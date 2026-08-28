"""chat_stream 的断流计费与按环节 max_tokens：烧掉的 token 不能因流中断而漏账。"""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from langchain_core.messages import HumanMessage

from app.llm import Usage, chat_stream
from app import llm as llm_mod

CFG = {"api_key": "k", "base_url": "https://x.invalid", "model": "m"}


class _Chunk(SimpleNamespace):
    """假的流式 chunk：chat_stream 只读 content 与 usage_metadata 两个属性。"""

    def __init__(self, text: str) -> None:
        super().__init__(content=text, usage_metadata=None)


class ChatStreamUsageTest(unittest.IsolatedAsyncioTestCase):

    async def test_usage_counted_when_consumer_closes_early(self) -> None:
        """消费方提前关流（客户端断开）：finally 也必须把已收到的部分计入 usage。"""

        class FakeChat:
            def __init__(self, **_kwargs): ...
            async def astream(self, _messages):
                yield _Chunk("你好")
                yield _Chunk("世界")

        usage = Usage()
        with patch.object(llm_mod, "ChatOpenAI", FakeChat):
            agen = chat_stream([HumanMessage(content="写")], llm_cfg=CFG, usage_out=usage)
            self.assertEqual(await agen.__anext__(), "你好")
            await agen.aclose()  # 触发生成器内的 GeneratorExit → finally 累计

        self.assertGreater(usage["completion_tokens"], 0)  # “你好”按字符估算
        self.assertTrue(usage["estimated"])               # 端点 usage 块没到，只能估算

    async def test_usage_counted_when_stream_errors(self) -> None:
        """上游中途抛错：异常照常冒泡，但已烧的部分必须已计入 usage。"""

        class BoomChat:
            def __init__(self, **_kwargs): ...
            async def astream(self, _messages):
                yield _Chunk("第一段")
                raise RuntimeError("connection reset")

        usage = Usage()
        with patch.object(llm_mod, "ChatOpenAI", BoomChat):
            with self.assertRaises(RuntimeError):
                async for _ in chat_stream([HumanMessage(content="写")], llm_cfg=CFG, usage_out=usage):
                    pass

        self.assertGreater(usage["completion_tokens"], 0)
        self.assertTrue(usage["estimated"])

    async def test_max_tokens_reaches_client(self) -> None:
        """chat_stream 的 max_tokens 透传到 ChatOpenAI 构造参数（0/None=不设上限）。"""
        seen: list[dict] = []

        class RecChat:
            def __init__(self, **kwargs):
                seen.append(kwargs)
            async def astream(self, _messages):
                yield _Chunk("稿")

        with patch.object(llm_mod, "ChatOpenAI", RecChat):
            async for _ in chat_stream([HumanMessage(content="x")], llm_cfg=CFG, max_tokens=777):
                pass
            async for _ in chat_stream([HumanMessage(content="x")], llm_cfg=CFG):
                pass

        self.assertEqual(seen[0]["max_tokens"], 777)
        self.assertNotIn("max_tokens", seen[1])


class CacheReadUsageTest(unittest.TestCase):
    """缓存命中 token 的提取（P0-3 缓存计价）：命中部分约 1/10 价，必须与未命中分开。"""

    def test_usage_of_reads_cache_from_usage_metadata(self) -> None:
        """OpenAI 风格 prompt_tokens_details.cached_tokens → input_token_details.cache_read。"""
        msg = SimpleNamespace(
            usage_metadata={"input_tokens": 100, "output_tokens": 50,
                            "input_token_details": {"cache_read": 30}},
            response_metadata={},
        )
        u = llm_mod._usage_of(msg, sent="", received="")
        self.assertEqual(u["cache_read_tokens"], 30)
        self.assertFalse(u["estimated"])

    def test_usage_of_falls_back_to_deepseek_native_field(self) -> None:
        """langchain 不映射 DeepSeek 原生字段，从原始 usage 兜底读。"""
        msg = SimpleNamespace(
            usage_metadata={"input_tokens": 100, "output_tokens": 50},
            response_metadata={"token_usage": {"prompt_cache_hit_tokens": 40}},
        )
        u = llm_mod._usage_of(msg, sent="", received="")
        self.assertEqual(u["cache_read_tokens"], 40)

    def test_no_cache_info_means_zero(self) -> None:
        """端点不回缓存信息 = 0（按全价计费，与加字段之前的行为一致）。"""
        msg = SimpleNamespace(usage_metadata={"input_tokens": 10, "output_tokens": 5}, response_metadata={})
        self.assertEqual(llm_mod._usage_of(msg, sent="", received="")["cache_read_tokens"], 0)
        est = llm_mod._usage_of(
            SimpleNamespace(usage_metadata=None, response_metadata={}), sent="x", received="y"
        )
        self.assertTrue(est["estimated"])
        self.assertEqual(est["cache_read_tokens"], 0)

    def test_usage_add_accumulates_cache_read(self) -> None:
        a, b = Usage(10, 5, cache_read=3), Usage(10, 5, cache_read=4)
        a.add(b)
        self.assertEqual(a["cache_read_tokens"], 7)


if __name__ == "__main__":
    unittest.main()
