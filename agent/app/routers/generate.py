"""游玩链路：/generate（开场）与 /continue（续写），供 Go 后端调用。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..graph.story_graph import run_continue, run_start
from ..schemas import AIResult, ContinueRequest, GenerateRequest

router = APIRouter(tags=["play"])


@router.post("/generate", response_model=AIResult)
def generate(req: GenerateRequest) -> AIResult:
    """生成作品开场剧情。"""
    initial = req.initial_state or req.world.initial_state or {}
    try:
        result = run_start(req.world.model_dump(), initial)
    except Exception as e:  # noqa: BLE001 —— 统一转成 502，交由 Go 侧重试
        raise HTTPException(status_code=502, detail=f"ai generate failed: {e}") from e
    return AIResult(**result)


@router.post("/continue", response_model=AIResult)
def continue_story(req: ContinueRequest) -> AIResult:
    """根据历史路径与玩家选择续写下一段剧情。"""
    try:
        result = run_continue(
            req.world.model_dump(),
            [h.model_dump() for h in req.history],
            req.current_state,
            req.choice,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"ai continue failed: {e}") from e
    return AIResult(**result)
