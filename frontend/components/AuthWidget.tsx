"use client";

import { useState } from "react";
import { useAuthStore } from "@/store/authStore";

// 顶栏登录/注册小组件：未登录展开内联表单；登录后显示昵称 + 退出。
export default function AuthWidget() {
  const { user, login, register, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (user) {
    return (
      <div className="auth">
        <span className="auth-user">你好，{user.nickname || user.username}</span>
        <button className="auth-link" onClick={logout}>
          退出
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="auth">
        <button className="auth-link" onClick={() => { setOpen(true); setMode("login"); }}>
          登录
        </button>
        <button className="auth-link" onClick={() => { setOpen(true); setMode("register"); }}>
          注册
        </button>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(
          username.trim(),
          email.trim(),
          password,
          nickname.trim() || username.trim()
        );
      }
      setOpen(false);
      setPassword("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-panel">
      <div className="auth-tabs">
        <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
          登录
        </button>
        <button className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>
          注册
        </button>
        <span className="auth-close" onClick={() => setOpen(false)}>
          ×
        </span>
      </div>
      {mode === "register" && (
        <>
          <input
            placeholder="用户名"
            value={username}
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            placeholder="昵称（可选）"
            value={nickname}
            autoComplete="off"
            onChange={(e) => setNickname(e.target.value)}
          />
        </>
      )}
      <input
        placeholder="邮箱"
        value={email}
        autoComplete="off"
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      {err && <div className="auth-err">{err}</div>}
      <button className="auth-submit" disabled={busy} onClick={submit}>
        {busy ? "…" : mode === "login" ? "登录" : "注册并登录"}
      </button>
    </div>
  );
}
