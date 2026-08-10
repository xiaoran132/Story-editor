"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import AppHeader from "@/components/AppHeader";
import { IconChevronLeft } from "@/components/icons";
import { useToast } from "@/components/Toast";
import {
  LLM_PROVIDERS,
  LLM_STAGES,
  type PlatformSetting,
  type TestResult,
} from "@/lib/types";

// 平台 LLM 设置（仅管理员）：每个生成环节配一套 provider/base_url/key/model，作为用户未配时的回退。
// 权限双保险：前端按 role 守卫 + 后端 RequireAdmin。第一个 admin 靠手动改库提权后重新登录。
type Row = { stage: string; provider: string; base_url: string; api_key: string; model: string; has_key: boolean; key_hint: string };

export default function AdminPage() {
  const router = useRouter();
  const initAuth = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { show: flash, node: toastNode } = useToast();

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // 守卫：无 token 或非 admin 一律回首页（后端也会 403，这里先做体验层拦截）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("token")) {
      router.replace("/");
      return;
    }
    if (user && user.role !== "admin") router.replace("/");
  }, [user, router]);

  useEffect(() => {
    api
      .get<PlatformSetting[]>("/admin/llm/platform")
      .then((list) =>
        setRows(list.map((p) => ({ ...p, api_key: "" })))
      )
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const patch = (stage: string, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.stage === stage ? { ...r, ...p } : r)));

  const pickProvider = (stage: string, prov: string) => {
    const preset = LLM_PROVIDERS.find((x) => x.key === prov);
    patch(stage, { provider: prov, base_url: preset?.baseURL ?? "", model: preset?.model ?? "" });
  };

  const save = async (r: Row) => {
    setBusy(r.stage);
    setError(null);
    try {
      const saved = await api.put<PlatformSetting>("/admin/llm/platform", {
        stage: r.stage,
        provider: r.provider,
        base_url: r.base_url.trim(),
        api_key: r.api_key.trim(),
        model: r.model.trim(),
      });
      patch(r.stage, { ...saved, api_key: "" });
      flash("已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const test = async (r: Row) => {
    setBusy(r.stage);
    setError(null);
    try {
      const res = await api.post<TestResult>("/admin/llm/platform/test", {
        base_url: r.base_url.trim(),
        api_key: r.api_key.trim(),
        model: r.model.trim(),
      });
      flash(res.ok ? "连接成功，配置可用" : `不可用：${res.detail || "鉴权失败"}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const stageLabel = (stage: string) => LLM_STAGES.find((s) => s.key === stage)?.label || stage;
  const stageDesc = (stage: string) => LLM_STAGES.find((s) => s.key === stage)?.desc || "";

  return (
    <>
    <AppHeader />
    <main className="wrap">
      <div className="topbar">
        <button className="back" onClick={() => router.push("/me")}>
          <IconChevronLeft size={14} /> 个人主页
        </button>
      </div>
      <h1 className="ed-h1">平台 AI 设置</h1>
      <p className="me-desc">
        每个环节配一套平台连接，作为用户未配自带连接时的回退。key 加密存储、不回显。
      </p>
      {error && <div className="status err">出错：{error}</div>}

      {loading ? (
        <div className="empty pulse">载入中…</div>
      ) : rows.length === 0 ? (
        // 后端按 LLM_STAGES 补齐空壳，正常不会为空；真为空时给句人话，别只剩一个标题
        <div className="empty">尚未初始化任何环节配置，请检查后端 /admin/llm/platform 是否可用。</div>
      ) : (
        rows.map((r) => (
          <section className="ed-section" key={r.stage}>
            <span className="eyebrow">
              {stageLabel(r.stage)} <span className="ed-hint">{stageDesc(r.stage)}</span>
            </span>
            <div className="me-key-status">
              当前：
              {r.has_key ? (
                <span className="badge active">已配置 {r.key_hint || ""}</span>
              ) : (
                <span className="badge ended">未配置</span>
              )}
            </div>
            <label className="ed-field">
              <span className="ed-label">供应商</span>
              <select className="ed-input ed-select" value={r.provider} onChange={(e) => pickProvider(r.stage, e.target.value)}>
                <option value="">（选择预设）</option>
                {LLM_PROVIDERS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="ed-field">
              <span className="ed-label">Base URL</span>
              <input className="ed-input" value={r.base_url} placeholder="https://api.example.com/v1"
                onChange={(e) => patch(r.stage, { base_url: e.target.value })} />
            </label>
            <label className="ed-field">
              <span className="ed-label">模型</span>
              <input className="ed-input" value={r.model} placeholder="如 deepseek-chat"
                onChange={(e) => patch(r.stage, { model: e.target.value })} />
            </label>
            <label className="ed-field">
              <span className="ed-label">API Key <span className="ed-hint">（留空则保留原 key）</span></span>
              <input className="ed-input" type="password" value={r.api_key} placeholder="sk-..." autoComplete="off"
                onChange={(e) => patch(r.stage, { api_key: e.target.value })} />
            </label>
            <div className="me-key-actions">
              <button className="btn secondary" disabled={busy === r.stage} onClick={() => save(r)}>
                {busy === r.stage ? "保存中…" : "保存"}
              </button>
              <button className="btn secondary sm" disabled={busy === r.stage} onClick={() => test(r)}>
                测试连接
              </button>
            </div>
          </section>
        ))
      )}

      {toastNode}
    </main>
    </>
  );
}
