"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { resolveTheme } from "@/lib/hue";
import { parseWorld, storyTags } from "@/lib/work";
import Backdrop from "@/components/sky/Backdrop";
import WorldScope from "@/components/sky/WorldScope";
import WorkFace from "@/components/wx/WorkFace";
import WxHeader from "@/components/wx/WxHeader";
import Dropdown from "@/components/Dropdown";
import type { Story } from "@/lib/types";
import styles from "./page.module.css";

// 作品馆。规格 DESIGN.md §7.2，视觉目标 docs/design/works-library.html。
//
// ⚠️ **搜索 / 筛选 / 排序 / 分页全部在前端做**，在一次 `?limit=100` 拉回来的这批上。
// 这是有意的取舍（plan.md §二·补三）：当前库 12 部，为不存在的规模写服务端搜索是浪费。
// 换方案的触发点写死在这里——`meta.total > 100` 就说明这批被截断了，那时要把搜索、
// 筛选、排序、分页**整体下沉到后端查询参数**，而不是在前端上再叠一层。
// 截断时页面如实说，绝不默默显示前 100 条冒充全部。
const PAGE_LIMIT = 100;
const PER_PAGE = 12;

type SortKey = "recommend" | "plays" | "title";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recommend", label: "推荐" },
  { key: "plays", label: "游玩最多" },
  { key: "title", label: "作品名" },
];

export default function WorksPage() {
  const initAuth = useAuthStore((s) => s.init);

  const [stories, setStories] = useState<Story[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState<string>("");
  const [revealOnly, setRevealOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("recommend");
  const [page, setPage] = useState(1);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const load = useCallback(() => {
    setStatus("loading");
    api
      .getWithMeta<Story[]>(`/stories/?limit=${PAGE_LIMIT}`)
      .then((r) => {
        setStories(r.data ?? []);
        setTotal(r.meta?.total ?? (r.data ?? []).length);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  // 题材从**实际在架作品**派生，不写死一张表——手填或 AI 生成的标签也要能筛
  const genres = useMemo(() => {
    const n = new Map<string, number>();
    stories.forEach((s) => {
      const t = storyTags(s)[0];
      if (t) n.set(t, (n.get(t) ?? 0) + 1);
    });
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
  }, [stories]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const out = stories.filter((s) => {
      if (genre && storyTags(s)[0] !== genre) return false;
      if (revealOnly) {
        const attrs = parseWorld(s.world_config).attributes ?? {};
        if (!Object.values(attrs).some((a) => a?.reveal)) return false;
      }
      if (!kw) return true;
      return `${s.title}${s.description}${storyTags(s).join("")}`.toLowerCase().includes(kw);
    });
    // 排序都带稳定的次级键，理由同后端：并列值在不同浏览器/次数下次序不保证
    if (sort === "plays") {
      out.sort((a, b) => b.play_count - a.play_count || a.title.localeCompare(b.title, "zh"));
    } else if (sort === "title") {
      out.sort((a, b) => a.title.localeCompare(b.title, "zh"));
    }
    return out;
  }, [stories, q, genre, revealOnly, sort]);

  // 筛选条件一变就回第 1 页，否则会停在一个已经不存在的页码上看见空网格
  useEffect(() => {
    setPage(1);
  }, [q, genre, revealOnly, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const shown = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const filtering = !!(q.trim() || genre || revealOnly);
  const truncated = total > stories.length;

  const clear = () => {
    setQ("");
    setGenre("");
    setRevealOnly(false);
  };

  return (
    <div>
      <Backdrop />
      <WxHeader />

      <main className={styles.main}>
        <p className={styles.eyebrow}>世界档案</p>
        <h1 className={styles.h1}>
          每一片天空，
          <br />
          都能抵达一个世界。
        </h1>
        <p className={styles.lede}>
          这里是全部已发布的作品。挑一片颜色走进去，或用筛选条件缩小范围。
        </p>

        <div className={styles.tools}>
          <input
            className={styles.search}
            type="search"
            value={q}
            placeholder="搜作品名、钩子或题材"
            aria-label="搜索作品"
            onChange={(e) => setQ(e.target.value)}
          />

          {/* 排序是 menuitemradio 互斥单选——读屏该听到「三选一」而不是三个独立开关 */}
          <Dropdown
            className={styles.sortDd}
            caption="排序"
            ariaLabel="排序方式"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            entries={SORTS.map((o) => ({ value: o.key, label: o.label }))}
          />

          {filtering && (
            <button className={styles.clearBtn} type="button" onClick={clear}>
              清除筛选
            </button>
          )}
        </div>

        <div className={styles.body}>
          <aside className={styles.side} aria-label="筛选">
            <div>
              <p className={styles.sideTitle}>题材</p>
              <div className={styles.facets}>
                {genres.map(([g, n]) => (
                  <button
                    key={g}
                    type="button"
                    className={styles.facet}
                    aria-pressed={genre === g}
                    onClick={() => setGenre(genre === g ? "" : g)}
                  >
                    {g} {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className={styles.sideTitle}>故事线索</p>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={revealOnly}
                  onChange={(e) => setRevealOnly(e.target.checked)}
                />
                含渐显属性
              </label>
              {/* ⚠️ 设计稿这里还有一个「含隐藏属性」。**做不了，也不该做**：
                  service/access.go 的 sanitizeWorldConfig 对非作者是整条 delete(attrs, k)，
                  他根本看不到这个键存在——能筛出来就等于泄露了它的存在。 */}
              <p className={styles.note}>
                渐显属性指剧情推进到某处才会显现的状态。隐藏属性对读者不可见，因此无法筛选。
              </p>
            </div>
          </aside>

          <div>
            <p className={styles.resultbar} aria-live="polite">
              {status === "loading"
                ? "正在翻检档案…"
                : status === "error"
                  ? ""
                  : `${filtered.length} 部作品${genre ? ` · ${genre}` : ""}${q.trim() ? ` · 搜索「${q.trim()}」` : ""}`}
              {truncated && status === "ok" && (
                <span className={styles.note}>
                  档案里共有 {total} 部，这一页只取回了前 {stories.length} 部，其余暂不支持浏览。
                </span>
              )}
            </p>

            {status === "error" ? (
              <div className={styles.state}>
                <p className={styles.stateTitle}>暂时无法载入作品列表</p>
                <p>请稍后重试。</p>
                <button className={styles.clearBtn} type="button" onClick={load}>
                  重新尝试
                </button>
              </div>
            ) : status === "loading" ? (
              <div className={styles.state}>正在翻检档案…</div>
            ) : shown.length === 0 ? (
              <div className={styles.state}>
                <p className={styles.stateTitle}>
                  {stories.length === 0 ? "档案暂时是空的" : "没有符合条件的作品"}
                </p>
                <p>
                  {stories.length === 0
                    ? "作品发布后会出现在这里。"
                    : "可更换题材，或清空搜索词。"}
                </p>
                {filtering && (
                  <button className={styles.clearBtn} type="button" onClick={clear}>
                    清除筛选
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className={styles.grid} aria-busy={status !== "ok"}>
                  {shown.map((s) => {
                    const { hue } = resolveTheme(s.world_config, s.id);
                    return (
                      <WorldScope
                        key={s.id}
                        as={Link}
                        hue={hue}
                        className={styles.card}
                        href={`/story/${s.id}`}
                        aria-label={`打开作品：${s.title}`}
                      >
                        <WorkFace story={s} />
                      </WorldScope>
                    );
                  })}
                </div>

                {pages > 1 && (
                  <nav className={styles.pager} aria-label="分页">
                    <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
                      ←
                    </button>
                    {Array.from({ length: pages }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-current={page === i + 1 ? "true" : undefined}
                        onClick={() => setPage(i + 1)}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={page === pages}
                      onClick={() => setPage(page + 1)}
                    >
                      →
                    </button>
                  </nav>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
