"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

// 通用模态对话框（对齐原型 settings/community/create-editor 三屏共用的 `.ov > .dlg`）。
// 全站此前零实现，各处要么用内联表单顶替、要么干脆没有。
//
// 无障碍要点（DESIGN §6）：
//   - role="dialog" + aria-modal + aria-labelledby 指向标题；
//   - Esc 关闭；
//   - 焦点陷阱：打开时把焦点移进面板，Tab 在面板内循环，关闭后还给触发元素——
//     否则键盘用户会 Tab 到被遮住的背景内容里，彻底迷路；
//   - 背景滚动锁定，避免移动端「遮罩下面还在滚」。
//
// 用 portal 挂到 body：对话框若留在原组件树里，会被祖先的 transform/overflow/z-index
// 裁掉或压在下面（`.scrim`、`.od-drawer` 都带 transform）。
export default function Dialog({
  open,
  title,
  desc,
  icon,
  onClose,
  children,
  actions,
  labelledBy = "dialog-title",
}: {
  open: boolean;
  title: string;
  desc?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null);

    // 优先聚焦面板内第一个可交互元素，没有就聚焦面板本身
    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ov on" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={panelRef}
      >
        <button className="dlg-close" type="button" aria-label="关闭" onClick={onClose}>
          <IconClose size={18} />
        </button>
        {icon && <div className="ic">{icon}</div>}
        <h2 id={labelledBy}>{title}</h2>
        {desc && <p className="sub">{desc}</p>}
        {children}
        {actions && <div className="row">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}
