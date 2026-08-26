"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { resolveTheme } from "@/lib/hue";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { introSeenRecently, markIntroSeen } from "@/lib/intro";
import Backdrop from "@/components/sky/Backdrop";
import WorldScope from "@/components/sky/WorldScope";
import WorkFace from "@/components/wx/WorkFace";
import WxHeader from "@/components/wx/WxHeader";
import WorkDetail from "@/components/WorkDetail";
import type { Story } from "@/lib/types";
import styles from "./page.module.css";

// 星海 —— 开屏 + 3D 星系书库。规格 DESIGN.md §7.1，视觉目标 docs/design/home-galaxy.html。
//
// 纯 CSS `transform-style: preserve-3d`，**无 Three.js / WebGL**。
// 旋转/拖拽/缩放走 rAF 直接写 style，不进 React state——每帧 setState 会把
// 12 张卡连同它们的天空整棵子树重渲一遍，帧率当场垮掉。
//
// ⚠️ ≤820px 降级为 2D 天空墙（双列可滚网格）：手机上拖一个 12 张卡的球体
// 既难命中又费电。这是响应式要求，不是「3D 还没做完」的临时态。

const GALAXY_LIMIT = 12; // 星系固定展示 12 部
const DRAG_THRESHOLD = 3; // px。小于它算点击，大于它算拖拽（§9）

type LayoutName = "sphere" | "helix" | "grid" | "chaos";
type Pos = { x: number; y: number; z: number; ry: number; rx: number };

const LAYOUT_LABELS: { id: LayoutName; label: string }[] = [
  { id: "sphere", label: "星系" },
  { id: "helix", label: "银河" },
  { id: "grid", label: "书架" },
  { id: "chaos", label: "混沌" },
];

// 四种排布。混沌用固定种子的线性同余，**不用 Math.random()**——
// 位置每刷新一次就跳一次那不是混沌，是抖动（§6）。
function layoutPositions(name: LayoutName, n: number): Pos[] {
  const out: Pos[] = [];
  if (n === 0) return out;
  if (name === "sphere") {
    const R = 400;
    for (let i = 0; i < n; i += 1) {
      // 斐波那契球：n=1 时 (n-1) 会除零，单部作品直接摆在正前方
      const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * Math.PI * (3 - Math.sqrt(5));
      const x = Math.cos(phi) * r;
      const z = Math.sin(phi) * r;
      out.push({
        x: x * R,
        y: -y * R * 0.78,
        z: z * R,
        ry: (Math.atan2(x, z) * 180) / Math.PI,
        rx: ((Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI) * 0.7,
      });
    }
  } else if (name === "helix") {
    const R = 330;
    for (let i = 0; i < n; i += 1) {
      const a = i * 32;
      out.push({
        x: Math.sin((a * Math.PI) / 180) * R,
        y: (i - (n - 1) / 2) * 52,
        z: Math.cos((a * Math.PI) / 180) * R,
        ry: a,
        rx: 0,
      });
    }
  } else if (name === "grid") {
    const cols = 4;
    const gx = 214;
    const gy = 268;
    for (let i = 0; i < n; i += 1) {
      out.push({
        x: ((i % cols) - (cols - 1) / 2) * gx,
        y: (Math.floor(i / cols) - 1) * gy,
        z: 0,
        ry: 0,
        rx: 0,
      });
    }
  } else {
    let s = 9301;
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i < n; i += 1) {
      out.push({
        x: (rnd() - 0.5) * 940,
        y: (rnd() - 0.5) * 560,
        z: (rnd() - 0.5) * 880,
        ry: (rnd() - 0.5) * 60,
        rx: (rnd() - 0.5) * 26,
      });
    }
  }
  return out;
}

export default function HomePage() {
  const initAuth = useAuthStore((s) => s.init);
  const reduced = useReducedMotion();

  const [stories, setStories] = useState<Story[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "empty" | "error">("loading");
  const [layout, setLayout] = useState<LayoutName>("sphere");
  const [flat, setFlat] = useState(false);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  // 开屏：SSR 与首帧一律不渲染，挂载后再决定播不播——否则老访客每次进站
  // 都会先闪一下黑幕再消失。decided 之前卡片不入场，免得错峰在幕后走完。
  const [intro, setIntro] = useState<"hidden" | "playing" | "fading">("hidden");
  const [introDecided, setIntroDecided] = useState(false);
  const [ambient, setAmbient] = useState(252);

  const stageRef = useRef<HTMLElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const behindRef = useRef<HTMLDivElement>(null);
  const focusViewRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const introTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevMotion = useRef<string | undefined>(undefined);

  // rAF 循环读写的可变量。放 ref 不放 state：每帧 setState 会重渲整棵卡片树。
  const m = useRef({
    spin: 0,
    tSpin: 0,
    tilt: -6,
    tTilt: -6,
    dist: 0,
    tDist: 0,
    dragging: false,
    down: false, // 指针按下但还没过阈值
    moved: false, // 这一次手势构成了拖拽 → 吃掉随后的 click
    auto: true,
    lx: 0,
    ly: 0,
    ox: 0, // 按下时的起点，用来算位移阈值
    oy: 0,
    flat: false,
    focusing: false,
  });

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const load = useCallback(() => {
    setStatus("loading");
    api
      // 阅读量最高的 12 部。排序在后端做（plan.md §二·补三）——次级键是
      // created_at DESC, id，否则 play_count 全为 0 时 Postgres 不保证次序，
      // 首页每次刷新会重排一批不同的作品。
      .get<Story[]>(`/stories/?sort=plays&limit=${GALAXY_LIMIT}`)
      .then((list) => {
        const top = list ?? [];
        setStories(top);
        setStatus(top.length ? "ok" : "empty");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(load, [load]);

  // 开屏是否要播。
  // ⚠️ 这里**不能读 useReducedMotion 的返回值**：那是挂载后才被 effect 置真的 state，
  // 而本 effect 依赖是 []，捕获到的永远是初值 false——减动效用户照样会吃一遍开屏。
  // 直接查媒体查询与 data-motion，拿的是此刻的真值。
  useEffect(() => {
    const seen = introSeenRecently();
    const rm =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "off";
    // ?intro=1 强制重播，绕过 TTL。评审时要反复看这段动画，而正常规则是隔一段时间
    // 才演一遍（lib/intro.ts）。用 location.search 读而不是 useSearchParams：
    // 后者会把这一页从静态预渲染里拽出去，只为一个调试开关不值。
    const force = new URLSearchParams(window.location.search).get("intro") === "1";
    if (force) {
      // 光渲染出来不够：减动效那条 `.wx * { animation-duration:.001ms !important }`
      // 会把整段开屏瞬间跑完，屏幕上只剩 2.6 秒纯黑。data-motion="force" 是
      // wanxiang.css 里给这个场景留的唯一例外口子。
      prevMotion.current = document.documentElement.dataset.motion;
      document.documentElement.dataset.motion = "force";
    }
    setIntro(force || !(rm || seen) ? "playing" : "hidden");
    setIntroDecided(true);
  }, []);

  // 开屏收场（或离开本页）就把 data-motion 还回去，别让 force 漏给别的页面
  useEffect(() => {
    const restore = () => {
      const el = document.documentElement;
      if (el.dataset.motion !== "force") return;
      if (prevMotion.current === undefined) delete el.dataset.motion;
      else el.dataset.motion = prevMotion.current;
    };
    if (intro === "hidden") restore();
    return restore;
  }, [intro]);

  const endIntro = useCallback(() => {
    setIntro((cur) => {
      if (cur !== "playing") return cur;
      markIntroSeen();
      introTimers.current.push(setTimeout(() => setIntro("hidden"), 800));
      return "fading";
    });
  }, []);

  useEffect(() => {
    if (intro !== "playing") return;
    const t = setTimeout(endIntro, 2650);
    return () => clearTimeout(t);
  }, [intro, endIntro]);

  useEffect(() => {
    const timers = introTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // ≤820px：3D 星系降级为 2D 天空墙
  useEffect(() => {
    const mq = window.matchMedia("(max-width:820px)");
    const read = () => {
      setFlat(mq.matches);
      m.current.flat = mq.matches;
    };
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  const positions = useMemo(
    () => layoutPositions(layout, stories.length),
    [layout, stories.length],
  );

  // 排布：直接写 style，不进 state。天空墙下由 CSS grid 排，一行 transform 都不写。
  useEffect(() => {
    if (flat) {
      cardRefs.current.forEach((el) => {
        if (el) el.style.transform = "";
      });
      return;
    }
    positions.forEach((p, i) => {
      const el = cardRefs.current[i];
      if (!el) return;
      // 切排布是一次 1.05s 的 transform 过渡，期间重新占用合成层，结束后由上面
      // 那个 effect 之外的定时器还回去
      el.style.willChange = "transform";
      el.style.transform =
        `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,${p.z.toFixed(1)}px)` +
        ` rotateY(${p.ry.toFixed(1)}deg) rotateX(${p.rx.toFixed(1)}deg)`;
    });
    const t = setTimeout(() => {
      cardRefs.current.forEach((el) => {
        if (el) el.style.willChange = "auto";
      });
    }, 1400);
    return () => clearTimeout(t);
  }, [positions, flat, status]);

  // 拖拽 / 滚轮 / 自转。惯性靠 v += (target - v) * k 逼近（§6）。
  useEffect(() => {
    const stage = stageRef.current;
    const orbit = orbitRef.current;
    if (!stage || !orbit) return;

    // ⚠️ 起拖**不排除卡片**。12 张卡占掉大半个屏，若在卡片上按下就不算拖，
    // 满屏找空隙才能转得动——实测就是「有的地方拖不动」。改成 §9 要求的 3px 位移
    // 阈值：按下先不判定，动过 3px 才转成拖拽并吃掉随后那次 click；没动就是点击。
    const onDown = (e: PointerEvent) => {
      const s = m.current;
      if (s.flat) return; // 天空墙下不劫持触摸，留给页面滚动
      s.down = true;
      s.moved = false;
      s.dragging = false;
      s.lx = e.clientX;
      s.ly = e.clientY;
      s.ox = e.clientX;
      s.oy = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      const s = m.current;
      if (!s.down) return;
      if (!s.dragging) {
        if (Math.hypot(e.clientX - s.ox, e.clientY - s.oy) < DRAG_THRESHOLD) return;
        s.dragging = true;
        s.moved = true;
        s.auto = false;
        stage.classList.add(styles.dragging);
      }
      s.tSpin += (e.clientX - s.lx) * 0.28;
      s.tTilt = Math.max(-58, Math.min(58, s.tTilt - (e.clientY - s.ly) * 0.18));
      s.lx = e.clientX;
      s.ly = e.clientY;
    };
    // pointerup / pointercancel / lostpointercapture 三处都复位（§9）。
    // moved 不在这里清——它要活到随后那次 click 被卡片的处理器消费掉。
    const endDrag = () => {
      m.current.down = false;
      m.current.dragging = false;
      stage.classList.remove(styles.dragging);
    };
    const onWheel = (e: WheelEvent) => {
      if (m.current.flat) return; // 天空墙下滚轮 = 翻页，不能拦
      e.preventDefault();
      m.current.tDist = Math.max(-560, Math.min(340, m.current.tDist - e.deltaY * 0.6));
    };

    // ⚠️ pointermove / pointerup 挂 window，不挂 stage。
    // 顶栏与排布条的 z-index 高于星系，指针一划到它们上面，挂在 stage 上的
    // pointermove 就收不到了——手势当场断在半路。这也是「有的地方拖不动」的另一半。
    // 不用 setPointerCapture：捕获会把随后那次 click 的目标从卡片挪走，作品就点不开了。
    stage.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    stage.addEventListener("wheel", onWheel, { passive: false });

    let raf = 0;
    const loop = () => {
      const s = m.current;
      if (!s.flat) {
        if (s.auto && !s.dragging && !s.focusing) s.tSpin += 0.055;
        s.spin += (s.tSpin - s.spin) * 0.075;
        s.tilt += (s.tTilt - s.tilt) * 0.09;
        s.dist += (s.tDist - s.dist) * 0.09;
        orbit.style.transform =
          `translateZ(${s.dist.toFixed(1)}px) rotateX(${s.tilt.toFixed(2)}deg)` +
          ` rotateY(${s.spin.toFixed(2)}deg)`;
      }
      raf = requestAnimationFrame(loop);
    };
    // 减动效：不自转、不跑循环，直接落在一个静止的视角上（静止态即最终态）
    if (reduced) {
      orbit.style.transform = "rotateX(-6deg)";
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      stage.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      stage.removeEventListener("wheel", onWheel);
    };
  }, [reduced, status]);

  const focusing = focusIdx !== null;

  const focusWork = (i: number) => {
    const s = stories[i];
    if (!s) return;
    const { hue } = resolveTheme(s.world_config, s.id);
    // 整片深空过渡到这个世界的色相——「穿过一个宇宙」
    setAmbient(hue);
    const p = positions[i];
    if (p) {
      m.current.tSpin = -p.ry;
      m.current.tTilt = Math.max(-40, Math.min(40, -p.rx));
    }
    m.current.auto = false;
    m.current.focusing = true;
    behindRef.current?.setAttribute("inert", "");
    setFocusIdx(i);
  };

  const unfocus = useCallback(() => {
    setFocusIdx((cur) => {
      if (cur === null) return cur;
      behindRef.current?.removeAttribute("inert");
      m.current.auto = true;
      m.current.focusing = false;
      setAmbient(252);
      // 焦点归还触发它的那张卡（§9：浮层关闭后焦点回到触发元素）
      cardRefs.current[cur]?.focus();
      return null;
    });
  }, []);

  // 浮层：Esc 关闭 + Tab 在内部回环
  useEffect(() => {
    if (!focusing) return;
    const view = focusViewRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        unfocus();
        return;
      }
      if (e.key !== "Tab" || !view) return;
      const f = view.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
    // 浮层落定后把焦点送进去；减动效下不等过渡
    const t = setTimeout(() => {
      view?.querySelector<HTMLElement>("button, a[href]")?.focus();
    }, reduced ? 0 : 420);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [focusing, unfocus, reduced]);

  const revealed = introDecided && intro !== "playing" && status === "ok";

  // ⚠️ 入场结束就把 will-change 摘掉（§6：动画结束不长期占用合成层）。
  // .work 上的 will-change: transform, opacity 是给入场与排布切换用的；12 张卡各带
  // 一个常驻合成层，每张里面还有两面天空、28 颗星点和一个剪影 SVG——一直挂着，
  // 拖动时的合成开销就一直在。原型入场后 1.2s 释放，这里照做。
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => {
      cardRefs.current.forEach((el) => {
        if (el) el.style.willChange = "auto";
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [revealed]);
  const focusStory = focusIdx === null ? null : stories[focusIdx];

  // 浮层的进/出时序。两件事都需要它：
  // ① 进场——聚焦内容是聚焦那一刻才挂上去的，挂载即终态的话 .on 的位移与淡入
  //    根本不会跑。等两帧再加 .on，浏览器才登记得到初始样式（单帧不够稳）。
  // ② 退场——内容若随 focusIdx 立刻卸载，.focusview 那 0.42s 淡出就成了一个空壳
  //    在淡出。所以让它多留 460ms 再卸。
  const [shown, setShown] = useState<Story | null>(null);
  const [openAnim, setOpenAnim] = useState(false);

  useEffect(() => {
    if (focusStory) {
      setShown(focusStory);
      if (reduced) {
        setOpenAnim(true);
        return;
      }
      let r2 = 0;
      const r1 = requestAnimationFrame(() => {
        r2 = requestAnimationFrame(() => setOpenAnim(true));
      });
      return () => {
        cancelAnimationFrame(r1);
        cancelAnimationFrame(r2);
      };
    }
    setOpenAnim(false);
    const t = setTimeout(() => setShown(null), reduced ? 0 : 460);
    return () => clearTimeout(t);
  }, [focusStory, reduced]);

  const rootCls = [styles.root, flat ? styles.flat : "", focusing ? styles.focusing : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootCls} style={{ "--ambient-hue": ambient } as CSSProperties}>
      <Backdrop />

      {/* 浮层打开时整块设 inert：没有它，Tab 会跑到浮层背后的顶栏上再也回不来 */}
      <div ref={behindRef}>
        <WxHeader />

        <section className={styles.creed}>
          <p className={styles.eyebrow}>万象 · 无穷世界</p>
          <h1>
            一个灵感，
            <br />
            长成一片星空。
          </h1>
          <blockquote>
            当人工智能拥有超过人类的智力时，想象力也许是我们对于它们所拥有的唯一优势。
            <cite>—— 刘慈欣</cite>
          </blockquote>
        </section>

        <main className={styles.stage} ref={stageRef} aria-busy={status === "loading"}>
          <h2 className="sr-only" id="galaxy-heading">
            万象 · 作品星海
          </h2>
          <div className={styles.orbit} ref={orbitRef} aria-labelledby="galaxy-heading">
            {stories.map((s, i) => {
              const { hue } = resolveTheme(s.world_config, s.id);
              return (
                <WorldScope
                  key={s.id}
                  as="button"
                  hue={hue}
                  className={`${styles.work} ${revealed ? styles.in : ""}`}
                  innerRef={(el: Element | null) => {
                    cardRefs.current[i] = el as HTMLButtonElement | null;
                  }}
                  type="button"
                  aria-label={`打开作品：${s.title}`}
                  onClick={() => {
                    // 拖动结束时落在某张卡上，不该顺手把它打开
                    if (m.current.moved) {
                      m.current.moved = false;
                      return;
                    }
                    focusWork(i);
                  }}
                  style={
                    {
                      "--td-layout": `${i * 38}ms`,
                      "--td-in": `${i * 42}ms`,
                    } as CSSProperties
                  }
                >
                  <span className={styles.face}>
                    <WorkFace story={s} />
                  </span>
                  {/* 背面同样渲一次：转过去时卡片仍在，而不是凭空消失 */}
                  <span className={`${styles.face} ${styles.back}`} aria-hidden="true">
                    <WorkFace story={s} />
                  </span>
                </WorldScope>
              );
            })}
          </div>

          {status !== "ok" && (
            <div className={styles.state} aria-live="polite">
              <div className={styles.statePanel}>
                {status === "loading" && (
                  <>
                    <p>星海正在展开</p>
                    <small>正在整理可进入的世界。</small>
                  </>
                )}
                {status === "empty" && (
                  <>
                    <p>此刻还没有可进入的世界</p>
                    <small>作品发布后，会在这片星海里出现。</small>
                  </>
                )}
                {status === "error" && (
                  <>
                    <p>暂时无法载入作品列表</p>
                    <small>请稍后重试。</small>
                    <button className={styles.stateRetry} type="button" onClick={load}>
                      重新尝试
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </main>

        <nav className={styles.dock} aria-label="星系排布">
          {LAYOUT_LABELS.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={layout === l.id}
              onClick={() => setLayout(l.id)}
            >
              {l.label}
            </button>
          ))}
        </nav>

        <p className={styles.hint} aria-hidden="true">
          {flat ? "点开一张卡片，走进那个世界" : "拖动旋转 · 滚轮远近 · 点击进入"}
        </p>
      </div>

      {/* 聚焦浮层：与 /story/[id] 共用 WorkDetail，内容契约同一份 */}
      <div
        className={styles.focusview}
        ref={focusViewRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={shown ? `work-title-${shown.id}` : undefined}
        onClick={(e) => {
          if (e.target === e.currentTarget) unfocus();
        }}
      >
        {shown && (
          <WorkDetail story={shown} variant="overlay" open={openAnim} onBack={unfocus} />
        )}
      </div>

      {intro !== "hidden" && (
        <div
          className={`${styles.intro} ${intro === "fading" ? styles.gone : ""}`}
          aria-label="万象开场动画"
        >
          <svg viewBox="0 0 320 320" aria-hidden="true">
            <g className={styles.tree}>
              <path className={styles.ln} pathLength={100} style={{ animationDelay: ".35s" }} d="M160 280 V234" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: ".72s" }} d="M160 234 L118 196" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: ".72s" }} d="M160 234 L202 196" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.04s" }} d="M118 196 L92 160" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.04s" }} d="M118 196 L140 156" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.04s" }} d="M202 196 L180 156" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.04s" }} d="M202 196 L228 160" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.34s" }} d="M92 160 L74 126" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.34s" }} d="M92 160 L100 122" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.34s" }} d="M140 156 L128 120" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.34s" }} d="M140 156 L152 118" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.34s" }} d="M180 156 L168 118" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.34s" }} d="M180 156 L192 120" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.34s" }} d="M228 160 L220 122" />
              <path className={styles.ln} pathLength={100} style={{ animationDelay: "1.34s" }} d="M228 160 L246 126" />
              <circle className={styles.seed} cx={160} cy={280} r={3.4} />
              <circle className={styles.st} cx={74} cy={126} r={3.2} style={{ animationDelay: "1.66s" }} />
              <circle className={styles.st} cx={100} cy={122} r={2.6} style={{ animationDelay: "1.72s" }} />
              <circle className={styles.st} cx={128} cy={120} r={3} style={{ animationDelay: "1.68s" }} />
              <circle className={styles.st} cx={152} cy={118} r={2.4} style={{ animationDelay: "1.76s" }} />
              <circle className={styles.st} cx={168} cy={118} r={3.2} style={{ animationDelay: "1.7s" }} />
              <circle className={styles.st} cx={192} cy={120} r={2.6} style={{ animationDelay: "1.78s" }} />
              <circle className={styles.st} cx={220} cy={122} r={3} style={{ animationDelay: "1.66s" }} />
              <circle className={styles.st} cx={246} cy={126} r={2.4} style={{ animationDelay: "1.74s" }} />
            </g>
          </svg>
          <p className={styles.caption}>一个灵感 · 长成一片星空</p>
          <button className={styles.skip} type="button" onClick={endIntro}>
            跳过
          </button>
        </div>
      )}
    </div>
  );
}
