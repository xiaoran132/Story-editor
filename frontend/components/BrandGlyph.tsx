// 品牌标记（分支节点，见 docs/design/tokens.css 底部）。
// 曾在 AppHeader 与 login 页各存一份、颜色各写死一套（DESIGN §10 点名的「副本漂移」）。
// 合并为一处并全用 currentColor：颜色交给容器（.brand .glyph 设 color），
// 管理态与阅读态复用同一枚，不再有第二份需要同步。
export default function BrandGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19.5v-6M12 13.5 7.7 8.9M12 13.5l4.3-4.6" />
      <circle cx="12" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="7.4" cy="8.3" r="2.3" fill="currentColor" stroke="none" opacity="0.55" />
      <circle cx="16.6" cy="8.3" r="2.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
