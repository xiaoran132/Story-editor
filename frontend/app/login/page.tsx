"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import BrandGlyph from "@/components/BrandGlyph";

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// useSearchParams 要求 Suspense 边界，否则整页会被迫退出静态预渲染（Next 14 构建期报错）。
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  // 登录后回到来处（如 /create 的登录门槛跳转）；只接受站内相对路径，防开放重定向。
  const nextRaw = useSearchParams().get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const { login, register } = useAuthStore();
  const [tab, setTab] = useState<"login" | "reg">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!emailOk(email)) return setErr("请输入有效的邮箱");
    if (tab === "reg" && !nickname.trim()) return setErr("请填写昵称");
    if (tab === "reg" && password.length < 8) return setErr("密码至少 8 位");
    if (!password) return setErr("请输入密码");
    setBusy(true);
    try {
      if (tab === "login") {
        await login(email.trim(), password);
      } else {
        // username 传空串：由后端从邮箱派生并保证唯一（前端派生会让 a@x / a@y 撞车，
        // 而用户看到的「用户名已被占用」对应不上自己填过的任何一栏）。
        await register("", email.trim(), password, nickname.trim());
      }
      router.push(next);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-split">
      {/* 左：阅读态氛围栏 */}
      {/* 挂 od-reading：左栏是阅读态氛围栏，挂上后整块直接吃阅读态 token，不必再复制深色字面量 */}
      <aside className="login-aside od-reading">
        <Link className="brand" href="/">
          <span className="glyph" aria-hidden="true">
            <BrandGlyph size={18} />
          </span>
          Story&nbsp;Editor
        </Link>
        <div className="mid">
          <div className="kick">走进一个世界</div>
          <h1>
            每个选择，
            <br />
            都有回声。
          </h1>
          <p>
            登录后，你的存档、创作与关注会跨设备同步。还没准备好？也可以先以匿名身份走进任意一个故事。
          </p>
        </div>
        <div className="foot">© Story Editor · 自由创作的 AI 互动剧情社区</div>
      </aside>

      {/* 右：管理态表单 */}
      <main className="login-main">
        <div className="login-box">
          <div className="login-tabs" role="tablist" aria-label="登录或注册">
            <button id="tab-login" role="tab" aria-selected={tab === "login"} aria-controls="authpanel"
              type="button" onClick={() => setTab("login")}>登录</button>
            <button id="tab-reg" role="tab" aria-selected={tab === "reg"} aria-controls="authpanel"
              type="button" onClick={() => setTab("reg")}>注册</button>
          </div>

          <form id="authpanel" role="tabpanel" aria-labelledby={tab === "login" ? "tab-login" : "tab-reg"}
            onSubmit={submit} noValidate>
            <h2>{tab === "login" ? "欢迎回来" : "创建账号"}</h2>
            <p className="lead">{tab === "login" ? "继续你未讲完的故事。" : "一分钟，开始读或写你的第一个故事。"}</p>

            {tab === "reg" && (
              <div className="field">
                <label htmlFor="nk">昵称</label>
                <input className="inp" id="nk" value={nickname} autoComplete="nickname"
                  placeholder="别人会这样称呼你" onChange={(e) => setNickname(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="em">邮箱</label>
              <input className="inp" id="em" type="email" value={email} autoComplete="email"
                placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw">密码</label>
              <div style={{ position: "relative" }}>
                <input className="inp" id="pw" type={showPw ? "text" : "password"} value={password}
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  placeholder={tab === "reg" ? "至少 8 位" : "••••••••"} style={{ paddingRight: 44 }}
                  onChange={(e) => setPassword(e.target.value)} />
                <button type="button" aria-label={showPw ? "隐藏密码" : "显示密码"} aria-pressed={showPw}
                  onClick={() => setShowPw((v) => !v)}
                  style={{ position: "absolute", right: 6, top: 6, width: 32, height: 32, border: 0, background: "transparent", color: "var(--muted)", borderRadius: 7, display: "grid", placeItems: "center" }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
            </div>

            {err && <div className="err-msg" role="alert" style={{ marginBottom: 14 }}>{err}</div>}

            <button className="btn primary block" type="submit" disabled={busy} style={{ height: 46 }}>
              {busy ? "处理中…" : tab === "login" ? "登录" : "创建账号"}
            </button>
          </form>

          {tab === "login" && (
            <>
              <div className="divider">或</div>
              <Link className="btn secondary block" href="/" style={{ height: 46 }}>
                先以匿名身份进入
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
