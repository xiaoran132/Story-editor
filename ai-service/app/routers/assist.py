"""创作辅助链路：世界观 / 开场 / 润色 / 分支建议（功能设计 1.3.1）。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..graph.story_graph import run_start
from ..llm import chat_json
from ..prompts import BRANCH_SYSTEM, POLISH_SYSTEM, WORLD_SYSTEM
from ..schemas import (
    BranchesResponse,
    BranchSuggestion,
    GenerateOpeningRequest,
    GenerateWorldRequest,
    OpeningDraft,
    Option,
    PolishDraft,
    PolishRequest,
    SuggestBranchesRequest,
    WorldDraft,
)

router = APIRouter(prefix="/assist", tags=["assist"])


def _fail(what: str, e: Exception) -> HTTPException:
    return HTTPException(status_code=502, detail=f"ai {what} failed: {e}")


@router.post("/world", response_model=WorldDraft)
def generate_world(req: GenerateWorldRequest) -> WorldDraft:
    """从一句话灵感生成世界观草稿。"""
    if not req.idea.strip():
        raise HTTPException(status_code=400, detail="idea is required")
    user = f"灵感：{req.idea}\n"
    if req.style:
        user += f"期望风格：{req.style}\n"
    user += "\n请据此生成完整世界观设定。"
    try:
        data = chat_json(WORLD_SYSTEM, user, temperature=0.9)
    except Exception as e:  # noqa: BLE001
        raise _fail("generate world", e) from e
    return WorldDraft(**data)


@router.post("/opening", response_model=OpeningDraft)
def generate_opening(req: GenerateOpeningRequest) -> OpeningDraft:
    """基于世界观生成开场剧情草稿（复用游玩侧生成图）。"""
    try:
        result = run_start(req.world.model_dump(), req.world.initial_state or {})
    except Exception as e:  # noqa: BLE001
        raise _fail("generate opening", e) from e
    return OpeningDraft(
        content=result["content"],
        options=[Option(**o) for o in result["options"]],
    )


@router.post("/polish", response_model=PolishDraft)
def polish(req: PolishRequest) -> PolishDraft:
    """对话/正文润色。"""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    user = ""
    if req.instruction:
        user += f"润色要求：{req.instruction}\n\n"
    user += f"原文：\n{req.text}"
    try:
        data = chat_json(POLISH_SYSTEM, user, temperature=0.7)
    except Exception as e:  # noqa: BLE001
        raise _fail("polish", e) from e
    return PolishDraft(text=str(data.get("text", "")))


@router.post("/branches", response_model=BranchesResponse)
def suggest_branches(req: SuggestBranchesRequest) -> BranchesResponse:
    """为当前节点建议若干后续分支走向。"""
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="content is required")
    count = req.count if req.count > 0 else 3

    lines = ["【世界观设定】"]
    w = req.world
    if w.background:
        lines.append(f"背景：{w.background}")
    if w.style:
        lines.append(f"风格：{w.style}")
    if w.rules:
        lines.append(f"规则：{w.rules}")
    lines.append(f"\n当前剧情正文：\n{req.content}")
    lines.append(f"\n请给出 {count} 条后续分支走向。")

    try:
        data = chat_json(BRANCH_SYSTEM, "\n".join(lines), temperature=0.9)
    except Exception as e:  # noqa: BLE001
        raise _fail("suggest branches", e) from e
    branches = [BranchSuggestion(**b) for b in (data.get("branches") or []) if isinstance(b, dict)]
    return BranchesResponse(branches=branches)
