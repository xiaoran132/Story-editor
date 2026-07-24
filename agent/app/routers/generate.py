"""游玩链路：/generate（开场）与 /continue（续写），供 Go 后端调用。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..graph.story_graph import run_continue, run_start
from ..llm import chat_json
from ..prompts import MERGE_SYSTEM
from ..schemas import (
    AIResult,
    ContinueRequest,
    GenerateRequest,
    MergeCheckRequest,
    MergeCheckResponse,
)

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


@router.post("/merge-check", response_model=MergeCheckResponse)
def merge_check(req: MergeCheckRequest) -> MergeCheckResponse:
    """判定新选择是否与某个已有同层候选语义等价（候选由 Go 侧按 state_delta 相等预筛）。

    命中返回其下标 → Go 侧复用该节点而不新建，避免近义选择产生重复分支。
    候选为空直接返回 -1，不调用 LLM。
    """
    if not req.candidates:
        return MergeCheckResponse(matched_index=-1, reason="no candidates")

    lines = [f"新选择：{req.new_choice}"]
    if req.new_content.strip():
        lines.append(f"新选择产生的剧情正文：\n{req.new_content}")
    lines.append("\n已有候选（下标从 0 开始）：")
    for i, cand in enumerate(req.candidates):
        lines.append(f"[{i}] 选择：{cand.choice_text}")
    lines.append("\n请判断新选择是否与某个候选语义等价，返回 matched_index。")

    try:
        data = chat_json(MERGE_SYSTEM, "\n".join(lines), temperature=0.0)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"ai merge-check failed: {e}") from e

    idx = data.get("matched_index", -1)
    if not isinstance(idx, int) or idx < 0 or idx >= len(req.candidates):
        idx = -1
    return MergeCheckResponse(matched_index=idx, reason=str(data.get("reason", "")))
