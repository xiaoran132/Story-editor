> 📖 **本文为技术设计（思路 / 实现）**：技术选型、剧情树与 JSONB、属性类型、数据流、扩展。产品需求见 [prd.md](prd.md)，仓库总览见 [README.md](../README.md)。
>
> **阅读提示（2026 年 7 月 28 日）**：本文保留了早期架构设想与后续演进方案。当前可运行事实、代码入口和接手优先级以 [handoff.md](handoff.md) 与 `CLAUDE.md` 为准；尤其“前端尚未搭建”“未来多 Agent”等早期表述不能直接视为现状。
初期的话，先做一个最小的MVP，内容为剧情游玩
具体功能设计详见 **prd.md**。
首先是技术选型

架构参考

<img src=".\img\架构.png" alt="架构参考" style="zoom:40%;" />

目录结构参考

<img src=".\img\文件树参考.png" alt="文件目录" style="zoom:50%;" />

## 前端

前端的话大概是 **Next.js + React**，状态管理用 **Zustand** ，对前端不了解，等后端基础些差不多了再写。

## 后端

后端的话考虑用 **Go-Gin** 做基础的后端服务

> **架构定位（重要）**：下面这几个 “service” 是**逻辑模块划分 / 未来的微服务拆分方向**，不是一开始就拆成多进程。
> MVP 阶段落地为**单个 Go 单体**（`handler → service → repository` 扁平分层，各模块是同一进程内的包），等某个模块真正成为瓶颈再独立拆分。
> **唯一从一开始就独立进程的是 Python AI 服务**（Go 通过 HTTP 调用，见 `ai_client.go`）。

`user-service` 注册/登录/JWT/OAuth（微信登录）

`story-service` 节点树CRUD、存档、回溯、分支统计

`community-service` 作品发布、点赞、评论、搜索

`payment-service` 打赏、解锁节点、收益分成

`realtime-service` WebSocket/SSE，把AI流式输出推给前端

## AI agent

Ai相关服务单独分出来用 **Python - FastAPI** 做 ai 服务

fast api

LangGraph

Agent架构图

<img src=".\img\Agent架构.png" alt="image-20260602122231019" style="zoom: 50%;" />

用户提问后，请求转发给上帝agent模块进行调度，rag检索上下文，找到选择相关的人物，派发子agent进行

子agent接受到任务后，检索相关信息，根据人物设计处理，返回结果给上层。

主agent接受到返回的结果，进行归纳统计，判断剧情是否达标，负责进行重试。合格后存储到数据库，返回原始数据给模块，调用ai编排成文段返回给前端

### 目标形态与落地阶段

上面「上帝 agent 调度 + 按人物子 agent + 主 agent 归纳」是**目标演进形态**。落地策略：**先采纳「角色分工」精神做流水线式子图，把最贵的「按人物并行 fan-out」推到最后**——对外 `run_start / run_continue` 签名始终不变（把 `generate` 节点替换为子图即可）。

目标子图（替换 `generate`）：

```
prepare
  ↓
① director  导演/节拍：读 current_state+进度 → 定本回合节拍(铺垫/冲突/收束)、
            消费硬规则(数值属性极端→险境/结局)、给出期望选项方向   ← 「上帝 agent 调度」
  ↓
② recall    记忆检索：从节点树增量摘要 + 关键事实(伏笔/人物关系/死亡)
            检索与本次选择相关的条目                              ← 「RAG 检索 + 定位人物」
  ↓
③ write     叙事生成：beat + 记忆 + 属性 → 正文(引用属性)、分化选项(hint 带后果)、state_delta
  ↓
④ critic    一致性校验 + 归纳：与记忆/世界观冲突则重写；抽取本段新增关键事实回填节点摘要 ← 「主 agent 归纳」
  ↓
normalize
```

三阶段演进（成本换体验，逐步逼近上图）：

- **阶段一（已完成）｜生成质量闭环**：`generate` 的单次调用仍同时产出「节拍把控的正文 + 后果预期的选项 + 滚动前情提要 `summary`」。`summary` 落库到 `story_nodes.summary`（即「④节点树增量摘要」，见 [context-strategy.md](context-strategy.md)），续写时作【前情提要】喂回、替代滑动窗口的折叠段；老数据无 summary 时回退滑动窗口兜底。生成后新增低温 `review` 回调，审查剧情承接、属性反馈、选项后果、delta 与摘要一致性；不通过则带具体反馈完整重写，最多额外重写 `AI_REVIEW_MAX_RETRIES` 次（默认 2），超限报错且不交付未通过内容。该阶段命中「叙事记忆一致性 / 有后果的选择 / 属性入戏+节拍」三目标，但最坏情况下会增加审校和重写延迟。
- **阶段二｜拆真节点 + 流式**：director/recall/write/critic 拆成职责独立的 LangGraph 节点，recall 从节点摘要升级到 RAG（③）；同时上 realtime 流式输出（WebSocket/SSE）对冲多节点延迟。
- **阶段三｜按人物 fan-out**：多 NPC 同场时并行派发人物子 agent，主 agent 归纳——补齐完整多 agent 形态。

> 当前 `agent/` 实现为「阶段一」：`prepare → generate → review`，审校不通过则回到 `generate`，通过后才 `normalize`。`generate` 的单次调用承担导演/书记员职责，`review` 是独立的质量回调；尚未拆出 director/recall/write 的完整子图（见 [agent/README.md](../agent/README.md)、`prompts.py`）。

## 数据库设计

PostGreSQL

一局游戏的剧情树长这样：

```
根节点（开局）
├── 选择A → 节点1
│   ├── 选择A1 → 节点3
│   └── 选择A2 → 节点4（结局）
└── 选择B → 节点2
    └── 选择B1 → 节点5
```

每个节点需要记录：**它是谁生的（parent）、玩家做了什么选择、这一步属性怎么变了(可省略)，原始数据，返回给用户的段落**。

---
建表详见/infa/sql
## 递归 CTE 查询

建好表之后，PostgreSQL 的递归 CTE 可以直接处理树形查询，不需要应用层递归。

## JSONB 的扩展能力

这是支持创作者自定义属性的关键。创作者可以在 `world_config.initial_state` 里定义任意字段：

```json
// 创作者A的武侠世界
{ "hp": 100, "inner_power": 80, "reputation": 0 }

// 创作者B的商战故事
{ "money": 1000000, "connections": 5, "public_opinion": 50 }

// 创作者C的恋爱养成
{ "affection_A": 0, "affection_B": 0, "looks": 70 }
```

`story_nodes.state_delta` 存对应的增量，`play_sessions.current_state` 存累加后的完整状态，**整套逻辑对创作者的字段名完全透明**，后端代码不需要知道有哪些属性，直接做 JSONB 合并就行。

查询某个属性也很方便：

```sql
-- 查某个session当前的好感度
SELECT current_state->>'affection_A' FROM play_sessions WHERE id = :id;

-- 查所有好感度超过80的session（用于触发隐藏剧情）
SELECT id FROM play_sessions
WHERE (current_state->>'affection_A')::int > 80;

-- 给JSONB字段加索引，查询不慢
CREATE INDEX idx_session_state ON play_sessions USING GIN(current_state);
```

---

## 属性类型分类（增量语义的边界）

前面的 delta 累加只演示了 `hp/gold` 这类**数值属性**，但创作者可能定义**背包道具、布尔开关、身份标签**等，这些无法用「加减」表达。所以 `state_delta` 需要区分属性类型，创作者在 `world_config` 里声明每个属性键的类型：

| 类型 | 例子 | delta 语义 | 合并方式 |
|------|------|-----------|----------|
| **数值累加（number）** | `hp`、`gold`、好感度 | `{"hp": -10}` 表示增减 | 路径累加 / 数值相加 |
| **覆盖式（scalar）** | `location`、`chapter`、布尔 flag | `{"location": "王城"}` 表示置为新值 | 后值覆盖前值（JSONB `\|\|`） |
| **集合式（set/list）** | 背包 `items`、已解锁成就 | `{"items": {"add": ["钥匙"], "remove": ["火把"]}}` | 按 add/remove 增删元素 |

```jsonc
// world_config.attributes 声明（供后端选择合并策略、前端渲染面板）
{
  "hp":    { "type": "number", "initial": 100, "min": 0, "max": 100 },
  "items": { "type": "set",    "initial": [] },
  "married": { "type": "scalar", "initial": false }
}
```

> 关键结论：**只有 number 类型能用 SQL `SUM` / 路径累加**；覆盖式和集合式必须靠 `state_snapshot`（每节点完整快照）来回溯，无法从 delta 反推。这也是保留 `state_snapshot` 字段的根本原因，而不只是性能优化。

### 三份状态数据的一致性约定

`state_delta`（增量）/ `current_state`（会话全量）/ `state_snapshot`（节点全量）三者并存，必须约定单一事实来源，否则极易不一致：

- **`play_sessions.current_state` 是当前状态的唯一事实来源**，前端属性面板只读它；
- `story_nodes.state_delta` 是审计与展示「这一步变化了什么」的依据；
- `story_nodes.state_snapshot` 是回溯加速缓存（回溯 = 直接用它覆盖 `current_state`）；
- 三者**必须在同一数据库事务内写入**（写节点 + 更新会话），不允许分开提交。

## 回溯功能怎么实现

玩家点击"回到第3步重新选择"，不需要删数据，直接：

```sql
-- 1. 找到目标节点
-- 2. 以它为parent_id插入新节点，depth = target.depth + 1
-- 3. 把session的current_state回滚到目标节点的状态

-- 回滚状态：重新跑一遍路径累加，或者在节点上缓存一份snapshot
-- MVP阶段简单做：在节点上加一个 state_snapshot 字段存当时的完整状态
ALTER TABLE story_nodes ADD COLUMN state_snapshot JSONB;
-- 每次写节点时把当前完整状态快照进去，回溯时直接读这个
```

用 `state_snapshot` 是空间换时间，每个节点多存一点数据，但回溯时不需要递归重算，直接读就行。

### 已生成节点必须复用（AI 随机性问题）

AI 生成有随机性（`temperature` 较高时同一输入结果不同），所以要区分两种操作，否则"对比不同选择""重玩分支"会失真：

- **查看/回到已存在的节点** → 直接读数据库里已落库的 `content`，**绝不重新请求 AI**（保证玩家看到的分支内容稳定、可对比）；
- **在某节点探索一个全新选择** → 才调用 AI 生成并作为新子节点落库。

即：树上每个节点的 AI 内容**生成一次、永久固化**。这也让「XX% 玩家走过此路线」的统计有意义。

---

## 路径统计（热门节点）

```sql
-- 统计某个作品哪些节点被最多玩家经过
-- visit_count 在节点被其他玩家"走到"时+1
SELECT
    id,
    choice_text,
    content,
    visit_count,
    depth
FROM story_nodes
WHERE story_id = :story_id
  AND is_public = true
ORDER BY visit_count DESC
LIMIT 20;
```



------

## 处理高并发的方法

## 先量化问题规模

```
1个玩家 × 1部作品 × 玩到第50层 = 50个节点
1个玩家 × 10部作品 × 各玩50层 = 500个节点
10万玩家 × 500节点 = 5000万行
100万玩家 × 500节点 = 5亿行
```

5亿行在单表里，**没有正确索引**的情况下确实会慢。但这个问题是可以系统性解决的，而且解决方案是分层的，不需要一开始就上最复杂的方案。

------

## 第一层：索引设计

`story_nodes` 表上最常见的查询只有三种，索引对准这三种就够了：

```sql
-- 查询1：拿某局游戏的节点树（最频繁）
-- WHERE session_id = ? AND parent_id = ?
CREATE INDEX idx_nodes_session_parent
    ON story_nodes(session_id, parent_id);

-- 查询2：递归CTE回溯路径
-- WHERE id = ? （从某节点往上找父节点）
-- parent_id 已经被上面的索引覆盖，id是主键，天然有索引

-- 查询3：社区统计，某部作品的热门节点
-- WHERE story_id = ? ORDER BY visit_count DESC
CREATE INDEX idx_nodes_story_visits
    ON story_nodes(story_id, visit_count DESC)
    WHERE is_public = true;  -- 只索引公开节点，减小索引体积

-- 最重要的：不要全表扫描
-- 绝对不能出现 WHERE session_id = ? 没有索引的情况
```

正确索引之后，`session_id` 的查询直接走B树定位，5亿行和500万行的查询时间差别很小，都是毫秒级。

------

## 第二层：分区表

PostgreSQL原生支持**表分区**，对应用层透明，不需要改业务代码：

```sql
-- 按 story_id 哈希分区，把数据打散到64个子表
-- 每个子表只有总数据量的 1/64
CREATE TABLE story_nodes (
    id          UUID NOT NULL,
    session_id  UUID NOT NULL,
    story_id    UUID NOT NULL,
    parent_id   UUID,
    depth       INT NOT NULL,
    content     TEXT,
    state_delta JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY HASH (story_id);  -- 按作品分区

-- 建64个分区
DO $$
BEGIN
    FOR i IN 0..63 LOOP
        EXECUTE format(
            'CREATE TABLE story_nodes_%s
             PARTITION OF story_nodes
             FOR VALUES WITH (modulus 64, remainder %s)',
            i, i
        );
    END LOOP;
END $$;

-- 索引建在父表上，自动应用到所有分区
CREATE INDEX ON story_nodes(session_id, parent_id);
CREATE INDEX ON story_nodes(story_id, visit_count DESC) WHERE is_public = true;
```

分区之后，查某部作品的节点只扫描 1/64 的数据。而且PostgreSQL的**分区裁剪（Partition Pruning）**是自动的，查询计划器会自己判断只需要访问哪个分区。

------

## 第三层：冷热数据分离（有了一定用户量之后）

用户的游玩行为有明显的时间衰减——**90%的活跃查询都发生在最近30天内**，3个月前的节点几乎没人看。

```sql
-- 在分区基础上再按时间分层
-- 热数据表：最近90天，走普通PostgreSQL
CREATE TABLE story_nodes_hot
    PARTITION OF story_nodes
    FOR VALUES FROM ('2025-03-01') TO (MAXVALUE);

-- 冷数据表：90天前，可以迁移到更便宜的存储
-- 或者压缩、降低索引密度
CREATE TABLE story_nodes_cold
    PARTITION OF story_nodes
    FOR VALUES FROM (MINVALUE) TO ('2025-03-01');

-- 定时任务：每天把90天前的数据从hot移到cold
```

冷数据还可以进一步处理：把完整节点内容压缩归档，只保留摘要（毕竟玩家很少真的回头看3个月前的剧情节点）。

------

## 第四层：读写分离（QPS上来之后）

节点的写入（玩家每次选择生成新节点）和读取（渲染时间线）可以分开：

```
写入  →  PostgreSQL 主库（单主保证一致性）
读取  →  PostgreSQL 只读副本（可以横向多个）
         └── 时间线渲染、热门节点统计、社区展示
```

PostgreSQL的流复制是原生功能，延迟通常在1秒以内，对"显示时间线"这种场景完全可以接受。

------

## 还有一个设计优化：session级别的快照

前面提到过在节点上存 `state_snapshot`，这里补充一下它对性能的另一个好处：

```sql
ALTER TABLE story_nodes ADD COLUMN state_snapshot JSONB;
```

有了快照之后，**不需要递归CTE累加属性**——查当前状态直接读这一个节点的快照，把一次递归查询变成一次主键查询。对于深度很深（100层以上）的剧情，这个优化效果非常明显。

------

## 什么时候不够用，需要更激进的方案

如果真的到了以下规模，再考虑更复杂的架构：

- **单表超过10亿行 + 查询仍然慢** → 考虑TiDB（兼容MySQL协议的分布式数据库，水平扩展，对应用改动极小）
- **节点写入QPS超过5000** → 写入走消息队列缓冲，批量写入数据库
- **热门作品的节点统计需要实时** → 引入Redis做计数缓存，异步同步到DB

------

**MVP阶段只需要做第一层（索引），其他的等真正遇到瓶颈再加**。过早优化反而增加维护成本，而且你大概率在遇到性能问题之前，已经有足够的资源和时间来处理它了。

------

## 关键数据流与前后端契约

以「玩家做出一次选择」为例，端到端链路（P0 核心）：

```
前端                Go 后端                         Python AI 服务
 │  POST 选择/自由输入   │                                │
 │ ───────────────────> │                                │
 │                      │ 1. 校验会话归属、读取当前 session│
 │                      │ 2. 递归 CTE 回溯 parent 路径 ──> 构建剧情历史上下文
 │                      │ 3. 调 AIClient.Continue ───────>│ 生成正文+选项+state_delta
 │                      │                                │ <──── 返回
 │                      │ 4. 一个事务内：                 │
 │                      │    - INSERT story_nodes         │
 │                      │      (含 state_delta + 快照)    │
 │                      │    - UPDATE play_sessions       │
 │                      │      (current_state / node_id / │
 │                      │       node_count)               │
 │ <─── 新节点 + 属性 ── │                                │
```

**契约要点**：
- AI 服务只负责「给定世界观 + 历史路径 + 玩家输入 → 返回 `{content, options, state_delta}`」，**不碰数据库**（`ai_client.go` 已是纯 HTTP 客户端，超时 60s）。返回的 `options` 落库到 `story_nodes.suggested_options`。
- 属性状态的**唯一事实来源是 `play_sessions.current_state`**；`state_delta` 是审计/回溯依据，`state_snapshot` 是回溯加速缓存。三者必须在同一事务写入，见本文「三份状态数据的一致性约定」一节。
- 回溯：不删任何节点，以目标节点为新 `parent_id` 分叉；`current_state` 从目标节点 `state_snapshot` 恢复。

------

## 非功能需求（MVP 底线）

以下列出 MVP 需要满足的底线：

- **性能**：`story_nodes` 必须命中索引（`session_id, parent_id`），杜绝全表扫描；MVP 只做「索引层」，分区/冷热分离/读写分离等留待真实瓶颈出现后再上。
- **一致性**：写节点 + 更新会话状态用数据库事务保证原子性；三份状态数据（`state_delta`/`current_state`/`state_snapshot`）不允许出现不同步。
- **AI 容错**：AI 服务超时/失败时，节点不落库、会话状态不变，向前端返回可重试错误。
- **安全**：密码 bcrypt + 凭证分离（`user_credentials`）；对外 DTO 隐藏敏感字段（已实现 `ToResponse()`）。

------
