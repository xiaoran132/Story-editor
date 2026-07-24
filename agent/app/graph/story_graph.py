"""剧情生成 LangGraph 工作流：prepare -> generate -> normalize。

对应功能设计 1.3.2「AI Agent 工作流配置」：把「构建上下文 / 调用模型 / 结果校验」
拆成可编排、可替换、可扩展的图节点。后期可插入「检索历史」「一致性检查」「多模型
路由」等节点而不影响调用方。
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from langgraph.graph import END, StateGraph

from ..llm import chat_json
from ..prompts import STORY_SYSTEM
from .state import StoryState


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


def _write_history_window(lines: list[str], history: list[dict[str, Any]]) -> None:
    """滑动窗口渲染历史：只放「开局 + 最近 (window-1) 段」原文，中间折叠。

    更早的剧情结果已沉淀在“当前属性”快照里，故折叠不影响状态一致性，只损失远段叙事细节。
    window<=0 或历史不长时全量渲染。方案与演进见 docs/剧情上下文构建方案.md。
    """
    from ..config import get_settings

    window = get_settings().history_window
    n = len(history)
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
    """调用 LLM 生成结构化剧情。"""
    raw = chat_json(STORY_SYSTEM, state["user_prompt"])
    return {"raw": raw}


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
    g.add_node("normalize", normalize)

    g.set_entry_point("prepare")
    g.add_edge("prepare", "generate")
    g.add_edge("generate", "normalize")
    g.add_edge("normalize", END)
    return g.compile()


def run_start(world: dict[str, Any], initial_state: dict[str, Any]) -> dict[str, Any]:
    out = get_story_graph().invoke(
        {"mode": "start", "world": world, "initial_state": initial_state}
    )
    return out["result"]


def run_continue(
    world: dict[str, Any],
    history: list[dict[str, Any]],
    current_state: dict[str, Any],
    choice: str,
) -> dict[str, Any]:
    out = get_story_graph().invoke(
        {
            "mode": "continue",
            "world": world,
            "history": history,
            "current_state": current_state,
            "choice": choice,
        }
    )
    return out["result"]
