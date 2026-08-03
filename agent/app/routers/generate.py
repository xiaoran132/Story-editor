"""游玩链路（全流式）：/generate/stream（开场）、/continue/stream（续写）、
/opening/complete（预设开场补全）、/merge-check（节点合并），供 Go 后端调用。"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..graph.story_graph import complete_opening, run_continue_stream, run_start_stream
from ..llm import chat_json
from ..prompts import MERGE_SYSTEM
from ..schemas import (
    AIResult,
    ContinueRequest,
    GenerateRequest,
    MergeCheckRequest,
    MergeCheckResponse,
    OpeningCompleteRequest,
)

router = APIRouter(tags=["play"])


def _sse(event: str, data: dict) -> str:
    """编码一帧 SSE。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _sse_stream(events: AsyncIterator[dict]) -> AsyncIterator[str]:
    """把流水线事件（delta/revise/done）转成 SSE 帧；异常转 error 帧后正常结束流。"""
    try:
        async for ev in events:
            t = ev.get("type")
            if t == "delta":
                yield _sse("delta", {"text": ev.get("text", "")})
            elif t == "revise":
                yield _sse("revise", {})
            elif t == "done":
                yield _sse("done", ev.get("result", {}))
    except Exception as e:  # noqa: BLE001 —— 流已开始，只能以 error 帧告知下游
        yield _sse("error", {"detail": f"{type(e).__name__}: {e}"})


@router.post("/generate/stream")
def generate_stream(req: GenerateRequest) -> StreamingResponse:
    """流式开场：正文逐字（delta），结束后 done 携带结构化结果。"""
    initial = req.initial_state or req.world.initial_state or {}
    events = run_start_stream(req.world.model_dump(), initial, req.revealed_attrs)
    return StreamingResponse(_sse_stream(events), media_type="text/event-stream")


@router.post("/continue/stream")
def continue_stream(req: ContinueRequest) -> StreamingResponse:
    """流式续写：正文逐字（delta），审校拒绝发 revise，结束后 done 携带结构化结果。"""
    events = run_continue_stream(
        req.world.model_dump(),
        [h.model_dump() for h in req.history],
        req.current_state,
        req.choice,
        req.revealed_attrs,
    )
    return StreamingResponse(_sse_stream(events), media_type="text/event-stream")


@router.post("/opening/complete", response_model=AIResult)
def opening_complete(req: OpeningCompleteRequest) -> AIResult:
    """为已写定的开场正文补生成起始选项 + 前情提要（非流式）。"""
    try:
        result = complete_opening(req.world.model_dump(), req.initial_state, req.content)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"ai opening complete failed: {e}") from e
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
