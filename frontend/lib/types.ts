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
