"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { GENRES } from "@/lib/types";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { Toast } from "@/components/ui/Toast";
import { usePublishChecks } from "./PublishCheck";
import EditorSky, { type SegReady } from "./EditorSky";
import SegInspiration from "./SegInspiration";
import SegWorldview from "./SegWorldview";
import SegAttributes from "./SegAttributes";
import SegOpening from "./SegOpening";
import SegSky from "./SegSky";
import SegPublish from "./SegPublish";
import styles from "./editor.module.css";

// 创作编辑器。规格 DESIGN.md §7.7，视觉目标 docs/design/create-editor.html。
// create 与 edit 两页共用；差异仅初始化（create 调 reset、edit 调 loadStory）。
//
// **编辑器是一部作品的天空第一次被点亮的地方**，不是贴在深色背景上的六步表单：
// 进度不由进度条表示，进度就是左边那片天空，六段各点亮一层。某段没写完，天空就缺
// 那一层——不需要读错误列表才知道还差什么。
//
// ⚠️ **段落可任意跳转，不强制线性**（§7.7）。旧实现有一道顺序解锁的门禁，理由是
// 「属性系统这种不填也能存草稿、却决定整个玩法的步骤最容易被整个跳过」——那个担心
// 是真的，但天空已经把它解决了：属性星那一层没亮就一直摆在眼前，比一把锁更有效，
// 也不会把作者关在自己的作品外面。门禁连同 lib/editorGate 一起退场。

const SEGS = [
  { t: "灵感", sub: "一句话起点" },
  { t: "世界观", sub: "设定 · 题材 · 基调" },
  { t: "属性", sub: "数值 · 隐藏 · 门控" },
  { t: "开场", sub: "第一段正文" },
  { t: "天空", sub: "主题 · 封面" },
  { t: "发布", sub: "检查并上线" },
] as const;
const NAMES = SEGS.map((x) => x.t);

export default function StoryEditor() {
  const router = useRouter();
  const s = useEditorStore();
  const reduced = useReducedMotion();

  const [confirmDel, setConfirmDel] = useState(false);
  const [seg, setSeg] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // ⚠️ 必须在下面那个 `if (s.loading) return` **之前**调用——它是 hook。
  // editorStore 是模块级的、跨页面导航不销毁：从编辑器发布完再进来，首帧带着上次的
  // 已载入状态渲染（hooks 齐全），随后 effect 里的 reset() 把 loading 置回 true，
  // 下一帧撞上提前 return 就少调一个 hook，React 直接抛「Rendered fewer hooks than expected」。
  const checks = usePublishChecks();

  // toast 文案由 editorStore 写入（genWorld / save 等异步流程都要用），这里只负责自动消隐
  useEffect(() => {
    if (!s.toast) return;
    const t = setTimeout(() => useEditorStore.setState({ toast: null }), 2400);
    return () => clearTimeout(t);
  }, [s.toast]);

  // 切段后焦点移到该段标题（§7.7 无障碍）：不这么做，键盘用户点完轨上的站点，
  // 焦点还留在轨上，读屏不会念新面板里有什么。
  const go = (i: number) => {
    if (i < 0 || i >= SEGS.length || i === seg) return;
    setSeg(i);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  };

  if (s.loading) return <p className={styles.desc}>载入中…</p>;

  const anyBusy = s.aiBusy !== null || s.saving;
  const canPublish = checks.every((c) => c.ok);

  // 六段的就绪判定（§7.7 那张表）。它同时驱动天空的六层与轨上的标记——
  // 两处说的必须是同一件事，所以只算一次。
  const attrsOk =
    s.attributes.length > 0 &&
    s.attributes.every((a) => a.key.trim()) &&
    new Set(s.attributes.map((a) => a.key.trim())).size === s.attributes.length &&
    s.attributes.every((a) => a.type !== "number" || Number.isFinite(Number(a.initial)));
  const isGenre = (t: string) => (GENRES as readonly string[]).includes(t);
  const ready: SegReady = [
    s.description.trim().length >= 8 && s.tags.some(isGenre),
    !!(s.background.trim() && s.style.trim() && s.rules.trim()),
    attrsOk,
    s.openingContent.trim().length >= 40,
    s.themePicked,
    canPublish,
  ];
  const missing = SEGS.filter((_, i) => !ready[i]).map((x) => x.t);

  const onDelete = async () => {
    try {
      await s.remove();
      router.push("/mine");
    } catch {
      /* 错误已进 store.error */
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.h1}>{s.storyId ? "编辑作品" : "写一个世界"}</h1>
        <span className={`${styles.badge} ${s.status === "published" ? styles.badgeLive : ""}`}>
          {s.status === "published" ? "已发布" : "草稿"}
        </span>
        <span className={styles.saved} role="status" aria-live="polite">
          {s.saving ? "保存中…" : ""}
        </span>
      </div>

      {s.error && (
        <p className={styles.err} role="alert">
          出错：{s.error}
        </p>
      )}

      <div className={styles.editor}>
        {/* ============ 左：正在成形的天空 ============ */}
        <div className={styles.skyside}>
          <EditorSky theme={s.theme} ready={ready} attrs={s.attributes} reduced={reduced} />
          <p className={styles.skyLegend}>
            {missing.length === 0 ? (
              <>这片天空已完整。<b>可以发布。</b></>
            ) : (
              <>
                天空还缺 <b>{missing.join(" · ")}</b>：完成对应段落后会自动点亮。
              </>
            )}
          </p>
        </div>

        {/* ============ 右：段落轨 + 面板 ============ */}
        <div className={styles.pane}>
          {/* 六个站点是静态标记，渲染只改状态、不重建 DOM——重建会让焦点掉出去 */}
          <nav className={styles.rail} aria-label="创作段落">
            {SEGS.map((st, i) => (
              <button
                key={st.t}
                type="button"
                className={styles.station}
                aria-current={seg === i ? "true" : undefined}
                data-state={ready[i] ? "on" : undefined}
                onClick={() => go(i)}
              >
                <span className={styles.stationNo} aria-hidden="true">
                  {i + 1}
                </span>
                <span className={styles.stationName}>{st.t}</span>
                <span className={styles.stationSub}>{st.sub}</span>
              </button>
            ))}
          </nav>

          <section className={styles.panel}>
            <p className={styles.eyebrow}>第 {seg + 1} 段 · {SEGS[seg].sub}</p>
            <h2 className={styles.h2} ref={headingRef} tabIndex={-1}>
              {SEGS[seg].t}
            </h2>

            {seg === 0 && <SegInspiration go={go} names={NAMES} />}
            {seg === 1 && <SegWorldview go={go} names={NAMES} />}
            {seg === 2 && <SegAttributes go={go} names={NAMES} />}
            {seg === 3 && <SegOpening go={go} names={NAMES} />}
            {seg === 4 && <SegSky go={go} names={NAMES} />}
            {seg === 5 && <SegPublish go={go} names={NAMES} />}
          </section>

          {/* 存草稿 / 发布 / 删除常驻：作者在任何一段都可能想先存一下 */}
          <div className={styles.publishbar}>
            <button
              className={styles.btn}
              type="button"
              disabled={anyBusy}
              onClick={() => s.save()}
            >
              {s.saving ? "保存中…" : "保存草稿"}
            </button>
            {s.status === "published" ? (
              <button
                className={styles.btn}
                type="button"
                disabled={anyBusy}
                onClick={() => s.unpublish()}
              >
                取消发布
              </button>
            ) : (
              // 实心暖金主 CTA 整个编辑器只此一个（§7.7 段 6）
              <button
                className={styles.btnPublish}
                type="button"
                disabled={anyBusy || !canPublish}
                title={canPublish ? undefined : "仍有检查项未通过，见第 6 段"}
                onClick={() => s.publish()}
              >
                发布
              </button>
            )}
            {s.storyId && (
              <button
                className={`${styles.btn} ${styles.btnQuiet} ${styles.btnDanger}`}
                type="button"
                data-confirm={confirmDel ? "1" : undefined}
                onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))}
              >
                {confirmDel ? "确认删除？" : "删除"}
              </button>
            )}
          </div>
        </div>
      </div>

      <Toast message={s.toast} />
    </div>
  );
}
