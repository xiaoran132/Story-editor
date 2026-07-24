"""LangGraph 剧情生成工作流的共享状态。"""
from __future__ import annotations

from typing import Any, Literal, TypedDict


class StoryState(TypedDict, total=False):
    """在图节点之间流转的状态。

    输入字段由调用方填充；prepare/generate/normalize 逐步补全其余字段。
    """
    # 输入
    mode: Literal["start", "continue"]
    world: dict[str, Any]
    initial_state: dict[str, Any]
    current_state: dict[str, Any]
    history: list[dict[str, Any]]
    choice: str

    # 中间产物
    known_keys: list[str]        # 允许出现在 state_delta 中的属性键
    attr_types: dict[str, str]   # 属性键 -> number|scalar|set（normalize 按此规整 delta）
    user_prompt: str             # prepare 拼好的用户提示
    raw: dict[str, Any]          # generate 得到的原始 LLM JSON

    # 输出（归一化后的 AIResult 字段）
    result: dict[str, Any]
