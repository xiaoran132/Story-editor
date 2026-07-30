"""剧情生成 LangGraph 工作流：prepare -> generate -> normalize。

对应功能设计 1.3.2「AI Agent 工作流配置」：把「构建上下文 / 调用模型 / 结果校验」
拆成可编排、可替换、可扩展的图节点。后期可插入「检索历史」「一致性检查」「多模型
路由」等节点而不影响调用方。
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from langgraph.graph import END, StateGraph

from ..config import get_settings
from ..llm import LLMParseError, chat_json, chat_stream
from ..prompts import (
    _SENTINEL,
    OPENING_COMPLETE_SYSTEM,
    REVIEW_SYSTEM,
    STORY_STREAM_SYSTEM,
    STORY_SYSTEM,
    STRUCTURE_SYSTEM,
)
from .state import StoryState

# 阶段一可观测性：每次生成打一行 logfmt 埋点，供离线 grep/jq 统计
# 首稿审校通过率、每局平均重写次数、完整回复延迟 p95、报错率（按类型细分）。
# 详见 docs/开发交接手册.md §9.1；刻意不建大屏/新表，验证期用日志聚合即可。
logger = logging.getLogger("story.metrics")


class ReviewExhaustedError(RuntimeError):
    """重写次数耗尽仍未通过审校。独立类型，便于与 LLMParseError 在埋点里区分。"""


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
    """渲染续写上下文的“已发生剧情”，两条路径（见 docs/剧情上下文构建方案.md）：

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

    if state.get("mode") == "start":
        initial = state.get("initial_state") or world.get("initial_state") or {}
        known = list(initial.keys())
        attr_types = _attr_types(world, known)
        lines.append(f"\n当前属性：{_to_json(initial)}")
        _write_attr_types(lines, attr_types)
        lines.append(
            "\n请生成这部作品的开场剧情与初始推荐选项。开场通常不产生属性变化，state_delta 可为空对象 {}。"
        )
    else:
        current = state.get("current_state") or {}
        known = list(current.keys())
        attr_types = _attr_types(world, known)
        lines.append("\n已发生的剧情（从开局到当前，按顺序）：")
        _write_history_window(lines, state.get("history") or [])
        lines.append(f"\n当前属性：{_to_json(current)}")
        _write_attr_types(lines, attr_types)
        lines.append(f"\n玩家现在的选择/行动：{state.get('choice', '')}")
        lines.append("\n请承接以上剧情，生成下一段剧情、新的推荐选项，以及本次选择引起的属性变化。")

    return {"user_prompt": "\n".join(lines), "known_keys": known, "attr_types": attr_types}


def generate(state: StoryState) -> dict[str, Any]:
    """调用 LLM 生成结构化剧情；被审校拒绝时带反馈完整重写。"""
    prompt = state["user_prompt"]
    feedback = state.get("review_feedback", "")
    if feedback:
        prompt += (
            "\n【上一稿未通过质量审校】\n"
            f"以下问题必须全部修正：{feedback}\n"
            "请基于原始要求完整重写，并严格返回完整 JSON，不要解释修改过程。"
        )
    raw = chat_json(STORY_SYSTEM, prompt)
    return {"raw": raw, "review_feedback": ""}


def review(state: StoryState) -> dict[str, Any]:
    """调用 AI 审校当前生成；拒绝时把可执行反馈交给下一次重写。"""
    candidate = _to_json(state.get("raw") or {})
    prompt = (
        f"{state['user_prompt']}\n"
        "\n【待审查的候选 JSON】\n"
        f"{candidate}\n"
        "\n请仅按系统要求返回审校 JSON。"
    )
    verdict = chat_json(REVIEW_SYSTEM, prompt, temperature=0.2)
    passed = verdict.get("passed") is True
    issues = verdict.get("issues") or []
    if isinstance(issues, list):
        feedback = "；".join(str(issue) for issue in issues if str(issue).strip())
    else:
        feedback = str(issues)
    if not passed and not feedback:
        feedback = "候选内容未通过质量审校；请重新核对剧情承接、选项后果、属性变化和前情提要。"

    # 逐次审校判定打点：用来回答「审校到底在拒什么、是不是形同橡皮图章」。
    attempt = state.get("review_failures", 0) + 1
    if passed:
        logger.info("review verdict=pass attempt=%d", attempt)
    else:
        logger.info("review verdict=reject attempt=%d issues=%s", attempt, feedback)

    return {
        "review_passed": passed,
        "review_feedback": feedback,
        "review_failures": state.get("review_failures", 0) + (0 if passed else 1),
    }


def route_after_review(state: StoryState) -> str:
    """通过则归一化；被拒绝则有限重写，避免无限循环和不可控成本。"""
    if state.get("review_passed"):
        return "normalize"
    max_retries = max(0, get_settings().ai_review_max_retries)
    if state.get("review_failures", 0) <= max_retries:
        return "generate"
    return "review_failed"


def review_failed(state: StoryState) -> dict[str, Any]:
    """重写次数耗尽时拒绝交付未达标的内容。"""
    raise ReviewExhaustedError(
        "AI 生成内容在 "
        f"{state.get('review_failures', 0)} 次质量审校后仍未通过："
        f"{state.get('review_feedback', '未提供具体原因')}"
    )


def normalize(state: StoryState) -> dict[str, Any]:
    """归一化 LLM 输出：过滤非法属性键、补默认字段、规整结局。"""
    raw = state.get("raw") or {}
    known = set(state.get("known_keys") or [])

    # options 规整为 [{text, hint}]
    options: list[dict[str, str]] = []
    for opt in raw.get("options") or []:
        if isinstance(opt, dict):
            options.append({"text": str(opt.get("text", "")), "hint": str(opt.get("hint", ""))})
        elif isinstance(opt, str):
            options.append({"text": opt, "hint": ""})

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

    result = {
        "content": str(raw.get("content", "")),
        "options": options,
        "state_delta": state_delta,
        "summary": str(raw.get("summary", "")),  # ④节点树增量摘要，随节点落库供后续续写复用
        "is_ending": is_ending,
        "ending_type": ending_type,
    }
    return {"result": result}


@lru_cache
def get_story_graph():
    """编译并缓存剧情生成图。"""
    g = StateGraph(StoryState)
    g.add_node("prepare", prepare)
    g.add_node("generate", generate)
    g.add_node("review", review)
    g.add_node("review_failed", review_failed)
    g.add_node("normalize", normalize)

    g.set_entry_point("prepare")
    g.add_edge("prepare", "generate")
    g.add_edge("generate", "review")
    g.add_conditional_edges(
        "review",
        route_after_review,
        {"generate": "generate", "normalize": "normalize", "review_failed": "review_failed"},
    )
    g.add_edge("normalize", END)
    return g.compile()


def _invoke_with_metrics(mode: str, initial: dict[str, Any]) -> dict[str, Any]:
    """执行图并打点。成功打 outcome=ok，超限/异常打 outcome=error 后原样抛出。

    review_failures = 本次交付前被审校拒绝的次数（0 即首稿通过）；
    elapsed_ms = 完整回复耗时（无流式，暂无首字延迟）。
    """
    start = time.perf_counter()
    try:
        out = get_story_graph().invoke(initial)
    except Exception as e:  # noqa: BLE001 —— 仅打点后原样抛给路由转 502
        elapsed_ms = round((time.perf_counter() - start) * 1000)
        # 区分两类失败：审校超限（提示词/门槛问题）vs LLM 非法 JSON（解析/重试问题）。
        if isinstance(e, ReviewExhaustedError):
            outcome = "review_exhausted"
        elif isinstance(e, LLMParseError):
            outcome = "parse_error"
        else:
            outcome = "error"
        logger.warning(
            "gen mode=%s outcome=%s elapsed_ms=%d err_type=%s detail=%s",
            mode, outcome, elapsed_ms, type(e).__name__, e,
        )
        raise
    elapsed_ms = round((time.perf_counter() - start) * 1000)
    failures = int(out.get("review_failures", 0))
    result = out["result"]
    logger.info(
        "gen mode=%s outcome=ok elapsed_ms=%d review_failures=%d first_draft_pass=%s is_ending=%s",
        mode, elapsed_ms, failures, failures == 0, bool(result.get("is_ending")),
    )
    return result


def run_start(world: dict[str, Any], initial_state: dict[str, Any]) -> dict[str, Any]:
    return _invoke_with_metrics(
        "start", {"mode": "start", "world": world, "initial_state": initial_state}
    )


def run_continue(
    world: dict[str, Any],
    history: list[dict[str, Any]],
    current_state: dict[str, Any],
    choice: str,
) -> dict[str, Any]:
    return _invoke_with_metrics(
        "continue",
        {
            "mode": "continue",
            "world": world,
            "history": history,
            "current_state": current_state,
            "choice": choice,
        },
    )


# ===== 流式流水线（真流式·单次哨兵分隔） =====
# 与 langgraph 的同步 invoke 分离：正文 chat_stream 逐字产出，结束后按 _SENTINEL 切出
# JSON 尾；尾缺失/非法则用 STRUCTURE_SYSTEM 兜底；再 normalize + review，拒绝则 revise 重写。

def _structure_fallback(state: dict[str, Any], prose: str) -> dict[str, Any]:
    """哨兵后的 JSON 尾缺失/非法时，据已写好的正文补出结构化元数据（保住正文不重来）。"""
    prompt = (
        state["user_prompt"]
        + "\n【已写好的剧情正文】\n"
        + prose
        + "\n请只为上面这段正文输出结构化元数据 JSON（不要重写正文）。"
    )
    return chat_json(STRUCTURE_SYSTEM, prompt)


def _split_sentinel(buf: str) -> tuple[str, str]:
    """按哨兵切分累积缓冲：返回 (正文, JSON尾字符串)。无哨兵时尾为空。"""
    idx = buf.find(_SENTINEL)
    if idx == -1:
        return buf.strip(), ""
    return buf[:idx].strip(), buf[idx + len(_SENTINEL):].strip()


async def _stream_pipeline(mode: str, base_state: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    """公共流式流水线，产出事件：
    {"type":"delta","text":..} 正文增量 / {"type":"revise"} 审校拒绝需重来 / {"type":"done","result":..}。
    异常（LLMParseError/ReviewExhaustedError/其它）打点后原样抛出，由路由转 SSE error 帧。"""
    prep = prepare(base_state)
    state = {**base_state, **prep}
    max_retries = max(0, get_settings().ai_review_max_retries)
    start = time.perf_counter()
    ttfb_ms: int | None = None
    failures = 0
    feedback = ""

    try:
        while True:
            prompt = state["user_prompt"]
            if feedback:
                prompt += (
                    "\n【上一稿未通过质量审校】\n"
                    f"以下问题必须全部修正：{feedback}\n"
                    "请基于原始要求完整重写，正文照旧用哨兵分隔，不要解释修改过程。"
                )

            # —— 流式写作：只把哨兵之前的正文作为 delta 外发，尾部留给 JSON ——
            buf = ""
            emitted = 0
            hold = len(_SENTINEL) - 1  # 末尾暂留，避免把半个哨兵当正文发出
            async for chunk in chat_stream(STORY_STREAM_SYSTEM, prompt):
                if ttfb_ms is None:
                    ttfb_ms = round((time.perf_counter() - start) * 1000)
                buf += chunk
                idx = buf.find(_SENTINEL)
                if idx == -1:
                    safe = max(emitted, len(buf) - hold)
                    if safe > emitted:
                        yield {"type": "delta", "text": buf[emitted:safe]}
                        emitted = safe
                elif idx > emitted:
                    yield {"type": "delta", "text": buf[emitted:idx]}
                    emitted = idx  # 哨兵已现，之后不再外发正文

            prose, tail_str = _split_sentinel(buf)
            tail: Any = None
            if tail_str:
                try:
                    tail = json.loads(tail_str)
                except json.JSONDecodeError:
                    tail = None
            if not isinstance(tail, dict):
                tail = _structure_fallback(state, prose)  # 兜底：保住正文，补结构化尾

            raw = {"content": prose, **tail}
            result = normalize(
                {"raw": raw, "known_keys": state["known_keys"], "attr_types": state["attr_types"]}
            )["result"]

            rv = review({"user_prompt": state["user_prompt"], "raw": raw, "review_failures": failures})
            if rv["review_passed"]:
                elapsed_ms = round((time.perf_counter() - start) * 1000)
                logger.info(
                    "gen mode=%s outcome=ok stream=1 elapsed_ms=%d ttfb_ms=%d "
                    "review_failures=%d first_draft_pass=%s is_ending=%s",
                    mode, elapsed_ms, ttfb_ms if ttfb_ms is not None else -1,
                    failures, failures == 0, bool(result.get("is_ending")),
                )
                yield {"type": "done", "result": result}
                return

            failures = rv["review_failures"]
            feedback = rv["review_feedback"]
            if failures > max_retries:
                raise ReviewExhaustedError(
                    f"AI 生成内容在 {failures} 次质量审校后仍未通过：{feedback}"
                )
            yield {"type": "revise"}  # 通知前端清空已流出的正文，准备重来
    except Exception as e:  # noqa: BLE001 —— 打点后原样抛给路由转 SSE error
        elapsed_ms = round((time.perf_counter() - start) * 1000)
        if isinstance(e, ReviewExhaustedError):
            outcome = "review_exhausted"
        elif isinstance(e, LLMParseError):
            outcome = "parse_error"
        else:
            outcome = "error"
        logger.warning(
            "gen mode=%s outcome=%s stream=1 elapsed_ms=%d ttfb_ms=%d err_type=%s detail=%s",
            mode, outcome, elapsed_ms, ttfb_ms if ttfb_ms is not None else -1,
            type(e).__name__, e,
        )
        raise


def run_continue_stream(
    world: dict[str, Any],
    history: list[dict[str, Any]],
    current_state: dict[str, Any],
    choice: str,
) -> AsyncIterator[dict[str, Any]]:
    return _stream_pipeline(
        "continue",
        {"mode": "continue", "world": world, "history": history,
         "current_state": current_state, "choice": choice},
    )


def run_start_stream(
    world: dict[str, Any], initial_state: dict[str, Any]
) -> AsyncIterator[dict[str, Any]]:
    return _stream_pipeline(
        "start", {"mode": "start", "world": world, "initial_state": initial_state}
    )


def complete_opening(
    world: dict[str, Any], initial_state: dict[str, Any], content: str
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
    raw = chat_json(OPENING_COMPLETE_SYSTEM, "\n".join(lines))
    raw["content"] = content
    return normalize({"raw": raw, "known_keys": known, "attr_types": attr_types})["result"]
