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


@lru_cache
def get_settings() -> Settings:
    return Settings()
