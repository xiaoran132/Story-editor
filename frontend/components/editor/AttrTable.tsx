"use client";

import { useEditorStore } from "@/store/editorStore";
import type { AttrRowData, AttrType } from "@/lib/types";

// 属性声明表：每属性一行——键 / 类型 / 初值（随类型切控件）/ hidden / reveal / 删除。
// initial_state 由这些行在存盘时派生，保证键严格一一对应（后端严格校验的对应项）。
export default function AttrTable() {
  const attributes = useEditorStore((s) => s.attributes);
  const addAttr = useEditorStore((s) => s.addAttr);
  const updateAttr = useEditorStore((s) => s.updateAttr);
  const removeAttr = useEditorStore((s) => s.removeAttr);

  return (
    <div className="ed-field">
      <span className="ed-label">
        属性
        <span className="ed-hint">
          number 数值累加 · scalar 覆盖 · set 集合；hidden 仅 AI 参考、reveal 发现前不显示
        </span>
      </span>
      <div className="ed-list">
        {attributes.length > 0 && (
          <div className="ed-attr-head">
            <span>键名</span>
            <span>类型</span>
            <span>初值</span>
            <span>隐藏</span>
            <span>门控</span>
            <span></span>
          </div>
        )}
        {attributes.map((a, i) => (
          <AttrRow key={i} a={a} onChange={(patch) => updateAttr(i, patch)} onDel={() => removeAttr(i)} />
        ))}
      </div>
      <button className="ghost-btn ed-add" onClick={addAttr}>
        + 添加属性
      </button>
    </div>
  );
}

function AttrRow({
  a,
  onChange,
  onDel,
}: {
  a: AttrRowData;
  onChange: (patch: Partial<AttrRowData>) => void;
  onDel: () => void;
}) {
  return (
    <div className="ed-attr-row">
      <input
        className="ed-input"
        placeholder="如 生命值"
        value={a.key}
        onChange={(e) => onChange({ key: e.target.value })}
      />
      <select
        className="ed-input ed-select"
        value={a.type}
        onChange={(e) => onChange({ type: e.target.value as AttrType })}
      >
        <option value="number">number</option>
        <option value="scalar">scalar</option>
        <option value="set">set</option>
      </select>
      <InitialInput a={a} onChange={onChange} />
      <label className="ed-check">
        <input
          type="checkbox"
          checked={a.hidden}
          onChange={(e) => onChange({ hidden: e.target.checked })}
        />
      </label>
      <label className="ed-check">
        <input
          type="checkbox"
          checked={a.reveal}
          onChange={(e) => onChange({ reveal: e.target.checked })}
        />
      </label>
      <button className="ed-row-del" title="删除属性" onClick={onDel}>
        ×
      </button>
    </div>
  );
}

// 初值输入随类型切换：number→数值、scalar→文本、set→逗号分隔（转字符串数组）。
function InitialInput({
  a,
  onChange,
}: {
  a: AttrRowData;
  onChange: (patch: Partial<AttrRowData>) => void;
}) {
  if (a.type === "number") {
    return (
      <input
        className="ed-input"
        type="number"
        value={typeof a.initial === "number" ? a.initial : 0}
        onChange={(e) => onChange({ initial: Number(e.target.value) })}
      />
    );
  }
  if (a.type === "set") {
    const text = Array.isArray(a.initial) ? a.initial.join("，") : "";
    return (
      <input
        className="ed-input"
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
      className="ed-input"
      placeholder="初始值"
      value={typeof a.initial === "string" ? a.initial : ""}
      onChange={(e) => onChange({ initial: e.target.value })}
    />
  );
}
