"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePlayStore } from "@/store/playStore";
import { assetUrl } from "@/lib/api";
import {
  useReadingTheme,
  getReadingMode,
  setReadingMode,
  getScrimAlpha,
  setScrimAlpha,
  SCRIM_MIN,
  SCRIM_MAX,
  SCRIM_DEFAULT,
  SCENES,
  setReadingScene,
} from "@/lib/useReadingTheme";
import AttrBar from "@/components/AttrBar";
import StoryPane from "@/components/StoryPane";
import OptionList from "@/components/OptionList";
import StoryTree from "@/components/StoryTree";
import { IconClose } from "@/components/icons";

const MapIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="5" cy="6" r="2" /><circle cx="19" cy="9" r="2" /><circle cx="9" cy="18" r="2" /><path d="M6.7 7 17 8.4M8 16l9-6" />
  </svg>
);

export default function PlayPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const {
    session, currentNode, allNodes, storyTitle, theme, coverUrl,
    hiddenAttrs, revealGated, attrMax, busy, readOnly, streamingText, loading, error,
    load, choose, backtrack, reset,
  } = usePlayStore();

  // 只读局（作品已下架）与生成中一样锁掉一切写操作：选项、自由输入、回溯。
  // 复用 busy 这个既有的禁用通道，不再给每个子组件加第二个开关。
  const locked = busy || readOnly;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<"day" | "night">("night");
  const [scrim, setScrim] = useState(SCRIM_DEFAULT);
  const [scene, setScene] = useState(""); // 氛围场景（不持久化，见 useReadingTheme.SCENES）

  // 作品主题：整页阅读态换肤（含挂载时套用已存的昼夜/遮罩偏好）；封面作阅读背景图
  useReadingTheme(theme, assetUrl(coverUrl));

  // 选项坞是 position:fixed 浮在正文之上，舞台必须留出等高的底部空白，否则最后一段
  // 正文被压在坞下面。这个高度**不能写死**：选项 3~4 条、文字会换行、生成中还会多出
  // 一条 genbar，实测能从 ~200px 变到 400px+。用 ResizeObserver 把实测值写进 --dock-h，
  // 由 .od-stage 的 padding-bottom 消费（见 globals.css）。
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () =>
      document.documentElement.style.setProperty("--dock-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--dock-h"); // 别漏到别的页面
    };
  }, []);

  // 控件态从持久化偏好初始化——hook 已把值套到 <html>，这里只是让滑块/分段与之对齐。
  useEffect(() => {
    setMode(getReadingMode());
    setScrim(getScrimAlpha());
  }, []);

  useEffect(() => {
    if (sessionId) load(sessionId);
    return () => reset();
  }, [sessionId, load, reset]);

  const treeReady = allNodes.length > 1;

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const handleBacktrack = (nodeId: string) => {
    backtrack(nodeId);
    setDrawerOpen(false);
  };

  const changeScrim = (v: number) => setScrim(setScrimAlpha(v));
  // 在三档氛围间循环。CSS 的 [data-scene] 早就写好了，此前一直没有触发入口。
  const cycleScene = () => {
    const i = SCENES.findIndex((x) => x.id === scene);
    const next = SCENES[(i + 1) % SCENES.length];
    setScene(next.id);
    setReadingScene(next.id);
  };
  const toggleMode = (m: "day" | "night") => {
    setMode(m);
    setReadingMode(m);
  };

  let revealedAttrs: string[] = [];
  try {
    revealedAttrs = JSON.parse(session?.revealed_attrs || "[]");
  } catch {
    revealedAttrs = [];
  }

  // 章节标签：后端没有章节概念，用当前节点在这条线上的深度当「第几节」——
  // 比凭空编一个章节名诚实，也让玩家对「走了多远」有感。根节点为序章。
  const chapterLabel = currentNode
    ? currentNode.depth === 0
      ? "序章"
      : `第 ${currentNode.depth} 节`
    : undefined;

  // 生命周期指示：载入期不能报「已交付」——那时正文还没到，绿灯会骗人。
  const lifecycle = error
    ? ""
    : loading
    ? "载入会话中…"
    : busy
    ? streamingText
      ? "逐字生成中…"
      : "正在生成…"
    : "已交付";
  const lifeCls = error ? "degrade" : loading || busy ? "gen" : "done";

  return (
    <>
      <div className="od-bg" />
      <div className="od-grain" />
      <div className="od-vignette" />

      {/* 顶部悬浮控制条 */}
      <div className="od-top">
        <button className="od-back" onClick={() => router.push("/")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          书库
        </button>
        {/* 作品名就是这一屏的主标题：用 h1 而不是 span，样式不变 */}
        <h1 className="od-title">{storyTitle || "载入中…"}</h1>
        <div className="od-controls">
          <div className="od-ctl" title="调整正文遮罩浓淡（已设可读性下限）">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 12h18" /></svg>
            <input type="range" min={SCRIM_MIN} max={SCRIM_MAX} value={scrim} aria-label="遮罩浓度"
              onChange={(e) => changeScrim(Number(e.target.value))} />
          </div>
          <div className="od-seg" role="group" aria-label="昼夜">
            <button className={mode === "day" ? "on" : ""} onClick={() => toggleMode("day")}>昼</button>
            <button className={mode === "night" ? "on" : ""} onClick={() => toggleMode("night")}>夜</button>
          </div>
          <button
            className="icon-btn"
            aria-label={`切换氛围（当前：${SCENES.find((x) => x.id === scene)?.label ?? "原色"}）`}
            onClick={cycleScene}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
            </svg>
          </button>
          <button className="icon-btn" aria-label="剧情星图" disabled={!treeReady} aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}>
            {MapIcon}
          </button>
        </div>
      </div>

      {/* 三栏舞台 */}
      <div className="od-stage">
        <aside className="od-rail left">
          {!loading && (
            <AttrBar
              stateJSON={session?.current_state ?? null}
              deltaJSON={currentNode?.state_delta ?? null}
              hiddenAttrs={hiddenAttrs}
              revealGated={revealGated}
              revealedAttrs={revealedAttrs}
              attrMax={attrMax}
            />
          )}
        </aside>

        <main className="reader">
          <div className="scrim">
            <div className={`lifecycle ${lifeCls}`}><span className="ld" aria-hidden="true" />{lifecycle}</div>
            {/* 只读局：不说清楚原因，玩家只会以为选项坏了 */}
            {readOnly && !loading && (
              <div className="notice" role="status">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                作者已取消发布这部作品 · 这一局可以读完，但不能再推进
              </div>
            )}
            {error && (
              <div className="notice err">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                出错：{error} · 可再次选择或输入以重试
              </div>
            )}
            {loading ? (
              <p className="prose loading">载入会话中…</p>
            ) : (
              <StoryPane
                node={currentNode}
                busy={busy}
                streamingText={streamingText}
                chapter={chapterLabel}
              />
            )}
          </div>
        </main>

        <aside className="od-rail right">
          <div className="panel">
            <h2>旅程</h2>
            <div className="od-jrow"><span>回合</span><b>{session?.node_count ?? 0}</b></div>
            <div className="od-jrow"><span>已探索</span><b>{allNodes.length || 0}</b></div>
            <button className="btn secondary sm od-mini" disabled={!treeReady} onClick={() => setDrawerOpen(true)}>
              {MapIcon} 剧情星图
            </button>
          </div>
        </aside>
      </div>

      {/* 底部选项坞 */}
      <div className="dock" ref={dockRef}>
        <div className="dock-inner">
          {!loading && <OptionList node={currentNode} busy={locked} onChoose={choose} />}
        </div>
      </div>

      {/* 星图抽屉 */}
      {treeReady && (
        <>
          {/* 遮罩退化为纯装饰：点击关闭对键盘用户不可达，而关闭动作 Esc 与抽屉内的 .close 都已覆盖。
              保留鼠标点击体验，但不让它成为唯一入口，也不假装自己是控件。 */}
          <div className={`od-overlay${drawerOpen ? " on" : ""}`} aria-hidden="true" onClick={() => setDrawerOpen(false)} />
          <aside className={`od-drawer${drawerOpen ? " open" : ""}`} aria-hidden={!drawerOpen}>
            <button className="close" aria-label="收起星图" onClick={() => setDrawerOpen(false)}><IconClose size={18} /></button>
            <h2>剧情星图</h2>
            <p className="sub">你走过的每一步都留在这里 · 点亮的节点可回溯续玩</p>
            <ul className="tree-legend">
              <li><i className="lg cur" />当前</li>
              <li><i className="lg on" />主线</li>
              <li><i className="lg dim" />已放弃</li>
              <li><i className="lg end" />结局</li>
            </ul>
            <StoryTree
              nodes={allNodes}
              currentNodeId={session?.current_node_id ?? null}
              busy={locked}
              onBacktrack={handleBacktrack}
              bare
              active={drawerOpen}
            />
          </aside>
        </>
      )}
    </>
  );
}
