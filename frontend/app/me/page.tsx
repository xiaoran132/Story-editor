"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import LLMSettings from "@/components/LLMSettings";
import AppHeader from "@/components/AppHeader";
import { useToast } from "@/components/Toast";
import Switch from "@/components/Switch";
import ImageUpload from "@/components/ImageUpload";
import {
  SCRIM_MIN,
  SCRIM_MAX,
  getReduceMotion,
  setReduceMotion,
  getScrimAlpha,
  setScrimAlpha,
} from "@/lib/useReadingTheme";
import { formatCredit, type UserProfile } from "@/lib/types";

// 设置页（对齐原型 settings.html）：左侧分区导航 + 四个分区
// —— 个人资料 / 账号与安全 / AI 连接(BYOK) / 偏好。
// 改密码需要后端接口，本期只做退出登录；偏好三项全走 localStorage，零后端。
const SECTIONS = [
  { id: "profile", label: "个人资料" },
  { id: "account", label: "账号与安全" },
  { id: "llm", label: "AI 连接" },
  { id: "prefs", label: "偏好" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
export default function MePage() {
  const router = useRouter();
  const initAuth = useAuthStore((s) => s.init);
  const setAuthUser = useAuthStore.setState;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show: flash, node: toastNode } = useToast();
  const [section, setSection] = useState<SectionId>("profile");
  // 偏好：初值必须在 effect 里读，localStorage 在服务端渲染时不存在。
  const [reduceMotion, setRM] = useState(false);
  const [scrim, setScrim] = useState(74);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    setRM(getReduceMotion());
    setScrim(getScrimAlpha());
  }, []);

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
        setAvatarUrl(p.avatar_url ?? "");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [router]);

  const saveProfile = async () => {
    setSavingProfile(true);
    setError(null);
    try {
      // avatar_url 传的是 string（含空串 = 显式移除），后端用指针接，区分得了「没传」与「清空」。
      const p = await api.put<UserProfile>("/auth/profile", {
        nickname: nickname.trim(),
        bio: bio.trim(),
        avatar_url: avatarUrl,
      });
      setProfile(p);
      // 同步顶栏昵称与头像（authStore.user + localStorage）。
      // authStore.user 只在 login/init 时从 localStorage 读，这里必须手动双写，否则顶栏不刷新。
      const raw = localStorage.getItem("user");
      if (raw) {
        const u = { ...JSON.parse(raw), nickname: p.nickname, avatar_url: p.avatar_url };
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
    <>
    <AppHeader />
    <main className="wrap">
      <div className="topbar">
        <h1 className="ed-h1" style={{ margin: 0 }}>设置</h1>
        <div className="topbar-actions">
          {isAdmin && (
            <button className="btn secondary sm" onClick={() => router.push("/admin")}>
              平台设置
            </button>
          )}
        </div>
      </div>

      {error && <div className="status err" role="alert">出错：{error}</div>}

      {loading ? (
        <div className="empty pulse">载入中…</div>
      ) : (
        <div className="settings-shell">
          {/* 左侧分区导航（原型 settings.html:120-125）。单列时横向滚动，不塞进折叠里。 */}
          <nav className="menu" aria-label="设置分区">
            {SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                aria-current={section === sec.id ? "true" : undefined}
                onClick={() => setSection(sec.id)}
              >
                {sec.label}
              </button>
            ))}
          </nav>

          <div className="settings-body">
            {section === "profile" && (
              <section className="ed-section">
                <span className="eyebrow lead">个人资料</span>
                {profile && (
                  <div className="me-meta">
                    <span>用户名 {profile.username}</span>
                    <span>作品 {profile.work_count}</span>
                    <span>注册于 {new Date(profile.created_at).toLocaleDateString("zh-CN")}</span>
                  </div>
                )}
                <ImageUpload
                  kind="avatar"
                  value={avatarUrl}
                  onChange={setAvatarUrl}
                  label="头像"
                  hint="（可选，不传则显示昵称首字母）"
                />
                <label className="ed-field">
                  <span className="ed-label">昵称</span>
                  <input className="ed-input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
                </label>
                <label className="ed-field">
                  <span className="ed-label">
                    简介
                    <span className="ed-hint">{bio.length}/200</span>
                  </span>
                  <textarea
                    className="ed-textarea"
                    rows={3}
                    maxLength={200}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                  />
                </label>
                <div className="me-key-actions">
                  <button className="btn primary" disabled={savingProfile} onClick={saveProfile}>
                    {savingProfile ? "保存中…" : "保存资料"}
                  </button>
                  <button
                    className="btn ghost sm"
                    disabled={savingProfile}
                    onClick={() => {
                      setNickname(profile?.nickname ?? "");
                      setBio(profile?.bio ?? "");
                      setAvatarUrl(profile?.avatar_url ?? "");
                    }}
                  >
                    撤销修改
                  </button>
                </div>
              </section>
            )}

            {section === "account" && (
              <section className="ed-section">
                <span className="eyebrow lead">账号与安全</span>
                <div className="prefrow">
                  <div className="t">
                    邮箱
                    <small>登录账号，暂不支持修改</small>
                  </div>
                  <div className="ctl ed-hint">已绑定</div>
                </div>
                <div className="prefrow">
                  <div className="t">
                    密码
                    <small>改密需要后端接口，尚未开放</small>
                  </div>
                  <div className="ctl">
                    <button className="btn secondary sm" disabled>
                      修改密码
                    </button>
                  </div>
                </div>
                <div className="prefrow">
                  <div className="t">
                    退出登录
                    <small>退出后本机的匿名进度仍在，登录回来可继续领取</small>
                  </div>
                  <div className="ctl">
                    <button
                      className="btn danger sm"
                      onClick={() => {
                        logout();
                        router.push("/");
                      }}
                    >
                      退出登录
                    </button>
                  </div>
                </div>
              </section>
            )}

            {section === "llm" && (
              <>
                {/* 平台额度：注册赠 1 元，按实际 token 用量扣。放在连接管理之前——
                    用户先看到"我还有多少免费的"，才知道为什么要配自己的连接。 */}
                <section className="ed-section">
                  <span className="eyebrow lead">平台体验额度</span>
                  <p className="me-desc">
                    剩余 <b>{formatCredit(profile?.credit_micro_cny ?? 0)}</b>
                    <span className="ed-hint">
                      注册时赠送 1 元，按每次生成的实际 token 用量扣减。用尽后需要配置下方自己的模型连接才能继续游玩；
                      自带连接不消耗额度。
                    </span>
                  </p>
                </section>
                <LLMSettings flash={flash} />
              </>
            )}

            {section === "prefs" && (
              <section className="ed-section">
                <span className="eyebrow lead">偏好</span>
                <div className="prefrow">
                  <div className="t">
                    减少动效
                    <small>关掉封面的缓慢漂移等循环动效；系统若已开启「减弱动态效果」则始终生效</small>
                  </div>
                  <div className="ctl">
                    <Switch
                      label="减少动效"
                      checked={reduceMotion}
                      onChange={(v) => {
                        setRM(v);
                        setReduceMotion(v);
                        flash(v ? "已减少动效" : "已恢复动效");
                      }}
                    />
                  </div>
                </div>
                <div className="prefrow">
                  <div className="t">
                    默认遮罩浓度
                    <small>阅读时正文底衬的深浅；已设可读性下限，再淡会看不清字</small>
                  </div>
                  <div className="ctl">
                    <input
                      type="range"
                      min={SCRIM_MIN}
                      max={SCRIM_MAX}
                      value={scrim}
                      aria-label="默认遮罩浓度"
                      onChange={(e) => setScrim(setScrimAlpha(Number(e.target.value)))}
                    />
                  </div>
                </div>
                <div className="prefrow">
                  <div className="t">
                    昼夜与氛围
                    <small>在游玩页顶栏随时切换，会记住你的选择</small>
                  </div>
                  <div className="ctl ed-hint">游玩页内调整</div>
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {toastNode}
    </main>
    </>
  );
}
