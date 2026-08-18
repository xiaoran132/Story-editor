"""最小化守住 Agent LLM 边界：JSON 重试与无默认凭据。"""
import unittest
from unittest.mock import patch

from app.llm import LLMConfigMissing, chat_json

_CFG = {"api_key": "k", "base_url": "https://example.invalid", "model": "m"}


class _FakeResp:
    def __init__(self, content: str) -> None:
        self.content = content
        self.usage_metadata = {"input_tokens": 3, "output_tokens": 5}


class _FakeLLM:
    def __init__(self, outputs: list[str]) -> None:
        self._outputs = list(outputs)
        self.calls: list[list] = []

    def bind(self, **_: object) -> "_FakeLLM":
        return self

    def invoke(self, messages: list) -> _FakeResp:
        self.calls.append(messages)
        return _FakeResp(self._outputs.pop(0))


class LLMContractTests(unittest.TestCase):
    def test_invalid_json_retries_then_recovers(self) -> None:
        for invalid in ("这不是 JSON", "[1, 2, 3]"):
            with self.subTest(invalid=invalid):
                fake = _FakeLLM([invalid, '{"ok": true}'])
                with patch("app.llm._build_ephemeral", return_value=fake):
                    data = chat_json("系统提示", "用户提示", llm_cfg=_CFG)

                self.assertEqual(data, {"ok": True})
                self.assertEqual(len(fake.calls), 2)
                self.assertIn("合法 JSON", fake.calls[1][1].content)

    def test_missing_or_incomplete_config_fails_closed(self) -> None:
        bad_configs = [
            None,
            {"api_key": "k", "base_url": "https://x.invalid"},
            {"api_key": "  ", "base_url": "https://x.invalid", "model": "m"},
        ]
        for cfg in bad_configs:
            with self.subTest(cfg=cfg):
                with self.assertRaises(LLMConfigMissing):
                    if cfg is None:
                        chat_json("系统提示", "用户提示")
                    else:
                        chat_json("系统提示", "用户提示", llm_cfg=cfg)


if __name__ == "__main__":
    unittest.main()
