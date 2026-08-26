"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import type { SessionListItem, SessionResult, Story } from "@/lib/types";
import styles from "./page.module.css";

// 我的作品。**由原「草稿箱」页与「空间」页的「我的作品」栏合并而来**，规格 DESIGN.md §7.9。
// 数据源仍是 `GET /stories/mine`（后端一次返回作者的全部作品，含草稿），不需要新接口。
//
// 分已发布 / 草稿两类，但**两类的动作是同一套**：编辑 + 试玩。发布不是终点——
// 把编辑入口只留给草稿，等于逼作者先下架再改。
//
// ⚠️ 缩略天空**只画已点亮的层**：这一栏回答的是「这份稿子写到哪儿了」，
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

type Filter = "all" | "published" | "draft";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "published", label: "已发布" },
  { key: "draft", label: "草稿" },
];

export default function MyWorksPage() {
  const initAuth = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  const [works, setWorks] = useState<Story[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  // storyId → 该作品最近一次存档。试玩优先续这一局，而不是每点一次就开一局新的——
  // 作者调稿会反复点它，开新局会在历史里堆出一串一步没走的空局。
  const [lastOf, setLastOf] = useState<Record<string, SessionListItem>>({});
  const [tryingId, setTryingId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const load = useCallback(() => {
    setStatus("loading");
    api
      .get<Story[]>("/stories/mine")
      .then((list) => {
        setWorks(list ?? []);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  // 存档列表单独取：拿不到不影响编辑与开新局，所以失败静默，试玩退化成开新局。
  useEffect(() => {
    if (!user) return;
    let alive = true;
    api
      .get<SessionListItem[]>("/play/sessions")
      .then((list) => {
        if (!alive) return;
        const map: Record<string, SessionListItem> = {};
        for (const s of list ?? []) {
          const cur = map[s.story_id];
          if (!cur || s.last_played_at.localeCompare(cur.last_played_at) > 0) map[s.story_id] = s;
        }
        setLastOf(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user]);

  const remove = async (id: string) => {
    setErr("");
    try {
      await api.del(`/stories/${id}`);
      setWorks((cur) => cur.filter((s) => s.id !== id));
    } catch (e) {
      // 删一条失败不该把整张列表收走——setStatus("error") 会让整页变成「作品列表打不开」，
      // 而列表明明就在手上，文案也对不上。用这一页已有的局部错误条说清楚。
      setErr((e as Error).message);
      // 顺带重取一次：删除失败最常见的原因就是它已经不在了（另一个标签页删过，
      // 或上一次点击其实成功了）。不重取的话那张卡片会一直留着，再点还是同一个错。
      load();
    } finally {
      setConfirmDel(null);
    }
  };

  // 试玩：有存档就续，没有才开新局。草稿也能玩——后端 canPlay 对作者本人放行。
  const tryPlay = async (id: string) => {
    if (tryingId) return;
    setErr("");
    const last = lastOf[id];
    if (last) {
      router.push(`/play/${last.id}`);
      return;
    }
    setTryingId(id);
    try {
      const r = await api.post<SessionResult>("/play/sessions", { story_id: id });
      router.push(`/play/${r.session.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setTryingId(null);
    }
  };

  const shown = useMemo(() => {
    const rank = (s: Story) => (s.status === "published" ? 0 : 1);
    return works
      .filter((s) =>
        filter === "all"
          ? true
          : filter === "published"
            ? s.status === "published"
            : s.status !== "published"
      )
      .slice()
      .sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));
  }, [works, filter]);

  const nPub = works.filter((s) => s.status === "published").length;
  const nDraft = works.length - nPub;

  return (
    <div>
      <Backdrop />
      <WxHeader />
      <SubNav />

      <main className={styles.main}>
        <p className={styles.eyebrow}>我的空间 · 我的作品</p>
        <h1 className={styles.h1}>你写过的每一片天空。</h1>
        <p className={styles.lede}>
          {works.length > 0
            ? `已发布 ${nPub} · 草稿 ${nDraft}。缩略图只画写完的那几层——缺哪层，就是那一段还没写。`
            : "写完的世界会出现在这里，也会出现在星海里。"}
        </p>

        {status === "ok" && works.length > 0 && (
          <div className={styles.filters} role="tablist" aria-label="按状态筛选">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={styles.chip}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {err && (
          <p className={styles.err} role="alert">
            {err}
          </p>
        )}

        {status === "error" ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>作品列表打不开</p>
            <p>没能取到你的作品。</p>
            <button className={styles.btn} type="button" onClick={load}>
              重新尝试
            </button>
          </div>
        ) : status === "loading" ? (
          <p className={styles.state}>正在整理…</p>
        ) : !user ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>先登录</p>
            <p>作品都挂在账号上。</p>
            <Link className={styles.btn} href="/login?next=/mine/works">
              去登录
            </Link>
          </div>
        ) : shown.length === 0 ? (
          <div className={styles.state}>
            <p className={styles.stateTitle}>
              {works.length === 0 ? "还没有作品" : "这一类下面是空的"}
            </p>
            <p>{works.length === 0 ? "写一个世界，它会从这里长出来。" : "换个筛选看看。"}</p>
            {works.length === 0 && (
              <Link className={styles.btn} href="/create">
                写一个世界
              </Link>
            )}
          </div>
        ) : (
          <div className={styles.grid}>
            {shown.map((s) => {
              const theme = resolveTheme(s.world_config, s.id);
              const gaps = gapsOf(s);
              const missing = gaps.filter((g) => !g.ok);
              const published = s.status === "published";
              const last = lastOf[s.id];
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
                    <span
                      className={`${styles.badge} ${published ? styles.badgePub : styles.badgeDraft}`}
                    >
                      {published ? "已发布" : "草稿"}
                    </span>
                  </div>

                  <div className={styles.meta}>
                    <p className={`${styles.title} ${s.title.trim() ? "" : styles.untitled}`}>
                      {s.title.trim() || "还没有名字"}
                    </p>
                    {s.description.trim() && <p className={styles.hook}>{s.description}</p>}
                    <p className={styles.when}>
                      改于 {new Date(s.created_at).toLocaleDateString("zh-CN")}
                      {published && ` · 游玩 ${s.play_count} · 赞 ${s.like_count}`}
                    </p>
                    <p className={styles.gaps}>
                      {published ? (
                        <>已经在星海里了，改完记得再看一眼发布体检。</>
                      ) : missing.length === 0 ? (
                        <>六层都齐了，去发布体检看看。</>
                      ) : (
                        <>
                          还缺 <b>{missing.map((g) => g.label).join(" · ")}</b>
                        </>
                      )}
                    </p>

                    <div className={styles.acts}>
                      <Link className={styles.btn} href={`/edit/${s.id}`}>
                        {published ? "编辑" : "接着写"}
                      </Link>
                      <button
                        className={styles.btn}
                        type="button"
                        disabled={tryingId === s.id}
                        onClick={() => tryPlay(s.id)}
                      >
                        {tryingId === s.id ? "正在开局…" : last ? "继续试玩" : "试玩"}
                      </button>
                      {published && (
                        <Link className={styles.btn} href={`/story/${s.id}`}>
                          作品页
                        </Link>
                      )}
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
