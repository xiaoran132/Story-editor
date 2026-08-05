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


def _build_ephemeral(cfg: dict[str, Any], json_mode: bool) -> ChatOpenAI:
    """按请求下发的 LLM 配置构造**临时** ChatOpenAI（BYOK：不进 _build_llm 全局缓存）。

    cfg 为 Go 侧解析出的 {provider,base_url,api_key,model}；缺字段回退 .env 默认。
    provider 仅作标签（OpenAI 兼容端点只需 base_url+api_key+model）。
    """
    s = get_settings()
    kwargs: dict[str, Any] = {
        "model": cfg.get("model") or s.deepseek_model,
        "api_key": cfg.get("api_key") or s.deepseek_api_key,
        "base_url": cfg.get("base_url") or s.deepseek_base_url,
        "temperature": s.ai_temperature,
        "timeout": s.ai_timeout,
    }
    if json_mode:
        kwargs["model_kwargs"] = {"response_format": {"type": "json_object"}}
    return ChatOpenAI(**kwargs)


def _pick(llm_cfg: dict[str, Any] | None, json_mode: bool) -> ChatOpenAI:
    """有下发配置用临时实例（BYOK），否则走全局缓存实例（平台 .env 默认）。

    缓存路径特意经 get_llm()/get_stream_llm()（而非直接 _build_llm），以保留既有测试的
    patch 挂载点（tests 通过 patch 这两个函数注入 fake LLM）。
    """
    if llm_cfg:
        return _build_ephemeral(llm_cfg, json_mode)
    return get_llm() if json_mode else get_stream_llm()


async def chat_stream(
    messages: list[BaseMessage], *, llm_cfg: dict[str, Any] | None = None
) -> AsyncIterator[str]:
    """流式多轮对话，逐块产出增量文本（可能为空块，调用方需容忍）。

    收完整消息列表（而非单轮 system+user），以支持"有记忆的写手"：
    重写时把上一稿(AIMessage) + 审校反馈(HumanMessage) 追加进列表，让模型在自己
    上一稿基础上修订，而非从头重写——减少来回震荡、更快收敛。

    llm_cfg 非空时用其构造临时实例（BYOK）；否则用全局缓存的平台默认。
    """
    llm = _pick(llm_cfg, False)
    async for chunk in llm.astream(messages):
        text = chunk.content if isinstance(chunk.content, str) else str(chunk.content)
        if text:
            yield text


def validate_key(api_key: str, base_url: str = "", model: str = "") -> tuple[bool, str]:
    """一次性校验某个 LLM API key 是否可用：用它新建一个**独立**的 ChatOpenAI（不进
    _build_llm 的全局缓存、不影响生成管线），发一个极小的 ping，成功返回 (True, "")。

    仅用于个人设置页的「测试连接」。失败返回 (False, 简短原因)。"""
    if not api_key.strip():
        return False, "api_key 为空"
    s = get_settings()
    try:
        llm = ChatOpenAI(
            model=model or s.deepseek_model,
            api_key=api_key,
            base_url=base_url or s.deepseek_base_url,
            temperature=0,
            timeout=15,
            max_tokens=1,
            max_retries=0,
        )
        llm.invoke([HumanMessage(content="ping")])
        return True, ""
    except Exception as e:  # noqa: BLE001 —— 鉴权失败/网络/超时都算不可用
        return False, type(e).__name__


def chat_json(
    system: str, user: str, *, temperature: float | None = None,
    llm_cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """单轮对话，返回解析后的 JSON 对象。

    temperature 可临时覆盖（如润色用低温、生成用高温）。
    llm_cfg 非空时用其构造临时实例（BYOK）；否则用全局缓存的平台默认。
    """
    llm = _pick(llm_cfg, True)
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
