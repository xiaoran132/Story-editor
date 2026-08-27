"""Regression tests for the author-side style-polish loop."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from app.llm import Usage
from app.routers import assist
from app.schemas import GenerateWorldRequest, PolishRequest


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

    def test_initial_budget_precheck_does_not_start_review(self) -> None:
        calls, fake = self._chat([])
        with patch.object(assist, "chat_json", fake), patch.object(assist, "_has_next_stage_budget", return_value=False):
            draft = assist.polish_with_style_review(self.req)
        self.assertFalse(draft.applied)
        self.assertEqual(draft.text, SOURCE)
        self.assertEqual(len(calls), 0)
        self.assertEqual(draft.usage.prompt_tokens, 0)


class GenerateWorldStyleProfileTests(unittest.TestCase):
    """/assist/world 产出 style_profile 时必须容错。

    WorldDraft 其余字段都是宽容默认值，唯独 StyleProfile 是严格模型（Literal 枚举 +
    max_length + 会 raise 的条目校验器），而 WorldDraft(**data) 在 generate_world 的
    try/except 之外——模型多吐一条 sensory_focus 就是未捕获异常、整个世界观生成 500。
    文风档案只是可选精修，绝不该让主功能挂掉。
    """

    BASE = {"background": "b", "style": "s", "rules": "r", "outline": "o",
            "characters": [], "initial_state": {}, "attributes": {}}
    REQ = GenerateWorldRequest(
        idea="一个灵感",
        llm={"base_url": "https://example.test", "api_key": "key", "model": "m"},
    )

    def _run(self, profile):
        def fake(_system, _user, *, usage_out=None, **_kwargs):
            if usage_out is not None:
                usage_out.add(Usage(1, 1))
            return {**self.BASE, "style_profile": profile}

        with patch.object(assist, "chat_json", fake):
            return assist.generate_world(self.REQ)

    def test_malformed_profile_is_clamped_not_raised(self) -> None:
        draft = self._run({
            "narrative_distance": "far",          # 越界枚举 → 丢弃
            "rhythm": "tight",
            "sensory_focus": ["a", "b", "c", "d"],  # 4 条 → 截到 3
            "dialogue_rule": "y" * 200,             # 200 字 → 截到 160
            "avoid": ["x" * 60],                    # 60 字 → 截到 48
        })
        self.assertIsNone(draft.style_profile.narrative_distance)
        self.assertEqual(draft.style_profile.rhythm, "tight")
        self.assertEqual(draft.style_profile.sensory_focus, ["a", "b", "c"])
        self.assertEqual(len(draft.style_profile.dialogue_rule), 160)
        self.assertEqual(len(draft.style_profile.avoid[0]), 48)

    def test_absent_or_empty_profile_stays_none(self) -> None:
        self.assertIsNone(self._run(None).style_profile)
        self.assertIsNone(self._run("垃圾").style_profile)
        self.assertIsNone(self._run({"sensory_focus": [], "dialogue_rule": ""}).style_profile)


if __name__ == "__main__":
    unittest.main()
