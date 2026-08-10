"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthWidget from "./AuthWidget";
import BrandGlyph from "./BrandGlyph";
import { IconPlus } from "./icons";

// 导航集合按 DESIGN §9.3：发现 / 我在读 / 我的空间 / 社区。
// 「我在读」指向 /mine#reading（我的空间的第二个页签），存档从首页迁过去后入口不丢。
const NAV = [
  { href: "/", label: "发现" },
  { href: "/mine#reading", label: "我在读" },
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
  // 带 hash 的项（/mine#reading）不参与高亮判定，否则会和 /mine 同时点亮。
  const isActive = (href: string) =>
    href.includes("#") ? false : href === "/" ? pathname === "/" : pathname === href;

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
