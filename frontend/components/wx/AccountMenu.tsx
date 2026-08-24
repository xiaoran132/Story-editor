"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { assetUrl } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

// 顶栏最右侧的账户区。**所有与「我」有关的入口都收在这里**，顶栏主导航因此
// 只剩三项公共入口（星海 / 作品馆 / 社区）。将来新增个人向子页面，加进下面
// 那张 ITEMS 表即可，不要再往主导航上挂。
//
// ⚠️ 两态永不同屏（DESIGN.md §7.6 那条纪律的实质）：
//   · 已登录：头像 → 下拉菜单
//   · 匿名  ：登录 / 注册两个按钮
// 原型不接认证、只有登录态，所以它没写匿名那一半；产品里匿名访客可以浏览已发布
// 作品，顶栏必须给他一条路，否则只能靠点到受限页被弹走才发现要登录。
//
// 暖金配额：品牌标记那个圆点已占掉第 1 处，「写一个世界」占第 2 处——所以这里
// **一处暖金都不能用**。「注册」用中性亮态，「登录」是文字态。

type Item = { href: string; label: string; hint?: string };

const ITEMS: Item[] = [
  { href: "/mine", label: "我的空间", hint: "作品与数据" },
  { href: "/mine/works", label: "我的作品" },
  { href: "/mine/history", label: "历史记录" },
  { href: "/mine/inbox", label: "消息" },
  { href: "/mine/settings", label: "设置", hint: "资料 · AI 连接 · 阅读偏好" },
];

export default function AccountMenu() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const initAuth = useAuthStore((s) => s.init);
  const logout = useAuthStore((s) => s.logout);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // 路由一变就收起来：菜单项本身是 <Link>，不关的话跳过去菜单还挂在那儿。
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btnRef.current?.focus(); // 关闭后焦点归还触发元素（§9）
    };
    // ⚠️ 用 pointerdown 而不是 click：菜单项是 <Link>，click 阶段路由已经在跳，
    // 这时再 setState 会在卸载中的组件上更新。
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  // 登录后回到当前页。只带 pathname 不带 query：读 useSearchParams 会强制要求外面
  // 套 Suspense，为一个回跳参数把 13 个挂顶栏的页面都改掉不划算。
  const nextParam = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;

  // ⚠️ 补水之前两态都不渲染：服务端与客户端首帧都是 hydrated=false，标记一致所以
  // 不会 hydration mismatch；已登录的人也不会先闪一下「登录 / 注册」。
  if (!hydrated) return <div className="wx-account" aria-hidden="true" />;

  if (!user) {
    return (
      <div className="wx-account">
        <Link className="wx-signin" href={`/login${nextParam}`}>
          登录
        </Link>
        <Link className="wx-signup" href={`/login${nextParam}${nextParam ? "&" : "?"}tab=register`}>
          注册
        </Link>
      </div>
    );
  }

  const name = (user.nickname || user.username || "").trim();
  const initial = name.charAt(0) || "·";
  const isAdmin = user.role === "admin";

  return (
    <div className="wx-account" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="wx-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`账户菜单 · ${name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {user.avatar_url ? (
          // 原生 <img>：项目未配 next/image 的 remotePatterns，这些图来自后端同源静态目录。
          // eslint-disable-next-line @next/next/no-img-element
          <img className="wx-avatar" src={assetUrl(user.avatar_url)} alt="" />
        ) : (
          <span className="wx-avatar wx-avatar-fallback" aria-hidden="true">
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div className="wx-menu" id={menuId} role="menu">
          <div className="wx-menu-head">
            <span className="wx-menu-name">{name}</span>
            <span className="wx-menu-sub">@{user.username}</span>
          </div>
          {ITEMS.map((it) => (
            <Link
              key={it.href}
              role="menuitem"
              className="wx-menu-item"
              href={it.href}
              aria-current={pathname === it.href ? "page" : undefined}
            >
              <span>{it.label}</span>
              {it.hint && <small>{it.hint}</small>}
            </Link>
          ))}
          {/* 平台设置只对 admin 出现。⚠️ role 是 JWT 签发时的快照，提权后要重新登录
              才会在这里出现；后端的 RequirePermission 才是硬防线，这里只是入口。 */}
          {isAdmin && (
            <Link role="menuitem" className="wx-menu-item" href="/admin">
              <span>平台设置</span>
              <small>AI 连接与单价</small>
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            className="wx-menu-item wx-menu-quit"
            onClick={() => {
              logout();
              setOpen(false);
              router.push("/");
            }}
          >
            <span>退出登录</span>
          </button>
        </div>
      )}
    </div>
  );
}
