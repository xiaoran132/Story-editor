"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  PLAY_STAGES,
  formatCredit,
  type LLMConnection,
  type RecommendedModels,
  type StageBindings,
  type StoryLLMConfig,
} from "@/lib/types";
import Switch from "@/components/Switch";
import { useToast } from "@/components/Toast";

// 作品详情页的「本作品 AI 配置」面板。
//
// 模型有两个来源：**平台额度**（注册赠 1 元，用尽即止）与**自己的连接**（不花额度）。
// 连接是账号级的（在 /me 管），这里只选「本作品用哪个」。
// 未登录不渲染这套表单——额度挂在账号上，没账号就没有可选项。
export default function StoryLLMConfigPanel({
  storyId,
  recommended,
  loggedIn,
  cfg,
  onCfgChange,
}: {
  storyId: string;
  recommended: RecommendedModels;
  loggedIn: boolean;
  cfg: StoryLLMConfig | null; // 由详情页持有：CTA 的禁用状态与这里的编辑结果必须同源
  onCfgChange: (next: StoryLLMConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [conns, setConns] = useState<LLMConnection[]>([]);
  const [loading, setLoading] = useState(true); // 在途时别劝用户去添加其实已存在的连接
  const [draft, setDraft] = useState<StageBindings>({});
  const [reviewOn, setReviewOn] = useState(false);
  const [modelsByConn, setModelsByConn] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show: flash, node: toastNode } = useToast();

  const fetchModels = (connId: string) => {
    if (!connId || modelsByConn[connId]) return;
    api
      .get<{ models: string[] }>(`/llm/connections/${connId}/models`)
      .then((r) => setModelsByConn((m) => ({ ...m, [connId]: r.models || [] })))
      .catch(() => setModelsByConn((m) => ({ ...m, [connId]: [] }))); // 拉不到→空，仍可手填
  };

  useEffect(() => {
    if (!loggedIn) {
      setLoading(false);
      return;
    }
    api
      .get<LLMConnection[]>("/llm/connections")
      .then((c) => setConns(c || []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [loggedIn]);

  // 服务端配置到达/变化后同步进本地草稿（详情页负责拉取，这里只编辑）。
  useEffect(() => {
    if (!cfg) return;
    setDraft(cfg.bindings || {});
    setReviewOn(cfg.review_enabled);
    (["write", "review"] as const).forEach((st) => {
      const id = cfg.bindings?.[st]?.conn;
      if (id) fetchModels(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  const setStage = (stage: "write" | "review", patch: Partial<{ conn: string; model: string }>) => {
    setDraft((d) => ({ ...d, [stage]: { conn: "", model: "", ...d[stage], ...patch } }));
    if (patch.conn) fetchModels(patch.conn);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const bindings: StageBindings = {};
      (["write", "review"] as const).forEach((st) => {
        if (draft[st]?.conn) bindings[st] = draft[st]!;
      });
      const saved = await api.put<StoryLLMConfig>(`/llm/story-config/${storyId}`, {
        bindings,
        review_enabled: reviewOn,
      });
      onCfgChange(saved); // 回传给详情页：CTA 的禁用状态要跟着一起解开
      flash("本作品 AI 配置已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hasRec = !!(recommended.write?.model || recommended.review?.model);
  const credit = cfg?.credit_micro_cny ?? 0;
  const platformReady = !!cfg?.platform_ready;
  // 开着审校却没给它选连接 → 后端会拒（不静默降级），这里先禁用保存并说明。
  const reviewIncomplete = reviewOn && !draft.review?.conn;

  return (
    <div className="od-settings">
      <button className="od-stog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3v3M12 18v3M5 12H2m20 0h-3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2" />
        </svg>
        选择本次游玩的 AI 模型
        <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="od-sbody">
          {hasRec && (
            <p className="od-note">
              <span className="rec">作者推荐</span>
              {recommended.write?.model && <> 续写 {recommended.write.model}</>}
              {recommended.review?.model && <>　审校 {recommended.review.model}</>}
              　（仅供参考，不会自动套用）
            </p>
          )}
          {error && <p className="od-note" style={{ color: "var(--read-err-ink)" }} role="alert">出错：{error}</p>}

          {!loggedIn ? (
            <p className="od-note">登录即赠 1 元体验额度，可直接用平台模型开玩；也可以配置自己的连接。</p>
          ) : loading || !cfg ? (
            <p className="od-note pulse">载入你的连接…</p>
          ) : (
            <>
              <p className="od-note">
                平台体验额度剩余 <b>{formatCredit(credit)}</b>
                {credit > 0
                  ? "。不选连接即用平台额度，按实际用量扣减；用尽后需配置自己的连接。"
                  : "。已用尽——请为「续写」选择一条自己的连接后继续。"}
              </p>

              {conns.length === 0 && (
                <p className="od-note">
                  你还没有自己的 LLM 连接。到「个人主页 → AI 连接」添加一条，额度用尽后就不会被打断。
                </p>
              )}

              {PLAY_STAGES.map((st) => {
                if (st.key === "review" && !reviewOn) return null; // 关掉就整行不出现，比禁用更清楚
                const b = draft[st.key] || { conn: "", model: "" };
                const models = b.conn ? modelsByConn[b.conn] || [] : [];
                const listId = `models-${st.key}`;
                const connId = `conn-${st.key}`;
                const modelId = `model-${st.key}`;
                return (
                  <div className="od-fld" key={st.key}>
                    {/* 环节名作组标题，两个控件各自再给 aria-label 区分连接/模型 */}
                    <label htmlFor={connId}>
                      {st.label}
                      {st.key === "review" && <span className="od-req">（已开启审校，必选）</span>}
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <select id={connId} className="od-sel" value={b.conn}
                        aria-label={`${st.label} · 连接`}
                        onChange={(e) => setStage(st.key, { conn: e.target.value, model: "" })}>
                        {/* 「平台」独立成组：让玩家看见这条路存在，也看见它现在通不通 */}
                        <optgroup label="平台">
                          <option value="" disabled={!platformReady}>
                            {platformReady
                              ? `平台额度（剩余 ${formatCredit(credit)}）`
                              : credit > 0
                                ? "平台额度（该环节未开放）"
                                : "平台额度（已用尽）"}
                          </option>
                        </optgroup>
                        {conns.length > 0 && (
                          <optgroup label="我的连接（不花额度）">
                            {conns.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <input id={modelId} className="od-inp" value={b.model} list={listId} disabled={!b.conn}
                        aria-label={`${st.label} · 模型`}
                        placeholder={b.conn ? "选择或手填模型" : "用平台默认模型"}
                        onChange={(e) => setStage(st.key, { model: e.target.value })} />
                      <datalist id={listId}>
                        {models.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                );
              })}

              <div className="od-fld">
                {/* Switch 自身的 label 是 sr-only（供读屏），可见标题要在这里给 */}
                <div className="od-switch-row">
                  <span className="od-switch-title">质量审校</span>
                  <Switch checked={reviewOn} onChange={setReviewOn} label="质量审校" />
                </div>
                <p className="od-note" style={{ margin: 0 }}>
                  开启后每段正文再过一遍低温校验，盯的是「属性变化与正文不符」「前情提要漏记新人物」
                  这类会毁掉长剧情的问题（真实拒绝率约 18%）。代价是 token 大约翻倍，且需要为它单独选一条连接。
                </p>
              </div>

              {reviewIncomplete && (
                <p className="od-note" style={{ color: "var(--read-err-ink)" }} role="alert">
                  开启了审校但没为它选连接。请选一条，或关掉这个开关。
                </p>
              )}

              {/* 本屏唯一主 CTA 是「开始新游戏」，配置保存降为次级（DESIGN §7 每屏一个主按钮） */}
              <button
                className="btn-read ghost"
                style={{ height: 40 }}
                disabled={busy || reviewIncomplete}
                onClick={save}
              >
                {busy ? "保存中…" : "保存本作品配置"}
              </button>
            </>
          )}
          {toastNode}
        </div>
      )}
    </div>
  );
}
