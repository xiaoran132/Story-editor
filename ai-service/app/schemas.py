"""对外请求/响应模型。字段命名与 Go 后端 JSON 契约对齐（snake_case）。"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ----- 通用剧情结构 -----

class Option(BaseModel):
    """AI 推荐的下一步选项。"""
    text: str = ""
    hint: str = ""


class WorldConfig(BaseModel):
    """作品世界观配置（对应 stories.world_config）。"""
    background: str = ""
    style: str = ""
    rules: str = ""
    characters: list[Any] = Field(default_factory=list)
    initial_state: dict[str, Any] = Field(default_factory=dict)
    # 属性键类型声明：{"hp": {"type": "number", ...}, "items": {"type": "set"}, ...}
    # type ∈ number(数值累加) / scalar(覆盖式) / set(集合增删)。未声明时按值类型推断。
    attributes: dict[str, Any] = Field(default_factory=dict)


class PathStep(BaseModel):
    """回溯路径上的一步（玩家选择 + 该步剧情正文）。"""
    choice_text: str = ""
    content: str = ""


class AIResult(BaseModel):
    """一次生成的结构化结果（Go 侧 AIResult 的镜像）。"""
    content: str = ""
    options: list[Option] = Field(default_factory=list)
    state_delta: dict[str, Any] = Field(default_factory=dict)
    is_ending: bool = False
    ending_type: str = ""


# ----- /generate 与 /continue 请求 -----

class GenerateRequest(BaseModel):
    """开场生成：给定世界观与初始属性。"""
    world: WorldConfig = Field(default_factory=WorldConfig)
    initial_state: dict[str, Any] = Field(default_factory=dict)


class ContinueRequest(BaseModel):
    """续写：给定世界观、历史路径、当前属性与本次玩家选择。"""
    world: WorldConfig = Field(default_factory=WorldConfig)
    history: list[PathStep] = Field(default_factory=list)
    current_state: dict[str, Any] = Field(default_factory=dict)
    choice: str = ""


# ----- 创作辅助请求/响应 -----

class WorldDraft(BaseModel):
    """可回填到 stories.world_config 的世界观草稿。"""
    background: str = ""
    style: str = ""
    rules: str = ""
    characters: list[dict[str, Any]] = Field(default_factory=list)
    initial_state: dict[str, Any] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)


class GenerateWorldRequest(BaseModel):
    idea: str
    style: str = ""


class OpeningDraft(BaseModel):
    content: str = ""
    options: list[Option] = Field(default_factory=list)


class GenerateOpeningRequest(BaseModel):
    world: WorldConfig = Field(default_factory=WorldConfig)


class PolishRequest(BaseModel):
    text: str
    instruction: str = ""


class PolishDraft(BaseModel):
    text: str = ""


class BranchSuggestion(BaseModel):
    title: str = ""
    summary: str = ""


class SuggestBranchesRequest(BaseModel):
    world: WorldConfig = Field(default_factory=WorldConfig)
    content: str
    count: int = 3


class BranchesResponse(BaseModel):
    branches: list[BranchSuggestion] = Field(default_factory=list)
