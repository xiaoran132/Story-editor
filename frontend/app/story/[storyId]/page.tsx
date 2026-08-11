"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, assetUrl } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useReadingTheme } from "@/lib/useReadingTheme";
import { formatAttrValue } from "@/lib/state";
import StoryLLMConfigPanel from "@/components/StoryLLMConfigPanel";
import type { RecommendedModels, SessionListItem, SessionResult, Story, StoryLLMConfig } from "@/lib/types";

interface AttrSpec { type?: string; initial?: unknown; hidden?: boolean; reveal?: boolean }

function parseWorld(worldConfig: string): {
  background?: string;
  style?: string;
  characters?: Array<{ name?: string; role?: string; personality?: string; desc?: string }>;
  tags?: string[];
  attributes?: Record<string, AttrSpec>;
  recommended_models?: RecommendedModels;
  theme?: string;
} {
  try {
    return JSON.parse(worldConfig || "{}");
  } catch {
    return {};
  }
}

const BackIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export default function StoryDetailPage() {
  const router = useRouter();
  const params = useParams<{ storyId: string }>();
  const storyId = params.storyId;
  const user = useAuthStore((s) => s.user);

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 本作品的最近一次存档（原型 story-detail.html:164 的「继续上次」）。
  // /play/sessions 已返回带 story_id 的列表，前端过滤即可，无需新接口。
  const [lastSession, setLastSession] = useState<SessionListItem | null>(null);
  // 本作品的模型配置 + 「能不能开玩」。后端在同一次请求里给 ready/blocked，
  // 所以拦截不需要额外接口。未登录不请求（AuthRequired），cfg 恒为 null。
  const [cfg, setCfg] = useState<StoryLLMConfig | null>(null);

  useEffect(() => {
    if (!storyId || !user) return;
    api
      .get<StoryLLMConfig>(`/llm/story-config/${storyId}`)
      .then(setCfg)
      .catch(() => setCfg(null)); // 拿不到就按"未就绪"处理，不假装能玩
  }, [storyId, user]);

  useEffect(() => {
    if (!storyId) return;
    api
      .get<Story>(`/stories/${storyId}`)
      .then((s) => setStory(s))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [storyId]);

  useEffect(() => {
    if (!storyId) return;
    api
      .get<SessionListItem[]>("/play/sessions")
      .then((list) => {
        const mine = (list ?? [])
          .filter((x) => x.story_id === storyId)
          .sort((a, b) => b.last_played_at.localeCompare(a.last_played_at));
        setLastSession(mine[0] ?? null);
      })
      .catch(() => {}); // 拿不到存档不影响开新局，静默
  }, [storyId, user]);

  // 能不能开玩：必须登录（额度挂账号）且后端判定 ready。cfg 未到达时按不可玩处理——
  // 宁可让按钮晚亮一瞬，也不要点下去才发现没模型。
  const canPlay = !!user && !!cfg?.ready;

  const world = story ? parseWorld(story.world_config) : {};
  // 作品主题：整页阅读态换肤；封面（若有）作为阅读背景图注入 --reader-bg
  useReadingTheme(world.theme, assetUrl(story?.cover_url ?? ""));

  const start = async () => {
    if (starting || !story) return;
    setStarting(true);
    setError(null);
    try {
      const r = await api.post<SessionResult>("/play/sessions", { story_id: story.id });
      router.push(`/play/${r.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };

  // 属性预览：hidden 属性**整条不出现**——它的契约是「仅供 AI 参考、玩家端永不展示」，
  // 连它存在都不该让玩家知道（猜疑度/命运值这类背后压力表一旦亮出来，玩法就变味了）。
  // reveal 门控则相反：明说「有东西会在剧情里显现」是钩子，只是不泄露初值。
  const attrEntries = Object.entries(world.attributes || {}).filter(([, s]) => !s?.hidden);

  return (
    <>
      <div className="od-bg" />
      <div className="od-grain" />
      <div className="od-vignette" />

      <div className="od-top">
        <button className="od-back" onClick={() => router.push("/")}>
          {BackIcon} 书库
        </button>
      </div>

      <main style={{ maxWidth: 680, margin: "0 auto", padding: "20px 24px 80px" }}>
        {loading ? (
          <article className="scrim od-panel">
            <p className="prose loading">载入中…</p>
          </article>
        ) : !story ? (
          <article className="scrim od-panel">
            <p className="notice err">出错：{error || "作品不存在"}</p>
          </article>
        ) : (
          <article className="scrim od-panel">
            <div className="od-kick">{world.tags?.[0] ?? "AI 生成"}</div>
            <h1 className="od-h1">{story.title}</h1>
            {story.creator_name && (
              <div className="od-byline">
                <span className="au" aria-hidden="true" /> 作者 <b>{story.creator_name}</b>
              </div>
            )}
            <div className="od-stats">
              <span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                {story.play_count} 游玩
              </span>
              <span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
                {story.like_count} 赞
              </span>
              {/* 「分支 ∞」已移除：它坐在真实数字旁边会被读成统计值，而后端并没有分支数 */}
            </div>

            {story.description && <p className="od-premise">{story.description}</p>}

            {world.tags && world.tags.length > 0 && (
              <div className="od-tags">
                {world.tags.map((t) => (
                  <span className="od-tag" key={t}>{t}</span>
                ))}
              </div>
            )}

            {world.background && (
              <>
                <div className="od-rule" />
                <h2 className="od-h2">世界观</h2>
                <p className="od-intro">{world.background}</p>
                {world.style && <p className="od-intro" style={{ marginTop: 12 }}>风格 · {world.style}</p>}
              </>
            )}

            {world.characters && world.characters.length > 0 && (
              <>
                <div className="od-rule" />
                <h2 className="od-h2">登场人物</h2>
                {world.characters.map((c, i) => (
                  <div className="od-char" key={i}>
                    <b>{c.name}</b>
                    {c.role && <span className="role">（{c.role}）</span>}
                    {(c.personality || c.desc) && <span className="desc">{c.personality || c.desc}</span>}
                  </div>
                ))}
              </>
            )}

            {attrEntries.length > 0 && (
              <>
                <div className="od-rule" />
                <h2 className="od-h2">你将背负的状态</h2>
                <div className="od-attrs">
                  {attrEntries.map(([k, spec]) =>
                    spec?.reveal ? (
                      <div className="od-attr-card locked" key={k}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                        </svg>
                        {k} · 需在剧情中揭示
                      </div>
                    ) : (
                      <div className="od-attr-card" key={k}>
                        <div className="an">
                          <span>{k}</span>
                          <b>{formatAttrValue(spec?.initial)}</b>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </>
            )}

            <div className="od-rule" />
            <h2 className="od-h2">生成设置</h2>
            <StoryLLMConfigPanel
              storyId={story.id}
              recommended={world.recommended_models || {}}
              loggedIn={!!user}
              cfg={cfg}
              onCfgChange={setCfg}
            />

            {error && <p className="notice err" style={{ marginTop: 16 }}>出错：{error}</p>}

            {/* 墙撑在这里：没有可用模型就别让玩家进游玩页才吃一个流式报错。
                未登录 → 引导登录（额度挂在账号上）；已登录未配 → 就地给原因与去路。 */}
            {!user ? (
              <div className="od-block">
                <span><b>登录即赠 1 元体验额度</b>，可直接用平台模型开玩；也可以配置自己的模型连接。</span>
                <button
                  className="btn-read primary"
                  onClick={() => router.push(`/login?next=/story/${storyId}`)}
                >
                  登录 / 注册
                </button>
              </div>
            ) : cfg && !cfg.ready ? (
              <div className="od-block" role="alert">
                <span>{cfg.blocked}</span>
                <button className="btn-read ghost" onClick={() => router.push("/me?section=llm")}>
                  去添加连接
                </button>
              </div>
            ) : null}

            <div className="od-cta">
              {lastSession && (
                <button
                  className="btn-read ghost"
                  disabled={!canPlay}
                  onClick={() => router.push(`/play/${lastSession.id}`)}
                >
                  继续上次
                  <small>第 {Math.max(0, lastSession.node_count - 1)} 步</small>
                </button>
              )}
              <button className="btn-read primary" disabled={starting || !canPlay} onClick={start}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                {starting ? "正在生成开场…" : "开始新游戏"}
              </button>
            </div>
            <p className="od-cont-hint">
              {lastSession ? "开新局不会覆盖存档，两条线各走各的。" : ""}
              游玩消耗平台额度或你自己的模型连接；登录后可跨设备续玩。
            </p>
          </article>
        )}
      </main>
    </>
  );
}
