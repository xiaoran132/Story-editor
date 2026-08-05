"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import type { UserProfile, UserSettings } from "@/lib/types";

// 个人主页：资料展示 + 编辑昵称/简介 + 设置区（安全存自带 LLM key）。
export default function MePage() {
  const router = useRouter();
  const initAuth = useAuthStore((s) => s.init);
  const setAuthUser = useAuthStore.setState;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
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
    Promise.all([
      api.get<UserProfile>("/auth/profile"),
      api.get<UserSettings>("/auth/settings"),
    ])
      .then(([p, s]) => {
        setProfile(p);
        setNickname(p.nickname);
        setBio(p.bio);
        setSettings(s);
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

  const saveKey = async () => {
    setSavingKey(true);
    setError(null);
    try {
      const s = await api.put<UserSettings>("/auth/settings", { llm_api_key: keyInput.trim() });
      setSettings(s);
      setKeyInput("");
      flash(s.has_llm_key ? "API Key 已保存" : "API Key 已清除");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const clearKey = async () => {
    setKeyInput("");
    setSavingKey(true);
    setError(null);
    try {
      const s = await api.put<UserSettings>("/auth/settings", { llm_api_key: "" });
      setSettings(s);
      flash("API Key 已清除");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const testKey = async () => {
    if (!keyInput.trim()) {
      setError("请先填入要测试的 Key");
      return;
    }
    setTesting(true);
    setError(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>("/assist/validate-key", {
        llm_api_key: keyInput.trim(),
      });
      flash(r.ok ? "连接成功，Key 可用" : `不可用：${r.detail || "鉴权失败"}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <span className="back" onClick={() => router.push("/")}>
          ← 返回首页
        </span>
        <button className="ghost-btn" onClick={() => router.push("/mine")}>
          我的作品
        </button>
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

          {/* 设置：自带 LLM key */}
          <section className="ed-section">
            <span className="eyebrow">AI 设置</span>
            <p className="me-desc">
              填入你自己的 DeepSeek API Key（加密存储）。配置后将用于你的 AI 生成
              <span className="ed-hint">（生成接入即将上线；未配置时使用平台额度）</span>
            </p>
            <div className="me-key-status">
              当前：
              {settings?.has_llm_key ? (
                <span className="badge active">已配置 {settings.llm_key_hint || ""}</span>
              ) : (
                <span className="badge ended">未配置</span>
              )}
            </div>
            <label className="ed-field">
              <span className="ed-label">DeepSeek API Key</span>
              <input
                className="ed-input"
                type="password"
                placeholder="sk-..."
                value={keyInput}
                autoComplete="off"
                onChange={(e) => setKeyInput(e.target.value)}
              />
            </label>
            <div className="me-key-actions">
              <button className="primary-btn" disabled={savingKey || !keyInput.trim()} onClick={saveKey}>
                {savingKey ? "保存中…" : "保存 Key"}
              </button>
              <button className="ghost-btn" disabled={testing || !keyInput.trim()} onClick={testKey}>
                {testing ? "测试中…" : "测试连接"}
              </button>
              {settings?.has_llm_key && (
                <button className="ed-del" onClick={clearKey}>
                  清除已存 Key
                </button>
              )}
            </div>
          </section>
        </>
      )}

      {toast && <div className="ed-toast">{toast}</div>}
    </div>
  );
}
