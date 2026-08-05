"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import LLMSettings from "@/components/LLMSettings";
import type { UserProfile } from "@/lib/types";

// 个人主页：资料展示 + 编辑昵称/简介 + BYOK 设置（多连接 + 环节绑定，见 LLMSettings）。
export default function MePage() {
  const router = useRouter();
  const initAuth = useAuthStore((s) => s.init);
  const setAuthUser = useAuthStore.setState;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("token")) {
      router.replace("/");
      return;
    }
    api
      .get<UserProfile>("/auth/profile")
      .then((p) => {
        setProfile(p);
        setNickname(p.nickname);
        setBio(p.bio);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [router]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    setError(null);
    try {
      const p = await api.put<UserProfile>("/auth/profile", { nickname: nickname.trim(), bio: bio.trim() });
      setProfile(p);
      // 同步顶栏昵称（authStore.user + localStorage）
      const raw = localStorage.getItem("user");
      if (raw) {
        const u = { ...JSON.parse(raw), nickname: p.nickname };
        localStorage.setItem("user", JSON.stringify(u));
        setAuthUser({ user: u });
      }
      flash("资料已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingProfile(false);
    }
  };

  const isAdmin = useAuthStore((s) => s.user?.role === "admin");

  return (
    <div className="wrap">
      <div className="topbar">
        <span className="back" onClick={() => router.push("/")}>
          ← 返回首页
        </span>
        <div className="topbar-actions">
          {isAdmin && (
            <button className="ghost-btn" onClick={() => router.push("/admin")}>
              平台设置
            </button>
          )}
          <button className="ghost-btn" onClick={() => router.push("/mine")}>
            我的作品
          </button>
        </div>
      </div>

      <h1 className="ed-h1">个人主页</h1>
      {error && <div className="status err">出错：{error}</div>}

      {loading ? (
        <div className="empty pulse">载入中…</div>
      ) : (
        <>
          {/* 资料 */}
          <section className="ed-section">
            <span className="eyebrow">资料</span>
            {profile && (
              <div className="me-meta">
                <span>用户名 {profile.username}</span>
                <span>作品 {profile.work_count}</span>
                <span>注册于 {new Date(profile.created_at).toLocaleDateString("zh-CN")}</span>
              </div>
            )}
            <label className="ed-field">
              <span className="ed-label">昵称</span>
              <input className="ed-input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </label>
            <label className="ed-field">
              <span className="ed-label">简介</span>
              <textarea
                className="ed-textarea"
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
            </label>
            <button className="primary-btn" disabled={savingProfile} onClick={saveProfile}>
              {savingProfile ? "保存中…" : "保存资料"}
            </button>
          </section>

          {/* AI 连接（BYOK）：多连接 + 环节绑定 */}
          <LLMSettings flash={flash} />
        </>
      )}

      {toast && <div className="ed-toast">{toast}</div>}
    </div>
  );
}
