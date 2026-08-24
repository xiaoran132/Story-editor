"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { formatAttrValue } from "@/lib/state";
import { resolveTheme } from "@/lib/hue";
import { parseWorld, storyTags, visibleAttrs, workKicker } from "@/lib/work";
import WorldScope from "@/components/sky/WorldScope";
import WorkFace from "@/components/wx/WorkFace";
import StoryLLMConfigPanel from "@/components/StoryLLMConfigPanel";
import type { SessionListItem, SessionResult, Story, StoryLLMConfig } from "@/lib/types";
import styles from "./WorkDetail.module.css";

// POST/DELETE /stories/:id/like 的返回体。只有这一个消费方，不进 lib/types.ts。
type LikeResult = { liked: boolean; like_count: number };

// 一部作品的详情。**星系的聚焦浮层与 /story/[id] 是同一个组件**，不是两套。
//
// 设计稿把详情做成星系里的聚焦面板浮层，没有独立详情页；但深链、分享链接、
// /login?next=/story/xxx 的回跳都需要一个能单独存在的页面。所以这里出两种密度：
//   overlay —— 浮层，止于「走进这个世界」（大卡 + 钩子 + 世界观 + 属性 + 生成设置 + CTA）
//   page    —— 整页，多出标题/作者、登场人物、游玩次数、存档入口
// 解析、拦截、开局逻辑是同一份代码；差的只是 page 变体多渲染几段。
//
// 进入的拦截**必须在这里**，不能等玩家进了游玩页才吃一个流式报错：
// 没登录 → 引导登录（额度挂账号）；登录了但没有可用模型 → 就地给原因与去路。

const PlayIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);

const LockIcon = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export type WorkDetailProps = {
  story: Story;
  variant: "overlay" | "page";
  /** overlay 专用：控制入场位移与淡入。page 变体忽略。 */
  open?: boolean;
  /** overlay 专用：「回到星海」。 */
  onBack?: () => void;
};

export default function WorkDetail({ story, variant, open, onBack }: WorkDetailProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isPage = variant === "page";

  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  // 本作品的模型配置 + 「能不能开玩」。后端在同一次请求里给 ready/blocked，
  // 所以拦截不需要额外接口。未登录不请求（AuthRequired），cfg 恒为 null。
  const [cfg, setCfg] = useState<StoryLLMConfig | null>(null);
  // 本作品最近一次存档：/play/sessions 已返回带 story_id 的列表，前端过滤即可。
  const [lastSession, setLastSession] = useState<SessionListItem | null>(null);
  // 赞。初值来自作品 DTO（liked 只有详情接口会填，列表里恒 false）。
  // 计数以服务端返回的为准，不做乐观更新——点赞是幂等的，等一个往返比让数字先跳后退好。
  const [liked, setLiked] = useState(!!story.liked);
  const [likeCount, setLikeCount] = useState(story.like_count);
  const [likeBusy, setLikeBusy] = useState(false);

  useEffect(() => {
    setLiked(!!story.liked);
    setLikeCount(story.like_count);
  }, [story.id, story.liked, story.like_count]);

  useEffect(() => {
    if (!user) {
      setCfg(null);
      return;
    }
    let alive = true;
    api
      .get<StoryLLMConfig>(`/llm/story-config/${story.id}`)
      .then((c) => alive && setCfg(c))
      .catch(() => alive && setCfg(null)); // 拿不到就按「未就绪」处理，不假装能玩
    return () => {
      alive = false;
    };
  }, [story.id, user]);

  useEffect(() => {
    if (!user) {
      setLastSession(null);
      return;
    }
    let alive = true;
    api
      .get<SessionListItem[]>("/play/sessions")
      .then((list) => {
        if (!alive) return;
        const mine = (list ?? [])
          .filter((x) => x.story_id === story.id)
          .sort((a, b) => b.last_played_at.localeCompare(a.last_played_at));
        setLastSession(mine[0] ?? null);
      })
      .catch(() => {}); // 拿不到存档不影响开新局，静默
    return () => {
      alive = false;
    };
  }, [story.id, user]);

  const world = parseWorld(story.world_config);
  const theme = resolveTheme(story.world_config, story.id);
  const attrs = visibleAttrs(world);
  const tags = storyTags(story);
  // 能不能开玩：必须登录（额度挂账号）且后端判定 ready。cfg 未到达时按不可玩处理——
  // 宁可让按钮晚亮一瞬，也不要点下去才发现没模型。
  const canPlay = !!user && !!cfg?.ready;
  // 作者本人：发布之后同样要能改。后端 StoryService.Update 只校验属主、不看状态,
  // 一直支持已发布作品的编辑;缺的只是入口。
  const isAuthor = !!user && user.id === story.creator_id;

  const start = async () => {
    if (starting) return;
    if (!user) {
      router.push(`/login?next=/story/${story.id}`);
      return;
    }
    setStarting(true);
    setErr("");
    try {
      const r = await api.post<SessionResult>("/play/sessions", { story_id: story.id });
      router.push(`/play/${r.session.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setStarting(false);
    }
  };

  const toggleLike = async () => {
    if (likeBusy) return;
    if (!user) {
      // 匿名没有身份可去重，后端一律 401。与主 CTA 同样的处理：带 next 去登录，回来还在这一部
      router.push(`/login?next=/story/${story.id}`);
      return;
    }
    setLikeBusy(true);
    try {
      const path = `/stories/${story.id}/like`;
      const r = liked ? await api.del<LikeResult>(path) : await api.post<LikeResult>(path);
      setLiked(r.liked);
      setLikeCount(r.like_count);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLikeBusy(false);
    }
  };

  const rootCls = [
    styles.root,
    isPage ? styles.page : styles.overlay,
    !isPage && open ? styles.on : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootCls}>
      <WorldScope hue={theme.hue} className={styles.fcard}>
        <WorkFace story={story} big />
      </WorldScope>

      <div className={styles.meta}>
        {/* 浮层里作品名已经压在大卡上，再写一遍是重复；整页需要一个真正的 h1 */}
        {isPage ? (
          <>
            <p className={styles.kicker}>{workKicker(story)}</p>
            <h1 className={styles.title} id={`work-title-${story.id}`}>
              {story.title}
            </h1>
            {story.creator_name && (
              <p className={styles.byline}>
                作者 <b>{story.creator_name}</b>
              </p>
            )}
          </>
        ) : (
          <h2 className="sr-only" id={`work-title-${story.id}`}>
            {story.title}
          </h2>
        )}

        {story.description && <p className={styles.tagline}>{story.description}</p>}

        {/* 两种密度都给：赞是真能点的动作，不是摆设。
            选中态用中性亮态而不是暖金——每屏暖金配额已经给了品牌标记与主 CTA。 */}
        <div className={styles.stats}>
          {isPage && (
            <span>
              {PlayIcon}
              {story.play_count} 次游玩
            </span>
          )}
          <button
            className={`${styles.likeBtn} ${liked ? styles.liked : ""}`}
            type="button"
            aria-pressed={liked}
            aria-label={liked ? `取消赞《${story.title}》` : `赞《${story.title}》`}
            onClick={toggleLike}
          >
            <HeartIcon filled={liked} />
            <span>{likeCount}</span>
          </button>
        </div>

        {tags.length > 0 && (
          <div className={styles.tags}>
            {tags.map((t) => (
              <span className={styles.chip} key={t}>
                {t}
              </span>
            ))}
          </div>
        )}

        {world.background && (
          <>
            <h3 className={styles.h2}>世界观</h3>
            <p className={styles.world}>{world.background}</p>
            {world.style && <p className={styles.world}>风格 · {world.style}</p>}
          </>
        )}

        {isPage && world.characters && world.characters.length > 0 && (
          <>
            <h3 className={styles.h2}>登场人物</h3>
            {world.characters.map((c, i) => (
              <p className={styles.char} key={`${c.name ?? ""}-${i}`}>
                <b>{c.name}</b>
                {c.role && <span className={styles.role}>（{c.role}）</span>}
                {(c.personality || c.desc) && (
                  <span className={styles.desc}>{c.personality || c.desc}</span>
                )}
              </p>
            ))}
          </>
        )}

        {attrs.length > 0 && (
          <>
            <h3 className={styles.h2}>你将背负的状态</h3>
            <div className={styles.attrs}>
              {attrs.map(([k, spec]) =>
                spec?.reveal ? (
                  <span className={`${styles.attr} ${styles.attrLocked}`} key={k}>
                    {LockIcon}
                    {k} · 需在剧情中揭示
                  </span>
                ) : (
                  <span className={styles.attr} key={k}>
                    {k}
                    <b>{formatAttrValue(spec?.initial)}</b>
                  </span>
                ),
              )}
            </div>
          </>
        )}

        {/* 两种密度都给：浮层里同样能按「走进这个世界」，也同样会弹「没有可用模型」的
            拦截横幅——只拦不给去路，玩家在浮层里就无路可走了。 */}
        <h3 className={styles.h2}>生成设置</h3>
        <StoryLLMConfigPanel
          storyId={story.id}
          recommended={world.recommended_models || {}}
          loggedIn={!!user}
          cfg={cfg}
          onCfgChange={setCfg}
        />

        {!user ? (
          <div className={styles.block}>
            <span>
              <b>注册即赠 1 元体验额度</b>，可直接用平台模型开玩；也可以接自己的模型连接。
            </span>
          </div>
        ) : cfg && !cfg.ready ? (
          <div className={styles.block} role="alert">
            <span>{cfg.blocked}</span>
            <button
              className={styles.btnGhost}
              type="button"
              onClick={() => router.push("/mine/settings")}
            >
              去添加连接
            </button>
          </div>
        ) : null}

        <p className={styles.err} role="alert">
          {err}
        </p>

        <div className={styles.facts}>
          {/* 未登录时**不禁用**：死按钮点了毫无反馈，只会被当成坏了。
              改成可点 + 直说要登录，点击带 next 跳登录页，回来还在这一部作品。 */}
          <button
            className={styles.btnEnter}
            type="button"
            disabled={starting || (!!user && !canPlay)}
            onClick={start}
          >
            {PlayIcon}
            {starting ? "正在生成开场…" : user ? "走进这个世界" : "登录后进入"}
          </button>

          {lastSession && (
            <button
              className={styles.btnGhost}
              type="button"
              disabled={!canPlay}
              onClick={() => router.push(`/play/${lastSession.id}`)}
            >
              继续上次
              <small>第 {Math.max(0, lastSession.node_count - 1)} 步</small>
            </button>
          )}

          {isAuthor && (
            <Link className={styles.btnGhost} href={`/edit/${story.id}`}>
              编辑这部作品
            </Link>
          )}

          {!isPage && onBack && (
            <button className={styles.btnQuiet} type="button" onClick={onBack}>
              ← 回到星海
            </button>
          )}
        </div>

        <p className={styles.hint}>
          {lastSession ? "开新局不会覆盖存档，两条线各走各的。" : ""}
          游玩消耗平台额度或你自己的模型连接；登录后可跨设备续玩。
        </p>
      </div>
    </div>
  );
}
