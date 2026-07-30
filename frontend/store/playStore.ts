import { create } from "zustand";
import { api, postStream } from "@/lib/api";
import type { Session, SessionResult, StoryNode } from "@/lib/types";

interface PlayState {
  session: Session | null;
  currentNode: StoryNode | null;
  allNodes: StoryNode[]; // 该会话已探索的全部节点，供树状视图建树
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

// 开场流式的去重守卫（按 sessionId）：避免 React 严格模式下 effect 双触发重复生成开场。
// 放模块级，reset() 不清除，跨重挂载有效；出错时清除以允许重试。
const openingRequested: Record<string, boolean> = {};

export const usePlayStore = create<PlayState>((set, get) => ({
  session: null,
  currentNode: null,
  allNodes: [],
  busy: false,
  streamingText: "",
  loading: false,
  error: null,

  reset: () =>
    set({
      session: null,
      currentNode: null,
      allNodes: [],
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
    set({ busy: true, error: null, streamingText: "" });
    try {
      const r = await postStream<SessionResult>(
        `/play/sessions/${session.id}/opening/stream`,
        {},
        {
          onDelta: (t) => set((s) => ({ streamingText: s.streamingText + t })),
          onRevise: () => set({ streamingText: "" }),
        }
      );
      set({
        session: r.session,
        currentNode: r.current_node,
        allNodes: r.current_node ? [r.current_node] : [],
        busy: false,
        streamingText: "",
      });
    } catch (e) {
      delete openingRequested[session.id]; // 允许出错后重试
      set({ busy: false, streamingText: "", error: (e as Error).message });
    }
  },

  choose: async (choice) => {
    const { session, busy } = get();
    if (!session || busy || !choice.trim()) return;
    set({ busy: true, error: null, streamingText: "" });
    try {
      // 流式续写：正文逐字流入 streamingText；审校拒绝(revise)时清空重来；
      // done 帧携带持久化后的 SessionResult。
      const r = await postStream<SessionResult>(
        `/play/sessions/${session.id}/choice/stream`,
        { choice: choice.trim() },
        {
          onDelta: (t) => set((s) => ({ streamingText: s.streamingText + t })),
          onRevise: () => set({ streamingText: "" }),
        }
      );
      set((s) => ({
        session: r.session,
        currentNode: r.current_node,
        // 流式响应不含 nodes，新生成的子节点增量并入
        allNodes: r.current_node
          ? [...s.allNodes, r.current_node]
          : s.allNodes,
        busy: false,
        streamingText: "",
      }));
    } catch (e) {
      set({ busy: false, streamingText: "", error: (e as Error).message });
    }
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
