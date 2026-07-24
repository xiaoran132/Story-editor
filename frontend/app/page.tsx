"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SessionListItem, SessionResult, Story } from "@/lib/types";
import StoryCard from "@/components/StoryCard";
import SessionCard from "@/components/SessionCard";

export default function HomePage() {
  const router = useRouter();
  const [stories, setStories] = useState<Story[]>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [st, se] = await Promise.all([
          api.get<Story[]>("/stories/"),
          api.get<SessionListItem[]>("/play/sessions"),
        ]);
        setStories(st ?? []);
        setSessions(se ?? []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const startStory = async (story: Story) => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const r = await api.post<SessionResult>("/play/sessions", {
        story_id: story.id,
      });
      router.push(`/play/${r.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };

  // 删除会话：乐观移除，失败则回滚并提示。
  const deleteSession = async (id: string) => {
    const prev = sessions;
    setSessions((list) => list.filter((s) => s.id !== id));
    try {
      await api.del(`/play/sessions/${id}`);
    } catch (e) {
      setSessions(prev);
      setError((e as Error).message);
    }
  };

  return (
    <div className="wrap">
      <header className="hero">
        <div>
          <span className="eyebrow">AI 互动剧情共创</span>
          <h1 className="hero-title">
            你的每个选择，
            <br />
            都是一颗<span className="accent">星</span>
          </h1>
          <p className="hero-sub">
            与 AI 共同生成剧情，沿分支探索、回溯改写。每一次抉择都在星图上留下一条轨迹。
          </p>
        </div>
        <Constellation />
      </header>

      {error && <div className="status err">出错：{error}</div>}
      {starting && <div className="status pulse">正在点亮新的星图…</div>}

      {sessions.length > 0 && (
        <>
          <h2>继续你的旅程</h2>
          <div className="grid">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                item={s}
                onClick={() => router.push(`/play/${s.id}`)}
                onDelete={() => deleteSession(s.id)}
              />
            ))}
          </div>
        </>
      )}

      <h2>选择一部作品启程</h2>
      {loading ? (
        <div className="empty pulse">载入中…</div>
      ) : stories.length === 0 ? (
        <div className="empty">暂无可玩的作品</div>
      ) : (
        <div className="grid">
          {stories.map((s) => (
            <StoryCard
              key={s.id}
              story={s}
              disabled={starting}
              onClick={() => startStory(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 首页装饰星座：静态 SVG，一条主线串起几颗星，末端为暖金"目标星"。
function Constellation() {
  return (
    <svg
      className="hero-constellation"
      viewBox="0 0 240 200"
      role="img"
      aria-label="星座装饰"
    >
      <polyline
        className="c-line"
        points="30,150 80,110 120,140 165,70 210,40"
        fill="none"
      />
      <polyline className="c-line" points="80,110 95,60 130,45" fill="none" />
      <circle className="c-star" cx="30" cy="150" r="3" />
      <circle className="c-star" cx="80" cy="110" r="3.5" />
      <circle className="c-star" cx="120" cy="140" r="2.5" />
      <circle className="c-star" cx="95" cy="60" r="2.5" />
      <circle className="c-star" cx="130" cy="45" r="2.5" />
      <circle className="c-star" cx="165" cy="70" r="3" />
      <circle className="c-star lead" cx="210" cy="40" r="5" />
    </svg>
  );
}
