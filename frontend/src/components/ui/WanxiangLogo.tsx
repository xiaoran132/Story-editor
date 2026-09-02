// 《万象》品牌标记 · L1「灵感火种分叉」
// 承前端既有约定（见 wx/WxHeader.tsx）：
//   · 24 网格、fill=none、stroke=currentColor、strokeWidth 1.8、圆头圆角；
//   · 颜色交给容器（容器设 color 决定线条色）；
//   · 暖金只走 CSS 变量 var(--accent)，即全站「暖金配额」那一处（此处 = 灵感火种）。
// 语义：底部暖金火种（一个灵感）→ 向上分叉 2→4 →枝端化星（剧情树生长）。
// 站内唯一品牌标记：WxHeader 顶栏与登录页共用，浏览器标签图标走 app/icon.svg。
//
// 用法：
//   <span className="mark" style={{ color: "var(--w-line)" }}>
//     <WanxiangLogo size={20} />
//   </span>
// 想让整枚走暖金：把容器 color 设为 var(--accent) 即可（线条与火种同色）。
export default function WanxiangLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 枝干：火种 → 分叉 2 → 4 */}
      <path d="M12 20.4V17.6" />
      <path d="M12 17.6 8.2 14" />
      <path d="M12 17.6 15.8 14" />
      <path d="M8.2 14 6 10.6" />
      <path d="M8.2 14 10.2 11.2" />
      <path d="M15.8 14 18 10.6" />
      <path d="M15.8 14 13.8 11.2" />
      {/* 枝端化星 */}
      <circle cx="6" cy="10.6" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.2" cy="11.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="13.8" cy="11.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="18" cy="10.6" r="1" fill="currentColor" stroke="none" />
      {/* 暖金配额：灵感火种 */}
      <circle cx="12" cy="20.8" r="1.5" fill="var(--accent)" stroke="none" />
    </svg>
  );
}
