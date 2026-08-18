"""对外请求/响应模型。字段命名与 Go 后端 JSON 契约对齐（snake_case）。"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class NoneTolerantModel(BaseModel):
    """把显式传入的 null 视为「字段缺失」，回落到默认值。

    Go 侧 nil 的 map/slice 会被 json.Marshal 成 null，而 pydantic 默认拒绝非 Optional
    字段收到 null（返回 422）。此基类在校验前剔除值为 None 的键，交给字段默认值兜底。
    """

    @model_validator(mode="before")
    @classmethod
    def _drop_none_values(cls, data):
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if v is not None}
        return data


# ----- BYOK：随请求下发的 LLM 配置 -----

class LLMConfig(NoneTolerantModel):
    """Go 侧按环节解析出的有效 LLM 配置，随请求体下发。字段全可空；缺字段时 agent 明确报配置缺失。

    provider 仅作标签（OpenAI 兼容端点只需 base_url+api_key+model）。与 Go 的 AgentLLMConfig 对齐。
    """
    provider: str = ""
    base_url: str = ""
    api_key: str = ""
    model: str = ""


# ----- 通用剧情结构 -----

class Option(BaseModel):
    """AI 推荐的下一步选项。"""
    text: str = ""
    hint: str = ""


class StyleProfile(NoneTolerantModel):
    """可选的结构化文风约束；缺省时完全兼容旧作品。"""
    narrative_distance: Literal["close", "medium", "distant"] | None = None
    rhythm: Literal["mixed", "tight", "relaxed"] | None = None
    sensory_focus: list[str] = Field(default_factory=list, max_length=3)
    dialogue_rule: str = Field(default="", max_length=160)
    avoid: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("sensory_focus", "avoid")
    @classmethod
    def _short_nonempty_items(cls, items: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in items:
            value = item.strip()
            if not value:
                raise ValueError("条目不能为空")
            if len(value) > 48:
                raise ValueError("条目不能超过 48 个字符")
            cleaned.append(value)
        return cleaned

    @field_validator("dialogue_rule")
    @classmethod
    def _short_dialogue_rule(cls, value: str) -> str:
        return value.strip()


class WorldConfig(NoneTolerantModel):
    """作品世界观配置（对应 stories.world_config）。"""
    background: str = ""
    style: str = ""
    rules: str = ""
    outline: str = ""  # 故事大纲：核心悬念/走向锚点/可能结局，作为 AI 导演的脊柱（非线性脚本）
    characters: list[Any] = Field(default_factory=list)
    initial_state: dict[str, Any] = Field(default_factory=dict)
    # 属性键类型声明：{"hp": {"type": "number", ...}, "items": {"type": "set"}, ...}
    # type ∈ number(数值累加) / scalar(覆盖式) / set(集合增删)。未声明时按值类型推断。
    attributes: dict[str, Any] = Field(default_factory=dict)
    style_profile: StyleProfile | None = None


class PathStep(BaseModel):
    """回溯路径上的一步（玩家选择 + 该步剧情正文 + 截至该步的前情提要）。"""
    choice_text: str = ""
    content: str = ""
    summary: str = ""  # 截至该节点的滚动前情提要（④节点树增量摘要）；老数据为空时回退滑动窗口


class StageUsage(BaseModel):
    """单个环节的 token 用量。

    estimated=True 表示端点没在响应里回 usage、数字是按字符估算的——Go 据此打埋点。
    「扣费全靠估算」是需要知道的事实，不该被一个精确的数字掩盖。
    """
    prompt_tokens: int = 0
    completion_tokens: int = 0
    estimated: bool = False


class Usage(BaseModel):
    """按环节分开的用量（两个环节可能是不同模型、不同单价，Go 要分别折算）。"""
    write: StageUsage = Field(default_factory=StageUsage)
    review: StageUsage = Field(default_factory=StageUsage)


class AIResult(BaseModel):
    """一次生成的结构化结果（Go 侧 AIResult 的镜像）。"""
    usage: Usage = Field(default_factory=Usage)  # 本次调用的 token 用量，供 Go 扣平台额度
    content: str = ""
    options: list[Option] = Field(default_factory=list)
    state_delta: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""  # 截至本段的前情提要，随节点落库供后续续写复用
    revealed: list[str] = Field(default_factory=list)  # 本段揭示的「揭示门控」属性键（首次向玩家展示）
    is_ending: bool = False
    ending_type: str = ""


# ----- /generate 与 /continue 请求 -----

class GenerateRequest(NoneTolerantModel):
    """开场生成：给定世界观与初始属性。"""
    world: WorldConfig = Field(default_factory=WorldConfig)
    initial_state: dict[str, Any] = Field(default_factory=dict)
    revealed_attrs: list[str] = Field(default_factory=list)  # 已揭示的门控属性（开局通常为空）
    llm_write: LLMConfig | None = None   # BYOK：写手配置（Go 按玩家 write 环节解析）
    llm_review: LLMConfig | None = None  # BYOK：审校配置（Go 按玩家 review 环节解析）


class ContinueRequest(NoneTolerantModel):
    """续写：给定世界观、历史路径、当前属性与本次玩家选择。"""
    world: WorldConfig = Field(default_factory=WorldConfig)
    history: list[PathStep] = Field(default_factory=list)
    current_state: dict[str, Any] = Field(default_factory=dict)
    choice: str = ""
    revealed_attrs: list[str] = Field(default_factory=list)  # 已揭示的门控属性，供 agent 知道还剩哪些未揭示
    llm_write: LLMConfig | None = None
    llm_review: LLMConfig | None = None


class OpeningCompleteRequest(NoneTolerantModel):
    """为已写定的开场正文补生成起始选项 + 前情提要（预设 opening_content 的作品）。"""
    world: WorldConfig = Field(default_factory=WorldConfig)
    initial_state: dict[str, Any] = Field(default_factory=dict)
    content: str = ""
    llm_write: LLMConfig | None = None  # BYOK：补全用写手配置


# ----- 创作辅助请求/响应 -----

class WorldDraft(BaseModel):
    """可回填到 stories.world_config 的世界观草稿。"""
    background: str = ""
    style: str = ""
    rules: str = ""
    outline: str = ""
    characters: list[dict[str, Any]] = Field(default_factory=list)
    initial_state: dict[str, Any] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)
    usage: StageUsage = Field(default_factory=StageUsage)


class GenerateWorldRequest(NoneTolerantModel):
    idea: str
    style: str = ""
    llm: LLMConfig | None = None  # BYOK：world 环节配置（Go 按创作者 world 环节解析）


class OpeningDraft(BaseModel):
    content: str = ""
    options: list[Option] = Field(default_factory=list)
    usage: StageUsage = Field(default_factory=StageUsage)


class GenerateOpeningRequest(NoneTolerantModel):
    world: WorldConfig = Field(default_factory=WorldConfig)
    llm_write: LLMConfig | None = None   # BYOK：开场走完整 play 管线，写手 + 审校分别下发
    llm_review: LLMConfig | None = None


class PolishRequest(NoneTolerantModel):
    text: str
    instruction: str = ""
    world: WorldConfig = Field(default_factory=WorldConfig)
    llm: LLMConfig | None = None  # BYOK：world 环节配置


class StyleIssue(BaseModel):
    category: Literal["ai_tell", "rhythm", "dialogue_voice", "style_drift", "redundancy"]
    span_hint: str = Field(min_length=1, max_length=120)
    goal: str = Field(min_length=1, max_length=180)


class StyleAnchor(BaseModel):
    id: str = Field(min_length=1, max_length=48)
    description: str = Field(min_length=1, max_length=160)


class StyleReview(BaseModel):
    score: int = Field(..., ge=0, le=100)
    has_major: bool
    issues: list[StyleIssue] = Field(..., max_length=2)
    anchors: list[StyleAnchor] = Field(..., max_length=12)
    missing_anchor_ids: list[str] = Field(..., max_length=12)


class PolishDraft(BaseModel):
    text: str = ""
    applied: bool = False
    feedback: list[StyleIssue] = Field(default_factory=list, max_length=2)
    usage: StageUsage = Field(default_factory=StageUsage)


class BranchSuggestion(BaseModel):
    title: str = ""
    summary: str = ""


class SuggestBranchesRequest(NoneTolerantModel):
    world: WorldConfig = Field(default_factory=WorldConfig)
    content: str
    count: int = 3
    llm: LLMConfig | None = None  # BYOK：world 环节配置


class BranchesResponse(BaseModel):
    branches: list[BranchSuggestion] = Field(default_factory=list)
    usage: StageUsage = Field(default_factory=StageUsage)


# ----- 节点语义合并去重 -----

class MergeCandidate(NoneTolerantModel):
    """已有的同层子节点，作为新选择的合并候选。"""
    choice_text: str = ""
    content: str = ""


class MergeCheckRequest(NoneTolerantModel):
    """判定新选择是否与某个已有候选语义等价（候选已由 Go 侧按 state_delta 相等预筛）。"""
    new_choice: str = ""
    new_content: str = ""
    candidates: list[MergeCandidate] = Field(default_factory=list)


class MergeCheckResponse(BaseModel):
    """matched_index 为命中的候选下标；-1 表示都不等价、应新建节点。"""
    matched_index: int = -1
    reason: str = ""


# ----- 校验用户自带 LLM key 是否可用 -----

class ValidateKeyRequest(BaseModel):
    """校验一个 LLM API key 是否可用（不落库，仅一次性 ping）。"""
    api_key: str = ""
    base_url: str = ""  # 可选：覆盖端点（兼容其他 OpenAI 兼容供应商）
    model: str = ""     # 可选：覆盖模型


class ValidateKeyResponse(BaseModel):
    ok: bool = False
    detail: str = ""  # 失败原因（如鉴权失败/超时），成功为空
