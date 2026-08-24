"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AccountMenu from "./AccountMenu";

// 新体系顶栏。12/13 份原型里这一块逐字节相同，整块搬过来。
//
// 主导航只放**公共入口**：星海 / 作品馆 / 社区。
// 「我的空间」及其全部子页面收进右侧的账户菜单（AccountMenu）——个人向的东西
// 都在头像后面，主导航不随登录态变形。「历史记录」同理，它还另有 SubNav 那一层
// 页内导航：账户菜单是**全局入口**，SubNav 是进到那个区之后的**局部导航**，
// 两者不是重复。
//
// 暖金配额：品牌标记末端那个圆点是第 1 处，「写一个世界」是第 2 处——**配额到此用满**，
// 账户菜单里一处暖金都不能再有。

const NAV = [
  { href: "/", label: "星海" },
  { href: "/works", label: "作品馆" },
  { href: "/community", label: "社区" },
];

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function WxHeader() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="wx-topbar">
      <Link className="wx-brand" href="/" aria-label="万象 · Story Editor · 回到星海">
        <span className="mark" aria-hidden="true">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19.5v-6M12 13.5 7.7 8.9M12 13.5l4.3-4.6" />
            <circle cx="12" cy="20" r="1.3" fill="currentColor" stroke="none" />
            {/* 暖金配额第 1 处 */}
            <circle cx="7.4" cy="8.3" r="2.2" fill="var(--accent)" stroke="none" />
            <circle cx="16.6" cy="8.3" r="2.2" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="zh">万象</span>
        <span className="en">STORY EDITOR</span>
      </Link>

      <nav className="wx-topnav" aria-label="主导航">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="wx-topbar-end">
        <Link className="wx-btn-create" href="/create" aria-label="写一个世界 · 打开创作编辑器">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>写一个世界</span>
        </Link>
        <AccountMenu />
      </div>
    </header>
  );
}
