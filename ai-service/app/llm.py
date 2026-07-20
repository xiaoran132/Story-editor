"""LLM 客户端：接 DeepSeek（OpenAI 兼容），强制 JSON 输出并解析。"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from .config import get_settings


@lru_cache
def get_llm() -> ChatOpenAI:
    """构造共享的 ChatOpenAI 实例（DeepSeek 端点）。"""
    s = get_settings()
    return ChatOpenAI(
        model=s.deepseek_model,
        api_key=s.deepseek_api_key,
        base_url=s.deepseek_base_url,
        temperature=s.ai_temperature,
        timeout=s.ai_timeout,
        # DeepSeek 兼容 OpenAI 的 response_format，强制返回 JSON 对象
        model_kwargs={"response_format": {"type": "json_object"}},
    )


def chat_json(system: str, user: str, *, temperature: float | None = None) -> dict[str, Any]:
    """单轮对话，返回解析后的 JSON 对象。

    temperature 可临时覆盖（如润色用低温、生成用高温）。
    """
    llm = get_llm()
    if temperature is not None:
        llm = llm.bind(temperature=temperature)

    resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
    content = resp.content if isinstance(resp.content, str) else str(resp.content)
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM 未返回合法 JSON: {e}; 原文: {content[:500]}") from e
    if not isinstance(data, dict):
        raise ValueError(f"LLM 返回的不是 JSON 对象: {content[:500]}")
    return data
