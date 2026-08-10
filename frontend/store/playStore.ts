import { create } from "zustand";
import { api, postStream } from "@/lib/api";
import type { Session, SessionResult, Story, StoryNode } from "@/lib/types";

interface PlayState {
  session: Session | null;
  currentNode: StoryNode | null;
  allNodes: StoryNode[]; // 该会话已探索的全部节点，供树状视图建树
  storyTitle: string; // 作品标题，用于游玩页顶栏展示
  coverUrl: string; // 作品封面：作为阅读背景图注入 --reader-bg（无则保持纯场景色）
  theme: string; // 作品级主题 id：游玩页整页换肤（挂 <html data-theme>）
  hiddenAttrs: string[]; // world_config.attributes 里标了 hidden 的属性键：仅供 AI 参考，玩家端不展示
  revealGated: string[]; // world_config.attributes 里标了 reveal 的门控属性键：揭示前不显示
  attrMax: Record<string, number>; // 声明了 max 的 number 属性上限：只有它才画进度条，其余只显示数字
  busy: boolean; // AI 生成中，禁用交互
  streamingText: string; // 流式续写时逐字到达的正文（done 后清空，回落 currentNode.content）
  loading: boolean; // 首次加载会话中
  error: string | null;

  load: (sessionId: string) => Promise<void>;
  startOpening: () => Promise<void>;
  choose: (choice: string) => Promise<void>;
  backtrack: (nodeId: string) => Promise<void>;
  reset: () => void;
}

// 从作品 world_config.attributes 解析出标了某布尔标记的属性键集合。
function parseFlaggedAttrs(worldConfig: string, flag: "hidden" | "reveal"): string[] {
  try {
    const attrs = (JSON.parse(worldConfig || "{}").attributes || {}) as Record<
      string,
      Record<string, unknown>
    >;
    return Object.keys(attrs).filter((k) => attrs[k] && attrs[k][flag] === true);
  } catch {
    return [];
  }
}

// 取 number 属性声明的上限 max（可选）。没声明就不画条——硬编码 0–100 会让 gold:500 直接满格，
// 一条错的进度条比没有条更误导。
function parseAttrMax(worldConfig: string): Record<string, number> {
  try {
    const attrs = (JSON.parse(worldConfig || "{}").attributes || {}) as Record<
      string,
      Record<string, unknown>
    >;
    const out: Record<string, number> = {};
    Object.entries(attrs).forEach(([k, spec]) => {
      const m = spec?.max;
      if (spec?.type === "number" && typeof m === "number" && m > 0) out[k] = m;
    });
    return out;
  } catch {
    return {};
  }
}

// 从作品 world_config 取主题 id（缺省 star）。
function parseTheme(worldConfig: string): string {
  try {
    return String(JSON.parse(worldConfig || "{}").theme ?? "star") || "star";
  } catch {
    return "star";
  }
}

// 开场流式的去重守卫（按 sessionId）：避免 React 严格模式下 effect 双触发重复生成开场。
// 放模块级，reset() 不清除，跨重挂载有效；出错时清除以允许重试。
const openingRequested: Record<string, boolean> = {};

type Setter = (
  partial: Partial<PlayState> | ((s: PlayState) => Partial<PlayState>)
) => void;

// runStream：开局/续写共用的流式执行外壳——起始置 busy、逐字累积 streamingText、
// revise 清空、done 后由 onDone 决定如何并入节点、收尾清标志；出错走 onError + error。
async function runStream(
  set: Setter,
  path: string,
  body: unknown,
  onDone: (r: SessionResult) => void,
  onError?: () => void
): Promise<void> {
  set({ busy: true, error: null, streamingText: "" });
  try {
    const r = await postStream<SessionResult>(path, body, {
      onDelta: (t) => set((s) => ({ streamingText: s.streamingText + t })),
      onRevise: () => set({ streamingText: "" }),
    });
    onDone(r);
    set({ busy: false, streamingText: "" });
  } catch (e) {
    onError?.();
    set({ busy: false, streamingText: "", error: (e as Error).message });
  }
}

export const usePlayStore = create<PlayState>((set, get) => ({
  session: null,
  currentNode: null,
  allNodes: [],
  storyTitle: "",
  coverUrl: "",
  theme: "star",
  hiddenAttrs: [],
  revealGated: [],
  attrMax: {},
  busy: false,
  streamingText: "",
  loading: false,
  error: null,

  reset: () =>
    set({
      session: null,
      currentNode: null,
      allNodes: [],
      storyTitle: "",
      coverUrl: "",
      theme: "star",
      hiddenAttrs: [],
      revealGated: [],
      attrMax: {},
      busy: false,
      streamingText: "",
      loading: false,
      error: null,
    }),

  load: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const r = await api.get<SessionResult>(`/play/sessions/${sessionId}`);
      set({
        session: r.session,
        currentNode: r.current_node,
        allNodes: r.nodes ?? [],
        loading: false,
      });
      // 取作品：标题（顶栏展示）+ 隐藏属性键（AI 参考）+ 揭示门控属性键（发现前不显示）。失败忽略，不影响游玩。
      api
        .get<Story>(`/stories/${r.session.story_id}`)
        .then((story) =>
          set({
            storyTitle: story.title,
            coverUrl: story.cover_url ?? "",
            theme: parseTheme(story.world_config),
            hiddenAttrs: parseFlaggedAttrs(story.world_config, "hidden"),
            revealGated: parseFlaggedAttrs(story.world_config, "reveal"),
            attrMax: parseAttrMax(story.world_config),
          })
        )
        .catch(() => {});
      // 空会话（尚无开场根节点）→ 触发开场流式生成。
      if (!r.current_node && r.session.status === "active") {
        get().startOpening();
      }
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  startOpening: async () => {
    const { session, busy } = get();
    if (!session || busy || openingRequested[session.id]) return;
    openingRequested[session.id] = true;
    // 开局：整局第一个节点，allNodes 从空开始置为 [根节点]。
    await runStream(
      set,
      `/play/sessions/${session.id}/opening/stream`,
      {},
      (r) =>
        set({
          session: r.session,
          currentNode: r.current_node,
          allNodes: r.current_node ? [r.current_node] : [],
        }),
      () => delete openingRequested[session.id] // 出错清守卫，允许重试
    );
  },

  choose: async (choice) => {
    const { session, busy } = get();
    if (!session || busy || !choice.trim()) return;
    // 续写：新子节点增量并入 allNodes。
    await runStream(
      set,
      `/play/sessions/${session.id}/choice/stream`,
      { choice: choice.trim() },
      (r) =>
        set((s) => ({
          session: r.session,
          currentNode: r.current_node,
          allNodes: r.current_node ? [...s.allNodes, r.current_node] : s.allNodes,
        }))
    );
  },

  backtrack: async (nodeId) => {
    const { session, busy } = get();
    if (!session || busy) return;
    set({ busy: true, error: null });
    try {
      const r = await api.post<SessionResult>(
        `/play/sessions/${session.id}/backtrack`,
        { node_id: nodeId }
      );
      // 回溯只移动当前指针，不产生新节点，allNodes 保持不变
      set({
        session: r.session,
        currentNode: r.current_node,
        busy: false,
      });
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
    }
  },
}));
