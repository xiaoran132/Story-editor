"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AssistConfig, LLMConnection } from "@/lib/types";
import styles from "./AssistModelSettings.module.css";

// 创作辅助（world 环节）用哪个模型 —— **账号级**，在这里配一次，编辑器全程用它。
//
// 为什么不放编辑器里：那里曾有一个临时下拉，但它只在第 1 段出现，而段落可任意跳转
// （DESIGN.md §7.7），作者直奔第 4 段用「AI 生成开场 / 精品润色」时既看不到也改不了；
// 它也从不持久，每次进编辑器都回到默认。同一个创作者在所有作品里用同一套辅助模型，
// 本就是账号级偏好。
export default function AssistModelSettings({ flash }: { flash: (m: string) => void }) {
  const [conns, setConns] = useState<LLMConnection[]>([]);
  const [cfg, setCfg] = useState<AssistConfig | null>(null);
  const [pick, setPick] = useState(""); // "" = 平台档；否则 "<connId>::<model>"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<LLMConnection[]>("/llm/connections"),
      api.get<AssistConfig>("/llm/assist-config"),
    ])
      .then(([cs, ac]) => {
        setConns(cs || []);
        setCfg(ac);
        setPick(ac.conn ? `${ac.conn}::${ac.model}` : "");
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const i = pick.indexOf("::");
      const body = i < 0 ? { conn: "", model: "" } : { conn: pick.slice(0, i), model: pick.slice(i + 2) };
      setCfg(await api.put<AssistConfig>("/llm/assist-config", body));
      flash("创作辅助模型已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) {
    return <p className="wx-hint">{error ? `出错：${error}` : "载入中…"}</p>;
  }

  // 已保存的模型可能已被移出该连接的列表；补一条，否则 select 的当前值无对应项，
  // 浏览器会静默显示成第一项，看起来像配置被改掉了。
  const bound = conns.find((c) => c.id === cfg.conn);
  const orphan = !!cfg.conn && !!bound && !(bound.models || []).includes(cfg.model);
  const dirty = pick !== (cfg.conn ? `${cfg.conn}::${cfg.model}` : "");

  return (
    <>
      {error && <p className="wx-err" role="alert">出错：{error}</p>}
      <div className={styles.row}>
        <select className={styles.sel} value={pick} aria-label="创作辅助模型"
          onChange={(e) => setPick(e.target.value)}>
          {/* 平台档永不禁用：不接自己的连接本就是合法的默认状态 */}
          <optgroup label="平台">
            <option value="">
              {`平台预设${cfg.platform.model ? ` · ${cfg.platform.model}` : ""}${
                cfg.platform.ready ? "" : cfg.platform.model ? "（额度已用尽）" : "（未配置）"
              }`}
            </option>
          </optgroup>
          {conns.map((c) => {
            const ms = c.models || [];
            if (ms.length === 0 && !(orphan && c.id === cfg.conn)) return null;
            return (
              <optgroup key={c.id} label={c.name}>
                {orphan && c.id === cfg.conn && (
                  <option value={`${cfg.conn}::${cfg.model}`}>{cfg.model}（已移出列表）</option>
                )}
                {ms.map((m) => (
                  <option key={m} value={`${c.id}::${m}`}>{m}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <button className="wx-btn sm" type="button" disabled={busy || !dirty} onClick={save}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </>
  );
}
