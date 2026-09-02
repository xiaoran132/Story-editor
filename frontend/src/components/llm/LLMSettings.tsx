"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { LLM_PROVIDERS, type LLMConnection, type TestResult } from "@/lib/types";
import { IconPlus } from "@/components/ui/icons";
import Dialog from "@/components/ui/Dialog";
import Dropdown from "@/components/ui/Dropdown";
import styles from "./LLMSettings.module.css";

// BYOK 连接管理（账号级）：增删改多个 LLM 连接（供应商/base_url/key/默认模型）。
// 各作品用哪个模型在「作品详情页」按作品单独配（此处只管连接本身）。key 只写不回显。
type ConnForm = {
  id: string | null; // null=新建
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  models: string[]; // 已选模型；没有「默认模型」，这里是一组
};

const EMPTY_FORM: ConnForm = {
  id: null,
  name: "",
  provider: "deepseek",
  base_url: "https://api.deepseek.com",
  api_key: "",
  models: [],
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
  // 端点拉回来的候选。null=还没拉过（与「拉到了但一个都没有」是两回事，提示语不同）。
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [manual, setManual] = useState("");

  const load = () => api.get<LLMConnection[]>("/llm/connections").then((c) => setConns(c || []));

  useEffect(() => {
    load()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // 换供应商只回填 base_url。模型不再猜——它要么从端点拉，要么用户手填。
  const pickProvider = (p: string) => {
    const preset = LLM_PROVIDERS.find((x) => x.key === p);
    setForm((f) => (f ? { ...f, provider: p, base_url: preset?.baseURL ?? f.base_url } : f));
  };

  const openNew = () => {
    setError(null);
    setFetched(null);
    setManual("");
    setForm({ ...EMPTY_FORM });
  };
  const openEdit = (c: LLMConnection) => {
    setError(null);
    setFetched(null);
    setManual("");
    setForm({ id: c.id, name: c.name, provider: c.provider, base_url: c.base_url, api_key: "", models: c.models || [] });
  };

  // 拉模型：连接可能还没保存，所以走 POST（带表单里现填的 base_url/api_key）；
  // 编辑态没重填 key 时带上 connection_id，让后端用存量 key。
  const probeModels = async () => {
    if (!form) return;
    setProbing(true);
    setError(null);
    try {
      const r = await api.post<{ models: string[] }>("/llm/connections/models", {
        connection_id: form.id || undefined,
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
      });
      setFetched(r.models || []);
    } catch (e) {
      setFetched(null);
      setError((e as Error).message + "（该服务可能不提供模型列表，可在下方手动填写）");
    } finally {
      setProbing(false);
    }
  };

  const toggleModel = (m: string) =>
    setForm((f) =>
      f ? { ...f, models: f.models.includes(m) ? f.models.filter((x) => x !== m) : [...f.models, m] } : f
    );

  const addManual = () => {
    const m = manual.trim();
    if (!m) return;
    setForm((f) => (f && !f.models.includes(m) ? { ...f, models: [...f.models, m] } : f));
    setManual("");
  };

  const saveConn = async () => {
    if (!form) return;
    if (form.models.length === 0) {
      setError("请至少选择一个模型：使用「拉取模型」获取，或在下方手动填写。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        provider: form.provider,
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
        models: form.models,
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
        model: form.models[0] || "", // ping 要一个具体模型，取第一个即可（不是默认模型）
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
        添加你自己的 LLM 连接（支持任意 OpenAI 兼容服务；API Key 加密存储，保存后不再显示）。
        <span className="wx-hint">每部作品使用哪个模型，在该作品详情页单独设置；此处仅管理连接本身。</span>
      </p>
      {/* 弹窗打开时错误改在弹窗内显示——留在这里会被遮罩挡住，用户只会看到「保存」毫无反应 */}
      {error && form === null && <div className="wx-err" role="alert">出错：{error}</div>}

      {/* 连接列表 */}
      <div className={styles.list}>
        {loading ? (
          <div className={`wx-hint ${styles.loading}`}>载入连接…</div>
        ) : (
          conns.length === 0 && !error && <div className="wx-hint">还没有连接，请先添加一条。</div>
        )}
        {conns.map((c) => (
          <div className={styles.row} key={c.id}>
            <div className={styles.meta}>
              <span className={styles.name}>{c.name}</span>
              <span className={styles.badge}>{providerLabel(c.provider)}</span>
              <span className="wx-hint">
                {c.models?.length ? c.models.slice(0, 2).join(" / ") : "未选模型"}
                {c.models?.length > 2 ? ` 等 ${c.models.length} 个` : ""}
              </span>
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
        desc="支持任意 OpenAI 兼容服务。API Key 加密存储，保存后不再显示。"
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
              <Dropdown
                value={form.provider}
                onChange={pickProvider}
                ariaLabel="供应商"
                entries={LLM_PROVIDERS.map((p) => ({ value: p.key, label: p.label }))}
              />
            </label>
            <label className="wx-field">
              <span className="wx-label">Base URL</span>
              <input className="wx-input" value={form.base_url} placeholder="https://api.example.com/v1"
                onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </label>
            {/* 可用模型：拉取为主、手填兜底。不少 OpenAI 兼容端点（自建、代理）
                根本不实现 /models，硬性要求能拉到等于把它们排除在外。 */}
            <div className="wx-field">
              <span className="wx-label">
                可用模型
                <span className="wx-hint">（在作品里按环节选用哪个，这里只决定有哪些可选）</span>
              </span>
              <div className={styles.modelBar}>
                <button className="wx-btn sm" type="button" disabled={probing} onClick={probeModels}>
                  {probing ? "拉取中…" : "拉取模型"}
                </button>
                <input className="wx-input" value={manual} placeholder="或手动输入模型名后回车"
                  onChange={(e) => setManual(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManual();
                    }
                  }} />
                <button className="wx-btn sm" type="button" disabled={!manual.trim()} onClick={addManual}>
                  添加
                </button>
              </div>

              {fetched !== null && (
                fetched.length === 0 ? (
                  <p className="wx-hint">该服务未返回任何模型，请手动填写。</p>
                ) : (
                  <div className={styles.modelPick}>
                    {fetched.map((m) => (
                      <label className={styles.modelOpt} key={m}>
                        <input type="checkbox" checked={form.models.includes(m)}
                          onChange={() => toggleModel(m)} />
                        <span>{m}</span>
                      </label>
                    ))}
                  </div>
                )
              )}

              {form.models.length > 0 ? (
                <div className={styles.chips}>
                  {form.models.map((m) => (
                    <span className={styles.chip} key={m}>
                      {m}
                      <button type="button" aria-label={`移除 ${m}`} onClick={() => toggleModel(m)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="wx-hint">请至少选择一个模型后再保存。</p>
              )}
            </div>
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
