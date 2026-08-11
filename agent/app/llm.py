"""LLM 客户端：调用 OpenAI 兼容端点，按需强制 JSON 输出并解析。

**凭据一律由调用方随请求下发（llm_cfg），本模块不持有任何默认 key/端点/模型。**
缺配置时抛 LLMConfigMissing，不回退——否则就是让服务器悄悄替用户付费。
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
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


class LLMConfigMissing(RuntimeError):
    """没有可用的 LLM 配置。

    以前这里会回退到 agent 自己 .env 里的 DEEPSEEK_API_KEY——那是一层看不见、
    无法限额、也不归 admin 管的服务器成本。现在缺配置就是硬错误：Go 侧负责在
    发请求之前就把「用户自带连接 / 平台额度」解析清楚，解析不到就别发过来。
    """


def _build_ephemeral(cfg: dict[str, Any], json_mode: bool) -> ChatOpenAI:
    """按请求下发的 LLM 配置构造**临时** ChatOpenAI（不缓存：每请求凭据不同）。

    cfg 为 Go 侧解析出的 {provider,base_url,api_key,model}，三个关键字段缺一即报错。
    provider 仅作标签（OpenAI 兼容端点只需 base_url+api_key+model）。

    json_mode=True 强制返回 JSON 对象（chat_json 用）；False 不强制——流式下正文以
    哨兵分隔（正文 <<<META>>> JSON 尾），JSON 模式会破坏正文的自然流式。
    """
    missing = [k for k in ("api_key", "base_url", "model") if not (cfg.get(k) or "").strip()]
    if missing:
        raise LLMConfigMissing(f"下发的 LLM 配置缺少：{', '.join(missing)}")

    s = get_settings()
    kwargs: dict[str, Any] = {
        "model": cfg["model"],
        "api_key": cfg["api_key"],
        "base_url": cfg["base_url"],
        "temperature": s.ai_temperature,
        "timeout": s.ai_timeout,
        # 让端点在流式响应里带回 usage（OpenAI 的 stream_options.include_usage）。
        # 并非所有兼容端点都实现；取不到时由 _usage_of 退化为字符估算。
        "stream_usage": True,
    }
    if json_mode:
        kwargs["model_kwargs"] = {"response_format": {"type": "json_object"}}
    return ChatOpenAI(**kwargs)


def _pick(llm_cfg: dict[str, Any] | None, json_mode: bool) -> ChatOpenAI:
    """构造本次调用的客户端。没有下发配置 = 硬错误，没有回退可言。"""
    if not llm_cfg:
        raise LLMConfigMissing("请求未携带 LLM 配置（agent 不持有任何默认凭据）")
    return _build_ephemeral(llm_cfg, json_mode)


# 估算用的字符/token 比。中文约 1.5~2 字符一个 token，取 1.7 偏保守
# （宁可略高估也不要低估——低估等于让赠送额度变相无限）。
_CHARS_PER_TOKEN = 1.7


def _estimate_tokens(text: str) -> int:
    return max(1, round(len(text) / _CHARS_PER_TOKEN)) if text else 0


class Usage(dict):
    """一次或多次 LLM 调用的 token 用量：{prompt_tokens, completion_tokens, estimated}。

    用 dict 子类而不是 dataclass：它要原样进 SSE 的 JSON 帧，少一层转换。
    estimated=True 表示端点没回 usage、数字是按字符估的——Go 侧据此打埋点，
    因为「扣费全靠估算」是需要知道的事实，不是可以忽略的细节。
    """

    def __init__(self, prompt: int = 0, completion: int = 0, estimated: bool = False) -> None:
        super().__init__(prompt_tokens=prompt, completion_tokens=completion, estimated=estimated)

    def add(self, other: "Usage") -> "Usage":
        self["prompt_tokens"] += other["prompt_tokens"]
        self["completion_tokens"] += other["completion_tokens"]
        # 只要有一次是估的，整笔就算估的——别让一半真实数字给出精确的假象。
        self["estimated"] = self["estimated"] or other["estimated"]
        return self


def _usage_of(msg: Any, *, sent: str, received: str) -> Usage:
    """从 langchain 消息取 usage_metadata；端点没给就按字符估算。"""
    meta = getattr(msg, "usage_metadata", None) or {}
    pt, ct = meta.get("input_tokens"), meta.get("output_tokens")
    if isinstance(pt, int) and isinstance(ct, int) and (pt or ct):
        return Usage(pt, ct, estimated=False)
    return Usage(_estimate_tokens(sent), _estimate_tokens(received), estimated=True)


async def chat_stream(
    messages: list[BaseMessage], *, llm_cfg: dict[str, Any] | None = None,
    usage_out: Usage | None = None,
) -> AsyncIterator[str]:
    """流式多轮对话，逐块产出增量文本（可能为空块，调用方需容忍）。

    收完整消息列表（而非单轮 system+user），以支持"有记忆的写手"：
    重写时把上一稿(AIMessage) + 审校反馈(HumanMessage) 追加进列表，让模型在自己
    上一稿基础上修订，而非从头重写——减少来回震荡、更快收敛。

    usage_out 非空时把本次调用的 token 用量**累加**进去（生成器没法 return 值，
    只能靠调用方传一个累加器进来）。usage 一般随最后一个 chunk 到达；端点不给
    就按字符估算，见 _usage_of。
    """
    llm = _pick(llm_cfg, False)
    sent = "\n".join(str(m.content) for m in messages)
    received: list[str] = []
    usage_chunk: Any = None  # 带 usage_metadata 的那一块（通常是末块，但不保证）

    async for chunk in llm.astream(messages):
        text = chunk.content if isinstance(chunk.content, str) else str(chunk.content)
        if text:
            received.append(text)
            yield text
        if getattr(chunk, "usage_metadata", None):
            usage_chunk = chunk

    if usage_out is not None:
        usage_out.add(_usage_of(usage_chunk, sent=sent, received="".join(received)))


def validate_key(api_key: str, base_url: str = "", model: str = "") -> tuple[bool, str]:
    """一次性校验某条连接是否可用：用它新建一个**独立**的 ChatOpenAI（不影响生成管线），
    发一个极小的 ping，成功返回 (True, "")。

    三个参数都必填——agent 没有默认端点/模型可以替调用方猜。
    仅用于设置页的「测试连接」。失败返回 (False, 简短原因)。"""
    missing = [
        name for name, v in (("api_key", api_key), ("base_url", base_url), ("model", model))
        if not (v or "").strip()
    ]
    if missing:
        return False, f"缺少 {', '.join(missing)}"
    try:
        llm = ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=base_url,
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
    llm_cfg: dict[str, Any] | None = None, usage_out: Usage | None = None,
) -> dict[str, Any]:
    """单轮对话，返回解析后的 JSON 对象。

    temperature 可临时覆盖（如润色用低温、生成用高温）。
    usage_out 非空时把 token 用量累加进去——**含解析失败的那几次重试**：
    失败的调用一样烧了钱，不计进去就等于让赠送额度漏出去。
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
        if usage_out is not None:
            usage_out.add(_usage_of(resp, sent=system + "\n" + prompt, received=content))
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
