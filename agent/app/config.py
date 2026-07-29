"""服务配置：环境变量 > .env > 默认值（与 Go 后端配置约定一致）。"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 服务监听
    ai_host: str = "0.0.0.0"
    ai_port: int = 8001

    # DeepSeek（OpenAI 兼容）
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # 生成参数
    ai_temperature: float = 0.8
    ai_timeout: int = 60
    # 质量审校拒绝后，允许额外重写的最大次数；超限后报错，不返回未经认可的内容。
    ai_review_max_retries: int = 2

    # 续写上下文滑动窗口：只把「开局 + 最近 (history_window-1) 段」原文放进提示，
    # 更早的剧情折叠（其结果已沉淀在“当前属性”快照中），避免深剧情撑爆上下文。
    # <=0 表示不限制（全量重放）。详见 docs/剧情上下文构建方案.md。
    history_window: int = 8


@lru_cache
def get_settings() -> Settings:
    return Settings()
