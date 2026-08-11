import type { CSSProperties } from "react";

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

// ===== 作品级主题换肤 =====
// 主题是作品属性（存于 world_config.theme，透传、零后端改动）。仅阅读态（详情/游玩）
// 整页换肤，管理态外壳永远中性。swatch=[强调色, 渐变起, 渐变止] —— 强调色用于卡片 kicker/点缀，
// 两段底色用于封面渐变 + 阅读场景背景。色值取自 docs/design/tokens.css 作品主题色板。
export const THEMES: { id: string; label: string; swatch: [string, string, string] }[] = [
  { id: "star", label: "末世 · 星海", swatch: ["#7fc4f2", "#1a1c2b", "#0e1730"] },
  { id: "ink", label: "水墨 · 武侠", swatch: ["#5eead4", "#0b1a1a", "#134e4a"] },
  { id: "horror", label: "恐怖 · 怪谈", swatch: ["#fca5a5", "#3b0a12", "#7f1d1d"] },
  { id: "sci", label: "软科幻", swatch: ["#a5b4fc", "#111827", "#312e81"] },
  { id: "love", label: "言情", swatch: ["#fbcfe8", "#4a1d3f", "#be185d"] },
  { id: "xian", label: "仙侠", swatch: ["#fde68a", "#1c1917", "#4d3a10"] },
  { id: "heal", label: "治愈日常", swatch: ["#bef264", "#1a2417", "#3f6212"] },
  { id: "radio", label: "冷绿电台", swatch: ["#7fe3c8", "#04121c", "#08303f"] },
];
// 取某主题的强调色，未知 id 回落星海冷蓝。
export function themeAccent(id: string | undefined): string {
  return THEMES.find((t) => t.id === id)?.swatch[0] ?? "#7fc4f2";
}
// 取某主题的封面/场景渐变对 [起, 止]，未知 id 回落星海。
export function themeGradient(id: string | undefined): [string, string] {
  const t = THEMES.find((x) => x.id === id);
  return t ? [t.swatch[1], t.swatch[2]] : ["#1a1c2b", "#0e1730"];
}
/**
 * 封面背景样式：有作者上传的封面就用图，否则回落主题渐变。
 *
 * 有图时**仍然叠一层主题渐变**（半透明罩层）而不是裸铺照片，两个理由：
 * ① 封面上压着白色标题/摘要/CTA，任意照片都可能让对比度跌破 4.5:1；
 * ② 设计铁律要求「彩色只来自作品主题色」，保留罩层，主题识别就不会被照片冲掉。
 */
export function coverStyle(themeId: string | undefined, url: string): CSSProperties {
  const [g0, g1] = themeGradient(themeId);
  if (!url) {
    return { background: `linear-gradient(155deg, ${g0}, ${g1} 55%, ${g0})` };
  }
  const scrim =
    `linear-gradient(155deg, color-mix(in srgb, ${g0} 74%, transparent), ` +
    `color-mix(in srgb, ${g1} 60%, transparent) 55%, ` +
    `color-mix(in srgb, ${g0} 82%, transparent))`;
  return {
    backgroundImage: `${scrim}, url("${url}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

// 取某主题的显示名（卡片 kicker / 题材标注用）。
export function themeLabel(id: string | undefined): string {
  return THEMES.find((t) => t.id === id)?.label ?? "AI 生成";
}

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
export interface LLMConnection {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  default_model: string;
  has_key: boolean;
  key_hint: string;
  created_at: string;
}

export interface StageBinding {
  conn: string; // 连接 id；空=未绑定
  model: string; // 可空→回退连接 default_model
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
  platform_ready: boolean; // 「平台」这一档现在可不可选
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

// GET /play/sessions 列表项：会话字段 + 作品标题。
export interface SessionListItem extends Session {
  story_title: string;
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
export interface WorldConfigObj {
  background: string;
  style: string;
  rules: string;
  outline: string;
  characters: Character[];
  initial_state: Record<string, unknown>;
  attributes: Record<string, Record<string, unknown>>;
  theme?: string; // 作品级主题 id（缺省 star）；透传，后端忽略未知键
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
