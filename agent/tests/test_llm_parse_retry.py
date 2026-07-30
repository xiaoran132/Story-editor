"""覆盖 chat_json 的 parse 重试：非法 JSON 时重发纠正指令，耗尽后抛 LLMParseError。"""
import unittest
from unittest.mock import patch

from app.llm import LLMParseError, chat_json


class _FakeResp:
    def __init__(self, content: str) -> None:
        self.content = content


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
        with patch("app.llm.get_llm", return_value=fake):
            data = chat_json("系统提示", "用户提示")

        self.assertEqual(data, {"ok": True})
        self.assertEqual(len(fake.calls), 2)  # 首发失败 + 一次重试
        retry_user_msg = fake.calls[1][1].content  # 第二次的 HumanMessage
        self.assertIn("合法 JSON", retry_user_msg)  # 重试附带了纠正指令

    def test_exhausted_parse_retry_raises(self) -> None:
        fake = _FakeLLM(["坏的一", "坏的二"])  # 默认 ai_parse_max_retries=1 → 共 2 次
        with patch("app.llm.get_llm", return_value=fake):
            with self.assertRaises(LLMParseError):
                chat_json("系统提示", "用户提示")

        self.assertEqual(len(fake.calls), 2)

    def test_non_dict_json_also_retried(self) -> None:
        fake = _FakeLLM(["[1, 2, 3]", '{"ok": 1}'])  # 合法 JSON 但不是对象 → 也要重试
        with patch("app.llm.get_llm", return_value=fake):
            data = chat_json("系统提示", "用户提示")

        self.assertEqual(data, {"ok": 1})
        self.assertEqual(len(fake.calls), 2)


if __name__ == "__main__":
    unittest.main()
