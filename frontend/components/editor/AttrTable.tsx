"use client";

import { useEditorStore } from "@/store/editorStore";
import type { AttrRowData, AttrType } from "@/lib/types";
import { IconPlus, IconTrash } from "@/components/icons";
import Dropdown from "@/components/Dropdown";
import styles from "./editor.module.css";

// 属性声明表：每属性一行——键 / 类型 / 初值（随类型切控件）/ 上限 / hidden / reveal / 删除。
// initial_state 由这些行在存盘时派生，保证键严格一一对应（后端严格校验的对应项）。
export default function AttrTable() {
  const attributes = useEditorStore((s) => s.attributes);
  const addAttr = useEditorStore((s) => s.addAttr);
  const updateAttr = useEditorStore((s) => s.updateAttr);
  const removeAttr = useEditorStore((s) => s.removeAttr);

  return (
    <div className={styles.field}>
      <span className={styles.label}>
        属性
        <span className={styles.hint}>
          number 数值累加 · scalar 覆盖 · set 集合；上限仅对 number 有效，填写后玩家端会显示进度条；
          hidden 仅供 AI 参考、reveal 在揭示前不显示
        </span>
      </span>
      <div className={`${styles.list} ${styles.attrScroll}`}>
        {attributes.length > 0 && (
          <div className={`${styles.attrHead} ${styles.rowHead}`} aria-hidden="true">
            <span>键名</span>
            <span>类型</span>
            <span>初值</span>
            <span>上限</span>
            <span>隐藏</span>
            <span>门控</span>
            <span></span>
          </div>
        )}
        {attributes.map((a, i) => (
          <AttrRow key={i} a={a} row={i} onChange={(patch) => updateAttr(i, patch)} onDel={() => removeAttr(i)} />
        ))}
      </div>
      <button className={styles.btn} onClick={addAttr}>
        <IconPlus /> 添加属性
      </button>
    </div>
  );
}

// 表头那行是 aria-hidden 的视觉标签（密集表格逐格挂可见 label 会把表单撑成噪音），
// 每个控件改用带行号的 aria-label——屏幕阅读器读到「第 2 行 · 键名」，视觉不变。
function AttrRow({
  a,
  row,
  onChange,
  onDel,
}: {
  a: AttrRowData;
  row: number;
  onChange: (patch: Partial<AttrRowData>) => void;
  onDel: () => void;
}) {
  const at = `第 ${row + 1} 个属性`;
  return (
    <div className={styles.attrRow}>
      <input
        className={styles.rowInput}
        aria-label={`${at} · 键名`}
        placeholder="如 生命值"
        value={a.key}
        onChange={(e) => onChange({ key: e.target.value })}
      />
      <Dropdown
        compact
        ariaLabel={`${at} · 类型`}
        value={a.type}
        onChange={(v) => onChange({ type: v as AttrType })}
        entries={[
          { value: "number", label: "number" },
          { value: "scalar", label: "scalar" },
          { value: "set", label: "set" },
        ]}
      />
      <InitialInput a={a} at={at} onChange={onChange} />
      {/* 上限：只有 number 能填。没上限就没有「满」的概念，玩家端不画条只显示数字。 */}
      <input
        className={styles.rowInput}
        type="number"
        min={1}
        aria-label={`${at} · 上限`}
        placeholder={a.type === "number" ? "如 100" : "—"}
        disabled={a.type !== "number"}
        title={a.type === "number" ? "可选：填写后玩家端会显示进度条" : "仅 number 属性可设上限"}
        value={a.max ?? ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange({ max: e.target.value === "" || !(n > 0) ? null : n });
        }}
      />
      <label className={styles.cell}>
        <span className="sr-only">{at} · 隐藏（仅 AI 参考）</span>
        <input
          type="checkbox"
          checked={a.hidden}
          onChange={(e) => onChange({ hidden: e.target.checked })}
        />
      </label>
      <label className={styles.cell}>
        <span className="sr-only">{at} · 门控（发现前不显示）</span>
        <input
          type="checkbox"
          checked={a.reveal}
          onChange={(e) => onChange({ reveal: e.target.checked })}
        />
      </label>
      <button type="button" className={styles.rowDel} aria-label={`删除${at}`} onClick={onDel}>
        <IconTrash />
      </button>
    </div>
  );
}

// 初值输入随类型切换：number→数值、scalar→文本、set→逗号分隔（转字符串数组）。
function InitialInput({
  a,
  at,
  onChange,
}: {
  a: AttrRowData;
  at: string;
  onChange: (patch: Partial<AttrRowData>) => void;
}) {
  if (a.type === "number") {
    return (
      <input
        className={styles.rowInput}
        type="number"
        aria-label={`${at} · 初值`}
        value={typeof a.initial === "number" ? a.initial : 0}
        onChange={(e) => onChange({ initial: Number(e.target.value) })}
      />
    );
  }
  if (a.type === "set") {
    const text = Array.isArray(a.initial) ? a.initial.join("，") : "";
    return (
      <input
        className={styles.rowInput}
        aria-label={`${at} · 初值（逗号分隔）`}
        placeholder="逗号分隔"
        value={text}
        onChange={(e) =>
          onChange({
            initial: e.target.value
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />
    );
  }
  return (
    <input
      className={styles.rowInput}
      aria-label={`${at} · 初值`}
      placeholder="初始值"
      value={typeof a.initial === "string" ? a.initial : ""}
      onChange={(e) => onChange({ initial: e.target.value })}
    />
  );
}
