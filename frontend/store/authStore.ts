import { create } from "zustand";
import { api } from "@/lib/api";
import type { AuthUser, LoginResult } from "@/lib/types";
import { clearGuestSessions, getGuestSessions } from "@/lib/guestSessions";

interface AuthState {
  user: AuthUser | null;
  init: () => void; // 从 localStorage 恢复登录态
  login: (email: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    nickname: string
  ) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,

  init: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("user");
    if (raw) {
      try {
        set({ user: JSON.parse(raw) as AuthUser });
      } catch {
        /* 坏数据忽略 */
      }
    }
  },

  login: async (email, password) => {
    const r = await api.post<LoginResult>("/auth/login", { email, password });
    localStorage.setItem("token", r.token);
    localStorage.setItem("user", JSON.stringify(r.user));
    // 迁移本浏览器匿名会话到该账号（用刚存的 token）。await 完再 set user，
    // 以免首页 sessions 列表在迁移完成前就刷新，导致迁移的会话不显示。
    const ids = getGuestSessions();
    if (ids.length) {
      try {
        await api.post("/play/sessions/migrate", { session_ids: ids });
      } catch {
        /* 迁移失败不阻断登录 */
      }
      clearGuestSessions();
    }
    set({ user: r.user });
  },

  register: async (username, email, password, nickname) => {
    await api.post("/auth/register", { username, email, password, nickname });
    await get().login(email, password); // 注册后自动登录（含迁移）
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
    set({ user: null });
  },
}));
