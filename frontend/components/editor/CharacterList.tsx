"use client";

import { useEditorStore } from "@/store/editorStore";

// 角色列表编辑：每行 name/role/desc，可增删。复用 .ed-* 表单语汇。
export default function CharacterList() {
  const characters = useEditorStore((s) => s.characters);
  const addCharacter = useEditorStore((s) => s.addCharacter);
  const updateCharacter = useEditorStore((s) => s.updateCharacter);
  const removeCharacter = useEditorStore((s) => s.removeCharacter);

  return (
    <div className="ed-field">
      <span className="ed-label">
        角色
        <span className="ed-hint">主角与关键 NPC</span>
      </span>
      <div className="ed-list">
        {characters.map((c, i) => (
          <div className="ed-char-row" key={i}>
            <input
              className="ed-input"
              placeholder="姓名"
              value={c.name}
              onChange={(e) => updateCharacter(i, { name: e.target.value })}
            />
            <input
              className="ed-input"
              placeholder="身份 / 定位"
              value={c.role}
              onChange={(e) => updateCharacter(i, { role: e.target.value })}
            />
            <input
              className="ed-input"
              placeholder="性格 / 简述"
              value={c.desc}
              onChange={(e) => updateCharacter(i, { desc: e.target.value })}
            />
            <button
              className="ed-row-del"
              title="删除角色"
              onClick={() => removeCharacter(i)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="ghost-btn ed-add" onClick={addCharacter}>
        + 添加角色
      </button>
    </div>
  );
}
