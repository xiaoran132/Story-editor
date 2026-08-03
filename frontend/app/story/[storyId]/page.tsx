"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { trackGuestSession } from "@/lib/guestSessions";
import { useAuthStore } from "@/store/authStore";
import type { SessionResult, Story } from "@/lib/types";

// 从 world_config JSON 字符串里安全提取展示用字段。
function parseWorld(worldConfig: string): {
  background?: string;
  style?: string;
  characters?: Array<{ name?: string; role?: string; personality?: string }>;
} {
  try {
    return JSON.parse(worldConfig || "{}");
  } catch {
    return {};
  }
}

export default function StoryDetailPage() {
  const router = useRouter();
  const params = useParams<{ storyId: string }>();
  const storyId = params.storyId;
  const user = useAuthStore((s) => s.user);

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storyId) return;
    api
      .get<Story>(`/stories/${storyId}`)
      .then((s) => setStory(s))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [storyId]);

  const start = async () => {
    if (starting || !story) return;
    setStarting(true);
    setError(null);
    try {
      const r = await api.post<SessionResult>("/play/sessions", {
        story_id: story.id,
      });
      if (!user) trackGuestSession(r.session.id); // 匿名进度：记下以便登录后领取
      router.push(`/play/${r.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };

  const world = story ? parseWorld(story.world_config) : {};

  return (
    <div className="wrap">
      <div className="topbar">
        <span className="eyebrow">作品详情</span>
        <span className="back" onClick={() => router.push("/")}>
          ← 返回作品
        </span>
      </div>

      {loading ? (
        <div className="empty pulse">载入中…</div>
      ) : !story ? (
        <div className="status err">出错：{error || "作品不存在"}</div>
      ) : (
        <article className="story-detail">
          <h1 className="hero-title">{story.title}</h1>
          {story.description && <p className="hero-sub">{story.description}</p>}

          {world.background && (
            <section className="detail-block">
              <h2>背景</h2>
              <p>{world.background}</p>
            </section>
          )}
          {world.style && (
            <section className="detail-block">
              <h2>风格基调</h2>
              <p>{world.style}</p>
            </section>
          )}
          {world.characters && world.characters.length > 0 && (
            <section className="detail-block">
              <h2>登场人物</h2>
              <ul className="char-list">
                {world.characters.map((c, i) => (
                  <li key={i}>
                    <b>{c.name}</b>
                    {c.role ? <span className="char-role">（{c.role}）</span> : null}
                    {c.personality ? <span className="char-desc">{c.personality}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {error && <div className="status err">出错：{error}</div>}

          <div className="detail-actions">
            <button className="primary-btn" disabled={starting} onClick={start}>
              {starting ? "正在点亮星图…" : "开始新游戏 ▸"}
            </button>
          </div>
        </article>
      )}
    </div>
  );
}
