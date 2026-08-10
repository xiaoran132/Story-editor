// 共享单线图标（DESIGN §7：1.6–2px 单线 SVG + currentColor，禁用 emoji / ×→← 这类字符当图标）。
// 全部 aria-hidden：图标只作装饰，可访问名由所在按钮的 aria-label 或可见文字提供。
// 颜色一律 currentColor，由容器决定——这样同一枚图标在管理态和阅读态都不用改。

type IconProps = { size?: number };

// 统一的线性图标外壳，省掉每处重复那一串属性。
function Line({ size = 16, children }: IconProps & { children: React.ReactNode }) {
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
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Line {...p}>
    <path d="M12 5v14M5 12h14" />
  </Line>
);

export const IconClose = (p: IconProps) => (
  <Line {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Line>
);

export const IconChevronLeft = (p: IconProps) => (
  <Line {...p}>
    <path d="m15 18-6-6 6-6" />
  </Line>
);

export const IconArrowRight = (p: IconProps) => (
  <Line {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Line>
);

export const IconTrash = (p: IconProps) => (
  <Line {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </Line>
);

// 结局横幅的四角星：原为 ✦ 字符，字体回退时形状与基线都不可控。
export const IconSpark = ({ size = 16 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.5 14 9.2 20.8 11.2 14 13.2 12 20.5 10 13.2 3.2 11.2 10 9.2z" />
  </svg>
);
