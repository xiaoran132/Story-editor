import { create } from "zustand";
import { api } from "@/lib/api";
import type { Session, SessionResult, StoryNode } from "@/lib/types";

interface PlayState {
  session: Session | null;
  currentNode: StoryNode | null;
  allNodes: StoryNode[]; // 该会话已探索的全部节点，供树状视图建树
  busy: boolean; // AI 生成中，禁用交互
  loading: boolean; // 首次加载会话中
  error: string | null;

  load: (sessionId: string) => Promise<void>;
  choose: (choice: string) => Promise<void>;
  backtrack: (nodeId: string) => Promise<void>;
  reset: () => void;
}

export const usePlayStore = create<PlayState>((set, get) => ({
  session: null,
  currentNode: null,
  allNodes: [],
  busy: false,
  loading: false,
  error: null,

  reset: () =>
    set({
      session: null,
      currentNode: null,
      allNodes: [],
      busy: false,
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
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  choose: async (choice) => {
    const { session, busy } = get();
    if (!session || busy || !choice.trim()) return;
    set({ busy: true, error: null });
    try {
      const r = await api.post<SessionResult>(
        `/play/sessions/${session.id}/choice`,
        { choice: choice.trim() }
      );
      set((s) => ({
        session: r.session,
        currentNode: r.current_node,
        // choice 响应不含 nodes，新生成的子节点增量并入
        allNodes: r.current_node
          ? [...s.allNodes, r.current_node]
          : s.allNodes,
        busy: false,
      }));
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
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
