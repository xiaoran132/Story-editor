import { create } from "zustand";
import { api } from "@/lib/api";
import { buildPath } from "@/lib/state";
import type { Session, SessionResult, StoryNode } from "@/lib/types";

interface PlayState {
  session: Session | null;
  currentNode: StoryNode | null;
  path: StoryNode[]; // 根 → 当前，供时间线渲染
  busy: boolean; // AI 生成中，禁用交互
  loading: boolean; // 首次加载会话中
  error: string | null;

  load: (sessionId: string) => Promise<void>;
  choose: (choice: string) => Promise<void>;
  backtrack: (nodeId: string, index: number) => Promise<void>;
  reset: () => void;
}

export const usePlayStore = create<PlayState>((set, get) => ({
  session: null,
  currentNode: null,
  path: [],
  busy: false,
  loading: false,
  error: null,

  reset: () =>
    set({
      session: null,
      currentNode: null,
      path: [],
      busy: false,
      loading: false,
      error: null,
    }),

  load: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const r = await api.get<SessionResult>(`/play/sessions/${sessionId}`);
      const nodes = r.nodes ?? [];
      set({
        session: r.session,
        currentNode: r.current_node,
        path: buildPath(nodes, r.session.current_node_id),
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
        path: r.current_node ? [...s.path, r.current_node] : s.path,
        busy: false,
      }));
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
    }
  },

  backtrack: async (nodeId, index) => {
    const { session, busy } = get();
    if (!session || busy) return;
    set({ busy: true, error: null });
    try {
      const r = await api.post<SessionResult>(
        `/play/sessions/${session.id}/backtrack`,
        { node_id: nodeId }
      );
      set((s) => ({
        session: r.session,
        currentNode: r.current_node,
        path: s.path.slice(0, index + 1),
        busy: false,
      }));
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
    }
  },
}));
