"""剧情生成工作流：prepare（构建上下文）→ 流式写作 → 结构化 → normalize → review。

唯一编排在 `_stream_pipeline`：写手只流式输出正文，随后复用 llm_write 配置生成结构化结果；
prepare/normalize/review 为共享纯函数，`complete_opening` 走非流式补全。历史上的 langgraph
非流式图已退休。
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from ..config import get_settings
from ..llm import LLMParseError, Usage, chat_json, chat_stream
from ..prompts import (
    OPENING_COMPLETE_SYSTEM,
    REVIEW_SYSTEM,
    STORY_WRITER_SYSTEM,
    STRUCTURE_SYSTEM,
)
from .state import StoryState

# 可观测性：每次生成打一行 logfmt 埋点（story.metrics gen ...），供离线 grep/jq 统计
# 首稿审校通过率、平均重写次数、延迟与 ttfb、降级率。详见 docs/handoff.md §9.1。
logger = logging.getLogger("story.metrics")


class StreamPipelineError(RuntimeError):
    """管线失败的外发包装。detail 进 SSE error 帧；usage 是已烧掉的 token——
    烧掉的 token 必须记账，路由层从异常上取 usage 附进 error 帧（Go 侧失败路径扣费）。
    """

    def __init__(self, detail: str, usage: dict[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.usage = usage or {}


def _to_json(v: Any) -> str:
    try:
        return json.dumps(v, ensure_ascii=False)
    except (TypeError, ValueError):
        return "{}"


def _write_world(lines: list[str], world: dict[str, Any]) -> None:
    lines.append("【世界观设定】")
    if world.get("background"):
        lines.append(f"背景：{world['background']}")
    if world.get("style"):
        lines.append(f"风格：{world['style']}")
    if world.get("rules"):
        lines.append(f"规则：{world['rules']}")
    if world.get("characters"):
        lines.append(f"角色：{_to_json(world['characters'])}")
    if world.get("outline"):
        # 故事大纲：给导演的走向锚点。分支叙事里据此保持脊柱、避免越走越散，
        # 但不是线性脚本——玩家选择仍决定具体路径，大纲只提供方向与关键节点。
        lines.append(f"故事大纲（走向锚点，非线性脚本，据此把控整体节奏与关键剧情）：{world['outline']}")


def _attr_types(world: dict[str, Any], known_keys: list[str]) -> dict[str, str]:
    """从 world.attributes 提取每个属性键的声明类型。

    只收录 **显式声明** 了合法类型（number|scalar|set）的键；未声明的键不入表，
    normalize 对其透传、Go 侧按取值推断合并——与 Go 的 mergeState 兜底保持一致。
    """
    declared = world.get("attributes") or {}
    types: dict[str, str] = {}
    if not isinstance(declared, dict):
        return types
    for k in known_keys:
        spec = declared.get(k)
        t = spec.get("type") if isinstance(spec, dict) else None
        if t in {"number", "scalar", "set"}:
            types[k] = t
    return types


def _write_attr_types(lines: list[str], attr_types: dict[str, str]) -> None:
    """把属性类型声明写进提示，指导模型按类型给出 state_delta。"""
    if not attr_types:
        return
    parts = [f"{k}（{t}）" for k, t in attr_types.items()]
    lines.append("\n属性类型：" + "，".join(parts))
    lines.append(
        "number 给增减量，scalar 给新值，set 给 {\"add\": [...], \"remove\": [...]}。"
    )


def _hidden_attrs(world: dict[str, Any]) -> list[str]:
    """从 world.attributes 提取标了 hidden:true 的属性键（仅供 AI 参考、玩家端不显示）。"""
    declared = world.get("attributes") or {}
    if not isinstance(declared, dict):
        return []
    return [
        k for k, spec in declared.items()
        if isinstance(spec, dict) and spec.get("hidden") is True
    ]


def _write_hidden(lines: list[str], world: dict[str, Any]) -> None:
    """告知模型哪些属性对玩家隐藏，并约束其不得在玩家可见文本里泄漏。"""
    hidden = _hidden_attrs(world)
    if not hidden:
        return
    lines.append(
        "\n隐藏属性（对玩家不可见，仅供你把控走向的幕后仪表）：" + "、".join(hidden)
        + "。照常按剧情更新它们的 state_delta，但**绝不要在 content 或 options 里点出这些属性的名字或报出其数值**，"
        "只用剧情间接体现（如'他眼神里的戒备更重了'而非'怀疑度+10'）。"
    )


_DISTANCE_LABELS = {"close": "紧贴（贴近主角的内心与感官）",
                    "medium": "适中", "distant": "疏离（冷眼旁观的镜头感）"}
_RHYTHM_LABELS = {"mixed": "张弛交替", "tight": "紧凑推进", "relaxed": "舒缓铺陈"}


def _style_profile_block(world: dict[str, Any]) -> str:
    """把结构化文风档案渲染成写手侧的硬约束段；无档案时返回空串。

    ⚠️ 只给 Writer，**不进 prepare 的 user_prompt**。user_prompt 每回合会被完整重发给
    Writer / Structurer / Reviewer 三个调用（重写一轮再乘一遍），而 Structurer 只产选项、
    delta 与摘要，Reviewer 的判据里没有任何文风维度——两者拿到这段纯属烧 token。
    对应的回归断言在 tests/test_stream.py。

    入参是 model_dump() 后的 dict（routers/generate.py），不是 pydantic 对象，所以
    None/空列表/空串都得自己裁；不能复用 assist.py 的 _profile_context（那个用了 exclude_none）。
    """
    profile = world.get("style_profile")
    if not isinstance(profile, dict):
        return ""

    items: list[str] = []
    distance = _DISTANCE_LABELS.get(profile.get("narrative_distance") or "")
    if distance:
        items.append(f"叙事距离：{distance}")
    rhythm = _RHYTHM_LABELS.get(profile.get("rhythm") or "")
    if rhythm:
        items.append(f"叙事节奏：{rhythm}")

    def _clean(key: str) -> list[str]:
        raw = profile.get(key)
        return [s.strip() for s in raw if isinstance(s, str) and s.strip()] if isinstance(raw, list) else []

    focus = _clean("sensory_focus")
    if focus:
        items.append("感官侧重：" + "、".join(focus) + "（优先用这几类感官落笔，不要面面俱到）")
    rule = (profile.get("dialogue_rule") or "").strip() if isinstance(profile.get("dialogue_rule"), str) else ""
    if rule:
        items.append(f"对白规则：{rule}")

    # avoid 单独成条并加重语气：否定约束混在散文里最容易被模型忽略，
    # 这也是结构化档案相对自由文本 world.style 的主要增量价值。
    avoid = _clean("avoid")
    if avoid:
        items.append("**必须避免**：" + "、".join(avoid))

    if not items:
        return ""
    return ("\n\n【文风档案】本作品的文风硬约束，与上文「风格」一并遵守；"
            "冲突时以本档案为准：\n- " + "\n- ".join(items))


def _reveal_gated_attrs(world: dict[str, Any]) -> list[str]:
    """从 world.attributes 提取标了 reveal:true 的「揭示门控」属性键。

    这些属性玩家尚未发现、暂不显示；由 AI 在剧情真正让玩家发现/清点时，通过输出的
    revealed 列表揭示（区别于 hidden:true 的永不显示）。
    """
    declared = world.get("attributes") or {}
    if not isinstance(declared, dict):
        return []
    return [
        k for k, spec in declared.items()
        if isinstance(spec, dict) and spec.get("reveal") is True
    ]


def _write_reveal_gated(lines: list[str], world: dict[str, Any], revealed: list[str]) -> None:
    """告知模型哪些门控属性尚未向玩家揭示，以及如何/何时揭示。"""
    gated = _reveal_gated_attrs(world)
    already = set(revealed or [])
    pending = [k for k in gated if k not in already]
    if not pending:
        return
    lines.append(
        "\n未揭示属性（玩家尚未发现，暂不向玩家显示）：" + "、".join(pending)
        + "。在玩家真正发现/清点/接触到某项之前，**不要在 content 或 options 里点名或报出其数值**；"
        "当这一段剧情让玩家真正发现它时，把该属性键放进输出的 revealed 列表以对玩家揭示，"
        "并确保此刻它在 state_delta/当前属性中的数值真实合理。"
        "**仅是整理/清点/查看等揭示性动作不改变其数量**（如清点后发现有 5 份就揭示 5，不要凭空增减）。"
    )


def _write_history_step(lines: list[str], idx: int, step: dict[str, Any]) -> None:
    if step.get("choice_text"):
        lines.append(f"  [玩家选择] {step['choice_text']}")
    lines.append(f"  [剧情{idx}] {step.get('content', '')}")


# ④节点树增量摘要：摘要命中时，除【前情提要】外再补渲染的最近原文段数
_RECENT_RAW = 2


def _latest_summary(history: list[dict[str, Any]]) -> str:
    """取历史中最近一条非空 summary（截至当前节点的滚动前情提要）。"""
    for step in reversed(history):
        s = step.get("summary")
        if s:
            return str(s)
    return ""


def _write_history_window(lines: list[str], history: list[dict[str, Any]]) -> None:
    """渲染续写上下文的“已发生剧情”，两条路径（见 docs/context-strategy.md）：

    - ④节点树增量摘要（优先）：历史带 summary 时 = 【前情提要】(最近节点滚动摘要) + 最近
      _RECENT_RAW 段原文。上下文 O(1)、与深度无关，且保留关键实体/伏笔，避免深剧情前后矛盾。
    - ①滑动窗口（兜底）：老数据无 summary 时，退回「开局 + 最近 (window-1) 段」原文、中间折叠。
    """
    n = len(history)
    if n == 0:
        return

    summary = _latest_summary(history)
    if summary:
        lines.append(f"【前情提要】{summary}")
        recent = min(_RECENT_RAW, n)
        tail_start = n - recent
        if tail_start > 0:
            lines.append("【最近剧情原文】")
        for offset, step in enumerate(history[tail_start:]):
            _write_history_step(lines, tail_start + 1 + offset, step)
        return

    # —— 兜底：① 滑动窗口 ——
    window = get_settings().history_window
    if window <= 0 or n <= window:
        for i, step in enumerate(history, start=1):
            _write_history_step(lines, i, step)
        return

    # 开局锚定场景
    _write_history_step(lines, 1, history[0])
    tail_start = n - (window - 1)  # 最近 window-1 段的 0 基起始下标
    omitted = tail_start - 1  # 中间被折叠的段数（第 2 段起）
    if omitted > 0:
        lines.append(f"  （……中间 {omitted} 段剧情从略，其结果已反映在下方“当前属性”中……）")
    for offset, step in enumerate(history[tail_start:]):
        _write_history_step(lines, tail_start + 1 + offset, step)


def _clean_delta_value(attr_type: str, v: Any) -> Any | None:
    """按属性类型规整单个 delta 值；不合法返回 None（丢弃该键）。

    - number：必须是数值（int/float，排除 bool），否则丢弃。
    - set：规整为 {"add": [...], "remove": [...]}，两者都空则丢弃。
    - scalar：任意标量新值原样保留。
    """
    if attr_type == "number":
        if isinstance(v, bool):
            return None
        return v if isinstance(v, (int, float)) else None
    if attr_type == "set":
        if not isinstance(v, dict):
            return None
        add = v.get("add") or []
        remove = v.get("remove") or []
        add = add if isinstance(add, list) else []
        remove = remove if isinstance(remove, list) else []
        if not add and not remove:
            return None
        return {"add": add, "remove": remove}
    # scalar 及未知类型：原样保留
    return v


# ----- 图节点 -----

def prepare(state: StoryState) -> dict[str, Any]:
    """构建用户提示，并确定 state_delta 的合法属性键与类型。"""
    world = state.get("world") or {}
    lines: list[str] = []
    _write_world(lines, world)

    revealed = state.get("revealed_attrs") or []
    if state.get("mode") == "start":
        initial = state.get("initial_state") or world.get("initial_state") or {}
        known = list(initial.keys())
        attr_types = _attr_types(world, known)
        lines.append(f"\n当前属性：{_to_json(initial)}")
        _write_attr_types(lines, attr_types)
        _write_hidden(lines, world)
        _write_reveal_gated(lines, world, revealed)
        lines.append("\n【本回合目标】生成开场，建立可供玩家行动的场景。")
    else:
        current = state.get("current_state") or {}
        known = list(current.keys())
        attr_types = _attr_types(world, known)
        lines.append("\n已发生的剧情（从开局到当前，按顺序）：")
        _write_history_window(lines, state.get("history") or [])
        lines.append(f"\n当前属性：{_to_json(current)}")
        _write_attr_types(lines, attr_types)
        _write_hidden(lines, world)
        _write_reveal_gated(lines, world, revealed)
        lines.append(f"\n玩家现在的选择/行动：{state.get('choice', '')}")
        lines.append("\n【本回合目标】承接玩家现在的选择/行动，推进下一段已经发生的剧情。")

    return {
        "user_prompt": "\n".join(lines),
        # 只给 Writer 的文风块：见 _style_profile_block 的说明，不并进 user_prompt。
        "style_block": _style_profile_block(world),
        "known_keys": known,
        "attr_types": attr_types,
        "reveal_gated": _reveal_gated_attrs(world),  # normalize 据此白名单校验 revealed
    }


def _split_feedback(issues: Any) -> tuple[str, str]:
    """把审校 issues 按标注分流为（正文类，元数据类）两条反馈。

    审校被要求每条 issue 以【正文】/【元数据】开头（见 REVIEW_SYSTEM）；模型不遵守时
    默认归正文类——行为回退到分流前的「全部反馈喂写手」，不会丢反馈。
    """
    items = issues if isinstance(issues, list) else [issues]
    content_parts: list[str] = []
    meta_parts: list[str] = []
    for issue in items:
        text = str(issue).strip()
        if not text:
            continue
        if text.startswith("【元数据】"):
            meta_parts.append(text.removeprefix("【元数据】").strip())
        else:
            content_parts.append(text.removeprefix("【正文】").strip())
    return "；".join(content_parts), "；".join(meta_parts)


def review(state: StoryState) -> dict[str, Any]:
    """调用 AI 审校当前生成；拒绝时把可执行反馈按【正文】/【元数据】分流，
    分别交给写手修订与结构化助手下一轮修正。"""
    candidate = _to_json(state.get("raw") or {})
    prompt = (
        f"{state['user_prompt']}\n"
        "\n【待审查的候选 JSON】\n"
        f"{candidate}\n"
        "\n请仅按系统要求返回审校 JSON。"
    )
    verdict = chat_json(REVIEW_SYSTEM, prompt, temperature=0.2, llm_cfg=state.get("llm_cfg"),
                        usage_out=state.get("usage_out"),
                        max_tokens=get_settings().ai_review_max_tokens)
    passed = verdict.get("passed") is True
    issues = verdict.get("issues") or []
    if isinstance(issues, list):
        feedback = "；".join(str(issue) for issue in issues if str(issue).strip())
    else:
        feedback = str(issues)
    content_feedback, meta_feedback = _split_feedback(issues)
    if not passed and not feedback:
        content_feedback = feedback = "候选内容未通过质量审校；请重新核对剧情承接、选项后果、属性变化和前情提要。"

    # 逐次审校判定打点：用来回答「审校到底在拒什么、是不是形同橡皮图章」。
    # depth（会话已发生剧情段数）让「拒因随深度上升」类信号可计算（判据见
    # docs/external-lessons.md §2.0），由管线传入。
    depth = int(state.get("depth") or 0)
    attempt = state.get("review_failures", 0) + 1
    if passed:
        logger.info("review verdict=pass depth=%d attempt=%d", depth, attempt)
    else:
        logger.info("review verdict=reject depth=%d attempt=%d issues=%s", depth, attempt, feedback)

    return {
        "review_passed": passed,
        "review_feedback": feedback,
        "review_content_feedback": content_feedback,
        "review_meta_feedback": meta_feedback,
        "review_failures": state.get("review_failures", 0) + (0 if passed else 1),
    }


def normalize(state: StoryState) -> dict[str, Any]:
    """归一化 LLM 输出：过滤非法属性键、补默认字段、规整结局。"""
    raw = state.get("raw") or {}
    known = set(state.get("known_keys") or [])

    # options 规整为 [{text}]：选项只给行动文字，不再产出 hint（见 prompts.py 选项规则）。
    # 即便模型偶尔手滑塞了 hint，这里也丢弃——schema 的 Option.hint 默认空、前端隐藏，双重保证不外显。
    options: list[dict[str, str]] = []
    for opt in raw.get("options") or []:
        if isinstance(opt, dict):
            options.append({"text": str(opt.get("text", ""))})
        elif isinstance(opt, str):
            options.append({"text": opt})

    # state_delta 只保留已声明的属性键，并按类型规整；杜绝模型发明新键或用错格式
    delta_in = raw.get("state_delta") or {}
    attr_types = state.get("attr_types") or {}
    state_delta: dict[str, Any] = {}
    if isinstance(delta_in, dict):
        for k, v in delta_in.items():
            if known and k not in known:
                continue
            cleaned = _clean_delta_value(attr_types.get(k), v)
            if cleaned is not None:
                state_delta[k] = cleaned

    is_ending = bool(raw.get("is_ending", False))
    ending_type = str(raw.get("ending_type", "") or "")
    if is_ending and ending_type not in {"good", "bad", "neutral", "hidden"}:
        ending_type = "neutral"

    # revealed 只保留声明为「揭示门控」的键，杜绝模型揭示非门控/不存在的属性。
    gated = set(state.get("reveal_gated") or [])
    revealed_in = raw.get("revealed") or []
    revealed = [str(k) for k in revealed_in if k in gated] if isinstance(revealed_in, list) else []

    result = {
        "content": str(raw.get("content", "")),
        "options": options,
        "state_delta": state_delta,
        "summary": str(raw.get("summary", "")),  # ④节点树增量摘要，随节点落库供后续续写复用
        "revealed": revealed,
        "is_ending": is_ending,
        "ending_type": ending_type,
    }
    return {"result": result}


# ===== 流式流水线（唯一的生成编排：写作与结构化职责拆分） =====
# Writer 只逐字输出玩家可见正文；其结束后复用同一个 llm_write 配置调用
# STRUCTURE_SYSTEM 生成选项/状态/摘要。再 normalize + review，拒绝则有记忆修订、
# 超限则降级交付。prepare/normalize/review 为共享纯函数；complete_opening 走非流式。

def _structure(state: dict[str, Any], prose: str, llm_cfg: dict[str, Any] | None = None,
               usage_out: Usage | None = None, feedback: str = "") -> dict[str, Any]:
    """基于已写定的正文生成结构化元数据，复用写手配置并累计 write usage。

    feedback 非空 = 上一版元数据被审校拒绝的具体问题（【元数据】类反馈），追加在
    prompt 尾部令结构化助手带记忆修正——审校两大真实拒因都出在元数据上，不喂反馈
    只能靠重跑碰运气。
    """
    prompt = (
        state["user_prompt"]
        + "\n【已写好的剧情正文】\n"
        + prose
        + "\n请只为上面这段正文输出结构化元数据 JSON（不要改写正文）。"
    )
    if feedback:
        prompt += f"\n上一版结构化元数据未通过审校，需修正：{feedback}\n请修正上述问题后重新输出，不要改写正文。"
    return chat_json(STRUCTURE_SYSTEM, prompt, llm_cfg=llm_cfg, usage_out=usage_out,
                     max_tokens=get_settings().ai_structure_max_tokens)


async def _stream_pipeline(mode: str, base_state: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    """公共流式流水线，产出事件：
    {"type":"delta","text":..} 正文增量 / {"type":"revise"} 审校拒绝需重来 / {"type":"done","result":..}。
    异常（LLMParseError/其它）打点后包装成 StreamPipelineError（附已烧 usage）抛出，
    由路由转 SSE error 帧——error 帧可选携带 usage，Go 侧失败路径据此记账。"""
    prep = prepare(base_state)
    state = {**base_state, **prep}
    # Writer 与 Structurer 共享 llm_write；Review 独占 llm_review。两者均由 Go 下发，
    # agent 没有默认可退——llm_write 缺失会在 chat_stream/chat_json 中抛 LLMConfigMissing。
    llm_write = base_state.get("llm_write")
    llm_review = base_state.get("llm_review")
    # llm_review 为 None = 玩家关掉了质量审校（作品级开关，默认关）。此时跳过审校，
    # 但仍必须生成结构化结果；埋点打 review=off，别让"没审校"伪装成 first_draft_pass=true。
    review_on = bool(llm_review)
    # write 累计 Writer + Structurer 的 token：两者复用同一模型配置、同一计费单价。
    # review 单独累计，因为它可使用另一条模型连接。
    usage_write, usage_review = Usage(), Usage()
    max_retries = max(0, get_settings().ai_review_max_retries)
    # depth=会话已发生剧情段数（开场为 0）：埋点按深度分桶是阶段二触发判据的
    # 前置（external-lessons §2.0），没有它「拒因随深度上升」类信号不可计算。
    depth = len(base_state.get("history") or [])
    start = time.perf_counter()
    ttfb_ms: int | None = None
    failures = 0

    # 有记忆的 Writer：首轮 system+user；被拒时追加上一稿正文与审校反馈，令其在
    # 自己上一稿基础上修订而非从头重写。Structurer 和 Reviewer 都是按当前版本单独调用。
    writer_msgs = [
        SystemMessage(content=STORY_WRITER_SYSTEM),
        HumanMessage(content=state["user_prompt"] + state.get("style_block", "")),
    ]
    meta_feedback = ""  # 上一轮【元数据】类审校反馈，喂给本轮 Structurer 修正

    try:
        while True:
            # —— 流式写作：每个正文 chunk 都可直接外发；结构化阶段不会阻塞首字。——
            prose_chunks: list[str] = []
            async for chunk in chat_stream(
                writer_msgs, llm_cfg=llm_write, usage_out=usage_write,
                max_tokens=get_settings().ai_write_max_tokens,
            ):
                if ttfb_ms is None:
                    ttfb_ms = round((time.perf_counter() - start) * 1000)
                prose_chunks.append(chunk)
                yield {"type": "delta", "text": chunk}

            prose = "".join(prose_chunks).strip()
            # ⚠️ 必须丢进工作线程：本函数是 async generator，由 StreamingResponse 在
            # 事件循环里迭代，而 chat_json 走的 llm.invoke 是同步阻塞网络 I/O。
            # 直接调用会卡住整个 uvicorn worker——一个玩家在结构化，其他玩家的逐字流全停。
            tail = await asyncio.to_thread(_structure, state, prose, llm_write, usage_write, meta_feedback)
            raw = {**tail, "content": prose}  # Writer 正文是唯一权威，不能被 Structurer 的意外字段覆盖
            result = normalize(
                {"raw": raw, "known_keys": state["known_keys"], "attr_types": state["attr_types"],
                 "reveal_gated": state["reveal_gated"]}
            )["result"]

            if review_on:
                # 同上：审校也是同步阻塞调用，留在事件循环里会把整个 worker 锁住。
                rv = await asyncio.to_thread(review, {
                    "user_prompt": state["user_prompt"], "raw": raw,
                    "review_failures": failures, "llm_cfg": llm_review,
                    "usage_out": usage_review, "depth": depth,
                })
            else:
                rv = {"review_passed": True, "review_failures": failures, "review_feedback": "",
                      "review_content_feedback": "", "review_meta_feedback": ""}
            failures = rv["review_failures"]
            feedback = rv["review_feedback"]
            # 通过 或 重写耗尽 → 都交付本稿（耗尽为降级交付，不硬失败）。
            degraded = (not rv["review_passed"]) and failures > max_retries
            if rv["review_passed"] or degraded:
                elapsed_ms = round((time.perf_counter() - start) * 1000)
                if degraded:
                    logger.warning("review degraded (stream, delivered after %d rejections): %s",
                                   failures, feedback)
                logger.info(
                    "gen mode=%s outcome=ok stream=1 depth=%d elapsed_ms=%d ttfb_ms=%d "
                    "review=%s review_failures=%d first_draft_pass=%s degraded=%s is_ending=%s "
                    "tok_in=%d tok_out=%d usage_estimated=%s",
                    mode, depth, elapsed_ms, ttfb_ms if ttfb_ms is not None else -1,
                    "on" if review_on else "off",
                    failures, failures == 0, degraded, bool(result.get("is_ending")),
                    usage_write["prompt_tokens"] + usage_review["prompt_tokens"],
                    usage_write["completion_tokens"] + usage_review["completion_tokens"],
                    usage_write["estimated"] or usage_review["estimated"],
                )
                yield {"type": "done", "result": result,
                       "usage": {"write": dict(usage_write), "review": dict(usage_review)}}
                return

            # 拒绝且未超限。反馈按审校标注分流：【正文】类喂写手修订；【元数据】类喂
            # 下一轮 Structurer——拒因只在元数据时不无谓重写正文，写手原样重发上一稿
            # （管线必须流式产出正文，不跳过 Writer、revise 事件语义不变）。
            content_feedback = rv.get("review_content_feedback", "")
            meta_feedback = rv.get("review_meta_feedback", "")
            writer_msgs.append(AIMessage(content=prose))
            if content_feedback:
                writer_msgs.append(HumanMessage(content=(
                    f"上一稿未通过质量审校。需修正的问题：{content_feedback}\n"
                    "请在上一稿基础上修订：保留已经写好、没问题的部分，只针对上述问题改动；"
                    "若问题是结构性的（如整段方向或节奏不对），可以较大改动。"
                    "只输出完整的修订正文，不要 JSON、选项、状态、摘要或解释。"
                )))
            else:
                writer_msgs.append(HumanMessage(content=(
                    "上一稿正文未发现硬伤，本次审校问题只在选项/属性/摘要等结构化元数据（将另行修正）。"
                    "请原样输出上一稿正文，不要改动剧情与文字。"
                    "只输出完整的正文，不要 JSON、选项、状态、摘要或解释。"
                )))
            yield {"type": "revise"}  # 通知前端清空已流出的正文，准备重来
    except Exception as e:  # noqa: BLE001 —— 打点后包装抛给路由转 SSE error（帧带 usage）
        elapsed_ms = round((time.perf_counter() - start) * 1000)
        outcome = "parse_error" if isinstance(e, LLMParseError) else "error"
        logger.warning(
            "gen mode=%s outcome=%s stream=1 depth=%d elapsed_ms=%d ttfb_ms=%d err_type=%s detail=%s",
            mode, outcome, depth, elapsed_ms, ttfb_ms if ttfb_ms is not None else -1,
            type(e).__name__, e,
        )
        raise StreamPipelineError(
            f"{type(e).__name__}: {e}",
            {"write": dict(usage_write), "review": dict(usage_review)},
        ) from e


def run_continue_stream(
    world: dict[str, Any],
    history: list[dict[str, Any]],
    current_state: dict[str, Any],
    choice: str,
    revealed_attrs: list[str] | None = None,
    llm_write: dict[str, Any] | None = None,
    llm_review: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    return _stream_pipeline(
        "continue",
        {"mode": "continue", "world": world, "history": history,
         "current_state": current_state, "choice": choice,
         "revealed_attrs": revealed_attrs or [],
         "llm_write": llm_write, "llm_review": llm_review},
    )


def run_start_stream(
    world: dict[str, Any], initial_state: dict[str, Any],
    revealed_attrs: list[str] | None = None,
    llm_write: dict[str, Any] | None = None,
    llm_review: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    return _stream_pipeline(
        "start", {"mode": "start", "world": world, "initial_state": initial_state,
                  "revealed_attrs": revealed_attrs or [],
                  "llm_write": llm_write, "llm_review": llm_review},
    )


def _drain(agen: AsyncIterator[dict[str, Any]]) -> dict[str, Any]:
    """把流式管线同步跑到底，丢弃 delta，返回 done 的最终 result。

    供**不需要流式**的调用方复用同一条编排（/assist/opening、离线工具），避免另起一套。
    仅可在无运行中事件循环处调用（FastAPI 的 def 端点在线程池执行，满足）。
    """
    async def collect() -> dict[str, Any]:
        result: dict[str, Any] = {}
        async for ev in agen:
            if ev.get("type") == "done":
                # usage 一并带出：非流式路径（/assist/opening）同样要计费。
                result = {**ev["result"], "usage": ev.get("usage") or {}}
        return result
    return asyncio.run(collect())


def run_start(
    world: dict[str, Any], initial_state: dict[str, Any],
    llm_write: dict[str, Any] | None = None, llm_review: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """同步开场（drain 流式管线取最终结果）。"""
    return _drain(run_start_stream(world, initial_state, None, llm_write, llm_review))


def run_continue(
    world: dict[str, Any], history: list[dict[str, Any]],
    current_state: dict[str, Any], choice: str,
    llm_write: dict[str, Any] | None = None, llm_review: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """同步续写（drain 流式管线取最终结果）。"""
    return _drain(run_continue_stream(world, history, current_state, choice, None, llm_write, llm_review))


def complete_opening(
    world: dict[str, Any], initial_state: dict[str, Any], content: str,
    llm_write: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """为已写定的开场正文补生成起始选项 + 前情提要（预设 opening_content 的作品，非流式）。"""
    known = list((initial_state or {}).keys())
    attr_types = _attr_types(world, known)
    lines: list[str] = []
    _write_world(lines, world)
    lines.append(f"\n初始属性：{_to_json(initial_state or {})}")
    _write_attr_types(lines, attr_types)
    lines.append("\n已写定的开场正文：\n" + content)
    lines.append("\n请为这段开场补出玩家的起始选项与前情提要（不要改写正文）。")
    usage = Usage()
    raw = chat_json(OPENING_COMPLETE_SYSTEM, "\n".join(lines), llm_cfg=llm_write, usage_out=usage)
    raw["content"] = content
    result = normalize({"raw": raw, "known_keys": known, "attr_types": attr_types})["result"]
    # 补全也烧写手环节的 token，一并回传供 Go 扣费——预设开场不是免费的。
    return {**result, "usage": {"write": dict(usage)}}
