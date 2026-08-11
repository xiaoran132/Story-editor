"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthWidget from "./AuthWidget";
import BrandGlyph from "./BrandGlyph";
import { IconPlus } from "./icons";

// 全局导航：发现 / 我的空间 / 社区。
//
// 「我在读」曾在这里单独占一项（指向 /mine 的第二个页签），已移除：顶栏是全局
// 导航，不该暴露某个页面的内部页签——两个入口指向同一路由，看起来还完全一样。
// 存档入口没有丢，就在「我的空间」页面的页签上；深链 /mine?tab=reading 仍然有效。
const NAV = [
  { href: "/", label: "发现" },
  { href: "/mine", label: "我的空间" },
  { href: "/community", label: "社区" },
];

// 管理态全局导航头：sticky 毛玻璃。可选搜索框（首页传入 value/onChange 做前端过滤）。
export default function AppHeader({
  search,
  onSearch,
}: {
  search?: string;
  onSearch?: (v: string) => void;
}) {
  const pathname = usePathname();
  // 只比 pathname：导航项都不带查询参数，且「我的空间」在两个页签下都该高亮。
  // 一旦有导航项要带 ?query，就得改用 useSearchParams——那会让子树退出静态预渲染，
  // 必须再用 Suspense 包住，否则每个用了 AppHeader 的静态页都会 prerender 失败（踩过）。
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href;

  return (
    <header className="app-header">
      <div className="nav-inner">
        <Link className="brand" href="/" aria-label="Story Editor 首页">
          <span className="glyph" aria-hidden="true"><BrandGlyph /></span> Story&nbsp;Editor
        </Link>
        <nav className="nav-links" aria-label="主导航">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>

        {onSearch ? (
          <div className="nav-search" role="search">
            <label className="sr-only" htmlFor="site-search">搜索作品</label>
            <span className="ico" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <input
              id="site-search"
              type="search"
              placeholder="搜索世界观、标题、题材…"
              autoComplete="off"
              value={search ?? ""}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        ) : (
          <span style={{ marginLeft: "auto" }} />
        )}

        <div className="header-actions">
          <Link className="btn-create" href="/create">
            <IconPlus size={15} />
            创作
          </Link>
          <AuthWidget />
        </div>
      </div>
    </header>
  );
}
