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
  step: number; // 缺这项该去第几步补（驱动「去补 →」回跳与左侧步骤的完成态）
}

export function usePublishChecks(): CheckItem[] {
  const s = useEditorStore();
  const attrs = s.attributes.filter((a) => a.key.trim());
  return [
    { ok: s.title.trim() !== "", label: "作品标题", step: 1 },
    { ok: s.background.trim() !== "", label: "世界观背景", step: 1 },
    { ok: s.style.trim() !== "", label: "风格基调", step: 1 },
    { ok: s.rules.trim() !== "", label: "玩法规则", step: 1 },
    { ok: s.outline.trim() !== "", label: "故事大纲", step: 1 },
    { ok: s.characters.some((c) => c.name.trim()), label: "至少一个角色", step: 1 },
    {
      // 属性可以一个都不要；但只要写了，键名就不能空——空键在后端会被判定为
      // 「initial_state 与 attributes 不对应」，报错信息作者很难看懂。
      ok: attrs.length === s.attributes.length,
      label: "属性键名均已填写",
      step: 2,
    },
  ];
}

export default function PublishCheck({
  checks,
  onJump,
}: {
  checks: CheckItem[];
  onJump: (step: number) => void;
}) {
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
            {!c.ok && (
              <button type="button" className="btn ghost sm fix" onClick={() => onJump(c.step)}>
                去补
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
