"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { formatCredit, type UserProfile } from "@/lib/types";
import {
  SCRIM_MIN,
  SCRIM_MAX,
  getReduceMotion,
  setReduceMotion,
  getScrimAlpha,
  setScrimAlpha,
} from "@/lib/readerPrefs";
import Backdrop from "@/components/sky/Backdrop";
import WxHeader from "@/components/wx/WxHeader";
import SubNav from "@/components/wx/SubNav";
import ImageUpload from "@/components/ImageUpload";
import LLMSettings from "@/components/LLMSettings";
import AssistModelSettings from "@/components/AssistModelSettings";
import Switch from "@/components/Switch";
import { useToast } from "@/components/Toast";
import styles from "./page.module.css";

// 资料与设置。规格 DESIGN.md §7.11。**原 `/me` 迁到这里**（plan.md §一）。
//
// 四块都是真的：资料（PUT /auth/profile）、AI 连接（BYOK，见 §12）、
// 阅读偏好（纯 localStorage，零后端）、退出登录。
// 改密码需要后端接口，还没有——所以这里不放一个点了没反应的入口。
//
// ⚠️ 遮罩浓度的下限 52 是**三处必须同步**中的一处：这里的滑杆 min、
// lib/readerPrefs 的 SCRIM_MIN、以及游玩页那个滑杆。JS 侧是唯一真源。
export default function SettingsPage() {
  const router = useRouter();
  const initAuth = useAuthStore((s) => s.init);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmOut, setConfirmOut] = useState(false);
  const [reduceMotion, setRM] = useState(false);
  const [scrim, setScrim] = useState(74);
  const { show: flash, node: toastNode } = useToast();

  useEffect(() => {
    initAuth();
    // 偏好初值必须在 effect 里读：localStorage 在服务端渲染时不存在
    setRM(getReduceMotion());
    setScrim(getScrimAlpha());
  }, [initAuth]);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<UserProfile>("/auth/profile")
      .then((p) => {
        setProfile(p);
        setNickname(p.nickname || "");
        setBio(p.bio || "");
        setAvatarUrl(p.avatar_url || "");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const p = await api.put<UserProfile>("/auth/profile", {
        nickname: nickname.trim(),
        bio: bio.trim(),
        avatar_url: avatarUrl,
      });
      setProfile(p);
      // 顶栏与账户菜单读的是 localStorage 里那份 user，不同步的话改完昵称
      // 页面各处还显示旧名字，直到下次登录
      const raw = localStorage.getItem("user");
      if (raw) {
        const merged = { ...JSON.parse(raw), nickname: p.nickname, avatar_url: p.avatar_url };
        localStorage.setItem("user", JSON.stringify(merged));
        useAuthStore.setState({ user: merged });
      }
      flash("资料已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Backdrop />
      <WxHeader />
      <SubNav />

      <main className={styles.main}>
        <p className={styles.eyebrow}>我的空间 · 设置</p>
        <h1 className={styles.h1}>你与这些世界的连接。</h1>

        {loading ? (
          <p className={styles.state}>正在读取…</p>
        ) : !profile ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>先登录</p>
            <p>资料与模型连接都挂在账号上。</p>
            <Link className={styles.btn} href="/login?next=/mine/settings">
              去登录
            </Link>
          </div>
        ) : (
          <>
            <section className={styles.card}>
              <p className={styles.cardTitle}>个人资料</p>

              <div className={styles.field}>
                <ImageUpload
                  kind="avatar"
                  value={avatarUrl}
                  onChange={setAvatarUrl}
                  label="头像"
                  hint="（可选）会被裁成方形"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="set-nick">
                  昵称
                </label>
                <input
                  id="set-nick"
                  className={styles.input}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="set-bio">
                  简介
                </label>
                <textarea
                  id="set-bio"
                  className={styles.textarea}
                  value={bio}
                  rows={3}
                  onChange={(e) => setBio(e.target.value)}
                />
              </div>

              <p className={styles.hint}>
                用户名 <b>@{profile.username}</b> 不可改——它是别人找到你的地址。
              </p>

              {error && (
                <p className={styles.err} role="alert">
                  出错：{error}
                </p>
              )}

              <div className={styles.row}>
                <button className={styles.btn} type="button" disabled={saving} onClick={save}>
                  {saving ? "保存中…" : "保存资料"}
                </button>
              </div>
            </section>

            <section className={styles.card}>
              <p className={styles.cardTitle}>AI 连接</p>
              <p className={styles.hint}>
                平台体验额度剩余 <b>{formatCredit(profile.credit_micro_cny)}</b>
                。额度按真实用量扣减；用尽后需要接一条自己的连接才能继续生成。
                <br />
                连接是**账号级**的，具体哪部作品用哪条，在那部作品的详情页里选。
              </p>
              <LLMSettings flash={flash} />
            </section>

            <section className={styles.card}>
              <p className={styles.cardTitle}>创作辅助模型</p>
              <p className={styles.hint}>
                编辑器里的「AI 生成世界观 / 生成开场 / 精品润色 / 分支建议」用哪个模型。
                在这里配一次，所有作品的创作过程都用它；不选连接就走平台额度。
              </p>
              <AssistModelSettings flash={flash} />
            </section>

            <section className={styles.card}>
              <p className={styles.cardTitle}>阅读偏好</p>

              <div className={styles.prefRow}>
                <span>减少动效</span>
                <Switch
                  checked={reduceMotion}
                  label="减少动效"
                  onChange={(v) => {
                    setRM(v);
                    setReduceMotion(v);
                  }}
                />
              </div>
              <p className={styles.hint}>
                关掉循环动效：星系自转、云的漂移、流星。开屏与逐层点亮也会直接落到终态。
              </p>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="set-scrim">
                  正文遮罩浓度 <b>{(scrim / 100).toFixed(2)}</b>
                </label>
                <input
                  id="set-scrim"
                  className={styles.range}
                  type="range"
                  min={SCRIM_MIN}
                  max={SCRIM_MAX}
                  value={scrim}
                  onChange={(e) => setScrim(setScrimAlpha(Number(e.target.value)))}
                />
                <p className={styles.hint}>
                  下限锁 {(SCRIM_MIN / 100).toFixed(2)}。再低，正文与身后的天空就不足 4.5:1。
                </p>
              </div>
            </section>

            <section className={styles.card}>
              <p className={styles.cardTitle}>账号</p>
              <p className={styles.hint}>
                改密码还没有接口，所以这里不放一个点了没反应的入口。
              </p>
              <div className={styles.row}>
                {user?.role === "admin" && (
                  <Link className={styles.btn} href="/admin">
                    平台设置
                  </Link>
                )}
                <button
                  className={`${styles.btn} ${styles.danger}`}
                  type="button"
                  data-confirm={confirmOut ? "1" : undefined}
                  onClick={() => {
                    if (!confirmOut) return setConfirmOut(true);
                    logout();
                    router.push("/");
                  }}
                  onBlur={() => setConfirmOut(false)}
                >
                  {confirmOut ? "确认退出？" : "退出登录"}
                </button>
              </div>
            </section>
          </>
        )}
      </main>
      {toastNode}
    </div>
  );
}
