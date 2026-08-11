"""覆盖 chat_json：parse 重试（非法 JSON 重发纠正指令、耗尽抛 LLMParseError）
与「没有下发配置就必须报错」（agent 不持有任何默认凭据）。"""
import unittest
from unittest.mock import patch

from app.llm import LLMConfigMissing, LLMParseError, chat_json


# 测 parse 重试用的最小合法配置：agent 不再有默认凭据，不传就先抛 LLMConfigMissing。
_CFG = {"api_key": "k", "base_url": "https://example.invalid", "model": "m"}


class _FakeResp:
    def __init__(self, content: str) -> None:
        self.content = content
        self.usage_metadata = {"input_tokens": 3, "output_tokens": 5}


class _FakeLLM:
    """按序吐出预设输出，记录每次 invoke 收到的消息。"""

    def __init__(self, outputs: list[str]) -> None:
        self._outputs = list(outputs)
        self.calls: list[list] = []

    def bind(self, **_: object) -> "_FakeLLM":
        return self

    def invoke(self, messages: list) -> _FakeResp:
        self.calls.append(messages)
        return _FakeResp(self._outputs.pop(0))


class ParseRetryTest(unittest.TestCase):
    def test_retry_recovers_from_bad_json(self) -> None:
        fake = _FakeLLM(["这不是 JSON", '{"ok": true}'])
        with patch("app.llm._build_ephemeral", return_value=fake):
            data = chat_json("系统提示", "用户提示", llm_cfg=_CFG)

        self.assertEqual(data, {"ok": True})
        self.assertEqual(len(fake.calls), 2)  # 首发失败 + 一次重试
        retry_user_msg = fake.calls[1][1].content  # 第二次的 HumanMessage
        self.assertIn("合法 JSON", retry_user_msg)  # 重试附带了纠正指令

    def test_exhausted_parse_retry_raises(self) -> None:
        fake = _FakeLLM(["坏的一", "坏的二"])  # 默认 ai_parse_max_retries=1 → 共 2 次
        with patch("app.llm._build_ephemeral", return_value=fake):
            with self.assertRaises(LLMParseError):
                chat_json("系统提示", "用户提示", llm_cfg=_CFG)

        self.assertEqual(len(fake.calls), 2)

    def test_non_dict_json_also_retried(self) -> None:
        fake = _FakeLLM(["[1, 2, 3]", '{"ok": 1}'])  # 合法 JSON 但不是对象 → 也要重试
        with patch("app.llm._build_ephemeral", return_value=fake):
            data = chat_json("系统提示", "用户提示", llm_cfg=_CFG)

        self.assertEqual(data, {"ok": 1})
        self.assertEqual(len(fake.calls), 2)


if __name__ == "__main__":
    unittest.main()

class MissingConfigTest(unittest.TestCase):
    """核心断言：没有下发 LLM 配置就必须报错，绝不回退到某个默认 key。

    这条曾经是 agent .env 里的 DEEPSEEK_API_KEY——一层看不见、无法限额、
    也不归 admin 管的服务器成本。删掉之后必须有测试守住它别被"顺手加回来"。
    """

    def test_no_cfg_raises(self) -> None:
        with self.assertRaises(LLMConfigMissing):
            chat_json("系统提示", "用户提示")

    def test_incomplete_cfg_raises(self) -> None:
        for bad in (
            {"api_key": "k", "base_url": "https://x.invalid"},                 # 缺 model
            {"api_key": "k", "model": "m"},                                    # 缺 base_url
            {"base_url": "https://x.invalid", "model": "m"},                   # 缺 api_key
            {"api_key": "  ", "base_url": "https://x.invalid", "model": "m"},   # 空白不算配了
        ):
            with self.subTest(cfg=sorted(bad)):
                with self.assertRaises(LLMConfigMissing):
                    chat_json("系统提示", "用户提示", llm_cfg=bad)
