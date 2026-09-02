"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  PLAY_STAGES,
  formatCredit,
  type LLMConnection,
  type RecommendedModels,
  type StageBinding,
  type StageBindings,
  type StoryLLMConfig,
} from "@/lib/types";
import Switch from "@/components/ui/Switch";
import Dropdown from "@/components/ui/Dropdown";
import styles from "./StoryLLMConfigPanel.module.css";
import { useToast } from "@/components/ui/Toast";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show: flash, node: toastNode } = useToast();

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
  // 模型列表随连接一起来（GET /llm/connections 的 models 字段），不必再逐条去拉。
  useEffect(() => {
    if (!cfg) return;
    setDraft(cfg.bindings || {});
    setReviewOn(cfg.review_enabled);
  }, [cfg]);

  // 一个下拉同时决定连接与模型，所以 option 的 value 把两者编在一起。
  // uuid 不含 ":"，按**首个** "::" 切一刀即可，模型名里有冒号也不会切错。
  const packPick = (b: StageBinding) => (b.conn ? `${b.conn}::${b.model}` : "");
  const unpackPick = (v: string): StageBinding => {
    const i = v.indexOf("::");
    return i < 0 ? { conn: "", model: "" } : { conn: v.slice(0, i), model: v.slice(i + 2) };
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const bindings: StageBindings = {};
      (["write", "review"] as const).forEach((st) => {
        // conn 为空 = 走平台档，不写绑定。后端要求 conn 非空时 model 必填，
        // 而下拉里每个连接项都自带模型，凑不出「有连接没模型」的组合。
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
  const plat = cfg?.platform ?? { ready: false, model: "" };
  // 开着审校却既没选连接、平台兜底也不可用 → 后端会拒（不静默降级），这里先禁用保存并说明。
  const reviewIncomplete = reviewOn && !draft.review?.conn && !plat.ready;

  return (
    <div className={styles.settings}>
      <button className={styles.stog} type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3v3M12 18v3M5 12H2m20 0h-3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2" />
        </svg>
        选择本次游玩的 AI 模型
        <svg className={styles.chev} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className={styles.sbody}>
          {hasRec && (
            <p className={styles.note}>
              <span className={styles.rec}>作者推荐</span>
              {recommended.write?.model && <> 续写 {recommended.write.model}</>}
              {recommended.review?.model && <>　审校 {recommended.review.model}</>}
              　（仅供参考，不会自动套用）
            </p>
          )}
          {error && <p className={`${styles.note} ${styles.err}`} role="alert">出错：{error}</p>}

          {!loggedIn ? (
            <p className={styles.note}>登录即赠 1 元体验额度，可直接使用平台模型开始游玩；也可以配置自有连接。</p>
          ) : loading || !cfg ? (
            <p className={`${styles.note} ${styles.pulse}`}>载入你的连接…</p>
          ) : (
            <>
              <p className={styles.note}>
                平台体验额度剩余 <b>{formatCredit(credit)}</b>
                {credit > 0
                  ? "。未选择连接时使用平台额度，按实际用量扣减；用尽后需配置自有连接。"
                  : "。额度已用尽，请为「续写」选择一条自有连接后继续。"}
              </p>

              {conns.length === 0 && (
                <p className={styles.note}>
                  你还没有自有 LLM 连接。可在「个人主页 → AI 连接」添加一条，避免额度用尽后中断。
                </p>
              )}

              {PLAY_STAGES.map((st) => {
                if (st.key === "review" && !reviewOn) return null; // 关掉就整行不出现，比禁用更清楚
                const b: StageBinding = draft[st.key] || { conn: "", model: "" };
                const pickId = `pick-${st.key}`;
                // 绑定指向的模型可能已被用户从连接里移除（orphan 时在下拉里补一条
                // 孤儿项，见下方 entries），否则当前值无对应项，看起来像「配置被改掉了」。
                const bound = conns.find((c) => c.id === b.conn);
                const orphan = !!b.conn && !!bound && !(bound.models || []).includes(b.model);
                return (
                  <div className={styles.fld} key={st.key}>
                    {/* 环节名作组标题，两个控件各自再给 aria-label 区分连接/模型 */}
                    <label htmlFor={pickId}>
                      {st.label}
                      {/* 只有平台兜底也兜不住时才是「必选」——平台配好了就不必买自己的连接 */}
                      {st.key === "review" && !plat.ready && (
                        <span className={styles.req}>（已开启审校，需选择一条连接）</span>
                      )}
                    </label>
                    <div className={styles.row}>
                      <Dropdown
                        id={pickId}
                        value={packPick(b)}
                        ariaLabel={`${st.label} · 模型`}
                        onChange={(v) => setDraft((d) => ({ ...d, [st.key]: unpackPick(v) }))}
                        entries={[
                          // 「平台」独立成组，且**永不禁用**：不绑连接本来就是合法的默认状态，
                          // 平台预设模型该一直摆在那儿。此前按 ready 禁用它有两个坏处——
                          // 它是默认选中项，禁用态的灰字在深底上直接看不见；后端一时回不出
                          // 可用性（比如旧进程没有 platform）就等于把默认档锁死。
                          // 能不能真的开玩由下方拦截横幅按后端 ready 说话，不靠禁用这个选项表达。
                          {
                            group: "平台",
                            opts: [
                              {
                                value: "",
                                label: `平台预设${plat.model ? ` · ${plat.model}` : ""}${
                                  plat.ready
                                    ? `（剩余 ${formatCredit(credit)}）`
                                    : credit > 0
                                      ? "（平台未配置）"
                                      : "（额度已用尽）"
                                }`,
                              },
                            ],
                          },
                          // 每条连接一组，组名是它的备注，组下是这条连接可用的模型。
                          // 连接本身不再是可选项——选的始终是「哪条连接的哪个模型」。
                          // 绑定指向的模型可能已被移出列表，补一条孤儿项，
                          // 否则当前值无对应项，看起来像「配置被改掉了」。
                          ...conns
                            .map((c) => ({
                              group: c.name,
                              opts: [
                                ...(orphan && c.id === b.conn
                                  ? [{ value: packPick(b), label: `${b.model}（已移出列表）` }]
                                  : []),
                                ...(c.models || []).map((m) => ({ value: `${c.id}::${m}`, label: m })),
                              ],
                            }))
                            .filter((g) => g.opts.length > 0),
                        ]}
                      />
                    </div>
                  </div>
                );
              })}

              <div className={styles.fld}>
                {/* Switch 自身的 label 是 sr-only（供读屏），可见标题要在这里给 */}
                <div className={styles.switchRow}>
                  <span className={styles.switchTitle}>质量审校</span>
                  <Switch checked={reviewOn} onChange={setReviewOn} label="质量审校" />
                </div>
                <p className={styles.note}>
                  开启后每段正文将额外校验一次，重点检查「属性变化与正文不符」「前情提要遗漏新人物」
                  等影响长篇连贯性的问题（实测约 18% 的草稿会被退回重写）。代价是 token 消耗约翻倍；平台兜底不可用时需为审校单独选择一条连接。
                </p>
              </div>

              {reviewIncomplete && (
                <p className={`${styles.note} ${styles.err}`} role="alert">
                  已开启审校，但平台模型不可用。请为其选择一条自有连接，或关闭该开关。
                </p>
              )}

              {/* 本屏唯一主 CTA 是「开始新游戏」，配置保存降为次级（DESIGN §7 每屏一个主按钮） */}
              <button
                className={styles.btnSave}
                type="button"
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
