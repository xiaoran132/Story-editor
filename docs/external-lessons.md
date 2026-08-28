# 外部项目经验参考：MaiBot 与 DeepSeek Harness

> 考察于 2026-08-27。来源：MaiBot v1.2.3（github.com/Mai-with-u/MaiBot）、DeepSeek Harness 开发者预览版（github.com/deepseek-ai/deepseek-harness），本地副本在 `C:\Users\13192\Downloads\` 下（可能被删，以上游为准）。
>
> 什么时候读：动手改 `agent/app/llm.py` 的计费/SSE 处理时（§1）；阶段二/三触发条件亮了、开始设计时（§2/§3）。总原则：**抄契约与 schema，不抄体量**——两个项目解决的是它们自己的规模问题（开放插件生态、45k 行记忆系统），不是我们的。

## 1. 立即可用（钱与正确性，不依赖阶段二）

### 1.1 计费分离缓存命中 token

dsh 的 `packages/llm/llm-deepseek/src/translate.ts` 把 DeepSeek 的 `prompt_tokens` 拆成不相交的 `inputTokens / cacheReadTokens / cacheWriteTokens` 三项分别计价（缓存命中约为未命中的 1/10）；MaiBot 每次请求记录缓存命中率（`src/services/llm_cache_stats.py`）。

我们的现状：`agent/app/llm.py` 的 `Usage` 只有 `prompt_tokens/completion_tokens`，而 `prepare` 把世界观放在 prompt 最前（会话内跨回合字节稳定），DeepSeek 自动前缀缓存的命中率会很高——若 Go 按 §12 的统一输入单价折算，缓存命中部分在按全价向玩家计费。

做法：核实 langchain 的 `usage_metadata` 是否透出 DeepSeek 的 `prompt_cache_hit_tokens`（不透出则从原始响应读），`Usage` 增加缓存字段并在 done 帧带出，Go 计价跟进。注意 config 新增单价的四处同步规则。

### 1.2 截断的流是不可信的流

dsh 的 SSE 契约（`packages/llm/llm-deepseek/src/sse.ts`、`adapter.ts`）：缺 `[DONE]` 视为截断错误 `STREAM_CLOSED`；usage 必须先于 finish 帧到达；被 max-tokens 截断的 tool call 一律丢弃（残缺调用不可执行）。MaiBot 补第三块：**中断是一等原语**——`asyncio.Event` 贯穿到流式客户端（`src/llm_models/`），新事件可中止在途生成。

对应我们的三处缺口：`chat_stream` 的 usage 累加无 `try/finally`（断连少计费）；前端把无 `done` 帧的断流当普通错误提示；整条链路（前端 postStream → Go → Agent）没有 AbortController 中断传播。

### 1.3 摘要的反污染契约

MaiBot 的 `core/utils/summary_importer.py::SUMMARY_PROMPT_TEMPLATE`（在 A_Memorix 子系统内）是一份战斗检验过的摘要纪律，要点：只记终态事实、不记纠错过程；新登场实体必入；共存不等于关系；临时请求不得泛化为长期偏好；健康/住址类需明确确认。对应加固对象：`agent/app/prompts.py` 的 `STRUCTURE_SYSTEM` summary 段——审校第二大拒因（summary 漏记新增实体）正是这份契约防的东西。

## 2. 阶段二蓝本（触发判据见 §2.0，蓝本本身只存设计）

### 2.0 触发判据（先于开工预注册，2026-08-27 定）

- **样本门槛**：约 30 场 × 20+ 回合、来自不同玩家的真实会话，是信号可信的最低样本量。前置：给 `gen` 埋点加 `depth` 字段（history 长度，几行代码），`aggregate_log.py` 按深度分桶——没有它「随深度上升」类信号不可计算。
- **三信号 → 三组件**：① 审校拒因「与前情/世界观矛盾」占比随深度上升（深段 ≥ 前 5 回合段 2 倍）或转录实体失忆占比高 → §2.1 Recall Cues；② 大纲脊柱失效/叙事绕圈（同义合并命中率随深度上升佐证）→ §2.3 调度先行 + 导演；③ 角色串味（仅角色交互为核心的作品）→ §3。单位经济（成本/会话）是所有组件的共同前置。
- **判据纪律**：无预注册判据的验证会无限拖延——先写死数字再开跑；信号全灭则省下整个阶段二，继续打磨叙事引擎。
- **架构护栏**：模拟向做成**作品级开关**（`world_config` JSON 键，符合「JSON 键优先于加列」惯例），组件先服务模拟向作品、验证后反哺全平台；不做平台级架构倒转，不赌单一手感。

### 2.1 Recall Cues：摘要漂移的最小解

MaiBot `src/maisaka/memory/mid_term.py`。机制四步：

1. 分段摘要时让模型同时产出 3-5 条「将来什么情境下会需要这段」的线索语句，**生成时即算好 embedding** 存进摘要负载；
2. 每回合用最近上下文（约 12 条消息的尾部）构造查询，对全部线索做余弦匹配（阈值 0.8）；
3. 只注入**一条**最佳命中、未召回过的摘要，标记为「内部参考」；
4. 决策请求把它从主窗口过滤掉，避免摘要文本渗入子请求。

相对我们的「永远只带最新一条滚动摘要」，老摘要从被动滚走变为按需召回。落地几乎无缝：`story_nodes.summary` 已存在，生成时多产线索、会话内召回即可。这是介于滚动摘要与全套 RAG 之间的最小干预，**阶段二的第一候选**。

### 2.2 事实账本：世界记忆的数据结构

A_Memorix（MaiBot 内嵌子系统）的 `core/storage/metadata_fact.py`：`fact_claims(scope, fact_key, value_text, polarity, stability[stable|temporal|uncertain], status[active|conflicted|superseded|retracted], confidence, valid_from/to)` + 证据表（stance 支持/反驳、证据 ID）+ 追加式 transitions 日志；派生画像按证据指纹版本化，只在底层事实变化时重算。

铁律一条：**矛盾的事实标 `conflicted`，永不静默覆盖**。这是「世界记得自己」的正确形状：模拟向作品的世界事实（守卫已死、结盟破裂）不该只活在摘要文本里。**只抄表形状与铁律，不抄系统**——证据 ID 直接复用我们的 `node_id`，存储挂在 Go 侧。

### 2.3 导演/调度：规则先行，零 LLM

MaiBot 的「何时开口」是纯规则打分（`src/maisaka/reply_necessity.py`）：相关性(@/提及/私聊) + 内容分(提问/请求/刷屏负分) + 压力分(积压消息二次曲线) - 存在感惩罚(自己最近占比过高)，阈值 80 触发；外加全局注意力槽（`focus/manager.py`，每 scope 仅 1 个会话可跑决策循环，空闲退避 + 冷静期）。

启示：将来「这一回合模拟哪些 NPC / 推进哪条线」应是**规则调度器分配模拟预算**，LLM 只消费分到的注意力，不做分配。回答了「director 先拆什么」——先拆预算器，且预算器不花 token。

## 3. 阶段三蓝本（NPC 人格）

- **人格每次从配置重渲染进 system prompt，绝不把模型输出持久化为人格**（MaiBot 反漂移核心，`src/config/official_configs.py::PersonalityConfig`）。NPC 人设同理：人设是配置，不是「它上次说的话」。
- **决策者与说话者分离**：MaiBot 的 planner（行动决策）与 replyer（发声）用不同的人格投影、不同模型与 max_tokens。我们 writer/structurer 已是此形状，缺的是**按环节设 max_tokens**（目前除 validate_key 外全无上限）。
- **多种回复风格按概率轮换注入**（`multiple_reply_style`），防口吻固化。
- **回复效果裁判驱动暗属性**：MaiBot `src/maisaka/reply_effect/` 用廉价 LLM 把用户后续发言分类为感谢/玩梗/攻击/纠错等立场。我们的隐藏好感度类属性可由「事后判立场」驱动，而非让写手在正文里猜玩家态度。

## 4. 工程机制

- **「模型可见 ⟺ 已落日志」不变量**（dsh 最强的一条）：任何到达模型的请求都必须能从会话日志重建。我们已接近（prompt 从节点链确定性构建），缺的是显式化——**把每次生成的完整 prompt 快照落盘**（MaiBot 做成 HTML 预览，`src/maisaka/monitor/`）。排查「第 15 回合为何忘了伏笔」全靠它。
- **测试升级**：dsh 的 `packages/test-support/llm-mock-server` 在 HTTP 层提供脚本化的 OpenAI 兼容假服务（可编排「断流→成功」序列），测试穿透整个客户端栈；`llm-replay` 从录制的会话 JSONL 重放模型流。我们现在的测试在 `chat_stream/chat_json` 函数级打补丁，测不到断流/重试路径。注意边界：回放只测「没坏」，不测「更好」——质量仍只靠真人多回合。
- **前缀缓存稳定性**：我们 `prepare` 的世界观在前已满足「稳定前缀」，保持该顺序不动；学 MaiBot 记录命中率作为成本观测指标。

## 5. 明确不抄

Cordis「一切皆插件」与 Typert 构建期 RPC 生成器（dsh 的开放生态问题）；事件溯源全家桶（我们的 `state_delta`+快照已是等价物且更简单）；A_Memorix 整体（45k 行，取 §2.2 的表形状即可）；子进程插件隔离、多提供商注册表（单管线服务无此需求）。

## 6. 落地顺序

1. 本周：§1.1 缓存计价 + §1.2 断流/中断链路；
2. 内测前：§1.3 摘要契约加固 + §4 prompt 快照；
3. 阶段二触发后：先 §2.1 Recall Cues，再按数据决定 §2.2 事实账本；导演一律 §2.3 规则先行；
4. 阶段三：§3 人格铁律 + 立场裁判。
