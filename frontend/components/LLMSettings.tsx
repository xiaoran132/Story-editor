"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { LLM_PROVIDERS, type LLMConnection, type TestResult } from "@/lib/types";
import { IconPlus } from "@/components/icons";
import Dialog from "@/components/Dialog";
import styles from "./LLMSettings.module.css";

// BYOK 连接管理（账号级）：增删改多个 LLM 连接（供应商/base_url/key/默认模型）。
// 各作品用哪个模型在「作品详情页」按作品单独配（此处只管连接本身）。key 只写不回显。
type ConnForm = {
  id: string | null; // null=新建
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  default_model: string;
};

const EMPTY_FORM: ConnForm = {
  id: null,
  name: "",
  provider: "deepseek",
  base_url: "https://api.deepseek.com",
  api_key: "",
  default_model: "deepseek-chat",
};

// 供应商机器值 → 友好名（deepseek → DeepSeek）；未知回落原值。
const providerLabel = (p: string) =>
  LLM_PROVIDERS.find((x) => x.key === p)?.label ?? p;

export default function LLMSettings({ flash }: { flash: (m: string) => void }) {
  const [conns, setConns] = useState<LLMConnection[]>([]);
  const [loading, setLoading] = useState(true); // 未加载完不能说「还没有连接」——那是假空态
  const [form, setForm] = useState<ConnForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<LLMConnection[]>("/llm/connections").then((c) => setConns(c || []));

  useEffect(() => {
    load()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const pickProvider = (p: string) => {
    const preset = LLM_PROVIDERS.find((x) => x.key === p);
    setForm((f) =>
      f ? { ...f, provider: p, base_url: preset?.baseURL ?? f.base_url, default_model: preset?.model || f.default_model } : f
    );
  };

  const openNew = () => {
    setError(null);
    setForm({ ...EMPTY_FORM });
  };
  const openEdit = (c: LLMConnection) => {
    setError(null);
    setForm({ id: c.id, name: c.name, provider: c.provider, base_url: c.base_url, api_key: "", default_model: c.default_model });
  };

  const saveConn = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        provider: form.provider,
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
        default_model: form.default_model.trim(),
      };
      if (form.id) await api.put(`/llm/connections/${form.id}`, body);
      else await api.post("/llm/connections", body);
      await load();
      setForm(null);
      flash(form.id ? "连接已更新" : "连接已添加");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const delConn = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.del(`/llm/connections/${id}`);
      await load();
      flash("连接已删除");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testForm = async () => {
    if (!form) return;
    setTesting(true);
    setError(null);
    try {
      const r = await api.post<TestResult>("/llm/connections/test", {
        connection_id: form.id || undefined, // 编辑时未重填 key 则用存量 key
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
        model: form.default_model.trim(),
      });
      flash(r.ok ? "连接成功，配置可用" : `不可用：${r.detail || "鉴权失败"}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <section>
      <span className={styles.eyebrow}>AI 连接（BYOK）</span>
      <p className={styles.desc}>
        添加你自己的 LLM 连接（任意 OpenAI 兼容端点，key 加密存储、绝不回显）。
        <span className="wx-hint">每部作品「用哪个模型」在作品详情页里单独配；这里只管连接本身。</span>
      </p>
      {/* 弹窗打开时错误改在弹窗内显示——留在这里会被遮罩挡住，用户只会看到「保存」毫无反应 */}
      {error && form === null && <div className="wx-err" role="alert">出错：{error}</div>}

      {/* 连接列表 */}
      <div className={styles.list}>
        {loading ? (
          <div className={`wx-hint ${styles.loading}`}>载入连接…</div>
        ) : (
          conns.length === 0 && !error && <div className="wx-hint">还没有连接，添加一个开始。</div>
        )}
        {conns.map((c) => (
          <div className={styles.row} key={c.id}>
            <div className={styles.meta}>
              <span className={styles.name}>{c.name}</span>
              <span className={styles.badge}>{providerLabel(c.provider)}</span>
              <span className="wx-hint">{c.default_model}</span>
              {c.has_key && <span className="wx-hint">{c.key_hint}</span>}
            </div>
            <div className={styles.ops}>
              <button className="wx-btn sm" onClick={() => openEdit(c)} disabled={busy}>
                编辑
              </button>
              <button className="wx-btn quiet sm danger" onClick={() => delConn(c.id)} disabled={busy}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="wx-btn sm" onClick={openNew}>
        <IconPlus /> 添加连接
      </button>

      {/* 原型（settings.html:186-200）这里是模态对话框；此前用内联表单顶替，
          展开时会把下方内容整块推走。Dialog 自带焦点陷阱 / Esc / 背景滚动锁定。 */}
      <Dialog
        open={form !== null}
        title={form?.id ? "编辑连接" : "添加连接"}
        desc="任意 OpenAI 兼容端点。Key 加密存储、绝不回显。"
        labelledBy="conn-dialog-title"
        onClose={() => setForm(null)}
        actions={
          <>
            <button className="wx-btn sm" disabled={testing || busy} onClick={testForm}>
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button className="wx-btn quiet sm" disabled={busy} onClick={() => setForm(null)}>
              取消
            </button>
            <button className="wx-btn strong sm" disabled={busy} onClick={saveConn}>
              {busy ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        {form && (
          <>
            {error && <div className="wx-err" role="alert" style={{ marginBottom: 12 }}>出错：{error}</div>}
            <label className="wx-field">
              <span className="wx-label">名称</span>
              <input className="wx-input" value={form.name} placeholder="如 我的 DeepSeek"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="wx-field">
              <span className="wx-label">供应商</span>
              <select className="wx-select" value={form.provider} onChange={(e) => pickProvider(e.target.value)}>
                {LLM_PROVIDERS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="wx-field">
              <span className="wx-label">Base URL</span>
              <input className="wx-input" value={form.base_url} placeholder="https://api.example.com/v1"
                onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </label>
            <label className="wx-field">
              <span className="wx-label">默认模型</span>
              <input className="wx-input" value={form.default_model} placeholder="如 deepseek-chat"
                onChange={(e) => setForm({ ...form, default_model: e.target.value })} />
            </label>
            <label className="wx-field">
              <span className="wx-label">API Key {form.id && <span className="wx-hint">（留空则保留原 key）</span>}</span>
              <input className="wx-input" type="password" value={form.api_key} placeholder="sk-..." autoComplete="off"
                onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            </label>
          </>
        )}
      </Dialog>
    </section>
  );
}
