"""Regression tests for the author-side style-polish loop."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.llm import Usage
from app.routers import assist
from app.schemas import PolishRequest, StyleProfile


SOURCE = "雨落在站台上。林舟非常难过，他知道自己失去了最后一次机会。"
ISSUE = {"category": "ai_tell", "span_hint": "非常难过", "goal": "用动作和感官细节呈现情绪"}
ANCHOR = {"id": "a1", "description": "雨落在站台；林舟失去最后一次机会"}


def review(score: int, major: bool, *, missing: list[str] | None = None) -> dict:
    return {
        "score": score,
        "has_major": major,
        "issues": [ISSUE] if major else [],
        "anchors": [ANCHOR],
        "missing_anchor_ids": missing or [],
    }


class StyleProfileSchemaTests(unittest.TestCase):
    def test_legacy_world_and_valid_profile(self) -> None:
        self.assertIsNone(PolishRequest(text=SOURCE).world.style_profile)
        profile = StyleProfile(
            narrative_distance="close", rhythm="tight",
            sensory_focus=["雨声", "铁锈"], avoid=["避免总结式收束"],
        )
        self.assertEqual(profile.sensory_focus, ["雨声", "铁锈"])

    def test_profile_rejects_empty_and_excess_items(self) -> None:
        with self.assertRaises(ValidationError):
            StyleProfile(sensory_focus=[" "])
        with self.assertRaises(ValidationError):
            StyleProfile(avoid=["a", "b", "c", "d", "e", "f"])


class PolishLoopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.req = PolishRequest(
            text=SOURCE,
            world={"style": "克制、近距离", "style_profile": {"rhythm": "tight"}},
            llm={"base_url": "https://example.test", "api_key": "key", "model": "m"},
        )

    def _chat(self, responses: list[dict]):
        calls: list[tuple[str, str]] = []

        def fake(system, user, *, usage_out=None, **_kwargs):
            calls.append((system, user))
            if usage_out is not None:
                usage_out.add(Usage(prompt=10, completion=5))
            value = responses.pop(0)
            if isinstance(value, Exception):
                raise value
            return value

        return calls, fake

    def test_no_major_runs_only_initial_review_and_returns_original(self) -> None:
        calls, fake = self._chat([review(80, False)])
        with patch.object(assist, "chat_json", fake):
            draft = assist.polish_with_style_review(self.req)
        self.assertFalse(draft.applied)
        self.assertEqual(draft.text, SOURCE)
        self.assertEqual(len(calls), 1)
        self.assertEqual(draft.usage.prompt_tokens, 10)

    def test_success_runs_review_polish_review_and_injects_profile(self) -> None:
        candidate = "雨敲着站台铁棚。林舟攥紧车票，最后一次机会从指缝里滑走。"
        calls, fake = self._chat([review(60, True), {"text": candidate}, review(66, False)])
        with patch.object(assist, "chat_json", fake):
            draft = assist.polish_with_style_review(self.req)
        self.assertTrue(draft.applied)
        self.assertEqual(draft.text, candidate)
        self.assertEqual(len(calls), 3)
        self.assertIn("tight", calls[0][1])
        self.assertEqual(draft.usage.completion_tokens, 15)

    def test_insufficient_score_or_missing_anchor_falls_back(self) -> None:
        candidate = "雨敲着站台铁棚。林舟攥紧车票，最后一次机会从指缝里滑走。"
        for final in (review(64, False), review(70, False, missing=["a1"])):
            with self.subTest(final=final):
                calls, fake = self._chat([review(60, True), {"text": candidate}, final])
                with patch.object(assist, "chat_json", fake):
                    draft = assist.polish_with_style_review(self.req)
                self.assertFalse(draft.applied)
                self.assertEqual(draft.text, SOURCE)
                self.assertEqual(len(calls), 3)

    def test_non_string_candidate_falls_back(self) -> None:
        for value in (None, 42, []):
            with self.subTest(value=value):
                calls, fake = self._chat([review(60, True), {"text": value}])
                with patch.object(assist, "chat_json", fake):
                    draft = assist.polish_with_style_review(self.req)
                self.assertFalse(draft.applied)
                self.assertEqual(draft.text, SOURCE)
                self.assertEqual(len(calls), 2)

    def test_missing_required_review_fields_fall_back(self) -> None:
        initial = review(60, True)
        initial.pop("anchors")
        calls, fake = self._chat([initial])
        with patch.object(assist, "chat_json", fake):
            draft = assist.polish_with_style_review(self.req)
        self.assertFalse(draft.applied)
        self.assertEqual(draft.text, SOURCE)
        self.assertEqual(len(calls), 1)

        final = review(66, False)
        final.pop("missing_anchor_ids")
        calls, fake = self._chat([review(60, True), {"text": SOURCE}, final])
        with patch.object(assist, "chat_json", fake):
            draft = assist.polish_with_style_review(self.req)
        self.assertFalse(draft.applied)
        self.assertEqual(draft.text, SOURCE)
        self.assertEqual(len(calls), 3)

    def test_length_bypass_requires_non_negated_request(self) -> None:
        source = "0123456789"
        candidate = "x" * 20
        self.assertFalse(assist._length_allowed(source, candidate, "不要扩写，保持简洁"))
        self.assertTrue(assist._length_allowed(source, candidate, "请扩写"))

    def test_empty_candidate_and_stage_exception_fall_back_with_known_usage(self) -> None:
        for responses, expected_calls in (([review(60, True), {"text": ""}], 2), ([review(60, True), RuntimeError("model")], 2)):
            with self.subTest(responses=responses):
                calls, fake = self._chat(list(responses))
                with patch.object(assist, "chat_json", fake):
                    draft = assist.polish_with_style_review(self.req)
                self.assertFalse(draft.applied)
                self.assertEqual(draft.text, SOURCE)
                self.assertEqual(len(calls), expected_calls)
                self.assertEqual(draft.usage.prompt_tokens, expected_calls * 10)

    def test_initial_budget_precheck_does_not_start_review(self) -> None:
        calls, fake = self._chat([])
        with patch.object(assist, "chat_json", fake), patch.object(assist, "_has_next_stage_budget", return_value=False):
            draft = assist.polish_with_style_review(self.req)
        self.assertFalse(draft.applied)
        self.assertEqual(draft.text, SOURCE)
        self.assertEqual(len(calls), 0)
        self.assertEqual(draft.usage.prompt_tokens, 0)

    def test_budget_exhaustion_after_initial_review_does_not_polish(self) -> None:
        calls, fake = self._chat([review(60, True)])
        with patch.object(assist, "chat_json", fake), patch.object(assist.time, "monotonic", side_effect=[0, 0, 166]):
            draft = assist.polish_with_style_review(self.req)
        self.assertFalse(draft.applied)
        self.assertEqual(draft.text, SOURCE)
        self.assertEqual(len(calls), 1)

    def test_insufficient_remaining_budget_does_not_start_next_stage(self) -> None:
        calls, fake = self._chat([review(60, True)])
        with patch.object(assist, "chat_json", fake), patch.object(assist.time, "monotonic", side_effect=[0, 0, 110]):
            draft = assist.polish_with_style_review(self.req)
        self.assertFalse(draft.applied)
        self.assertEqual(draft.text, SOURCE)
        self.assertEqual(len(calls), 1)

    def test_missing_llm_config_keeps_endpoint_error_semantics(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            assist.polish(PolishRequest(text=SOURCE))
        self.assertEqual(raised.exception.status_code, 502)

    def test_polish_loop_has_no_player_graph_dependency(self) -> None:
        calls, fake = self._chat([review(80, False)])
        with patch.object(assist, "chat_json", fake), patch.object(assist, "run_start", side_effect=AssertionError("must not run")):
            draft = assist.polish_with_style_review(self.req)
        self.assertFalse(draft.applied)


if __name__ == "__main__":
    unittest.main()
