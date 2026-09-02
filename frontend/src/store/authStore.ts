import { create } from "zustand";
import { api } from "@/lib/api";
import type { AuthUser, LoginResult } from "@/lib/types";

interface AuthState {
  user: AuthUser | null;
  // hydrated：init() 跑过了没有。⚠️ 光看 `user === null` 分不出「未登录」和「还没读
  // localStorage」——服务端渲染与客户端首帧都是 null，顶栏据此判断会让已登录用户
  // 先闪一下「登录」。有了这个标志，认证相关的那部分在补水之前整个不渲染。
  hydrated: boolean;
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
  hydrated: false,

  init: () => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("user");
    // ⚠️ token 才是登录与否的判据，`user` 只是显示用的缓存：登出只清两个键，
    // 但坏数据/手工清理可能只剩其一。两者都要求在，才算登录态。
    const token = localStorage.getItem("token");
    let user: AuthUser | null = null;
    if (raw && token) {
      try {
        user = JSON.parse(raw) as AuthUser;
      } catch {
        /* 坏数据忽略，当作未登录 */
      }
    }
    set({ user, hydrated: true });
  },

  login: async (email, password) => {
    const r = await api.post<LoginResult>("/auth/login", { email, password });
    localStorage.setItem("token", r.token);
    localStorage.setItem("user", JSON.stringify(r.user));
    set({ user: r.user });
  },

  register: async (username, email, password, nickname) => {
    await api.post("/auth/register", { username, email, password, nickname });
    await get().login(email, password); // 注册后自动登录
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
    set({ user: null, hydrated: true });
  },
}));
