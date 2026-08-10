"use client";

import Link from "next/link";
import { themeAccent, themeGradient, type Story } from "@/lib/types";
import { IconArrowRight } from "@/components/icons";

// 从 world_config 取：主题 id（只决定配色）、题材标签、是否含隐藏属性（封面徽标用）。
function parseWorld(worldConfig: string): { theme: string; tags: string[]; hasHidden: boolean } {
  try {
    const w = JSON.parse(worldConfig || "{}");
    const theme = String(w.theme ?? "star") || "star";
    const tags = Array.isArray(w.tags) ? w.tags.map(String).filter(Boolean) : [];
    const attrs = (w.attributes ?? {}) as Record<string, { hidden?: boolean; reveal?: boolean }>;
    const hasHidden = Object.values(attrs).some((a) => a?.hidden || a?.reveal);
    return { theme, tags, hasHidden };
  } catch {
    return { theme: "star", tags: [], hasHidden: false };
  }
}

const PlayIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const LikeIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);

// 管理态封面卡：封面用作品主题渐变（外壳中性，彩色只来自作品自身）。
// 所有卡等大（封面固定高 + 标题/摘要钳行），index 只用于入场错落延迟。
export default function StoryCard({
  story,
  index = 0,
}: {
  story: Story;
  index?: number;
}) {
  const { theme, tags, hasHidden } = parseWorld(story.world_config);
  const accent = themeAccent(theme);
  const [g0, g1] = themeGradient(theme);
  // kicker 用题材（tags[0]），不再拿主题名充数——主题只决定配色，
  // 拿它当题材会出现「孤岛探案」卡上写着「恐怖 · 怪谈」这种张冠李戴。
  const kicker = tags[0] ?? "";
  return (
    <Link
      className="work-card reveal"
      href={`/story/${story.id}`}
      style={{ ["--reveal-delay" as string]: `${Math.min(index, 7) * 55}ms` }}
      aria-label={kicker ? `${story.title}，题材 ${kicker}` : story.title}
    >
      <div
        className="cover alive"
        style={{ background: `linear-gradient(155deg, ${g0}, ${g1} 55%, ${g0})` }}
      >
        <span className="cover-badge" style={{ color: accent }}>
          {hasHidden ? "含隐藏属性" : "AI 生成"}
        </span>
        {kicker && <span className="kicker" style={{ color: accent }}>{kicker}</span>}
        <h3>{story.title}</h3>
        <div className="excerpt">{story.description || "一个等你走进去的世界。"}</div>
        <span className="cta">开始阅读 <IconArrowRight size={13} /></span>
      </div>
      {tags.length > 1 && (
        <div className="work-tags">
          {tags.slice(1).map((t) => (
            <span className="tag" key={t}>{t}</span>
          ))}
        </div>
      )}
      <div className="work-meta">
        {/* 署名只在后端真的给了昵称时出现——统一挂个假作者名比不署名更伤 */}
        {story.creator_name && (
          <>
            <span className="au" aria-hidden="true" />
            <span className="who">{story.creator_name}</span>
          </>
        )}
        <span className="stat">
          <span>{PlayIcon} {story.play_count}</span>
          <span>{LikeIcon} {story.like_count}</span>
        </span>
      </div>
    </Link>
  );
}
