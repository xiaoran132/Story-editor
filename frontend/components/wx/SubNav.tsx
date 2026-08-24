"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 我的空间的二级导航，/mine/* 五页共用。
// 原型里这条 .subnav 是 空间/草稿箱/消息/设置 四项，这里多一项「历史记录」——
// 它从顶栏一级入口降下来（见 WxHeader）。
//
// ⚠️ 与 WxHeader 同理，P0 只新建、不挂载。
//
// /mine/inbox 无后端（无消息模型、无表、无路由），保留入口但页面写死
// 「开发中」文案，**不渲染假消息**。

const ITEMS = [
  { href: "/mine", label: "空间" },
  { href: "/mine/drafts", label: "草稿箱" },
  { href: "/mine/history", label: "历史记录" },
  { href: "/mine/inbox", label: "消息" },
  { href: "/mine/settings", label: "设置" },
];

export default function SubNav() {
  const pathname = usePathname() ?? "/mine";

  return (
    <nav className="wx-subnav" aria-label="我的空间导航">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          // /mine 是父路径，不能用 startsWith，否则五项会同时高亮
          aria-current={pathname === item.href ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
