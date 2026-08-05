// 与 Go 后端 DTO 对齐的类型。
// 注意：current_state / suggested_options / state_snapshot 后端以 JSON **字符串** 返回，
// 需经 lib/state.ts 的解析辅助转成对象，不要直接当对象用。

export interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  bio?: string;
  role?: string;
}

// GET /auth/profile 完整资料（对齐后端 UserResponse）。
export interface UserProfile {
  id: string;
  username: string;
  nickname: string;
  bio: string;
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
// 主题是作品属性（存于 world_config.theme，透传、零后端改动）。体验页（详情/游玩）
// 整页换肤，外壳页维持默认 star。swatch=[强调色, 底色] 用于编辑器色块 + 首页卡片微染。
export const THEMES: { id: string; label: string; swatch: [string, string] }[] = [
  { id: "star", label: "星图（默认）", swatch: ["#6ea8ff", "#0a0e1a"] },
  { id: "ink", label: "民国墨色", swatch: ["#d9553b", "#14100c"] },
  { id: "horror", label: "血色恐怖", swatch: ["#c8324a", "#0a0708"] },
];
// 取某主题的强调色（首页卡片微染用），未知 id 回落星图冷蓝。
export function themeAccent(id: string | undefined): string {
  return (THEMES.find((t) => t.id === id)?.swatch[0]) ?? "#6ea8ff";
}

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
// 玩家在某作品的配置：环节→{conn,model}（作品级，GET/PUT /llm/story-config/:storyId）。
export type StoryLLMConfig = Partial<Record<"write" | "review", StageBinding>>;

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
