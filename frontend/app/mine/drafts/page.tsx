"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { resolveTheme } from "@/lib/hue";
import { hashSeed } from "@/lib/prng";
import { parseWorld, storyTags } from "@/lib/work";
import Backdrop from "@/components/sky/Backdrop";
import Sky from "@/components/sky/Sky";
import WorldScope from "@/components/sky/WorldScope";
import WxHeader from "@/components/wx/WxHeader";
import SubNav from "@/components/wx/SubNav";
import type { Story } from "@/lib/types";
import styles from "./page.module.css";

// 草稿箱。规格 DESIGN.md §7.9。数据源是 `GET /stories/mine` 里 status=draft 的那部分——
// 后端已经返回作者的全部作品（含草稿），不需要新接口。
//
// ⚠️ 缩略天空**只画已点亮的层**：这一栏回答的是「这份草稿写到哪儿了」，
// 补全没写的层等于替作者宣布他写完了。判定与编辑器那六段完全同源，
// 所以这里重算一遍而不是存一个进度字段——存字段就会有两份真相。

type Gap = { key: string; label: string; ok: boolean };

function gapsOf(s: Story): Gap[] {
  const w = parseWorld(s.world_config);
  const attrs = Object.entries(w.attributes ?? {});
  return [
    {
      key: "hook",
      label: "灵感",
      ok: s.description.trim().length >= 8 && storyTags(s).length > 0,
    },
    {
      key: "world",
      label: "世界观",
      ok: !!(w.background?.trim() && w.style?.trim() && w.rules?.trim()),
    },
    { key: "attrs", label: "属性", ok: attrs.length > 0 && attrs.every(([k]) => k.trim()) },
    { key: "opening", label: "开场", ok: s.opening_content.trim().length >= 40 },
    { key: "theme", label: "天空", ok: w.theme !== undefined && w.theme !== null },
  ];
}

export default function DraftsPage() {
  const initAuth = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);

  const [drafts, setDrafts] = useState<Story[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const load = useCallback(() => {
    setStatus("loading");
    api
      .get<Story[]>("/stories/mine")
      .then((list) => {
        setDrafts((list ?? []).filter((s) => s.status !== "published"));
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  const remove = async (id: string) => {
    try {
      await api.del(`/stories/${id}`);
      setDrafts((cur) => cur.filter((s) => s.id !== id));
    } catch {
      setStatus("error");
    } finally {
      setConfirmDel(null);
    }
  };

  return (
    <div>
      <Backdrop />
      <WxHeader />
      <SubNav />

      <main className={styles.main}>
        <p className={styles.eyebrow}>我的空间 · 草稿箱</p>
        <h1 className={styles.h1}>还没长齐的天空。</h1>
        <p className={styles.lede}>
          每一张缩略图只画已经写完的那几层——缺哪层，就是那一段还没写。点进去接着写。
        </p>

        {status === "error" ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>草稿箱打不开</p>
            <p>没能取到你的作品列表。</p>
            <button className={styles.btn} type="button" onClick={load}>
              重新尝试
            </button>
          </div>
        ) : status === "loading" ? (
          <p className={styles.state}>正在翻草稿…</p>
        ) : !user ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>先登录</p>
            <p>草稿挂在账号上。</p>
            <Link className={styles.btn} href="/login?next=/mine/drafts">
              去登录
            </Link>
          </div>
        ) : drafts.length === 0 ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>草稿箱是空的</p>
            <p>没有未完成的作品——要么都发布了，要么还没开始。</p>
            <Link className={styles.btn} href="/create">
              写一个世界
            </Link>
          </div>
        ) : (
          <div className={styles.grid}>
            {drafts.map((s) => {
              const theme = resolveTheme(s.world_config, s.id);
              const gaps = gapsOf(s);
              const missing = gaps.filter((g) => !g.ok);
              return (
                <WorldScope key={s.id} hue={theme.hue} className={styles.draft}>
                  <div className={styles.thumb}>
                    {/* 层与编辑器那六段一一对应：世界观→天空、属性→星、开场→剪影、天空→云 */}
                    <Sky
                      seed={hashSeed(s.id)}
                      pose={gaps[3].ok ? theme.figure : undefined}
                      layers={{
                        halo: gaps[1].ok,
                        clouds: gaps[4].ok ? 2 : false,
                        stars: gaps[1].ok ? 22 : false,
                        meteor: false,
                        horizon: gaps[0].ok,
                        groundGlow: gaps[3].ok,
                      }}
                    />
                  </div>

                  <div className={styles.meta}>
                    <p className={`${styles.title} ${s.title.trim() ? "" : styles.untitled}`}>
                      {s.title.trim() || "还没有名字"}
                    </p>
                    {s.description.trim() && <p className={styles.hook}>{s.description}</p>}
                    <p className={styles.when}>
                      改于 {new Date(s.created_at).toLocaleDateString("zh-CN")}
                    </p>
                    <p className={styles.gaps}>
                      {missing.length === 0 ? (
                        <>六层都齐了，去发布体检看看。</>
                      ) : (
                        <>
                          还缺 <b>{missing.map((g) => g.label).join(" · ")}</b>
                        </>
                      )}
                    </p>

                    <div className={styles.acts}>
                      <Link className={styles.btn} href={`/edit/${s.id}`}>
                        接着写
                      </Link>
                      <button
                        className={`${styles.btn} ${styles.del}`}
                        type="button"
                        data-confirm={confirmDel === s.id ? "1" : undefined}
                        onClick={() => (confirmDel === s.id ? remove(s.id) : setConfirmDel(s.id))}
                        onBlur={() => setConfirmDel((c) => (c === s.id ? null : c))}
                      >
                        {confirmDel === s.id ? "确认删除？" : "删除"}
                      </button>
                    </div>
                  </div>
                </WorldScope>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
