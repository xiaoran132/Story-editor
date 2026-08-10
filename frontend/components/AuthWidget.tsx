"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { assetUrl } from "@/lib/api";

// 账户控件（导航头右侧）：未登录 → 「登录」链接跳 /login；登录后 → 头像下拉（个人主页 / 设置 / 退出）。
export default function AuthWidget() {
  const router = useRouter();
  const { user, init, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    init();
  }, [init]);

  // 点击外部 / Esc 关闭下拉
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) {
    return (
      <Link className="btn secondary sm" href="/login">
        登录
      </Link>
    );
  }

  const initial = (user.nickname || user.username || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="account" ref={ref}>
      <button
        className="avatar"
        type="button"
        aria-label="我的账户"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* 有头像用图，否则回退首字母色块——头像是可选的，不该有「默认灰头像」这种无信息占位 */}
        {user.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(user.avatar_url)} alt="" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <span className="account-name">你好，{user.nickname || user.username}</span>
          <Link href="/me" role="menuitem" onClick={() => setOpen(false)}>个人主页</Link>
          <Link href="/mine" role="menuitem" onClick={() => setOpen(false)}>我的创作</Link>
          {user.role === "admin" && (
            <Link href="/admin" role="menuitem" onClick={() => setOpen(false)}>平台设置</Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              logout();
              setOpen(false);
              router.push("/");
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
