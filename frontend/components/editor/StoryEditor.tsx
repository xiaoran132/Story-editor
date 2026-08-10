"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { api } from "@/lib/api";
import { GENRES, THEMES, TONES, type LLMConnection } from "@/lib/types";
import Textarea from "./Textarea";
import Input from "./Input";
import CharacterList from "./CharacterList";
import AttrTable from "./AttrTable";
import { Toast } from "@/components/Toast";
import PublishCheck, { usePublishChecks } from "./PublishCheck";

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

  // toast 文案由 editorStore 写入（genWorld / save 等异步流程都要用），
  // 这里只负责自动消隐与渲染；样式与语义走共享的 <Toast>。
  useEffect(() => {
    if (!s.toast) return;
    const t = setTimeout(() => useEditorStore.setState({ toast: null }), 2400);
    return () => clearTimeout(t);
  }, [s.toast]);

  // 外壳（AppHeader）由页面层负责（app/create、app/edit），这里只渲染编辑器本体——
  // 两边都渲染会得到两个 <header> + 两个 <nav>，屏幕阅读器的地标列表会出现两套相同导航。
  if (s.loading)
    return <div className="empty pulse">载入中…</div>;

  // tags 的单一事实源就是 store 里的数组，UI 只做增删排序，**不认识的标签原样保留**——
  // AI 生成或作者手填的「民国」「本格」这类不在建议表里，抹掉就是数据丢失。
  // 排序约定：题材在前（tags[0] 决定书库分类）、自定义居中、基调置尾。
  const isGenre = (t: string) => (GENRES as readonly string[]).includes(t);
  const isTone = (t: string) => (TONES as readonly string[]).includes(t);
  const extraTags = s.tags.filter((t) => !isGenre(t) && !isTone(t));
  const reorder = (list: string[]) => [
    ...GENRES.filter((g) => list.includes(g)),
    ...list.filter((t) => !isGenre(t) && !isTone(t)),
    ...list.filter(isTone),
  ];
  const toggleGenre = (g: string) =>
    s.setField(
      "tags",
      reorder(s.tags.includes(g) ? s.tags.filter((t) => t !== g) : [...s.tags, g])
    );
  const setTone = (tone: string) =>
    s.setField("tags", reorder([...s.tags.filter((t) => !isTone(t)), ...(tone ? [tone] : [])]));

  // 发布前置校验：镜像后端 strict 规则，未全通过则禁用发布按钮。
  // 以前只能点了发布再等后端报错，而且一次只报一条。
  const checks = usePublishChecks();
  const canPublish = checks.every((c) => c.ok);

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
        {/* 返回入口交给 AppHeader 的「我的创作」，这里只留状态徽标 */}
        <span className={`badge ${s.status === "published" ? "active" : "ended"}`}>
          {s.status === "published" ? "已发布" : "草稿"}
        </span>
      </div>

      <h1 className="ed-h1">{s.storyId ? "编辑作品" : "创作新作品"}</h1>

      {s.error && <div className="status err">出错：{s.error}</div>}

      {/* 1. 灵感 → 世界观 */}
      <section className="ed-section">
        <span className="eyebrow lead">① 一句话灵感</span>
        <div className="ed-idea">
          <Textarea
            label="灵感"
            rows={2}
            placeholder="例：民国上海，一桩密室命案，侦探须在三日内破案…"
            value={idea}
            onChange={setIdea}
          />
          <Input
            label="风格"
            hint="（可选）"
            placeholder="如 本格推理 / 冷峻"
            value={ideaStyle}
            onChange={setIdeaStyle}
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
            className="btn accent"
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

        <div className="ed-field">
          <span className="ed-label">
            题材
            <span className="ed-hint">可多选；第一个决定作品在书库里归到哪个筛选分类</span>
          </span>
          <div className="tagpicks">
            {GENRES.map((g) => (
              <button
                type="button"
                key={g}
                className="tagpick"
                aria-pressed={s.tags.includes(g)}
                onClick={() => toggleGenre(g)}
              >
                {g}
              </button>
            ))}
          </div>
          {extraTags.length > 0 && (
            <p className="ed-hint">
              另有自定义标签：{extraTags.join("、")}（AI 生成或手填，保留展示）
            </p>
          )}
        </div>

        <label className="ed-field" style={{ maxWidth: 280 }}>
          <span className="ed-label">基调</span>
          <select
            className="ed-input ed-select"
            value={s.tags.find((t) => (TONES as readonly string[]).includes(t)) ?? ""}
            onChange={(e) => setTone(e.target.value)}
          >
            <option value="">（不指定）</option>
            {TONES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>

        <div className="ed-field">
          <span className="ed-label">
            主题皮肤
            <span className="ed-hint">玩家进入本作品的详情/游玩页时整页换肤，离开恢复星图</span>
          </span>
          <div className="theme-picker">
            {THEMES.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`theme-swatch${s.theme === t.id ? " on" : ""}`}
                onClick={() => s.setField("theme", t.id)}
                aria-pressed={s.theme === t.id}
              >
                <span
                  className="theme-swatch-chip"
                  style={{ background: t.swatch[1], borderColor: t.swatch[0] }}
                >
                  <i style={{ background: t.swatch[0] }} />
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

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
        <button className="btn secondary sm ed-add" disabled={anyBusy} onClick={() => s.genOpening()}>
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
        <Input label="推荐续写模型" value={s.recWriteModel} onChange={(v) => s.setField("recWriteModel", v)} hint="如 deepseek-reasoner" />
        <Input label="推荐审校模型" value={s.recReviewModel} onChange={(v) => s.setField("recReviewModel", v)} hint="如 deepseek-chat" />
      </section>

      {/* 5. 发布栏 */}
      <section className="ed-section">
        <span className="eyebrow">发布检查</span>
        <PublishCheck checks={checks} />
      </section>

      <div className="ed-publishbar">
        <button className="btn secondary sm" disabled={anyBusy} onClick={() => s.save()}>
          {s.saving ? "保存中…" : "存草稿"}
        </button>
        {s.status === "published" ? (
          <button className="btn secondary sm" disabled={anyBusy} onClick={() => s.unpublish()}>
            取消发布
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={anyBusy || !canPublish}
            title={canPublish ? undefined : "还有必填项没补齐，见上方发布检查"}
            onClick={() => s.publish()}
          >
            发布
          </button>
        )}
        {s.storyId &&
          (confirmDel ? (
            <button className="btn danger sm ed-del confirm" onClick={onDelete}>
              确认删除？
            </button>
          ) : (
            <button className="btn ghost sm ed-del" onClick={() => setConfirmDel(true)}>
              删除
            </button>
          ))}
      </div>

      <Toast message={s.toast} />
    </div>
  );
}
