"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Dropdown.module.css";

// 全站统一的下拉框：胶囊按钮 + 弹出菜单，视觉移植自作品馆的排序筛选（DESIGN §7.2）。
// 不用原生 <select>：它的弹层配色归操作系统管，深空底上一直是打补丁的对象；
// 自制菜单才能与设计 token 一致，并支持分组标题与勾选态。
//
// 语义是 role=menu + menuitemradio（互斥单选），与作品馆相同；
// 分组标题用 role=presentation 包裹，读屏只报选项不报标题。

export type DropOpt = { value: string; label: string };
export type DropGroup = { group: string; opts: DropOpt[] };
export type DropEntry = DropOpt | DropGroup;

const Tick = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const isGroup = (e: DropEntry): e is DropGroup => "group" in e;

export default function Dropdown({
  value,
  onChange,
  entries,
  id,
  ariaLabel,
  caption,
  disabled,
  compact,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  entries: readonly DropEntry[];
  /** 挂到触发按钮上，供外部 <label htmlFor> 关联 */
  id?: string;
  ariaLabel?: string;
  /** 按钮文案前缀，如作品馆的「排序」；不传则只显示选中项 */
  caption?: string;
  disabled?: boolean;
  /** 紧凑档（min-height 40px），给编辑器密集表格行用；默认 46px */
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const flat = entries.flatMap((e) => (isGroup(e) ? e.opts : [e]));
  const current = flat.find((o) => o.value === value);
  // 值不在选项里（理论上调用方都会补孤儿项）时如实显示原值，绝不静默显示成第一项
  const shown = current?.label ?? value;

  // 点外关闭：菜单没有遮罩，唯一的关闭线索不能只是「再点一次按钮」
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  // 方向键在选项间移动焦点（Home/End 到两端）；焦点自身带着 hover 态，不需要额外高亮
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [];
    if (!items.length) return;
    const i = [...items].indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (i < 0) next = 0;
    else next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  const pick = (v: string) => {
    onChange(v);
    close(true);
  };

  const rootCls = [styles.dd, className].filter(Boolean).join(" ");
  const btnCls = [styles.btn, compact ? styles.compact : "", open ? styles.open : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootCls} ref={rootRef}>
      <button
        ref={btnRef}
        id={id}
        className={btnCls}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        // 与原生 select 一致：按钮上按方向键也能直接拉开
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {caption && <span className={styles.cap}>{caption}</span>}
        <span className={styles.val} title={shown}>
          {shown}
        </span>
        <svg
          className={styles.caret}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className={styles.menu}
          role="menu"
          aria-label={ariaLabel ?? caption ?? "选项"}
          ref={menuRef}
          onKeyDown={onMenuKey}
        >
          {entries.map((e, i) =>
            isGroup(e) ? (
              <div role="presentation" key={`g${i}`}>
                <p className={styles.grp}>{e.group}</p>
                {e.opts.map((o) => (
                  <MenuItem key={o.value} opt={o} selected={o.value === value} onPick={pick} />
                ))}
              </div>
            ) : (
              <MenuItem key={e.value} opt={e} selected={e.value === value} onPick={pick} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  opt,
  selected,
  onPick,
}: {
  opt: DropOpt;
  selected: boolean;
  onPick: (v: string) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={() => onPick(opt.value)}
    >
      <span className={styles.tick}>{selected ? Tick : null}</span>
      {opt.label}
    </button>
  );
}
