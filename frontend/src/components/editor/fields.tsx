"use client";

import type { ReactNode } from "react";
import Dropdown, { type DropOpt } from "@/components/ui/Dropdown";
import styles from "./editor.module.css";

// 编辑器的表单原子件。六段共用，样式全在 editor.module.css。

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
        {hint && <span className={styles.hint}> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

let seq = 0;
const nextId = () => `wxf-${(seq += 1)}`;

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const id = nextId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  placeholder,
  readOnly,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange?: (v: string) => void;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const id = nextId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <textarea
        id={id}
        className={styles.textarea}
        rows={rows}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: DropOpt[];
}) {
  const id = nextId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Dropdown id={id} value={value} onChange={onChange} entries={options} />
    </Field>
  );
}

/** 段内的上一步 / 下一步。「下一步」永远可点——草稿本来就允许半成品。 */
export function NavBtns({
  index,
  names,
  onGo,
}: {
  index: number;
  names: readonly string[];
  onGo: (i: number) => void;
}) {
  return (
    <div className={styles.navbtns}>
      {index > 0 ? (
        <button
          className={`${styles.btn} ${styles.btnQuiet}`}
          type="button"
          onClick={() => onGo(index - 1)}
        >
          ← {names[index - 1]}
        </button>
      ) : (
        <span />
      )}
      {index < names.length - 1 && (
        <button className={styles.btn} type="button" onClick={() => onGo(index + 1)}>
          下一步 · {names[index + 1]} →
        </button>
      )}
    </div>
  );
}

/** AI 起草槽：接口未接入时诚实说明，**不伪造候选内容**（§7.7）。 */
export function DraftSlot({ children }: { children: ReactNode }) {
  return <p className={styles.slot}>{children}</p>;
}
