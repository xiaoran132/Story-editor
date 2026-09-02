"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import Figure from "@/components/sky/Figure";
import WanxiangLogo from "@/components/WanxiangLogo";
import WorldScope from "@/components/sky/WorldScope";
import { makeRng } from "@/lib/prng";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { markIntroSeen } from "@/lib/intro";
import styles from "./page.module.css";

// 「无人之境」登录页。规格 DESIGN.md §7.6，视觉目标 docs/design/login.html。
//
// 主张：登录不是身份校验，是**这个世界被写出来的过程**——你来之前这里是空的，
// 是你的输入让天空长出来的。标题因此从「这里还没有故事。」变成「现在有了。」。
//
// ⚠️ 与原型的两处必要偏离（plan.md §二 落差 #1）：
// ① 原型是不接认证的邮箱魔法链接单字段，真实后端是密码登录 + 注册。
//    **天空阶梯只绑邮箱**——密码框 focus 不推进层级，注册页签多出的昵称也不推进。
//    理由：阶梯讲的是「一个世界正在被写出来」，绑到密码上就变成了进度条。
// ② 原型的 L5 是「链接已寄出」的终态；这里 L5 之后要真的进站，所以确认态只停
//    650ms（世界长完那一下）就跳走，不做「换一个邮箱」。

const HUE_ENTER = 252;
const HUE_DONE = 276;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ERR_EMAIL = "请输入有效的邮箱地址，例如 you@example.com。";

// L3 星点：128 颗、三档大小。数量与尺寸不是随便定的——原型初版 38 颗 1.4px
// 撒在整块视口上肉眼看不出变化，L3 等于没发生。确定性 PRNG，刷新不变。
const STARS = (() => {
  const rng = makeRng(9301);
  return Array.from({ length: 128 }, (_, i) => {
    const r = rng();
    const size = r < 0.68 ? 1.6 : r < 0.92 ? 2.4 : 3.2;
    const o = (0.38 + rng() * 0.56).toFixed(2);
    return {
      key: i,
      size,
      o,
      left: `${(rng() * 100).toFixed(2)}%`,
      top: `${(rng() * 100).toFixed(2)}%`,
      // 错峰用 (i % 18)：星像被扫过一遍地亮起，而不是排成一条 5 秒长队
      delay: `${(i % 18) * 28}ms`,
    };
  });
})();

// useSearchParams 要求 Suspense 边界，否则整页被迫退出静态预渲染（Next 14 构建期报错）。
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  // 登录后回到来处（如 /create 的登录门槛跳转）；只接受站内相对路径，防开放重定向。
  const params = useSearchParams();
  const nextRaw = params.get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const { login, register } = useAuthStore();
  const reduced = useReducedMotion();

  // 顶栏的「注册」直接落在注册页签上（?tab=register），否则点了「注册」还要再点一次页签。
  // 只认这一个值，其余一律回落登录——这是展示参数，不该为一个拼错的 query 报错。
  const [tab, setTab] = useState<"login" | "reg">(
    params.get("tab") === "register" ? "reg" : "login"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // 世界只进不退：删字只回退校验状态，不回收已经生成的天空。
  // 改一个错字不该让整个宇宙闪一下就没了——「世界一旦长出来就留着」正是这一页的主张。
  const [maxLevel, setMaxLevel] = useState(0);
  const [pose, setPose] = useState<"walk" | "gaze" | "reach">("walk");
  const [hue, setHue] = useState(HUE_ENTER);

  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const nickRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  // 重复提交由这个标志拦（state 更新是异步的，连点两下会双发请求）
  const busyRef = useRef(false);
  const wcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reach = useCallback(
    (n: number) => {
      setMaxLevel((cur) => (n > cur ? n : cur));
      if (reduced) return;
      // 生成期间才占合成层，落定后释放（§6：filter / will-change 不长期挂着）
      const el = sceneRef.current;
      if (!el) return;
      el.style.willChange = "opacity, transform";
      if (wcTimer.current) clearTimeout(wcTimer.current);
      wcTimer.current = setTimeout(() => {
        el.style.willChange = "auto";
      }, 1400);
    },
    [reduced],
  );

  // 减动效：开页直接落在 L4 的完整天空。静止态是最终态，不是隐藏态。
  // 判定必须放挂载后（服务端没有 matchMedia），所以这里是一次 effect 而不是初值。
  useEffect(() => {
    if (!reduced) return;
    setMaxLevel((cur) => (cur < 4 ? 4 : cur));
    setPose((cur) => (cur === "walk" ? "gaze" : cur));
  }, [reduced]);

  useEffect(() => {
    return () => {
      if (wcTimer.current) clearTimeout(wcTimer.current);
    };
  }, []);

  // 输入驱动的层级推进。只看邮箱，密码与昵称不参与。
  const onEmail = (v: string) => {
    setEmail(v);
    const t = v.trim();
    const at = t.indexOf("@");
    if (err === ERR_EMAIL && EMAIL_RE.test(t)) setErr("");

    if (at === -1) {
      if (t.length >= 3) reach(2);
      return;
    }
    if (at >= 1) reach(2);
    if (t.length > at + 1) reach(3);
    if (EMAIL_RE.test(t)) {
      reach(4);
      setPose("gaze");
    }
  };

  const fail = (msg: string, focus?: HTMLInputElement | null) => {
    setErr(msg);
    focus?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;

    const mail = email.trim();
    // 无效邮箱不推进层级，不伪造「已生成」
    if (!EMAIL_RE.test(mail)) return fail(ERR_EMAIL, emailRef.current);
    if (tab === "reg" && !nickname.trim()) return fail("请填写昵称。", nickRef.current);
    if (!password) return fail("请输入密码。", pwRef.current);
    if (tab === "reg" && password.length < 8) return fail("密码至少 8 位。", pwRef.current);

    setErr("");
    busyRef.current = true;
    setBusy(true);
    try {
      if (tab === "login") {
        await login(mail, password);
      } else {
        // username 传空串：由后端从邮箱派生并保证唯一。前端派生会让 a@x / a@y 撞车，
        // 而用户看到的「用户名已被占用」对应不上自己填过的任何一栏。
        await register("", mail, password, nickname.trim());
      }
    } catch (e2) {
      busyRef.current = false;
      setBusy(false);
      return fail((e2 as Error).message, pwRef.current);
    }

    // L5：暖金地平线亮起、剪影伸手、色相 252→276。此时表单退场，
    // 实心主 CTA 把暖金配额让给地平线——世界已生成，按钮就不该再抢眼。
    reach(5);
    setPose("reach");
    setHue(HUE_DONE);
    setDone(true);
    setBusy(false);
    busyRef.current = false;
    // 这一页刚演过一遍「世界生成」，紧接着进星海不必再播 2.6s 开屏（判定见 lib/intro.ts）
    markIntroSeen();
    setTimeout(() => router.push(next), reduced ? 0 : 650);
  };

  // 确认区拿到焦点：容器里有 sr-only 标题，读屏听到的是上下文而不是孤零零一句话
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const lv = [styles.lv1, styles.lv2, styles.lv3, styles.lv4, styles.lv5].slice(0, maxLevel);
  const sceneCls = [
    styles.scene,
    ...lv,
    pose === "gaze" ? styles.poseGaze : "",
    pose === "reach" ? styles.poseReach : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.root}>
      {/* 层级推进对读屏静音：整个场景 aria-hidden，只有校验与确认区播报 */}
      <div className={styles.stage} aria-hidden="true">
        <WorldScope hue={hue} className={sceneCls} innerRef={sceneRef}>
          <div className={styles.skyGrad} />
          <div className={styles.halo} />
          <div className={`${styles.cloud} ${styles.c1}`} />
          <div className={`${styles.cloud} ${styles.c2}`} />
          <div className={`${styles.cloud} ${styles.c3}`} />
          <div className={styles.starfield}>
            {STARS.map((s) => (
              <i
                key={s.key}
                style={
                  {
                    left: s.left,
                    top: s.top,
                    width: `${s.size}px`,
                    height: `${s.size}px`,
                    "--o": s.o,
                    transitionDelay: s.delay,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className={styles.meteor} />
          <div className={styles.horizon} />
          {/* 余光必须叠在 .horizon 之上、剪影之下，否则纯黑剪影读不出轮廓 */}
          <div className={styles.glow} />
          <div className={styles.horizonLine} />
          <div className={styles.figure}>
            <Figure pose="walk" className={styles.figWalk} />
            <Figure pose="gaze" className={styles.figGaze} />
            <Figure pose="reach" className={styles.figReach} />
          </div>
          <div className={styles.veil} />
        </WorldScope>
      </div>
      <div className={styles.grain} aria-hidden="true" />

      {/* 顶栏不加登录入口：各页顶栏已渲染「我的空间」，同屏再放「登录」是自相矛盾的状态 */}
      <Link className={styles.brandmark} href="/" aria-label="万象 · Story Editor · 回到星海">
        <span className={styles.mark} aria-hidden="true">
          <WanxiangLogo size={20} />
        </span>
        <span className={styles.zh}>万象</span>
        <span className={styles.en}>STORY EDITOR</span>
      </Link>

      <main className={styles.shell}>
        <section
          className={`${styles.panel} ${done ? styles.sceneDone : ""}`}
          aria-labelledby="login-title"
        >
          <p className={styles.eyebrow}>万象 · 无穷世界</p>
          <h1 className={styles.title} id="login-title">
            <span className={styles.titleEmpty} aria-hidden={done || undefined}>
              这里还没有故事。
            </span>
            <span className={styles.titleDone} aria-hidden={!done || undefined}>
              现在有了。
            </span>
          </h1>
          <p className={styles.lede}>
            {tab === "login"
              ? "填写邮箱和密码，继续你未讲完的故事。你写下的每一个字符，都会让这片天空多长出一层。"
              : "注册即赠 1 元额度，存档与创作跨设备同步。你写下的每一个字符，都会让这片天空多长出一层。"}
          </p>

          <div className={styles.tabs} role="tablist" aria-label="登录或注册">
            <button
              className={styles.tab}
              id="tab-login"
              type="button"
              role="tab"
              aria-selected={tab === "login"}
              aria-controls="authpanel"
              onClick={() => {
                setTab("login");
                setErr("");
              }}
            >
              登录
            </button>
            <button
              className={styles.tab}
              id="tab-reg"
              type="button"
              role="tab"
              aria-selected={tab === "reg"}
              aria-controls="authpanel"
              onClick={() => {
                setTab("reg");
                setErr("");
              }}
            >
              注册
            </button>
          </div>

          <form
            className={`${styles.form} ${done ? styles.formOff : ""}`}
            id="authpanel"
            role="tabpanel"
            aria-labelledby={tab === "login" ? "tab-login" : "tab-reg"}
            aria-busy={busy || undefined}
            onSubmit={submit}
            noValidate
          >
            {tab === "reg" && (
              <div className={styles.field}>
                <label htmlFor="nk">昵称</label>
                <input
                  id="nk"
                  ref={nickRef}
                  value={nickname}
                  autoComplete="nickname"
                  placeholder="别人会这样称呼你"
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="email">邮箱</label>
              <input
                id="email"
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                aria-describedby="login-err"
                aria-invalid={err === ERR_EMAIL || undefined}
                onFocus={() => reach(1)}
                onChange={(e) => onEmail(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="pw">密码</label>
              {/* 密码框不推进层级：阶梯只绑邮箱，见文件头 */}
              <div className={styles.pwWrap}>
                <input
                  id="pw"
                  ref={pwRef}
                  type={showPw ? "text" : "password"}
                  value={password}
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  placeholder={tab === "reg" ? "至少 8 位" : "••••••••"}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  className={styles.pwToggle}
                  type="button"
                  aria-label={showPw ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPw}
                  onClick={() => setShowPw((v) => !v)}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                    {showPw && <path d="M4 4 20 20" />}
                  </svg>
                </button>
              </div>
            </div>

            {/* 文案由状态注入、清除时置空：role=alert 靠内容变化触发播报 */}
            <p className={styles.err} id="login-err" role="alert">
              {err}
            </p>

            <div className={styles.actions}>
              <button
                className={styles.btnGo}
                type="submit"
                aria-disabled={busy || undefined}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
                <span>{busy ? "正在开启…" : tab === "login" ? "让它开始" : "创建账号"}</span>
              </button>
              <Link className={styles.btnQuiet} href="/">
                随便看看
              </Link>
            </div>

            <p className={styles.note}>
              {tab === "login"
                ? "还没有账号？切换到「注册」，一分钟即可开始阅读或创作。"
                : "注册后账户即有 1 元额度，按真实用量结算；也可以在设置中接入自有模型。"}
            </p>
          </form>

          <div
            className={`${styles.done} ${done ? styles.doneOn : ""}`}
            ref={doneRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            <h2 className="sr-only">世界已经生成，正在进入</h2>
            <span className={styles.doneIcon} aria-hidden="true">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12.5 9.5 18 20 7" />
              </svg>
            </span>
            <p className={styles.lede}>天空已经长齐了，正带你进去。</p>
          </div>
        </section>
      </main>
    </div>
  );
}
