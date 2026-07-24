"""Agent 服务入口：FastAPI 应用装配。

启动：
    cd agent
    uvicorn app.main:app --host 0.0.0.0 --port 8001
或：
    python -m app.main
"""
from __future__ import annotations

from fastapi import FastAPI

from .config import get_settings
from .routers import assist, generate

app = FastAPI(title="Story Editor Agent Service", version="0.1.0")

app.include_router(generate.router)
app.include_router(assist.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    s = get_settings()
    return {
        "status": "ok",
        "model": s.deepseek_model,
        "key_configured": "true" if s.deepseek_api_key else "false",
    }


def main() -> None:
    import uvicorn

    s = get_settings()
    uvicorn.run(app, host=s.ai_host, port=s.ai_port)


if __name__ == "__main__":
    main()
