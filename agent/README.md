# Story Editor · agent 服务

独立的 Python agent 服务（FastAPI + LangGraph），负责「给定世界观 + 历史路径 + 玩家输入 → 返回结构化剧情」，**不碰数据库**。Go 后端通过 `AGENT_URL`（默认 `http://localhost:8001`）调用本服务。

## 架构

```
app/
├── main.py            # FastAPI 装配 + /health
├── config.py          # pydantic-settings 读环境变量/.env
├── schemas.py         # 请求/响应模型（与 Go JSON 契约对齐）
├── llm.py             # DeepSeek(OpenAI 兼容) 客户端，强制 JSON
├── prompts.py         # 系统提示词
├── graph/
│   ├── state.py       # LangGraph 状态
│   └── story_graph.py # prepare → generate → normalize 工作流
└── routers/
    ├── generate.py    # POST /generate  /continue  /merge-check
    └── assist.py      # POST /assist/world|opening|polish|branches
```

**LangGraph 工作流**（`story_graph.py`）把剧情生成拆成三个可编排节点：

1. `prepare` —— 依据世界观/历史构建提示，并锁定 `state_delta` 的合法属性键
2. `generate` —— 调用 LLM 产出结构化 JSON
3. `normalize` —— 过滤模型发明的非法属性键、补默认字段、规整结局

后期可无损插入「历史检索」「一致性检查」「多模型路由」等节点。

## 运行

```bash
cd agent
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env    # 填入 DEEPSEEK_API_KEY
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

健康检查：`curl http://localhost:8001/health`

## 接口

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/generate` | 生成开场剧情 |
| POST | `/continue` | 根据历史与选择续写 |
| POST | `/merge-check` | 判定新选择是否与某个已有同层候选语义等价（返回 `matched_index`，-1 表示不合并）；候选由 Go 侧按 `state_delta` 相等预筛 |
| POST | `/assist/world` | 一句话灵感 → 世界观草稿 |
| POST | `/assist/opening` | 世界观 → 开场草稿 |
| POST | `/assist/polish` | 文本润色 |
| POST | `/assist/branches` | 分支走向建议 |

`/generate`、`/continue` 的响应结构：

```json
{
  "content": "剧情正文",
  "options": [{"text": "选项", "hint": "提示"}],
  "state_delta": {"hp": -10},
  "is_ending": false,
  "ending_type": ""
}
```


------

## 属性类型（state_delta 的合并语义）

创作者在 `world_config.attributes` 声明每个属性键的类型，AI 与后端据此决定 `state_delta` 的格式与合并策略：

| 类型 | delta 形态 | 示例 |
|------|-----------|------|
| `number` | 增减量 | `{"hp": -10}` |
| `scalar` | 新值覆盖 | `{"location": "王城"}` |
| `set` | 增删 | `{"items": {"add": ["钥匙"], "remove": ["火把"]}}` |

`prepare` 把类型说明注入提示，`normalize` 按类型规整、丢弃非法值；**未声明类型的键透传**，由 Go 侧 `service.mergeState` 兜底推断（兼容无 `attributes` 的老作品）。
