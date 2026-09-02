"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, assetUrl } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { resolveTheme } from "@/lib/hue";
import { hashSeed } from "@/lib/prng";
import Backdrop from "@/components/sky/Backdrop";
import Sky from "@/components/sky/Sky";
import WorldScope from "@/components/sky/WorldScope";
import WxHeader from "@/components/wx/WxHeader";
import SubNav from "@/components/wx/SubNav";
import WorkFace from "@/components/wx/WorkFace";
import type { Story, UserProfile } from "@/lib/types";
import styles from "./page.module.css";

// 我的空间。规格 DESIGN.md §7.8，**已按 plan.md §一 降级**。
//
// 删掉的四块：衍生贡献、收藏、访客视角、关注。它们在后端一样都没有——
// 没有 fork 模型、没有收藏表、没有关注关系。照设计稿画出来就是四块假数据。
//
// 原来的 `?tab=works|reading` 两个页签也取消了：阅读那半边整块迁到 /mine/history，
// 由二级导航承载。一个页面里塞两套不相干的列表，两边都不好找。

export default function MinePage() {
  const initAuth = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [works, setWorks] = useState<Story[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const load = useCallback(() => {
    setStatus("loading");
    Promise.all([
      api.get<UserProfile>("/auth/profile").catch(() => null),
      api.get<Story[]>("/stories/mine").catch(() => [] as Story[]),
    ])
      .then(([p, list]) => {
        setProfile(p);
        // 只留**已发布**的：这一页用它们叠作者天空、算三个计数器。
        // 作品列表本身已整块搬去 /mine/works（与草稿箱合并），这里不再重复列一遍。
        setWorks((list ?? []).filter((s) => s.status === "published"));
        setStatus(p ? "ok" : "error");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  const initial = (profile?.nickname || profile?.username || "·").trim().charAt(0);

  return (
    <div>
      <Backdrop />
      <WxHeader />
      <SubNav />

      <main className={styles.main}>
        {/* 作者天空：你写过的每一部作品各出一层，叠在一起就是这个人的颜色。
            ⚠️ isolation 挂在容器上——不挂的话 screen 会把页面背景一起混进来。 */}
        <div className={styles.authorsky} aria-hidden="true">
          {works.slice(0, 6).map((s) => {
            const { hue } = resolveTheme(s.world_config, s.id);
            return (
              <WorldScope key={s.id} hue={hue} className={styles.layer}>
                <Sky
                  seed={hashSeed(s.id)}
                  layers={{ halo: true, clouds: 1, stars: 18, horizon: true }}
                />
              </WorldScope>
            );
          })}
        </div>

        <div className={styles.who}>
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.avatar} src={assetUrl(profile.avatar_url)} alt="" />
          ) : (
            <span className={`${styles.avatar} ${styles.avatarFallback}`} aria-hidden="true">
              {initial}
            </span>
          )}
          <div>
            <p className={styles.name}>{profile?.nickname || profile?.username || "未登录"}</p>
            {profile?.username && <p className={styles.handle}>@{profile.username}</p>}
          </div>
          {profile && (
            <Link className={styles.editLink} href="/mine/settings">
              编辑资料
            </Link>
          )}
        </div>

        {profile?.bio && <p className={styles.bio}>{profile.bio}</p>}

        {profile && (
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>已发布</dt>
              <dd>{works.length}</dd>
            </div>
            <div className={styles.fact}>
              <dt>累计游玩</dt>
              <dd>{works.reduce((n, s) => n + s.play_count, 0)}</dd>
            </div>
            <div className={styles.fact}>
              <dt>收到的赞</dt>
              <dd>{works.reduce((n, s) => n + s.like_count, 0)}</dd>
            </div>
            {/* 关注 / 粉丝两个计数器列都在，但没有任何关注入口——
                摆一个恒为 0 的「粉丝」只会被读成「没人关注你」。等社区落地再放。 */}
          </dl>
        )}

        {/* 作品列表整块搬去 /mine/works（与草稿箱合并）。这里只留一个入口——
            同一份列表在两个页面各画一遍，改一处就会漏另一处。 */}
        {status === "error" && !user ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>先登录</p>
            <p>作品与存档随账号保存。</p>
            <Link className={styles.btn} href="/login?next=/mine">
              前往登录
            </Link>
          </div>
        ) : status === "error" ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>暂时无法载入资料</p>
            <button className={styles.btn} type="button" onClick={load}>
              重新尝试
            </button>
          </div>
        ) : status === "loading" ? (
          <p className={styles.state}>正在整理…</p>
        ) : (
          <div className={styles.state}>
            <p className={styles.stateTitle}>
              {works.length === 0 ? "还没有发布过作品" : `已发布 ${works.length} 部`}
            </p>
            <p>草稿与已发布作品都在「我的作品」中，均可编辑与试玩。</p>
            <Link className={styles.btn} href="/mine/works">
              {works.length === 0 ? "写一个世界" : "打开我的作品"}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
