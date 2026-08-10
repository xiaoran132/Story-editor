"use client";

// 开关（原型 settings.html:70-76 的 `.sw`）。
// 用真正的 checkbox 承载状态与键盘行为，`.track` 只是视觉——自绘 div 开关会丢掉
// 空格键切换、表单语义和读屏时的「已选中/未选中」播报。
export default function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string; // 可访问名；视觉标题在 .prefrow 里，这里给读屏用
}) {
  return (
    <label className="sw">
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" aria-hidden="true" />
    </label>
  );
}
