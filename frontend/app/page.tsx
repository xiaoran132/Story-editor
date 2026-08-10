"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import type { Story } from "@/lib/types";
import AppHeader from "@/components/AppHeader";
import StoryCard from "@/components/StoryCard";
import { SkeletonWall, EmptyState, ErrorState } from "@/components/State";

// 作品题材存 world_config.tags（与 theme 同法透传，后端固定 struct 忽略未知键）。
// 约定：tags[0] 是主题材（首页 chip 按它归类），其余作展示标签。
// 注意别拿 theme 充题材——theme 只决定配色，两者语义不同。
function storyTags(worldConfig: string): string[] {
  try {
    const t = JSON.parse(worldConfig || "{}").tags;
    return Array.isArray(t) ? t.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
const primaryTag = (s: Story) => storyTags(s.world_config)[0] ?? "";

// chip 从**实际在架作品**的主题材派生，按作品数从多到少排；没标题材的作品不产生 chip。
// 只有一类（或没有）时整条筛选没意义，直接不渲染。
function buildCats(stories: Story[]): { id: string; label: string; count: number }[] {
  const count = new Map<string, number>();
  stories.forEach((s) => {
    const t = primaryTag(s);
    if (t) count.set(t, (count.get(t) ?? 0) + 1);
  });
  const present = [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
    .map(([id, n]) => ({ id, label: id, count: n }));
  if (present.length < 2) return [];
  return [{ id: "all", label: "全部", count: stories.length }, ...present];
}

export default function HomePage() {
  const initAuth = useAuthStore((s) => s.init);

  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const loadStories = () => {
    setLoading(true);
    setError(null);
    api
      .get<Story[]>("/stories/")
      .then((st) => setStories(st ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(loadStories, []);

  const cats = useMemo(() => buildCats(stories), [stories]);

  // 作品重新加载后，原选中的题材可能已不在架 —— 回落「全部」，否则会卡在空列表。
  useEffect(() => {
    if (cat !== "all" && !cats.some((c) => c.id === cat)) setCat("all");
  }, [cats, cat]);

  // 前端过滤：题材（作品主题）+ 搜索（标题/简介/题材名）。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stories.filter((s) => {
      if (cat !== "all" && primaryTag(s) !== cat) return false;
      if (!q) return true;
      const hay = `${s.title}${s.description}${storyTags(s.world_config).join("")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [stories, cat, query]);

  // 入场错落 + reduced-motion 兜底：交给 CSS 的 .reveal，进入视口加 .in。
  useEffect(() => {
    if (loading) return;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".work-card.reveal"));
    if (rm) {
      cards.forEach((c) => c.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (es, obs) => {
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            obs.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -6% 0px" }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [loading, filtered]);

  return (
    <>
      <AppHeader search={query} onSearch={setQuery} />

      <main>
        <section className="hero page">
          <p className="eyebrow lead">自由创作 · AI 共创</p>
          <h1>
            在这里，剧情有<span className="em">无穷种</span>可能
          </h1>
          <p>每个人都是玩家，也是创作者。挑一个世界走进去，或者亲手写一个——AI 陪你把它讲完。</p>
          {cats.length > 0 && (
            <div className="toolbar">
              <div className="filters" role="group" aria-label="题材筛选">
                {cats.map((c) => (
                  <button
                    key={c.id}
                    className="chip"
                    type="button"
                    aria-pressed={cat === c.id}
                    onClick={() => setCat(c.id)}
                  >
                    {c.label}
                    <span className="n">{c.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="page">
          <p className="resultbar" aria-live="polite">
            {loading
              ? "正在加载…"
              : error
              ? ""
              : `共 ${filtered.length} 部作品${cat !== "all" ? ` · ${cat}` : ""}`}
          </p>
        </div>

        {loading ? (
          <div className="page">
            <SkeletonWall />
          </div>
        ) : error ? (
          <ErrorState
            action={
              <button className="btn primary sm" onClick={loadStories}>
                重试
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="没有找到匹配的作品"
            desc="换个题材，或清空搜索词试试。也可以由你来写下这个世界的第一行。"
            action={
              <>
                <button
                  className="btn secondary sm"
                  onClick={() => {
                    setCat("all");
                    setQuery("");
                  }}
                >
                  清空筛选
                </button>
                <Link className="btn primary sm" href="/create">
                  去创作
                </Link>
              </>
            }
          />
        ) : (
          <div className="page">
            {/* 卡片标题是 h3，页面只有 h1 —— 补一个不可见的 h2 消除跳级 */}
            <h2 className="sr-only">作品列表</h2>
            <div className="wall">
              {filtered.map((s, i) => (
                <StoryCard key={s.id} story={s} index={i} />
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
