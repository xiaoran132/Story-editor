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

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>AI 互动剧情</h1>
      </div>

      {error && <div className="status err">出错：{error}</div>}
      {starting && <div className="status pulse">正在开启新的旅程…</div>}

      {sessions.length > 0 && (
        <>
          <h2>继续游玩</h2>
          <div className="grid">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                item={s}
                onClick={() => router.push(`/play/${s.id}`)}
              />
            ))}
          </div>
        </>
      )}

      <h2>选择作品</h2>
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
