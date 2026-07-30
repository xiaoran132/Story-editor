import unittest
from unittest.mock import patch

from app.graph.story_graph import get_story_graph, run_start
from app.prompts import REVIEW_SYSTEM, STORY_SYSTEM


def story(content: str) -> dict:
    return {
        "content": content,
        "options": [
            {"text": "正面交涉", "hint": "可能获得信任，但会暴露目的"},
            {"text": "先行撤离", "hint": "暂避风险，但可能错失线索"},
        ],
        "state_delta": {"hp": -1},
        "summary": "你在港口发现了可疑的密信。",
        "is_ending": False,
        "ending_type": "",
    }


class StoryGraphReviewTest(unittest.TestCase):
    def setUp(self) -> None:
        get_story_graph.cache_clear()

    def tearDown(self) -> None:
        get_story_graph.cache_clear()

    def test_rejected_draft_is_regenerated_with_reviewer_feedback(self) -> None:
        generated = iter([story("第一稿"), story("通过审校的第二稿")])
        reviews = iter([
            {"passed": False, "issues": ["选项后果不够明确"]},
            {"passed": True, "issues": []},
        ])
        calls: list[tuple[str, str]] = []

        def fake_chat(system: str, prompt: str, **_: object) -> dict:
            calls.append((system, prompt))
            if system == STORY_SYSTEM:
                return next(generated)
            self.assertEqual(system, REVIEW_SYSTEM)
            return next(reviews)

        with patch("app.graph.story_graph.chat_json", side_effect=fake_chat):
            result = run_start({"background": "海港悬疑"}, {"hp": 10})

        self.assertEqual(result["content"], "通过审校的第二稿")
        generation_prompts = [prompt for system, prompt in calls if system == STORY_SYSTEM]
        self.assertEqual(len(generation_prompts), 2)
        self.assertIn("上一稿未通过质量审校", generation_prompts[1])
        self.assertIn("选项后果不够明确", generation_prompts[1])

    def test_exhausted_retries_degrades_and_delivers_last_draft(self) -> None:
        # 重写耗尽不再硬失败：交付最后一稿（降级交付），绝不让玩家操作失败。
        generated = iter([story("第一稿"), story("第二稿"), story("第三稿")])
        reviews = iter([
            {"passed": False, "issues": ["问题一"]},
            {"passed": False, "issues": ["问题二"]},
            {"passed": False, "issues": ["问题三"]},
        ])

        def fake_chat(system: str, _: str, **__: object) -> dict:
            if system == STORY_SYSTEM:
                return next(generated)
            self.assertEqual(system, REVIEW_SYSTEM)
            return next(reviews)

        with patch("app.graph.story_graph.chat_json", side_effect=fake_chat):
            result = run_start({"background": "海港悬疑"}, {"hp": 10})

        self.assertEqual(result["content"], "第三稿")  # 交付最后一稿，而非报错


if __name__ == "__main__":
    unittest.main()
