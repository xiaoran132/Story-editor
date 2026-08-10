"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  PLAY_STAGES,
  type LLMConnection,
  type RecommendedModels,
  type StoryLLMConfig,
} from "@/lib/types";
import { useToast } from "@/components/Toast";

// 作品详情页的「本作品 AI 配置」面板：展示作者推荐模型 + 玩家为本作品各环节选自己的连接+模型。
// 连接是账号级（/me 管），此处只选「用哪个」。未登录则提示回退平台额度。
export default function StoryLLMConfigPanel({
  storyId,
  recommended,
  loggedIn,
}: {
  storyId: string;
  recommended: RecommendedModels;
  loggedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [conns, setConns] = useState<LLMConnection[]>([]);
  const [loading, setLoading] = useState(true); // 同上：在途时别劝用户去添加其实已存在的连接
  const [cfg, setCfg] = useState<StoryLLMConfig>({});
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
    Promise.all([
      api.get<LLMConnection[]>("/llm/connections"),
      api.get<StoryLLMConfig>(`/llm/story-config/${storyId}`),
    ])
      .then(([c, sc]) => {
        setConns(c || []);
        setCfg(sc || {});
        (["write", "review"] as const).forEach((st) => {
          const id = sc?.[st]?.conn;
          if (id) fetchModels(id);
        });
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, storyId]);

  const setStage = (stage: "write" | "review", patch: Partial<{ conn: string; model: string }>) => {
    setCfg((c) => ({ ...c, [stage]: { conn: "", model: "", ...c[stage], ...patch } }));
    if (patch.conn) fetchModels(patch.conn);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const clean: StoryLLMConfig = {};
      (["write", "review"] as const).forEach((st) => {
        if (cfg[st]?.conn) clean[st] = cfg[st]!;
      });
      const saved = await api.put<StoryLLMConfig>(`/llm/story-config/${storyId}`, clean);
      setCfg(saved || {});
      flash("本作品 AI 配置已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hasRec = !!(recommended.write?.model || recommended.review?.model);

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
              　（仅供参考，用你自己的连接游玩）
            </p>
          )}
          {error && <p className="od-note" style={{ color: "#f0a3a3" }}>出错：{error}</p>}

          {!loggedIn ? (
            <p className="od-note">登录后可为本作品配置自己的模型；当前将使用平台额度游玩。</p>
          ) : loading ? (
            <p className="od-note pulse">载入你的连接…</p>
          ) : conns.length === 0 ? (
            <p className="od-note">
              你还没有 LLM 连接。先到「个人主页 → AI 连接」添加，再回来为本作品选模型；未配置将用平台额度。
            </p>
          ) : (
            <>
              {PLAY_STAGES.map((st) => {
                const b = cfg[st.key] || { conn: "", model: "" };
                const models = b.conn ? modelsByConn[b.conn] || [] : [];
                const listId = `models-${st.key}`;
                const connId = `conn-${st.key}`;
                const modelId = `model-${st.key}`;
                return (
                  <div className="od-fld" key={st.key}>
                    {/* label 原本是兄弟节点、既不含 htmlFor 也不包裹控件 —— 两个控件都没有可访问名。
                        环节名作组标题，两个控件各自再给 aria-label 区分连接/模型。 */}
                    <label htmlFor={connId}>{st.label}</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <select id={connId} className="od-sel" value={b.conn}
                        aria-label={`${st.label} · 连接`}
                        onChange={(e) => setStage(st.key, { conn: e.target.value, model: "" })}>
                        <option value="">（回退平台）</option>
                        {conns.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <input id={modelId} className="od-inp" value={b.model} list={listId} disabled={!b.conn}
                        aria-label={`${st.label} · 模型`}
                        placeholder={b.conn ? "选择或手填模型" : "先选连接"}
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
              {/* 本屏唯一主 CTA 是「开始新游戏」，配置保存降为次级（§7 每屏一个主按钮） */}
              <button className="btn-read ghost" style={{ height: 40 }} disabled={busy} onClick={save}>
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
