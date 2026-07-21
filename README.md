# Story Editor · AI 互动剧情共创社区

> 一个「AI 驱动的互动剧情共创社区」——用户既是玩家也是创作者：创作者用 AI 搭建世界观与剧情，玩家用自由输入或推荐选项推动故事，所有选择形成一棵可回溯、可分享的剧情树。

## 文档导航

| 想了解 | 看这份 |
|--------|--------|
| **产品做什么**（功能、MVP 优先级、角色权限、开放问题） | [`docs/功能设计.md`](docs/功能设计.md) |
| **技术怎么建**（技术选型、剧情树/JSONB、属性类型、数据流、扩展） | [`docs/设计思路.md`](docs/设计思路.md) |
| **数据模型蓝本**（完整建表 SQL，领先 Go 实现） | [`infa/sql/`](infa/sql/) |
| **AI 服务**（FastAPI + LangGraph 接口与工作流） | [`ai-service/README.md`](ai-service/README.md) |
| **给 Claude Code 的仓库指南**（分层约定、命令、实现状态） | [`CLAUDE.md`](CLAUDE.md) |

## 架构

三个进程 + 一个数据库，各司其职：

```
┌──────────────┐      HTTP       ┌──────────────────┐     HTTP      ┌────────────────────┐
│  前端（未搭） │ ──────────────> │   Go-Gin 后端     │ ────────────> │  Python AI 服务     │
│ Next.js+React │                 │      :8080        │               │  FastAPI+LangGraph  │
│    Zustand    │ <────────────── │  账号/作品/游玩   │ <──────────── │       :8001         │
└──────────────┘                 └────────┬─────────┘               │  DeepSeek，不碰库   │
                                           │ GORM                    └────────────────────┘
                                     ┌─────▼─────┐
                                     │ PostgreSQL │  剧情树 + 会话状态（JSONB 增量/快照）
                                     └───────────┘
```

- **Go 后端**：账号（JWT）、作品 CRUD、剧情节点树、游玩会话（开局/选择/回溯）。状态的唯一事实来源在 `play_sessions.current_state`。
- **AI 服务**：给定「世界观 + 历史路径 + 玩家输入」→ 返回「正文 + 选项 + 属性增量」，**不碰数据库**；DeepSeek 凭证只在 `ai-service/.env`。
- **PostgreSQL**：剧情树用邻接表 + 递归 CTE，属性用 JSONB 增量/快照。

## 快速开始（Windows）

前置：Go 1.25+、Python 3.12（`ai-service/.venv`）、PostgreSQL（含 `story_editor` 库）、DeepSeek API Key。

```powershell
cd .\scripts\

# 一键：前置检查 + 分别在独立窗口启动 AI 服务(:8001) 与后端(:8080)
.\dev.ps1

# 或只起其一
.\dev.ps1 -Only ai
.\dev.ps1 -Only backend
```

启动后打开 **http://localhost:8080/** 即是最小游玩页面（自动载入 demo 作品，可选择/自由输入/回溯）；AI 接口文档在 **http://localhost:8001/docs**。

手动启动（不用脚本）：

```bash
# AI 服务
cd ai-service
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # 填入 DEEPSEEK_API_KEY
uvicorn app.main:app --port 8001

# 后端（须在 backend/ 下运行）
cd backend
go run .
```

> 配置优先级：环境变量 > `config.yaml` > 默认值；后端会自动加载 `backend/.env`（godotenv）。密钥类文件（`.env`）已被 gitignore，勿提交。

## 实现状态（概览）

已通：账号 / 作品 CRUD / 节点树 / **游玩会话全链路（含 AI 生成、属性合并、回溯）** / AI 服务对接 / 属性类型系统（number/scalar/set）。

待做：社区（点赞/评论/搜索，handler 尚为桩）、存档续玩、WebSocket 实时流式、付费、成就。

> 详细模块状态见 [`CLAUDE.md` · 当前实现状态](CLAUDE.md)。
