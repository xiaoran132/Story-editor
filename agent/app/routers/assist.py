"""Authoring assist routes: world, opening, polish, and branch suggestions."""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException

from ..config import get_settings
from ..graph.story_graph import run_start
from ..llm import LLMConfigMissing, Usage, chat_json, validate_key
from ..prompts import BRANCH_SYSTEM, STYLE_POLISH_SYSTEM, STYLE_REVIEW_SYSTEM, WORLD_SYSTEM
from ..schemas import (
    BranchesResponse,
    BranchSuggestion,
    GenerateOpeningRequest,
    GenerateWorldRequest,
    OpeningDraft,
    Option,
    PolishDraft,
    PolishRequest,
    StageUsage,
    StyleReview,
    SuggestBranchesRequest,
    ValidateKeyRequest,
    ValidateKeyResponse,
    WorldDraft,
)

router = APIRouter(prefix="/assist", tags=["assist"])


def _cfg(value) -> dict | None:
    """Return only the Go-resolved per-request model configuration."""
    if value is not None and getattr(value, "api_key", ""):
        return value.model_dump()
    return None


def _fail(what: str, error: Exception) -> HTTPException:
    return HTTPException(status_code=502, detail=f"ai {what} failed: {error}")


def _stage_usage(usage: Usage) -> StageUsage:
    return StageUsage(**usage)


def _opening_usage(result: dict) -> StageUsage:
    raw = result.get("usage") or {}
    if "prompt_tokens" in raw:
        return StageUsage(**raw)
    write = raw.get("write") or {}
    review = raw.get("review") or {}
    return StageUsage(
        prompt_tokens=int(write.get("prompt_tokens", 0)) + int(review.get("prompt_tokens", 0)),
        completion_tokens=int(write.get("completion_tokens", 0)) + int(review.get("completion_tokens", 0)),
        estimated=bool(write.get("estimated", False) or review.get("estimated", False)),
    )


def _profile_context(req: PolishRequest) -> str:
    lines = [f"Freeform style: {req.world.style or 'not provided'}"]
    profile = req.world.style_profile
    if profile is None:
        lines.append("Structured style profile: not provided")
    else:
        lines.append(
            "Structured style profile: " + json.dumps(profile.model_dump(exclude_none=True), ensure_ascii=False)
        )
    return "\n".join(lines)


def _length_allowed(source: str, candidate: str, instruction: str) -> bool:
    # Only explicit, non-negated expansion/compression instructions bypass the normal length guard.
    text = instruction.casefold()
    english_terms = ("expand", "compress", "shorten", "lengthen", "condense")
    chinese_terms = ("扩写", "压缩", "缩写", "加长", "精简")
    negated = (
        any(f"{prefix}{term}" in text for prefix in ("不要", "不", "别", "无需", "不用") for term in chinese_terms)
        or any(f"{prefix} {term}" in text for prefix in ("do not", "don't", "not", "no") for term in english_terms)
    )
    if not negated and any(term in text for term in english_terms + chinese_terms):
        return True
    return len(source) * 0.75 <= len(candidate) <= len(source) * 1.25


def _has_next_stage_budget(started: float, budget_seconds: int) -> bool:
    """Do not start a new model stage unless its configured timeout fits in the loop budget."""
    return time.monotonic() - started + get_settings().ai_timeout < budget_seconds


def _fallback(req: PolishRequest, usage: Usage, feedback=None) -> PolishDraft:
    return PolishDraft(
        text=req.text,
        applied=False,
        feedback=(feedback or [])[:2],
        usage=_stage_usage(usage),
    )


def polish_with_style_review(req: PolishRequest) -> PolishDraft:
    """Non-streaming author-side loop; it never invokes player graph or SSE functions."""
    usage = Usage()
    started = time.monotonic()
    budget_seconds = 165
    context = _profile_context(req)
    instruction = req.instruction or "not provided"

    if not _has_next_stage_budget(started, budget_seconds):
        return _fallback(req, usage)

    try:
        first = StyleReview(**chat_json(
            STYLE_REVIEW_SYSTEM,
            f"{context}\n\nInstruction: {instruction}\n\n[Initial review text]\n{req.text}",
            temperature=0.2,
            llm_cfg=_cfg(req.llm),
            usage_out=usage,
        ))
    except Exception:
        # Once inside the loop, model/JSON failures have a stable, billable fallback.
        return _fallback(req, usage)

    if not first.has_major or not _has_next_stage_budget(started, budget_seconds):
        return _fallback(req, usage, first.issues)

    try:
        polished = chat_json(
            STYLE_POLISH_SYSTEM,
            f"{context}\n\nInstruction: {instruction}\n"
            f"Issues: {json.dumps([issue.model_dump() for issue in first.issues], ensure_ascii=False)}\n"
            f"Required anchors: {json.dumps([anchor.model_dump() for anchor in first.anchors], ensure_ascii=False)}\n"
            f"[Text to polish]\n{req.text}",
            temperature=0.45,
            llm_cfg=_cfg(req.llm),
            usage_out=usage,
        )
        candidate_value = polished.get("text")
        if not isinstance(candidate_value, str):
            return _fallback(req, usage, first.issues)
        candidate = candidate_value.strip()
    except Exception:
        return _fallback(req, usage, first.issues)

    if not candidate or not _length_allowed(req.text, candidate, req.instruction):
        return _fallback(req, usage, first.issues)
    if not _has_next_stage_budget(started, budget_seconds):
        return _fallback(req, usage, first.issues)

    try:
        second = StyleReview(**chat_json(
            STYLE_REVIEW_SYSTEM,
            f"{context}\n\nInstruction: {instruction}\n"
            f"Initial anchors: {json.dumps([anchor.model_dump() for anchor in first.anchors], ensure_ascii=False)}\n"
            f"[Candidate review text]\n{candidate}",
            temperature=0.2,
            llm_cfg=_cfg(req.llm),
            usage_out=usage,
        ))
    except Exception:
        return _fallback(req, usage, first.issues)

    if second.score < first.score + 5 or second.has_major or second.missing_anchor_ids:
        return _fallback(req, usage, second.issues or first.issues)
    return PolishDraft(
        text=candidate,
        applied=True,
        feedback=second.issues,
        usage=_stage_usage(usage),
    )


_DISTANCES = {"close", "medium", "distant"}
_RHYTHMS = {"mixed", "tight", "relaxed"}


def _coerce_style_profile(raw: Any) -> dict[str, Any] | None:
    """把模型吐出的 style_profile 夹到合法范围；非法就丢，绝不抛。

    ⚠️ WorldDraft 其余字段都是宽容默认值，今天几乎不可能因模型输出而校验失败。
    但 StyleProfile 是严格模型（Literal 枚举 + max_length + 会 raise 的 item 校验器），
    直接塞进 WorldDraft(**data) 的话，模型多吐一条 sensory_focus 就是未捕获异常、
    整个世界观生成 500。文风档案只是可选精修，不该让主功能挂掉，所以这里夹取而不报错。
    夹完天然满足 Go 的发布校验（pkg/worldvalidate.go）。
    语义对齐前端 editorStore.loadStyleProfile。
    """
    if not isinstance(raw, dict):
        return None

    def _items(key: str, limit: int) -> list[str]:
        value = raw.get(key)
        if not isinstance(value, list):
            return []
        cleaned = [str(v).strip()[:48] for v in value if str(v).strip()]
        return cleaned[:limit]

    distance = raw.get("narrative_distance")
    rhythm = raw.get("rhythm")
    rule = raw.get("dialogue_rule")
    out = {
        "narrative_distance": distance if distance in _DISTANCES else None,
        "rhythm": rhythm if rhythm in _RHYTHMS else None,
        "sensory_focus": _items("sensory_focus", 3),
        "dialogue_rule": (str(rule).strip()[:160] if isinstance(rule, str) else ""),
        "avoid": _items("avoid", 5),
    }
    # 全空等于没给：别写一个空壳进 world_config。
    if not any(out.values()):
        return None
    return out


@router.post("/world", response_model=WorldDraft)
def generate_world(req: GenerateWorldRequest) -> WorldDraft:
    if not req.idea.strip():
        raise HTTPException(status_code=400, detail="idea is required")
    user = f"Idea: {req.idea}\n"
    if req.style:
        user += f"Desired style: {req.style}\n"
    user += "\nGenerate a complete story world."
    usage = Usage()
    try:
        data = chat_json(WORLD_SYSTEM, user, temperature=0.9, llm_cfg=_cfg(req.llm), usage_out=usage)
    except Exception as error:  # noqa: BLE001
        raise _fail("generate world", error) from error
    data["style_profile"] = _coerce_style_profile(data.get("style_profile"))
    return WorldDraft(**data, usage=_stage_usage(usage))


@router.post("/opening", response_model=OpeningDraft)
def generate_opening(req: GenerateOpeningRequest) -> OpeningDraft:
    """Opening remains the existing synchronous adapter to the player stream pipeline."""
    try:
        result = run_start(
            req.world.model_dump(), req.world.initial_state or {},
            _cfg(req.llm_write), _cfg(req.llm_review),
        )
    except Exception as error:  # noqa: BLE001
        raise _fail("generate opening", error) from error
    return OpeningDraft(
        content=result["content"],
        options=[Option(**option) for option in result["options"]],
        usage=_opening_usage(result),
    )


@router.post("/polish", response_model=PolishDraft)
def polish(req: PolishRequest) -> PolishDraft:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    cfg = _cfg(req.llm)
    if not cfg or any(not str(cfg.get(key, "")).strip() for key in ("api_key", "base_url", "model")):
        raise _fail("polish", LLMConfigMissing("missing complete LLM configuration"))
    return polish_with_style_review(req)


@router.post("/branches", response_model=BranchesResponse)
def suggest_branches(req: SuggestBranchesRequest) -> BranchesResponse:
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="content is required")
    count = req.count if req.count > 0 else 3
    world = req.world
    lines = ["[World]"]
    if world.background:
        lines.append(f"Background: {world.background}")
    if world.style:
        lines.append(f"Style: {world.style}")
    if world.rules:
        lines.append(f"Rules: {world.rules}")
    lines.extend((f"\nCurrent text:\n{req.content}", f"\nSuggest {count} branches."))
    usage = Usage()
    try:
        data = chat_json(
            BRANCH_SYSTEM, "\n".join(lines), temperature=0.9,
            llm_cfg=_cfg(req.llm), usage_out=usage,
        )
    except Exception as error:  # noqa: BLE001
        raise _fail("suggest branches", error) from error
    branches = [BranchSuggestion(**item) for item in (data.get("branches") or []) if isinstance(item, dict)]
    return BranchesResponse(branches=branches, usage=_stage_usage(usage))


@router.post("/validate-key", response_model=ValidateKeyResponse)
def validate_llm_key(req: ValidateKeyRequest) -> ValidateKeyResponse:
    ok, detail = validate_key(req.api_key, req.base_url, req.model)
    return ValidateKeyResponse(ok=ok, detail=detail)
