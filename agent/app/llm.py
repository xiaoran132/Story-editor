"""LLM 客户端：接 DeepSeek（OpenAI 兼容），强制 JSON 输出并解析。"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from .config import get_settings

logger = logging.getLogger("story.metrics")

# 解析失败时追加到 user 消息末尾的纠正指令，推动模型重发合法 JSON。
_RETRY_HINT = (
    "\n\n【上次输出不是合法的 JSON 对象。请只返回一个合法 JSON 对象，"
    "不要任何解释、前后缀或 ``` 代码块围栏。】"
)


class LLMParseError(ValueError):
    """LLM 未返回合法 JSON 对象。独立类型便于埋点区分「解析失败」与「审校超限」。

    仍继承 ValueError，不改变调用方既有的异常兜底行为。
    """


@lru_cache
def _build_llm(json_mode: bool) -> ChatOpenAI:
    """构造共享的 ChatOpenAI 实例（DeepSeek 端点）。按 json_mode 缓存两个实例。

    json_mode=True 强制返回 JSON 对象（chat_json 用）；False 不强制——流式下正文以
    哨兵分隔（正文 <<<META>>> JSON 尾），JSON 模式会破坏正文的自然流式。
    """
    s = get_settings()
    kwargs: dict[str, Any] = {
        "model": s.deepseek_model,
        "api_key": s.deepseek_api_key,
        "base_url": s.deepseek_base_url,
        "temperature": s.ai_temperature,
        "timeout": s.ai_timeout,
    }
    if json_mode:
        kwargs["model_kwargs"] = {"response_format": {"type": "json_object"}}
    return ChatOpenAI(**kwargs)


def get_llm() -> ChatOpenAI:
    return _build_llm(True)


def get_stream_llm() -> ChatOpenAI:
    return _build_llm(False)


async def chat_stream(messages: list[BaseMessage]) -> AsyncIterator[str]:
    """流式多轮对话，逐块产出增量文本（可能为空块，调用方需容忍）。

    收完整消息列表（而非单轮 system+user），以支持"有记忆的写手"：
    重写时把上一稿(AIMessage) + 审校反馈(HumanMessage) 追加进列表，让模型在自己
    上一稿基础上修订，而非从头重写——减少来回震荡、更快收敛。
    """
    llm = get_stream_llm()
    async for chunk in llm.astream(messages):
        text = chunk.content if isinstance(chunk.content, str) else str(chunk.content)
        if text:
            yield text


def chat_json(system: str, user: str, *, temperature: float | None = None) -> dict[str, Any]:
    """单轮对话，返回解析后的 JSON 对象。

    temperature 可临时覆盖（如润色用低温、生成用高温）。
    """
    llm = get_llm()
    if temperature is not None:
        llm = llm.bind(temperature=temperature)

    # 仅对「非法 JSON」重试（网络/API 异常照常冒泡，不在此吞掉）。
    attempts = max(1, get_settings().ai_parse_max_retries + 1)
    last_err: LLMParseError | None = None
    for i in range(attempts):
        prompt = user if i == 0 else user + _RETRY_HINT
        resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=prompt)])
        content = resp.content if isinstance(resp.content, str) else str(resp.content)
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            last_err = LLMParseError(f"LLM 未返回合法 JSON: {e}; 原文: {content[:500]}")
        else:
            if isinstance(data, dict):
                return data
            last_err = LLMParseError(f"LLM 返回的不是 JSON 对象: {content[:500]}")
        if i + 1 < attempts:  # 还有重试机会
            logger.warning("parse_retry attempt=%d detail=%s", i + 1, last_err)

    assert last_err is not None
    raise last_err
