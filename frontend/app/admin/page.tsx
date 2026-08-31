"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import Backdrop from "@/components/sky/Backdrop";
import WxHeader from "@/components/wx/WxHeader";
import Dropdown from "@/components/Dropdown";
import styles from "./page.module.css";
import { IconChevronLeft } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { LLM_PROVIDERS, type PlatformSetting, type TestResult } from "@/lib/types";

// 平台兜底 LLM 设置（仅管理员）：全局一条，作为用户未配自有连接时的回退，
// 所有环节（续写/审校/创作辅助）共用。想按环节用不同模型是用户自己的绑定的事。
// 权限双保险：前端按 role 守卫 + 后端 RequireAdmin。第一个 admin 靠手动改库提权后重新登录。
export default function AdminPage() {
  const router = useRouter();
  const initAuth = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);
  const [row, setRow] = useState<PlatformSetting | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
      .get<PlatformSetting>("/admin/llm/platform")
      .then((p) => setRow(p))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const patch = (p: Partial<PlatformSetting>) =>
    setRow((r) => (r ? { ...r, ...p } : r));

  const pickProvider = (prov: string) => {
    const preset = LLM_PROVIDERS.find((x) => x.key === prov);
    patch({ provider: prov, base_url: preset?.baseURL ?? "", model: preset?.model ?? "" });
  };

  const save = async () => {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.put<PlatformSetting>("/admin/llm/platform", {
        provider: row.provider,
        base_url: row.base_url.trim(),
        api_key: apiKey.trim(),
        model: row.model.trim(),
        price_in_per_mtok: Number(row.price_in_per_mtok) || 0,
        price_out_per_mtok: Number(row.price_out_per_mtok) || 0,
        price_cache_in_per_mtok: Number(row.price_cache_in_per_mtok) || 0,
      });
      setRow(saved);
      setApiKey("");
      flash("已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<TestResult>("/admin/llm/platform/test", {
        base_url: row.base_url.trim(),
        api_key: apiKey.trim(),
        model: row.model.trim(),
      });
      flash(res.ok ? "连接成功，配置可用" : `不可用：${res.detail || "鉴权失败"}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
    <Backdrop />
    <WxHeader />
    <main className={styles.main}>
      <div>
        <button className={styles.back} type="button" onClick={() => router.push("/mine/settings")}>
          <IconChevronLeft size={14} /> 个人主页
        </button>
      </div>
      <h1 className={styles.h1}>平台 AI 设置</h1>
      <p className={styles.desc}>
        配置平台兜底模型：用户未配置自有连接时，续写、审校与创作辅助都回落到它并按量扣减体验额度。API Key 加密存储，保存后不再显示。
      </p>
      {error && <div className={styles.err} role="alert">出错：{error}</div>}

      {loading ? (
        <div className={styles.state}>载入中…</div>
      ) : !row ? (
        // 后端未配置时回空壳对象，正常不会为 null；真为 null 时给句人话，别只剩一个标题
        <div className={styles.state}>尚未初始化平台设置。</div>
      ) : (
        <section className={styles.stage}>
          <div className={styles.keyStatus}>
            当前：
            {row.has_key ? (
              <span className={`${styles.badge} ${styles.badgeOn}`}>已配置 {row.key_hint || ""}</span>
            ) : (
              <span className={styles.badge}>未配置</span>
            )}
          </div>
          <label className="wx-field">
            <span className="wx-label">供应商</span>
            <Dropdown
              value={row.provider}
              onChange={pickProvider}
              ariaLabel="供应商"
              entries={[
                { value: "", label: "（选择预设）" },
                ...LLM_PROVIDERS.map((p) => ({ value: p.key, label: p.label })),
              ]}
            />
          </label>
          <label className="wx-field">
            <span className="wx-label">Base URL</span>
            <input className="wx-input" value={row.base_url} placeholder="https://api.example.com/v1"
              onChange={(e) => patch({ base_url: e.target.value })} />
          </label>
          <label className="wx-field">
            <span className="wx-label">模型</span>
            <input className="wx-input" value={row.model} placeholder="如 deepseek-chat"
              onChange={(e) => patch({ model: e.target.value })} />
          </label>
          <label className="wx-field">
            <span className="wx-label">API Key <span className="wx-hint">（留空则保留原 key）</span></span>
            <input className="wx-input" type="password" value={apiKey} placeholder="sk-..." autoComplete="off"
              onChange={(e) => setApiKey(e.target.value)} />
          </label>
          {/* 单价决定玩家那 1 元赠送额度怎么扣。为 0 = 永远扣不动 = 平台 key 无限量，
              所以这里必须显式警告，而不是让它安静地是 0。 */}
          <div className="wx-field">
            <span className="wx-label">
              单价 <span className="wx-hint">元 / 百万 token，与供应商定价页保持一致</span>
            </span>
            <div className={styles.price}>
              <label>
                <span className="wx-hint">输入</span>
                <input className="wx-input" type="number" min="0" step="0.01" value={row.price_in_per_mtok ?? 0}
                  aria-label="输入单价（元/百万 token）"
                  onChange={(e) => patch({ price_in_per_mtok: Number(e.target.value) })} />
              </label>
              <label>
                <span className="wx-hint">输出</span>
                <input className="wx-input" type="number" min="0" step="0.01" value={row.price_out_per_mtok ?? 0}
                  aria-label="输出单价（元/百万 token）"
                  onChange={(e) => patch({ price_out_per_mtok: Number(e.target.value) })} />
              </label>
              <label>
                <span className="wx-hint">缓存命中</span>
                <input className="wx-input" type="number" min="0" step="0.01" value={row.price_cache_in_per_mtok ?? 0}
                  aria-label="缓存命中输入单价（元/百万 token）"
                  title="前缀缓存命中的输入 token 单价（如 DeepSeek 约为输入价的十分之一）。留 0 = 按输入全价计费。"
                  onChange={(e) => patch({ price_cache_in_per_mtok: Number(e.target.value) })} />
              </label>
            </div>
            {!row.price_in_per_mtok && !row.price_out_per_mtok && (
              <span className="wx-err" role="alert">
                单价为 0：玩家使用平台兜底连接时不会扣减任何额度，等同于无限免费。请填写真实单价。
              </span>
            )}
          </div>
          <div className={styles.actions}>
            <button className="wx-btn strong" disabled={busy} onClick={save}>
              {busy ? "保存中…" : "保存"}
            </button>
            <button className="wx-btn sm" disabled={busy} onClick={test}>
              测试连接
            </button>
          </div>
        </section>
      )}

      {toastNode}
    </main>
    </div>
  );
}
