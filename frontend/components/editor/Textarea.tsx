"use client";

// 编辑器通用多行输入。复用星图主题的输入样式（.ed-textarea），可选行尾标签。
export default function Textarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="ed-field">
      <span className="ed-label">
        {label}
        {hint && <span className="ed-hint">{hint}</span>}
      </span>
      <textarea
        className="ed-textarea"
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
