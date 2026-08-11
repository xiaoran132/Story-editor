"""服务配置：环境变量 > .env > 默认值（与 Go 后端配置约定一致）。"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 服务监听
    ai_host: str = "0.0.0.0"
    ai_port: int = 8001

    # 注意：这里**故意没有任何 LLM 凭据**。
    # agent 不持有 key/端点/模型名——全部由 Go 按环节解析后随每个请求下发
    # （llm_write / llm_review / llm）。曾经有一组 DEEPSEEK_* 默认值作兜底，
    # 那是一层看不见、无法限额、也不归 admin 管的服务器成本，已删除。
    # 解析不到配置时是明确报错，不是悄悄换一把 key。

    # 生成参数
    ai_temperature: float = 0.8
    ai_timeout: int = 60
    # 质量审校拒绝后，允许额外重写的最大次数；超限后报错，不返回未经认可的内容。
    ai_review_max_retries: int = 2
    # LLM 返回非法 JSON 时，允许额外重试的最大次数（附纠正指令重发）；超限抛 LLMParseError。
    # 真实样本显示裸 parse_error 约占 7% 且直接冒泡成玩家 502，故加一次廉价重试兜底。
    ai_parse_max_retries: int = 1

    # 续写上下文滑动窗口：只把「开局 + 最近 (history_window-1) 段」原文放进提示，
    # 更早的剧情折叠（其结果已沉淀在“当前属性”快照中），避免深剧情撑爆上下文。
    # <=0 表示不限制（全量重放）。详见 docs/context-strategy.md。
    history_window: int = 8


@lru_cache
def get_settings() -> Settings:
    return Settings()
