"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import AuthWidget from "./AuthWidget";
import BrandGlyph from "./BrandGlyph";
import { IconPlus } from "./icons";

// 导航集合按 DESIGN §9.3：发现 / 我在读 / 我的空间 / 社区。
// 「我在读」指向 /mine?tab=reading（我的空间的第二个页签），存档从首页迁过去后入口不丢。
// 用查询参数而非 hash：同路由内切换时 hash 不会触发重渲染（见 app/mine/page.tsx 注释）。
const NAV = [
  { href: "/", label: "发现" },
  { href: "/mine?tab=reading", label: "我在读" },
  { href: "/mine", label: "我的空间" },
  { href: "/community", label: "社区" },
];

// 导航链表。active 传 null = 不做高亮（静态预渲染时的降级渲染，见下方 Suspense）。
function NavLinks({ active }: { active: ((href: string) => boolean) | null }) {
  return (
    <nav className="nav-links" aria-label="主导航">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} aria-current={active?.(n.href) ? "page" : undefined}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

// 高亮判定要读查询参数，而 useSearchParams 会让所属子树退出静态预渲染，
// 故单独抽成组件并用 Suspense 包住——否则**每个用了 AppHeader 的静态页都会预渲染失败**
// （踩过：/、/me、/admin、/community 全线报 prerender-error）。
function ActiveNavLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 两个导航项指向同一路由、靠 ?tab 区分，所以高亮要连查询参数一起比，
  // 否则「我在读」永远不亮、「我的空间」在两个页签下都亮。
  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (path !== pathname) return false;
    return (query ?? "") === (searchParams.toString() || "");
  };
  return <NavLinks active={isActive} />;
}

// 管理态全局导航头：sticky 毛玻璃。可选搜索框（首页传入 value/onChange 做前端过滤）。
export default function AppHeader({
  search,
  onSearch,
}: {
  search?: string;
  onSearch?: (v: string) => void;
}) {

  return (
    <header className="app-header">
      <div className="nav-inner">
        <Link className="brand" href="/" aria-label="Story Editor 首页">
          <span className="glyph" aria-hidden="true"><BrandGlyph /></span> Story&nbsp;Editor
        </Link>
        {/* fallback 渲染同样的链接、只是不高亮：静态 HTML 里导航必须在，
            不能因为高亮判定而整块缺席 */}
        <Suspense fallback={<NavLinks active={null} />}>
          <ActiveNavLinks />
        </Suspense>

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
