"""Agent 服务入口：FastAPI 应用装配。

启动：
    cd agent
    uvicorn app.main:app --host 0.0.0.0 --port 8001
或：
    python -m app.main
"""
from __future__ import annotations

import logging

from fastapi import FastAPI

from .config import get_settings
from .routers import assist, generate

# 让 story.metrics 的 INFO 埋点（首稿通过率/ttfb/延迟…）在服务日志可见。
# uvicorn 默认不给 root 挂 handler，会吞掉自定义 logger 的 INFO；这里显式挂一个。
_metrics_logger = logging.getLogger("story.metrics")
if not _metrics_logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s story.metrics %(message)s"))
    _metrics_logger.addHandler(_h)
    _metrics_logger.setLevel(logging.INFO)
    _metrics_logger.propagate = False

app = FastAPI(title="Story Editor Agent Service", version="0.1.0")

app.include_router(generate.router)
app.include_router(assist.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """进程存活探针。

    刻意不报告模型与 key 状态：agent 已不持有任何 LLM 凭据，凭据随每个请求
    由 Go 下发，"配没配 key" 是 Go + 数据库那边的问题，这里无从回答。
    """
    return {"status": "ok"}


def main() -> None:
    import uvicorn

    s = get_settings()
    uvicorn.run(app, host=s.ai_host, port=s.ai_port)


if __name__ == "__main__":
    main()
