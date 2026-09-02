"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { hashSeed } from "@/lib/prng";
import Backdrop from "@/components/sky/Backdrop";
import Sky from "@/components/sky/Sky";
import WorldScope from "@/components/sky/WorldScope";
import WxHeader from "@/components/wx/WxHeader";
import SubNav from "@/components/wx/SubNav";
import type { SessionListItem } from "@/lib/types";
import styles from "./page.module.css";

// 历史记录。规格 DESIGN.md §7.13。数据源 `GET /play/sessions`。
//
// ⚠️ 这一页**不再是顶栏一级入口**，收进我的空间的二级导航（plan.md §一）。
//
// ⚠️ 缩略天空拿不到作品的 hue：`/play/sessions` 返回的是会话字段 + story_title +
// available，没有 world_config。为每一行再拉一次 `/stories/:id` 就是 N+1，而这一栏
// 只是一枚缩略图——不值。改用 story_id 哈希派生色相：同一部作品永远同一个颜色，
// 只是那个颜色不等于作品真正的主题色。**这是有意的近似，不是 bug**；
// 要精确就得后端在列表里带上 theme，那是接口的事。
const FILTERS = [
  { key: "all", label: "全部" },
  { key: "active", label: "还在走" },
  { key: "ended", label: "已落幕" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default function HistoryPage() {
  const initAuth = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);

  const [items, setItems] = useState<SessionListItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const load = useCallback(() => {
    setStatus("loading");
    api
      .get<SessionListItem[]>("/play/sessions")
      .then((list) => {
        const rows = [...(list ?? [])].sort((a, b) =>
          b.last_played_at.localeCompare(a.last_played_at),
        );
        setItems(rows);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  const shown = useMemo(
    () =>
      items.filter((s) =>
        filter === "all" ? true : filter === "ended" ? s.status === "ended" : s.status !== "ended",
      ),
    [items, filter],
  );

  const remove = async (id: string) => {
    try {
      await api.del(`/play/sessions/${id}`);
      setItems((cur) => cur.filter((s) => s.id !== id));
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
        <p className={styles.eyebrow}>我的空间 · 历史记录</p>
        <h1 className={styles.h1}>你走过的那些世界。</h1>
        <p className={styles.lede}>
          每一条都是一份仍在的存档。作品被作者收回后，该存档仍可阅读，但无法继续推进。
        </p>

        <div className={styles.filters} role="group" aria-label="筛选存档">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={styles.filter}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {status === "error" ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>暂时无法载入存档</p>
            <button className={styles.btn} type="button" onClick={load}>
              重新尝试
            </button>
          </div>
        ) : status === "loading" ? (
          <p className={styles.state}>正在翻航迹…</p>
        ) : !user ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>先登录</p>
            <p>存档随账号保存，跨设备同步。</p>
            <Link className={styles.btn} href="/login?next=/mine/history">
              前往登录
            </Link>
          </div>
        ) : shown.length === 0 ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>
              {items.length === 0 ? "还没有走过任何世界" : "这个筛选下没有存档"}
            </p>
            <p>{items.length === 0 ? "挑一部作品走进去，这里就会有航迹。" : "可更换筛选条件。"}</p>
            {items.length === 0 && (
              <Link className={styles.btn} href="/">
                前往星海
              </Link>
            )}
          </div>
        ) : (
          <div className={styles.list}>
            {shown.map((s) => {
              const ended = s.status === "ended";
              const steps = Math.max(0, s.node_count - 1);
              return (
                <WorldScope
                  key={s.id}
                  hue={hashSeed(s.story_id) % 360}
                  className={`${styles.row} ${s.available ? "" : styles.gone}`}
                >
                  <div className={styles.thumb}>
                    {/* 只有走完的世界才划流星——那道光是「这一程结束了」的标记，
                        给一局还在半路的存档划一道，就是在说一件没发生的事 */}
                    <Sky
                      seed={hashSeed(s.id)}
                      pose="gaze"
                      layers={{
                        halo: true,
                        clouds: 2,
                        stars: 22,
                        meteor: ended,
                        horizon: true,
                        groundGlow: true,
                      }}
                    />
                  </div>

                  <div className={styles.meta}>
                    <p className={styles.title}>{s.story_title || "未命名作品"}</p>
                    <p className={styles.facts}>
                      <span>走了 {steps} 步</span>
                      <span>{new Date(s.last_played_at).toLocaleDateString("zh-CN")}</span>
                      <span>{ended ? "已落幕" : "还在走"}</span>
                    </p>
                    {!s.available && (
                      <span className={styles.tag}>作者已收回 · 可读完，不能再推进</span>
                    )}
                  </div>

                  <div className={styles.acts}>
                    <Link className={styles.btn} href={`/play/${s.id}`}>
                      {ended ? "继续阅读" : "继续"}
                    </Link>
                    <button
                      className={`${styles.btn} ${styles.del}`}
                      type="button"
                      data-confirm={confirmDel === s.id ? "1" : undefined}
                      onClick={() => (confirmDel === s.id ? remove(s.id) : setConfirmDel(s.id))}
                      onBlur={() => setConfirmDel((c) => (c === s.id ? null : c))}
                    >
                      {confirmDel === s.id ? "确认删除？" : "删除存档"}
                    </button>
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
