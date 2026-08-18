"""覆盖玩家流式流水线：纯正文写作、同配置结构化、审校修订与分阶段 usage。"""
import unittest
from unittest.mock import patch

from app.graph import story_graph as sg
from app.graph.story_graph import run_continue_stream
from app.llm import Usage
from app.prompts import REVIEW_SYSTEM, STORY_WRITER_SYSTEM, STRUCTURE_SYSTEM

WORLD = {"background": "测试世界"}
STATE = {"hp": 10}
# review 是作品级开关（默认关）。写手与结构化助手共用 WRITE_CFG；审校才使用 REVIEW_CFG。
WRITE_CFG = {"api_key": "write-k", "base_url": "https://write.invalid", "model": "writer"}
REVIEW_CFG = {"api_key": "review-k", "base_url": "https://review.invalid", "model": "reviewer"}
STRUCTURE = {
    "options": [{"text": "继续前进"}],
    "state_delta": {"hp": -1},
    "summary": "你在城中受了伤。",
    "is_ending": False,
    "ending_type": "",
}


def make_stream(calls_chunks):
    """返回假的 chat_stream；第 N 次调用逐块产出 calls_chunks[N]。"""
    counter = {"n": 0}

    async def fake(messages, **_kw):
        i = counter["n"]
        counter["n"] += 1
        for chunk in calls_chunks[min(i, len(calls_chunks) - 1)]:
            yield chunk

    return fake


async def collect(agen):
    """把异步生成器事件收集成列表。"""
    out = []
    async for event in agen:
        out.append(event)
    return out


class StreamPipelineTest(unittest.IsolatedAsyncioTestCase):
    async def test_writer_context_omits_structured_output_instructions(self) -> None:
        """开局与续写给 Writer 的用户上下文不再要求选项、状态或 JSON。"""
        opening = sg.prepare({"mode": "start", "world": WORLD, "initial_state": STATE})["user_prompt"]
        continuing = sg.prepare({
            "mode": "continue", "world": WORLD, "history": [],
            "current_state": STATE, "choice": "go",
        })["user_prompt"]
        for prompt in (opening, continuing):
            self.assertNotIn("推荐选项", prompt)
            self.assertNotIn("属性变化", prompt)
            self.assertNotIn("state_delta", prompt)
    async def test_writer_streams_pure_prose_then_structures(self) -> None:
        """Writer 只流正文；Structurer 始终在正文结束后生成元数据。"""
        seen_writer_messages = []

        async def fake_stream(messages, **_kwargs):
            seen_writer_messages.append(messages)
            yield "你在城中"
            yield "行走。"

        def fake_json(system, user, **_kwargs):
            self.assertEqual(system, STRUCTURE_SYSTEM)
            self.assertIn("你在城中行走。", user)
            return {**STRUCTURE, "content": "Structurer 不得覆盖的文本。"}

        with patch.object(sg, "chat_stream", fake_stream), \
             patch.object(sg, "chat_json", fake_json):
            events = await collect(run_continue_stream(WORLD, [], STATE, "go"))

        deltas = "".join(event["text"] for event in events if event["type"] == "delta")
        self.assertEqual(deltas, "你在城中行走。")
        self.assertEqual(len(seen_writer_messages), 1)
        self.assertEqual(seen_writer_messages[0][0].content, STORY_WRITER_SYSTEM)
        self.assertNotIn("<<<META>>>", seen_writer_messages[0][0].content)
        writer_context = seen_writer_messages[0][-1].content
        self.assertNotIn("新的推荐选项", writer_context)
        self.assertNotIn("属性变化", writer_context)
        done = [event for event in events if event["type"] == "done"]
        self.assertEqual(len(done), 1)
        self.assertEqual(done[0]["result"]["content"], "你在城中行走。")
        self.assertEqual(done[0]["result"]["state_delta"], {"hp": -1})

    async def test_review_reject_then_rewrites_and_restructures(self) -> None:
        """审校拒绝后，Writer 与 Structurer 必须都重新执行，不能复用旧结构。"""
        calls = []
        reviews = iter([
            {"passed": False, "issues": ["选项后果不明"]},
            {"passed": True, "issues": []},
        ])

        async def fake_stream(messages, **_kwargs):
            calls.append(messages)
            yield "初稿。" if len(calls) == 1 else "重写稿。"

        def fake_json(system, _user, **_kwargs):
            if system == STRUCTURE_SYSTEM:
                return STRUCTURE
            self.assertEqual(system, REVIEW_SYSTEM)
            return next(reviews)

        with patch.object(sg, "chat_stream", fake_stream), \
             patch.object(sg, "chat_json", fake_json):
            events = await collect(
                run_continue_stream(WORLD, [], STATE, "go", None, WRITE_CFG, REVIEW_CFG)
            )

        self.assertEqual(len(calls), 2)
        revision_request = calls[1][-1].content
        self.assertIn("只输出完整的修订正文", revision_request)
        self.assertNotIn("<<<META>>>", revision_request)
        types = [event["type"] for event in events]
        self.assertEqual(types.count("revise"), 1)
        done = [event for event in events if event["type"] == "done"][0]
        self.assertEqual(done["result"]["content"], "重写稿。")

    async def test_exhausted_degrades_and_delivers(self) -> None:
        """重写耗尽仍交付最后一稿，保持玩家操作不因审校失败而失败。"""
        with patch.object(sg, "chat_stream", make_stream([["稿。"]])), \
             patch.object(
                 sg,
                 "chat_json",
                 lambda system, _user, **_kwargs: STRUCTURE if system == STRUCTURE_SYSTEM
                 else {"passed": False, "issues": ["x"]},
             ):
            events = await collect(
                run_continue_stream(WORLD, [], STATE, "go", None, WRITE_CFG, REVIEW_CFG)
            )

        done = [event for event in events if event["type"] == "done"]
        self.assertEqual(len(done), 1)
        self.assertEqual(done[0]["result"]["content"], "稿。")
        self.assertIn("revise", [event["type"] for event in events])

    async def test_writer_and_structurer_share_write_config_and_usage(self) -> None:
        """Structurer 是第二次 llm_write 调用；其 usage 聚合进 write，审校独立。"""
        seen_writer = []
        seen_structurer = []
        seen_reviewer = []

        async def fake_stream(_messages, **kwargs):
            seen_writer.append(kwargs["llm_cfg"])
            kwargs["usage_out"].add(Usage(11, 7))
            yield "正文。"

        def fake_json(system, _user, **kwargs):
            if system == STRUCTURE_SYSTEM:
                seen_structurer.append(kwargs["llm_cfg"])
                kwargs["usage_out"].add(Usage(13, 17))
                return STRUCTURE
            self.assertEqual(system, REVIEW_SYSTEM)
            seen_reviewer.append(kwargs["llm_cfg"])
            kwargs["usage_out"].add(Usage(5, 3))
            return {"passed": True, "issues": []}

        with patch.object(sg, "chat_stream", fake_stream), \
             patch.object(sg, "chat_json", fake_json):
            events = await collect(
                run_continue_stream(WORLD, [], STATE, "go", None, WRITE_CFG, REVIEW_CFG)
            )

        self.assertEqual(seen_writer, [WRITE_CFG])
        self.assertEqual(seen_structurer, [WRITE_CFG])
        self.assertEqual(seen_reviewer, [REVIEW_CFG])
        done = [event for event in events if event["type"] == "done"][0]
        self.assertEqual(done["usage"], {
            "write": {"prompt_tokens": 24, "completion_tokens": 24, "estimated": False},
            "review": {"prompt_tokens": 5, "completion_tokens": 3, "estimated": False},
        })

    async def test_review_off_still_structures_but_skips_audit(self) -> None:
        """关闭审校时仍执行 Structurer；只跳过 REVIEW_SYSTEM。"""
        systems = []

        def fake_json(system, _user, **_kwargs):
            systems.append(system)
            if system == STRUCTURE_SYSTEM:
                return STRUCTURE
            raise AssertionError("review 已关闭，不应调用 REVIEW_SYSTEM")

        with patch.object(sg, "chat_stream", make_stream([["首稿。"]])), \
             patch.object(sg, "chat_json", fake_json):
            events = await collect(run_continue_stream(WORLD, [], STATE, "go", None, WRITE_CFG))

        self.assertEqual(systems, [STRUCTURE_SYSTEM])
        self.assertNotIn("revise", [event["type"] for event in events])
        done = [event for event in events if event["type"] == "done"][0]
        self.assertEqual(done["result"]["content"], "首稿。")
        self.assertEqual(done["usage"]["review"]["completion_tokens"], 0)


if __name__ == "__main__":
    unittest.main()
