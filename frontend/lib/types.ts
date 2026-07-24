// 与 Go 后端 DTO 对齐的类型。
// 注意：current_state / suggested_options / state_snapshot 后端以 JSON **字符串** 返回，
// 需经 lib/state.ts 的解析辅助转成对象，不要直接当对象用。

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
