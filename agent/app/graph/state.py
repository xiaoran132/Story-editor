"""剧情生成流水线（_stream_pipeline）的共享状态。"""
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
    # BYOK：Go 侧按环节解析下发的 LLM 配置（{provider,base_url,api_key,model}）；缺失即报错。
    llm_write: dict[str, Any]   # 写手（正文/结构化兜底）用
    llm_review: dict[str, Any]  # 审校用
    llm_cfg: dict[str, Any]     # review() 内部读取的当次配置（= llm_review）

    # 中间产物
    known_keys: list[str]        # 允许出现在 state_delta 中的属性键
    attr_types: dict[str, str]   # 属性键 -> number|scalar|set（normalize 按此规整 delta）
    user_prompt: str             # prepare 拼好的用户提示
    raw: dict[str, Any]          # generate 得到的原始 LLM JSON
    review_passed: bool           # review 是否认可当前 raw
    review_feedback: str          # review 拒绝时的完整反馈；管线内另按【正文】/【元数据】拆 content/meta 两路分流消费
    review_failures: int          # 当前内容已被拒绝的次数

    # 输出（归一化后的 AIResult 字段）
    result: dict[str, Any]
