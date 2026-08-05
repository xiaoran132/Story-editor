"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  PLAY_STAGES,
  type LLMConnection,
  type RecommendedModels,
  type StoryLLMConfig,
} from "@/lib/types";

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
  const [cfg, setCfg] = useState<StoryLLMConfig>({});
  const [modelsByConn, setModelsByConn] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchModels = (connId: string) => {
    if (!connId || modelsByConn[connId]) return;
    api
      .get<{ models: string[] }>(`/llm/connections/${connId}/models`)
      .then((r) => setModelsByConn((m) => ({ ...m, [connId]: r.models || [] })))
      .catch(() => setModelsByConn((m) => ({ ...m, [connId]: [] }))); // 拉不到→空，仍可手填
  };

  useEffect(() => {
    if (!loggedIn) return;
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
      .catch((e) => setError((e as Error).message));
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
      setToast("本作品 AI 配置已保存");
      setTimeout(() => setToast(null), 2200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hasRec = !!(recommended.write?.model || recommended.review?.model);

  return (
    <section className="detail-block">
      <button className="llm-panel-toggle" onClick={() => setOpen((o) => !o)}>
        本作品 AI 配置 {open ? "▾" : "▸"}
      </button>

      {open && (
        <div className="llm-panel">
          {hasRec && (
            <p className="me-desc">
              作者推荐：
              {recommended.write?.model && <span className="ed-hint">续写 {recommended.write.model}　</span>}
              {recommended.review?.model && <span className="ed-hint">审校 {recommended.review.model}</span>}
              <span className="ed-hint">（仅供参考，用你自己的连接游玩）</span>
            </p>
          )}
          {error && <div className="status err">出错：{error}</div>}

          {!loggedIn ? (
            <p className="me-desc">登录后可为本作品配置自己的模型；当前将使用平台额度游玩。</p>
          ) : conns.length === 0 ? (
            <p className="me-desc">
              你还没有 LLM 连接。先到「个人主页 → AI 连接」添加，再回来为本作品选模型；未配置将用平台额度。
            </p>
          ) : (
            <>
              <p className="ed-hint">选连接后模型可下拉选择，也可手填。</p>
              {PLAY_STAGES.map((st) => {
                const b = cfg[st.key] || { conn: "", model: "" };
                const models = b.conn ? modelsByConn[b.conn] || [] : [];
                const listId = `models-${st.key}`;
                return (
                  <div className="llm-bind-row" key={st.key}>
                    <div className="llm-bind-label">
                      <span className="ed-label">{st.label}</span>
                      <span className="ed-hint">{st.desc}</span>
                    </div>
                    <div className="llm-bind-fields">
                      <select className="ed-input ed-select" value={b.conn}
                        onChange={(e) => setStage(st.key, { conn: e.target.value, model: "" })}>
                        <option value="">（回退平台）</option>
                        {conns.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <input className="ed-input" value={b.model} list={listId} disabled={!b.conn}
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
              <button className="primary-btn" disabled={busy} onClick={save}>
                {busy ? "保存中…" : "保存本作品配置"}
              </button>
            </>
          )}
          {toast && <div className="ed-toast">{toast}</div>}
        </div>
      )}
    </section>
  );
}
