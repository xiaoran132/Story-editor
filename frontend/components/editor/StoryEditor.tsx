"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { api } from "@/lib/api";
import type { LLMConnection } from "@/lib/types";
import Textarea from "./Textarea";
import CharacterList from "./CharacterList";
import AttrTable from "./AttrTable";

// 创作编辑器主体：AI 优先流程——灵感生成世界观 → 结构化微调 → 生成开场 → 存草稿/发布。
// create 与 edit 两页共用；差异仅初始化（create 调 reset、edit 调 loadStory）。
export default function StoryEditor() {
  const router = useRouter();
  const s = useEditorStore();
  const [idea, setIdea] = useState("");
  const [ideaStyle, setIdeaStyle] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [conns, setConns] = useState<LLMConnection[]>([]);

  // 拉取用户的 LLM 连接，供「使用连接」下拉（覆盖 world 环节绑定）。未登录/无连接则下拉只有默认项。
  useEffect(() => {
    api.get<LLMConnection[]>("/llm/connections").then((c) => setConns(c || [])).catch(() => {});
  }, []);

  // toast 自动消隐
  useEffect(() => {
    if (!s.toast) return;
    const t = setTimeout(() => useEditorStore.setState({ toast: null }), 2400);
    return () => clearTimeout(t);
  }, [s.toast]);

  if (s.loading) return <div className="empty pulse">载入中…</div>;

  const aiWorld = s.aiBusy === "world";
  const aiOpening = s.aiBusy === "opening";
  const anyBusy = s.aiBusy !== null || s.saving;

  const onDelete = async () => {
    try {
      await s.remove();
      router.push("/mine");
    } catch {
      /* 错误已进 store.error */
    }
  };

  return (
    <div className="ed-wrap">
      <div className="topbar">
        <span className="back" onClick={() => router.push("/mine")}>
          ← 我的作品
        </span>
        <div className="topbar-actions">
          <span className={`badge ${s.status === "published" ? "active" : "ended"}`}>
            {s.status === "published" ? "已发布" : "草稿"}
          </span>
        </div>
      </div>

      <h1 className="ed-h1">{s.storyId ? "编辑作品" : "创作新作品"}</h1>

      {s.error && <div className="status err">出错：{s.error}</div>}

      {/* 1. 灵感 → 世界观 */}
      <section className="ed-section">
        <span className="eyebrow">① 一句话灵感</span>
        <div className="ed-idea">
          <textarea
            className="ed-textarea"
            rows={2}
            placeholder="例：民国上海，一桩密室命案，侦探须在三日内破案…"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
          />
          <input
            className="ed-input"
            placeholder="风格（可选，如 本格推理 / 冷峻）"
            value={ideaStyle}
            onChange={(e) => setIdeaStyle(e.target.value)}
          />
          {conns.length > 0 && (
            <label className="ed-field">
              <span className="ed-label">使用连接 <span className="ed-hint">（AI 生成用哪套 key，默认按设置）</span></span>
              <select
                className="ed-input ed-select"
                value={s.connectionId}
                onChange={(e) => s.setConnectionId(e.target.value)}
              >
                <option value="">默认（按环节绑定 / 平台）</option>
                {conns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.default_model}）
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="primary-btn"
            disabled={anyBusy}
            onClick={() => s.genWorld(idea, ideaStyle)}
          >
            {aiWorld ? "AI 构思中…" : "AI 生成世界观"}
          </button>
        </div>
      </section>

      {/* 2. 世界观结构化微调 */}
      <section className={`ed-section ${aiWorld ? "ai-generating" : ""}`}>
        <span className="eyebrow">② 世界观（审阅微调）</span>
        <Textarea label="标题" value={s.title} onChange={(v) => s.setField("title", v)} rows={1} />
        <Textarea
          label="简介"
          value={s.description}
          onChange={(v) => s.setField("description", v)}
          rows={2}
          hint="列表卡片展示用"
        />
        <Textarea label="背景" value={s.background} onChange={(v) => s.setField("background", v)} />
        <Textarea label="风格" value={s.style} onChange={(v) => s.setField("style", v)} rows={1} />
        <Textarea label="规则" value={s.rules} onChange={(v) => s.setField("rules", v)} />
        <Textarea
          label="大纲"
          value={s.outline}
          onChange={(v) => s.setField("outline", v)}
          rows={4}
          hint="AI 导演的走向锚点，非线性脚本"
        />
        <CharacterList />
        <AttrTable />
      </section>

      {/* 3. 开场 */}
      <section className={`ed-section ${aiOpening ? "ai-generating" : ""}`}>
        <span className="eyebrow">③ 开场</span>
        <button className="ghost-btn ed-add" disabled={anyBusy} onClick={() => s.genOpening()}>
          {aiOpening ? "AI 生成中…" : "AI 生成开场"}
        </button>
        <Textarea
          label="开场正文"
          value={s.openingContent}
          onChange={(v) => s.setField("openingContent", v)}
          rows={6}
          hint="留空则由 AI 在开局时即时生成"
        />
        {s.openingOptions.length > 0 && (
          <div className="ed-opts-preview">
            <span className="ed-hint">起始选项预览（不入库，游玩时由 AI 生成）</span>
            {s.openingOptions.map((o, i) => (
              <div className="opt" key={i}>
                {o.text}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. 推荐模型（可选，仅标注给玩家） */}
      <section className="ed-section">
        <span className="eyebrow">④ 推荐模型（可选）</span>
        <p className="me-desc">
          标注你创作/调试这部作品时各环节用的模型。
          <span className="ed-hint">仅作推荐展示——玩家用自己的连接游玩，不会自动套用你的配置。</span>
        </p>
        <Textarea label="推荐续写模型" value={s.recWriteModel} onChange={(v) => s.setField("recWriteModel", v)} rows={1} hint="如 deepseek-reasoner" />
        <Textarea label="推荐审校模型" value={s.recReviewModel} onChange={(v) => s.setField("recReviewModel", v)} rows={1} hint="如 deepseek-chat" />
      </section>

      {/* 5. 发布栏 */}
      <div className="ed-publishbar">
        <button className="ghost-btn" disabled={anyBusy} onClick={() => s.save()}>
          {s.saving ? "保存中…" : "存草稿"}
        </button>
        {s.status === "published" ? (
          <button className="ghost-btn" disabled={anyBusy} onClick={() => s.unpublish()}>
            取消发布
          </button>
        ) : (
          <button className="primary-btn" disabled={anyBusy} onClick={() => s.publish()}>
            发布
          </button>
        )}
        {s.storyId &&
          (confirmDel ? (
            <button className="ed-del confirm" onClick={onDelete}>
              确认删除？
            </button>
          ) : (
            <button className="ed-del" onClick={() => setConfirmDel(true)}>
              删除
            </button>
          ))}
      </div>

      {s.toast && <div className="ed-toast">{s.toast}</div>}
    </div>
  );
}
