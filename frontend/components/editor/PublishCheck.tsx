"use client";

import { useEditorStore } from "@/store/editorStore";

// 发布检查清单（原型 create-editor.html:292-302）。
//
// 这里镜像的是 `backend/pkg/worldvalidate.go` 的 **strict** 规则 + `SetStatus` 的标题校验。
// 目的不是替代后端校验（后端才是硬防线），而是让作者**在点发布之前**就知道差什么——
// 现在的做法是点了发布、等一个后端错误码，还只报第一条。
//
// ⚠️ 两边规则必须同步：改 worldvalidate.go 的 strict 分支时，这里要跟着改。
export interface CheckItem {
  ok: boolean;
  label: string;
  fix: string; // 没通过时告诉作者去哪补
}

export function usePublishChecks(): CheckItem[] {
  const s = useEditorStore();
  const attrs = s.attributes.filter((a) => a.key.trim());
  return [
    { ok: s.title.trim() !== "", label: "作品标题", fix: "② 世界观 · 标题" },
    { ok: s.background.trim() !== "", label: "世界观背景", fix: "② 世界观 · 背景" },
    { ok: s.style.trim() !== "", label: "风格基调", fix: "② 世界观 · 风格" },
    { ok: s.rules.trim() !== "", label: "玩法规则", fix: "② 世界观 · 规则" },
    { ok: s.outline.trim() !== "", label: "故事大纲", fix: "② 世界观 · 大纲" },
    {
      ok: s.characters.some((c) => c.name.trim()),
      label: "至少一个角色",
      fix: "② 世界观 · 角色",
    },
    {
      // 属性可以一个都不要；但只要写了，键名就不能空——空键在后端会被判定为
      // 「initial_state 与 attributes 不对应」，报错信息作者很难看懂。
      ok: attrs.length === s.attributes.length,
      label: "属性键名均已填写",
      fix: "② 世界观 · 属性表",
    },
  ];
}

export default function PublishCheck({ checks }: { checks: CheckItem[] }) {
  const failed = checks.filter((c) => !c.ok);
  return (
    <div className="ed-field">
      <span className="ed-label">
        发布检查
        <span className="ed-hint">
          {failed.length === 0 ? "全部通过，可以发布" : `还差 ${failed.length} 项`}
        </span>
      </span>
      <ul className="check">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? "ok" : "no"}>
            <span className="mk" aria-hidden="true">
              {c.ok ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              )}
            </span>
            {c.label}
            {!c.ok && <em>去 {c.fix} 补</em>}
          </li>
        ))}
      </ul>
    </div>
  );
}
