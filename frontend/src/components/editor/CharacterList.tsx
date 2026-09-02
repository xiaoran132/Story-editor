"use client";

import { useEditorStore } from "@/store/editorStore";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import styles from "./editor.module.css";

// 角色列表编辑：每行 name/role/desc，可增删。
// 密集重复行不逐个挂可见 label（每行三条会把表单撑成噪音），改用表头 + 每格 aria-label 带行号，
// 屏幕阅读器读到的是「第 2 行 · 姓名」，视觉上仍是一张紧凑的表。
export default function CharacterList() {
  const characters = useEditorStore((s) => s.characters);
  const addCharacter = useEditorStore((s) => s.addCharacter);
  const updateCharacter = useEditorStore((s) => s.updateCharacter);
  const removeCharacter = useEditorStore((s) => s.removeCharacter);

  return (
    <div className={styles.field}>
      <span className={styles.label}>
        角色
        <span className={styles.hint}>主角与关键 NPC</span>
      </span>
      <div className={styles.list}>
        {characters.length > 0 && (
          <div className={`${styles.charHead} ${styles.rowHead}`} aria-hidden="true">
            <span>姓名</span>
            <span>身份 / 定位</span>
            <span>性格 / 简述</span>
            <span />
          </div>
        )}
        {characters.map((c, i) => (
          <div className={styles.charRow} key={i}>
            <input
              className={styles.rowInput}
              aria-label={`第 ${i + 1} 个角色 · 姓名`}
              placeholder="姓名"
              value={c.name}
              onChange={(e) => updateCharacter(i, { name: e.target.value })}
            />
            <input
              className={styles.rowInput}
              aria-label={`第 ${i + 1} 个角色 · 身份或定位`}
              placeholder="身份 / 定位"
              value={c.role}
              onChange={(e) => updateCharacter(i, { role: e.target.value })}
            />
            <input
              className={styles.rowInput}
              aria-label={`第 ${i + 1} 个角色 · 性格或简述`}
              placeholder="性格 / 简述"
              value={c.desc}
              onChange={(e) => updateCharacter(i, { desc: e.target.value })}
            />
            <button
              type="button"
              className={styles.rowDel}
              aria-label={`删除第 ${i + 1} 个角色`}
              onClick={() => removeCharacter(i)}
            >
              <IconTrash />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={styles.btn} onClick={addCharacter}>
        <IconPlus /> 添加角色
      </button>
    </div>
  );
}
