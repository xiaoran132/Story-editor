"use client";

// 编辑器通用单行输入。与 Textarea 接口一致，但语义为单行（模型名等），复用 .ed-input 样式。
export default function Input({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="ed-field">
      <span className="ed-label">
        {label}
        {hint && <span className="ed-hint">{hint}</span>}
      </span>
      <input
        className="ed-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
