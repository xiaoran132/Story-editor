"""覆盖流式流水线 _stream_pipeline：哨兵解析 / 结构化兜底 / review 拒绝重来 / 超限降级交付。"""
import unittest
from unittest.mock import patch

from app.graph import story_graph as sg
from app.graph.story_graph import run_continue_stream
from app.prompts import REVIEW_SYSTEM, STRUCTURE_SYSTEM

WORLD = {"background": "测试世界"}
STATE = {"hp": 10}


def make_stream(calls_chunks):
    """返回一个假的 chat_stream：第 N 次调用逐块产出 calls_chunks[N]。"""
    counter = {"n": 0}

    async def fake(system, user):
        i = counter["n"]
        counter["n"] += 1
        for c in calls_chunks[min(i, len(calls_chunks) - 1)]:
            yield c

    return fake


async def collect(agen):
    """把异步生成器的事件收集成列表。"""
    out = []
    async for ev in agen:
        out.append(ev)
    return out


class StreamPipelineTest(unittest.IsolatedAsyncioTestCase):
    async def test_sentinel_parse_and_pass(self) -> None:
        chunks = [[
            "你在城中", "行走。", "<<<ME", "TA>>>",
            '{"options":[{"text":"A","hint":"h"}],',
            '"state_delta":{"hp":-1},"summary":"s","is_ending":false,"ending_type":""}',
        ]]
        with patch.object(sg, "chat_stream", make_stream(chunks)), \
             patch.object(sg, "chat_json", lambda system, user, **kw: {"passed": True, "issues": []}):
            events = await collect(run_continue_stream(WORLD, [], STATE, "go"))

        deltas = "".join(e["text"] for e in events if e["type"] == "delta")
        done = [e for e in events if e["type"] == "done"]
        self.assertEqual(deltas, "你在城中行走。")
        self.assertEqual(len(done), 1)
        r = done[0]["result"]
        self.assertEqual(r["content"], "你在城中行走。")
        self.assertEqual(len(r["options"]), 1)
        self.assertEqual(r["state_delta"], {"hp": -1})

    async def test_missing_tail_uses_structurer(self) -> None:
        chunks = [["正文段落。", "<<<META>>>", "这不是JSON"]]

        def fake_json(system, user, **kw):
            if system == STRUCTURE_SYSTEM:
                return {"options": [{"text": "B", "hint": "h"}], "state_delta": {},
                        "summary": "s", "is_ending": False, "ending_type": ""}
            if system == REVIEW_SYSTEM:
                return {"passed": True, "issues": []}
            raise AssertionError(f"unexpected system: {system[:20]}")

        with patch.object(sg, "chat_stream", make_stream(chunks)), \
             patch.object(sg, "chat_json", fake_json):
            events = await collect(run_continue_stream(WORLD, [], STATE, "go"))

        done = [e for e in events if e["type"] == "done"][0]
        self.assertEqual(done["result"]["content"], "正文段落。")  # 正文保住
        self.assertEqual(done["result"]["options"][0]["text"], "B")  # 结构化来自兜底

    async def test_review_reject_then_revise_and_pass(self) -> None:
        tail = ('<<<META>>>{"options":[{"text":"A","hint":"h"}],"state_delta":{},'
                '"summary":"s","is_ending":false,"ending_type":""}')
        chunks = [["初稿。", tail], ["重写稿。", tail]]
        reviews = iter([
            {"passed": False, "issues": ["选项后果不明"]},
            {"passed": True, "issues": []},
        ])

        def fake_json(system, user, **kw):
            self.assertEqual(system, REVIEW_SYSTEM)
            return next(reviews)

        with patch.object(sg, "chat_stream", make_stream(chunks)), \
             patch.object(sg, "chat_json", fake_json):
            events = await collect(run_continue_stream(WORLD, [], STATE, "go"))

        types = [e["type"] for e in events]
        self.assertIn("revise", types)  # 第一稿被拒 → 通知前端清空
        done = [e for e in events if e["type"] == "done"][0]
        self.assertEqual(done["result"]["content"], "重写稿。")  # 交付重写稿

    async def test_exhausted_degrades_and_delivers(self) -> None:
        # 重写耗尽不再抛错：降级交付最后一稿（done），绝不让玩家操作失败。
        tail = ('<<<META>>>{"options":[{"text":"A","hint":"h"}],"state_delta":{},'
                '"summary":"s","is_ending":false,"ending_type":""}')
        chunks = [["稿。", tail]]  # 每次都同样，review 永远拒
        with patch.object(sg, "chat_stream", make_stream(chunks)), \
             patch.object(sg, "chat_json", lambda system, user, **kw: {"passed": False, "issues": ["x"]}):
            events = await collect(run_continue_stream(WORLD, [], STATE, "go"))

        done = [e for e in events if e["type"] == "done"]
        self.assertEqual(len(done), 1)  # 交付而非抛错
        self.assertEqual(done[0]["result"]["content"], "稿。")
        self.assertIn("revise", [e["type"] for e in events])  # 期间确实重试过


if __name__ == "__main__":
    unittest.main()
