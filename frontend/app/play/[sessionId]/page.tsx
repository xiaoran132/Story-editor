"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePlayStore } from "@/store/playStore";
import { assetUrl } from "@/lib/api";
import {
  getScrimAlpha,
  setScrimAlpha,
  SCRIM_MIN,
  SCRIM_MAX,
} from "@/lib/readerPrefs";
import { attrLabel, formatDelta, parseState } from "@/lib/state";
import { useReducedMotion } from "@/lib/useReducedMotion";
import Figure from "@/components/sky/Figure";
import WorldScope from "@/components/sky/WorldScope";
import AttrBar from "@/components/AttrBar";
import StoryPane from "@/components/StoryPane";
import OptionList from "@/components/OptionList";
import StoryTree, { nodeLabel } from "@/components/StoryTree";
import Switch from "@/components/Switch";
import { IconClose } from "@/components/icons";
import styles from "./page.module.css";

// 游玩页 —— 规格 DESIGN.md §7.3，视觉目标 docs/design/play-story.html。
//
// 图层顺序（从底到顶）：世界场景 → 剪影 → 自传背景图层 → 颗粒 → 暗角 → 阅读遮罩 → 正文。
// 自传背景压在场景之上、颗粒/暗角/遮罩之下，**对比度护栏因此自动生效**——
// 换一张再亮的封面，正文也不会掉出 AA。
//
// ⚠️ 遮罩浓度下限 0.52 有两处表达：滑杆的 min 和 lib/readerPrefs 的 SCRIM_MIN
// （百分比整数，不是 0–1 小数）。JS 侧是唯一真源，两边必须同步。

// 正文字号与行距：设置面板可调，值挂在页面根元素上由 StoryPane 消费。
const SIZE_MIN = 15;
const SIZE_MAX = 22;
const SIZE_DEFAULT = 17;
const LEAD_MIN = 1.7;
const LEAD_MAX = 2.4;
const LEAD_DEFAULT = 2.05;
const READER_PREFS_KEY = "wanxiang-reader-v1";

const BackIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
const AttrIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M4 18V9M10 18V5M16 18v-6M4 18h16" />
  </svg>
);
const MapIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
    <path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" />
  </svg>
);
const SetIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="9" cy="17" r="2.2" />
  </svg>
);

type Panel = "" | "attrs" | "map" | "sheet";

export default function PlayPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const reduced = useReducedMotion();

  const {
    session, currentNode, allNodes, storyTitle, storyKicker, theme, coverUrl,
    hiddenAttrs, revealGated, attrMax, busy, readOnly, streamingText, loading, error,
    load, choose, backtrack, reset,
  } = usePlayStore();

  // 只读局（作品已下架）与生成中一样锁掉一切写操作：选项、自由输入、回溯。
  // 复用 busy 这个既有的禁用通道，不给每个子组件加第二个开关。
  const locked = busy || readOnly;

  // 三个面板互斥：属性、星图、阅读设置。同屏摞两个浮层没有意义，也会打架。
  // 属性面板在宽屏默认展开——它是「此刻的你」，不是偶尔查一次的东西。
  const [panel, setPanel] = useState<Panel>("attrs");
  const [scrim, setScrim] = useState(74);
  const [size, setSize] = useState(SIZE_DEFAULT);
  const [lead, setLead] = useState(LEAD_DEFAULT);
  const [drift, setDrift] = useState(true); // 世界在身后漂移
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const mapRef = useRef<HTMLElement>(null);
  const lastPanelTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (sessionId) load(sessionId);
    return () => reset();
  }, [sessionId, load, reset]);

  // 阅读偏好：遮罩沿用既有的 SCRIM_* 持久化（与设置页共用），
  // 字号/行距/漂移是这一页自己的，合存一个键。
  useEffect(() => {
    setScrim(getScrimAlpha());
    try {
      const raw = JSON.parse(window.localStorage.getItem(READER_PREFS_KEY) || "{}");
      if (typeof raw.size === "number") setSize(raw.size);
      if (typeof raw.lead === "number") setLead(raw.lead);
      if (typeof raw.drift === "boolean") setDrift(raw.drift);
    } catch {
      /* 坏数据忽略，用默认值 */
    }
  }, []);

  const savePrefs = (next: { size?: number; lead?: number; drift?: boolean }) => {
    try {
      window.localStorage.setItem(
        READER_PREFS_KEY,
        JSON.stringify({ size, lead, drift, ...next }),
      );
    } catch {
      /* 隐私模式写不了，不影响阅读 */
    }
  };

  // 属性面板在宽屏是常驻的「此刻的你」；≤1000px 它是底部抽屉，默认展开会把
  // 正文下半截压住。初值不能按视口给（服务端没有 matchMedia，会水合失配），
  // 所以挂载后再关。
  useEffect(() => {
    if (window.matchMedia("(max-width:1000px)").matches) setPanel("");
  }, []);

  // 星图默认检视当前航点
  useEffect(() => {
    if (panel === "map") setSelectedNode(session?.current_node_id ?? null);
  }, [panel, session?.current_node_id]);

  // Esc 关面板，焦点归还触发它的按钮（§9）
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 属性面板在宽屏是常驻态，Esc 不该把它也收走
      if (panel === "attrs") return;
      setPanel("");
      lastPanelTrigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  // 星图是模态浮层：Tab 在里面回环，否则焦点会跑到身后的正文上再也回不来
  useEffect(() => {
    if (panel !== "map") return;
    const view = mapRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !view) return;
      const f = view.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  const togglePanel = (p: Panel, e: React.MouseEvent<HTMLButtonElement>) => {
    lastPanelTrigger.current = e.currentTarget;
    setPanel((cur) => (cur === p ? "" : p));
  };

  const revealedAttrs = useMemo(() => {
    try {
      const v = JSON.parse(session?.revealed_attrs || "[]");
      return Array.isArray(v) ? (v as string[]) : [];
    } catch {
      return [];
    }
  }, [session?.revealed_attrs]);

  // 章节标签：后端没有章节概念，用当前节点在这条线上的深度当「第几节」——
  // 比凭空编一个章节名诚实，也让玩家对「走了多远」有感。根节点为序章。
  const chapterLabel = currentNode
    ? currentNode.depth === 0
      ? "序章"
      : `第 ${currentNode.depth} 节`
    : undefined;

  // 生命周期指示：载入期不能报「已交付」——那时正文还没到，绿灯会骗人。
  const lifecycle = error
    ? "生成失败"
    : loading
      ? "载入中"
      : busy
        ? streamingText
          ? "逐字生成中"
          : "正在生成"
        : "已交付";
  const lifeCls = error ? styles.lifeErr : loading || busy ? styles.lifeGen : "";

  const inspected = allNodes.find((n) => n.id === selectedNode) ?? null;
  const isCurrentInspected = inspected?.id === session?.current_node_id;
  // 这一步带来的属性变化。⚠️ 不在这里做可见性过滤：后端 attrView.node
  // （service/player_view.go）已按该节点自己的 revealed_snapshot 过滤过 state_delta，
  // 前端再判一次只会和后端各说一套。
  const inspectedDelta = useMemo(() => {
    const d = parseState(inspected?.state_delta);
    return Object.keys(d)
      .map((k) => ({ k, badge: formatDelta(d[k]) }))
      .filter((x): x is { k: string; badge: string } => x.badge !== null);
  }, [inspected?.state_delta]);
  const onPathIds = useMemo(() => {
    // 根 → 当前的主线：读数区要据此说「已抵达 / 岔路」
    const byId = new Map(allNodes.map((n) => [n.id, n]));
    const ids = new Set<string>();
    let cur = session?.current_node_id ? byId.get(session.current_node_id) : undefined;
    while (cur) {
      ids.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return ids;
  }, [allNodes, session?.current_node_id]);

  // 漂移：设置里的开关 ∧ 没有开减动效。两者任一为假就静止。
  const moving = drift && !reduced;
  const still = moving ? undefined : ({ animation: "none" } as CSSProperties);

  const rootStyle = {
    "--reader-veil": (scrim / 100).toFixed(2),
    "--reader-size": `${size}px`,
    "--reader-lead": lead,
    ...(coverUrl ? { "--reader-bg": `url("${assetUrl(coverUrl)}")` } : {}),
  } as CSSProperties;

  return (
    <WorldScope hue={theme.hue} className={styles.root} style={rootStyle}>
      {/* ============ 世界：身后活着的场景 ============ */}
      <div className={styles.scene} aria-hidden="true">
        {/* 关掉漂移不等于关掉世界：云还在，只是不动了。流星本身就是「动」，静止态不渲染。 */}
        <span className={`${styles.cloud} ${styles.c1}`} style={still} />
        <span className={`${styles.cloud} ${styles.c2}`} style={still} />
        <span className={`${styles.cloud} ${styles.c3}`} style={still} />
        {moving && <span className={styles.streak} />}
        <span className={styles.horizon} />
      </div>
      <div className={styles.stagefig} aria-hidden="true" style={still}>
        <Figure pose={theme.figure} />
      </div>
      <div className={styles.readerBg} aria-hidden="true" />
      <div className={styles.grain} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />

      {/* ============ 顶栏 ============ */}
      <header className={styles.topbar}>
        <button
          className={styles.iconBtn}
          type="button"
          aria-label="回到星海"
          onClick={() => router.push("/")}
        >
          {BackIcon}
        </button>
        <div className={styles.now}>
          <h1 className={styles.t}>{storyTitle || "载入中…"}</h1>
          {storyKicker && <p className={styles.s}>{storyKicker}</p>}
        </div>
        <div className={styles.topright}>
          <span className={`${styles.life} ${lifeCls}`} role="status" aria-live="polite">
            <i aria-hidden="true" />
            {lifecycle}
          </span>
          <button
            className={styles.iconBtn}
            type="button"
            aria-label="此刻的你"
            aria-expanded={panel === "attrs"}
            onClick={(e) => togglePanel("attrs", e)}
          >
            {AttrIcon}
          </button>
          <button
            className={styles.iconBtn}
            type="button"
            aria-label="世界星图"
            aria-expanded={panel === "map"}
            disabled={allNodes.length === 0}
            onClick={(e) => togglePanel("map", e)}
          >
            {MapIcon}
          </button>
          <button
            className={styles.iconBtn}
            type="button"
            aria-label="阅读设置"
            aria-expanded={panel === "sheet"}
            onClick={(e) => togglePanel("sheet", e)}
          >
            {SetIcon}
          </button>
        </div>
      </header>

      {/* ============ 阅读栏 ============ */}
      <main className={styles.reader}>
        <div className={styles.column}>
          <div className={styles.plate}>
            {/* 只读局：不说清楚原因，玩家只会以为选项坏了 */}
            {readOnly && !loading && (
              <p className={styles.notice} role="status">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                作者已取消发布这部作品 · 当前进度可继续阅读，但无法再推进
              </p>
            )}
            {error && (
              <p className={`${styles.notice} ${styles.noticeErr}`} role="alert">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
                出错：{error} · 可再次选择或输入以重试
              </p>
            )}

            {loading ? (
              <p className={styles.notice}>载入会话中…</p>
            ) : (
              <>
                <StoryPane
                  node={currentNode}
                  busy={busy}
                  streamingText={streamingText}
                  chapter={chapterLabel}
                  progress={`已走 ${session?.node_count ?? 0} 步`}
                />
                <OptionList node={currentNode} busy={locked} onChoose={choose} />
              </>
            )}
          </div>
        </div>
      </main>

      {/* ============ 此刻的你 ============ */}
      <aside
        className={`${styles.attrs} ${panel === "attrs" ? styles.attrsOpen : styles.attrsClosed}`}
        aria-label="此刻的你"
      >
        <button
          className={`${styles.iconBtn} ${styles.panelClose}`}
          type="button"
          aria-label="关闭属性面板"
          onClick={() => setPanel("")}
        >
          <IconClose size={16} />
        </button>
        <h2>此刻的你</h2>
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

      {/* ============ 世界星图 ============ */}
      <div
        className={`${styles.mapScrim} ${panel === "map" ? styles.mapScrimOn : ""}`}
        aria-hidden="true"
        onClick={() => setPanel("")}
      />
      <aside
        className={`${styles.starmap} ${panel === "map" ? styles.starmapOn : ""}`}
        ref={mapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-title"
      >
        <button
          className={`${styles.iconBtn} ${styles.close}`}
          type="button"
          aria-label="关闭世界星图"
          onClick={() => setPanel("")}
        >
          <IconClose size={16} />
        </button>
        <div className={styles.mapHead}>
          <div>
            <p className={styles.kicker}>世界航迹</p>
            <h2 id="map-title">你走过的路</h2>
          </div>
          <p className={styles.mapProgress}>
            <b>{allNodes.length}</b>
            <span>已探索航点</span>
          </p>
        </div>

        <div className={styles.mapLayout}>
          <div className={styles.mapStage}>
            <div className={styles.mapViewport}>
              {allNodes.length > 0 ? (
                <StoryTree
                  nodes={allNodes}
                  currentNodeId={session?.current_node_id ?? null}
                  selectedId={selectedNode}
                  onSelect={setSelectedNode}
                  active={panel === "map"}
                />
              ) : (
                <p className={styles.mapEmpty}>
                  还没有航点。
                  <br />
                  继续推进剧情，世界会从这里展开。
                </p>
              )}
            </div>
            <p className={styles.mapLegend} aria-hidden="true">
              <span>
                <i className={styles.dotDone} />
                已抵达
              </span>
              <span>
                <i className={styles.dotNow} />
                所在处
              </span>
              <span>
                <i />
                已放弃的岔路
              </span>
              <span>
                <i className={styles.dotEnd} />
                结局
              </span>
            </p>
            <p className={styles.mapHint}>← → 沿航迹走 · ↑ ↓ 切换分叉 · Home / End 跳到开局 / 所在处 · Esc 关闭</p>
          </div>

          <section className={styles.mapInspector} aria-labelledby="map-inspector-title">
            <p className={styles.eyebrow} id="map-inspector-title">
              航点读数
            </p>
            <div className={styles.mapReadout} role="status" aria-live="polite" aria-atomic="true">
              {inspected ? (
                <>
                  <span
                    className={`${styles.state} ${
                      isCurrentInspected
                        ? styles.stateCurrent
                        : onPathIds.has(inspected.id)
                          ? styles.stateVisited
                          : ""
                    }`}
                  >
                    {isCurrentInspected
                      ? "所在处"
                      : onPathIds.has(inspected.id)
                        ? "已抵达"
                        : "已放弃的岔路"}
                  </span>
                  <h3>{nodeLabel(inspected)}</h3>
                  <p>{(inspected.content || "").slice(0, 200) || "这个航点还没有正文。"}</p>
                  {inspectedDelta.length > 0 && (
                    <div className={styles.mapDelta}>
                      {inspectedDelta.map(({ k, badge }) => (
                        <span key={k}>
                          {attrLabel(k)}
                          <b>{badge}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p>选择任一航点，查看它在这次旅程中的位置。</p>
              )}
            </div>

            {/* 回溯只移动所在位置、不删数据（见下方 mapPrivacy）。
                只读局与生成中一律禁用（locked）。 */}
            {inspected && !isCurrentInspected && (
              <button
                className={styles.mapRewind}
                type="button"
                disabled={locked}
                onClick={() => {
                  backtrack(inspected.id);
                  setPanel("");
                }}
              >
                回到这里重新选择
              </button>
            )}

            <dl className={styles.mapFacts}>
              <div>
                <dt>剧情位置</dt>
                <dd>{chapterLabel ?? "—"}</dd>
              </div>
              <div>
                {/* 与上面的「已探索航点」是两个数：那个含放弃的岔路，这个只算根→当前 */}
                <dt>主线长度</dt>
                <dd>{onPathIds.size}</dd>
              </div>
            </dl>
            <p className={styles.mapPrivacy}>
              查看任意航点不会改动剧情。「回到这里重新选择」也不会删除任何内容，它只是把你所在的位置移回该航点，并恢复当时的属性与已揭示内容；走过的分支都保留在星图上，随时可以再次进入。
            </p>
          </section>
        </div>
      </aside>

      {/* ============ 阅读设置 ============ */}
      <aside
        className={`${styles.sheet} ${panel === "sheet" ? styles.sheetOn : ""}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="sheet-h"
      >
        <h2 id="sheet-h">阅读设置</h2>
        <button
          className={`${styles.iconBtn} ${styles.close}`}
          type="button"
          aria-label="关闭阅读设置"
          onClick={() => setPanel("")}
        >
          <IconClose size={16} />
        </button>

        <div className={styles.field}>
          <label className={styles.lab} htmlFor="r-veil">
            遮罩浓度 <b>{(scrim / 100).toFixed(2)}</b>
          </label>
          <input
            id="r-veil"
            type="range"
            min={SCRIM_MIN}
            max={SCRIM_MAX}
            value={scrim}
            aria-describedby="tip-veil"
            onChange={(e) => setScrim(setScrimAlpha(Number(e.target.value)))}
          />
          <p className={styles.tip} id="tip-veil">
            下限锁 {(SCRIM_MIN / 100).toFixed(2)}。再低会影响正文可读性。
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.lab} htmlFor="r-size">
            正文字号 <b>{size}px</b>
          </label>
          <input
            id="r-size"
            type="range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={1}
            value={size}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSize(v);
              savePrefs({ size: v });
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.lab} htmlFor="r-lead">
            行距 <b>{lead.toFixed(2)}</b>
          </label>
          <input
            id="r-lead"
            type="range"
            min={LEAD_MIN}
            max={LEAD_MAX}
            step={0.05}
            value={lead}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLead(v);
              savePrefs({ lead: v });
            }}
          />
        </div>

        <div className={styles.field}>
          <div className={styles.switchRow}>
            <span>世界在身后漂移</span>
            <Switch
              checked={drift}
              label="世界在身后漂移"
              onChange={(v) => {
                setDrift(v);
                savePrefs({ drift: v });
              }}
            />
          </div>
          <p className={styles.tip}>关闭后云与流星静止，阅读时干扰更少。</p>
        </div>
      </aside>
    </WorldScope>
  );
}
