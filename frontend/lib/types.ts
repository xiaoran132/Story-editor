
// 与 Go 后端 DTO 对齐的类型。
// 注意：current_state / suggested_options / state_snapshot 后端以 JSON **字符串** 返回，
// 需经 lib/state.ts 的解析辅助转成对象，不要直接当对象用。

export interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  bio?: string;
  role?: string;
  // 可选：老 localStorage 里的 user 没有这个字段，读到 undefined 时回退首字母占位。
  avatar_url?: string;
}

// GET /auth/profile 完整资料（对齐后端 UserResponse）。
export interface UserProfile {
  id: string;
  username: string;
  nickname: string;
  bio: string;
  avatar_url: string;
  credit_micro_cny: number; // 平台体验额度余额（微元，1e-6 元）；注册赠 1 元
  role: string;
  follower_count: number;
  following_count: number;
  work_count: number;
  created_at: string;
}

// ===== BYOK：LLM 连接 / 环节绑定 / 平台设置 =====

// 生成环节：write=续写/开场，review=质量审校，world=创作侧世界观/润色/分支。
export type LLMStage = "write" | "review" | "world";
// 平台设置（admin）用全部三个环节。
export const LLM_STAGES: { key: LLMStage; label: string; desc: string }[] = [
  { key: "write", label: "续写 / 开场", desc: "正文生成，玩家体验的主文本" },
  { key: "review", label: "质量审校", desc: "低温校验承接/属性，可用更便宜的模型" },
  { key: "world", label: "创作辅助", desc: "世界观 / 开场 / 润色 / 分支生成" },
];
// 玩家「作品级」配置只覆盖游玩相关环节（world 属创作侧，走编辑器临时连接）。
export const PLAY_STAGES: { key: "write" | "review"; label: string; desc: string }[] = [
  { key: "write", label: "续写 / 开场", desc: "正文生成，玩家体验的主文本" },
  { key: "review", label: "质量审校", desc: "低温校验，可用更便宜的模型" },
];

// 供应商预设：选中自动回填 base_url（custom 留空自填）。皆 OpenAI 兼容端点。
export const LLM_PROVIDERS: { key: string; label: string; baseURL: string; model: string }[] = [
  { key: "deepseek", label: "DeepSeek", baseURL: "https://api.deepseek.com", model: "deepseek-chat" },
  { key: "openai", label: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { key: "moonshot", label: "Moonshot", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { key: "custom", label: "自定义", baseURL: "", model: "" },
];

// ===== 题材与基调（存 world_config.tags，透传；约定 tags[0] 为主题材） =====
// 取自原型 create-editor.html 的题材表，并补上种子作品实际用到的「悬疑推理 / 奇幻」。
// 这是**建议表**不是白名单：作者手填或 AI 生成的其它标签照样保留在 tags 里，不会被 UI 抹掉。
export const GENRES = [
  "末世生存",
  "悬疑推理",
  "恐怖惊悚",
  "言情",
  "科幻",
  "武侠仙侠",
  "奇幻",
  "治愈日常",
] as const;

export const TONES = [
  "压抑 · 孤绝",
  "紧张 · 悬念",
  "温情 · 治愈",
  "热血 · 爽快",
  "诡谲 · 惊悚",
] as const;

// GET /llm/connections 列表项：绝不含 key，只回是否已配置 + 打码提示。
// **没有默认模型**：连接只声明「这套凭据下有哪些模型可选」，选哪个是用的时候的事。
export interface LLMConnection {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  models: string[];
  has_key: boolean;
  key_hint: string;
  created_at: string;
}

export interface StageBinding {
  conn: string; // 连接 id；空=走平台档
  model: string; // conn 非空时必填——连接没有默认模型可回退
}
export type StageBindings = Partial<Record<"write" | "review", StageBinding>>;

// 玩家在某作品的配置（GET/PUT /llm/story-config/:storyId）。
// 除了绑定本身，后端在同一次请求里回「能不能开玩」——详情页据此拦住 CTA，
// 而不是让玩家点了「开始新游戏」才发现没模型。
export interface StoryLLMConfig {
  bindings: StageBindings;
  review_enabled: boolean;
  ready: boolean;
  blocked?: string; // 不能开玩的原因，后端给的文案，直接展示
  credit_micro_cny: number; // 平台额度余额（微元，1e-6 元）；注册赠 1 元
  // 平台档「按环节」的可用性与预设模型名。按环节分开是必须的：平台设置每环节一行，
  // review 那行可能没配 key，借用 write 的可用性会把它显示成可选。
  platform_stages: Partial<Record<"write" | "review", PlatformOption>>;
}

// 平台档在某环节的形态：能不能选 + 不选连接时会用到的预设模型。
export interface PlatformOption {
  ready: boolean;
  model: string;
}

// 保存作品级配置的请求体。
export interface StoryLLMConfigInput {
  bindings: StageBindings;
  review_enabled: boolean;
}

// 微元 → 「¥0.83」。后端以整数微元存额度（避免浮点累加误差），展示时才折成元。
export function formatCredit(microCNY: number): string {
  return "¥" + (Math.max(0, microCNY) / 1_000_000).toFixed(2);
}

// 作者推荐模型（存于 world_config.recommended_models，仅标注展示、不自动套用）。
export interface RecommendedModels {
  write?: { provider?: string; model?: string };
  review?: { provider?: string; model?: string };
}

// GET /admin/llm/platform 列表项（每环节一行，缺的环节以空壳补齐）。
export interface PlatformSetting {
  stage: LLMStage;
  provider: string;
  base_url: string;
  model: string;
  // 单价：元 / 百万 token，与各家定价页口径一致。**为 0 则永远扣不动额度**，
  // 等于平台 key 无限量——admin 必须填。
  price_in_per_mtok: number;
  price_out_per_mtok: number;
  has_key: boolean;
  key_hint: string;
}

export interface TestResult {
  ok: boolean;
  detail: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export interface Story {
  id: string;
  creator_id: string;
  creator_name: string; // 作者昵称（后端 LEFT JOIN users 带出）；为空则前端省略署名，不编造
  title: string;
  description: string;
  cover_url: string;
  world_config: string; // JSON 字符串
  opening_content: string;
  status: string;
  play_count: number;
  like_count: number;
  // 当前访问者赞过没有。**只有 GET /stories/:id 会填**——列表接口是匿名可读的，
  // 为它查一遍赞表是整页的额外开销。列表里读到的恒为 false，别拿它画按钮态。
  liked?: boolean;
  created_at: string;
}

export interface Session {
  id: string;
  story_id: string;
  player_id: string;
  current_state: string; // JSON 字符串
  revealed_attrs: string; // JSON 字符串数组：已向玩家揭示的门控属性键
  protagonist_name: string | null;
  current_node_id: string | null;
  status: string; // active | ended
  node_count: number;
  last_played_at: string;
  created_at: string;
}

// GET /play/sessions 列表项：会话字段 + 作品标题 + 现在还进不进得去。
// available=false：作品被作者取消发布或删除，点进去会 404，卡片就地标注而不是凭空消失。
export interface SessionListItem extends Session {
  story_title: string;
  available: boolean;
}

export interface StoryNode {
  id: string;
  session_id: string;
  story_id: string;
  parent_id: string | null;
  depth: number;
  choice_text: string | null;
  content: string;
  suggested_options: string; // JSON 字符串 → Option[]
  state_delta: string;
  state_snapshot: string;
  is_ending: boolean;
  ending_type: string | null;
  created_at: string;
}

export interface Option {
  text: string;
  hint?: string;
}

// 游玩接口返回的组合 DTO（Start / Choice / Backtrack / Get 共用）。
export interface SessionResult {
  session: Session;
  current_node: StoryNode | null;
  nodes?: StoryNode[]; // 仅 GET /play/sessions/:id 返回，用于重建时间线
  // 作品被作者取消发布：这一局可以读完，但不能再推进（引用模式的下架语义）。
  // 没有这个标志的话，玩家只能靠点下去撞一个 403 才知道。
  read_only?: boolean;
}

// ===== 创作编辑器：world_config 的对象形态与草稿类型 =====

export type AttrType = "number" | "scalar" | "set";

// 编辑器里属性以「有序行」编辑（便于改键名/排序）；存盘时派生成 attributes 对象 + initial_state。
export interface AttrRowData {
  key: string;
  type: AttrType;
  initial: number | string | string[]; // number→数值、scalar→字符串、set→字符串数组
  max: number | null; // 仅 number 属性可有：声明上限后玩家端才画进度条；null=不画，只显示数字
  hidden: boolean;
  reveal: boolean;
}

export interface Character {
  name: string;
  role: string;
  desc: string;
}

// world_config 的对象形态（对齐后端 WorldConfig；attributes/initial_state 存盘时由 AttrRowData[] 派生）。
export interface StyleProfile {
  narrative_distance?: "close" | "medium" | "distant";
  rhythm?: "mixed" | "tight" | "relaxed";
  sensory_focus?: string[];
  dialogue_rule?: string;
  avoid?: string[];
}

export interface StyleIssue {
  category: "ai_tell" | "rhythm" | "dialogue_voice" | "style_drift" | "redundancy";
  span_hint: string;
  goal: string;
}

export interface PolishDraft {
  text: string;
  applied: boolean;
  feedback: StyleIssue[];
}

export interface WorldConfigObj {
  background: string;
  style: string;
  rules: string;
  outline: string;
  characters: Character[];
  initial_state: Record<string, unknown>;
  attributes: Record<string, Record<string, unknown>>;
  theme?: string; // 作品级主题 id（缺省 star）；透传，后端忽略未知键
  style_profile?: StyleProfile;
}

// /assist/world 响应
export interface WorldDraft {
  background: string;
  style: string;
  rules: string;
  outline: string;
  characters: unknown[];
  initial_state: Record<string, unknown>;
  attributes: Record<string, Record<string, unknown>>;
}

// /assist/opening 响应
export interface OpeningDraft {
  content: string;
  options: Option[];
}
