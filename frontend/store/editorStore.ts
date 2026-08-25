import { create } from "zustand";
import { api } from "@/lib/api";
import { DEFAULT_THEME, resolveTheme, type Theme } from "@/lib/hue";
import type {
  AttrRowData,
  AttrType,
  Character,
  OpeningDraft,
  Option,
  PolishDraft,
  StyleIssue,
  StyleProfile,
  Story,
  WorldDraft,
} from "@/lib/types";

// 编辑器表单态（对象形态；存盘时序列化为 world_config JSON 字符串）。
interface EditorForm {
  title: string;
  description: string;
  coverUrl: string;
  background: string;
  style: string;
  styleProfile: StyleProfile;
  rules: string;
  outline: string;
  characters: Character[];
  attributes: AttrRowData[]; // 有序、可改键；存盘时派生 attributes 对象 + initial_state
  openingContent: string;
  openingOptions: Option[]; // 仅预览，不入库（开场 options 游玩时由后端重生成）
  recWriteModel: string; // 作者推荐的续写模型（仅标注展示给玩家，不自动套用）
  recReviewModel: string; // 作者推荐的审校模型
  // 作品主题：**存值不存 id**（plan.md §二·补）。预设若只是前端常量，改动某个预设的
  // 色相会让所有用它的作品一起变色；值固化进作品后，颜色是作品身份的一部分。
  // 读取仍两种形态都吃（库里 12 部有 7 部是老的字符串 id），解析统一走 lib/hue.resolveTheme。
  theme: Theme;
  // 「主题被显式选过」——段 5 的就绪判定（DESIGN.md §7.7 那张表）。
  // theme 现在恒有值（缺省 252/gaze），光看值分不出「作者选过」和「还没碰过」。
  // **不进 world_config**：它是编辑期的一个足迹，不是作品数据。
  themePicked: boolean;
  // 题材标签。约定 tags[0] 是主题材（首页 chip 按它归类），其余作展示。
  // 与 theme 是两回事：theme 只决定配色，别拿它当题材（见 CLAUDE.md「Genre tags」）。
  tags: string[];
}

interface EditorState extends EditorForm {
  storyId: string | null; // null = 新建
  status: string; // draft | published
  loading: boolean;
  saving: boolean;
  aiBusy: "world" | "opening" | "polish" | null; // 分区 loading，避免整页禁用
  error: string | null;
  toast: string | null;
  polishInstruction: string;
  polishSourceText: string | null;
  polishDraft: string | null;
  polishFeedback: StyleIssue[];
  polishApplied: boolean;

  reset: () => void;
  loadStory: (id: string) => Promise<void>;
  setField: <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => void;
  // 角色
  addCharacter: () => void;
  updateCharacter: (i: number, patch: Partial<Character>) => void;
  removeCharacter: (i: number) => void;
  // 属性
  addAttr: () => void;
  updateAttr: (i: number, patch: Partial<AttrRowData>) => void;
  removeAttr: (i: number) => void;
  // AI 辅助
  genWorld: (idea: string, style: string) => Promise<void>;
  genOpening: () => Promise<void>;
  setPolishInstruction: (value: string) => void;
  polishOpening: () => Promise<void>;
  acceptPolish: () => void;
  dismissPolish: () => void;
  // 持久化
  save: () => Promise<string | null>; // 返回 storyId
  publish: () => Promise<void>;
  unpublish: () => Promise<void>;
  remove: () => Promise<void>;
  showToast: (msg: string) => void;
}

const EMPTY_FORM: EditorForm = {
  title: "",
  description: "",
  coverUrl: "",
  background: "",
  style: "",
  styleProfile: { sensory_focus: [], dialogue_rule: "", avoid: [] },
  rules: "",
  outline: "",
  characters: [],
  attributes: [],
  openingContent: "",
  openingOptions: [],
  recWriteModel: "",
  recReviewModel: "",
  theme: DEFAULT_THEME,
  themePicked: false,
  tags: [],
};

// 按类型给属性初值一个合理默认（切换 type 时重置，避免残留错型值）。
function defaultInitial(type: AttrType): number | string | string[] {
  if (type === "number") return 0;
  if (type === "set") return [];
  return "";
}

// 把某属性行的 initial 规整为其类型对应的 JSON 值（存盘/请求时用）。
function coerceInitial(a: AttrRowData): number | string | string[] {
  if (a.type === "number") {
    const n = typeof a.initial === "number" ? a.initial : Number(a.initial);
    return Number.isFinite(n) ? n : 0;
  }
  if (a.type === "set") {
    return Array.isArray(a.initial) ? a.initial : [];
  }
  return typeof a.initial === "string" ? a.initial : String(a.initial ?? "");
}

// 由属性行派生 attributes 对象 + initial_state（单一真源在 attributes 行，杜绝双写漂移）。
function deriveAttrs(rows: AttrRowData[]) {
  const attributes: Record<string, Record<string, unknown>> = {};
  const initial_state: Record<string, unknown> = {};
  for (const a of rows) {
    const key = a.key.trim();
    if (!key) continue;
    const initial = coerceInitial(a);
    const spec: Record<string, unknown> = { type: a.type, initial };
    // max 只对 number 有意义，后端校验也是这么卡的；其余类型即使填了也不落盘。
    if (a.type === "number" && typeof a.max === "number" && a.max > 0) spec.max = a.max;
    if (a.hidden) spec.hidden = true;
    if (a.reveal) spec.reveal = true;
    attributes[key] = spec;
    initial_state[key] = initial;
  }
  return { attributes, initial_state };
}

// 组装 world_config 的对象形态（供 /assist/opening 请求 + 存盘序列化共用）。
// recommended_models 只在填了时写入（作者推荐，仅标注展示、不自动套用）。
function worldObject(f: EditorForm) {
  const { attributes, initial_state } = deriveAttrs(f.attributes);
  const rec: Record<string, { model: string }> = {};
  if (f.recWriteModel.trim()) rec.write = { model: f.recWriteModel.trim() };
  if (f.recReviewModel.trim()) rec.review = { model: f.recReviewModel.trim() };
  const styleProfile = serializeStyleProfile(f.styleProfile);
  return {
    background: f.background,
    style: f.style,
    rules: f.rules,
    outline: f.outline,
    characters: f.characters,
    initial_state,
    attributes,
    theme: f.theme, // 写入永远是 {hue, figure} 对象
    ...(styleProfile ? { style_profile: styleProfile } : {}),
    ...(f.tags.length ? { tags: f.tags } : {}),
    ...(Object.keys(rec).length ? { recommended_models: rec } : {}),
  };
}

function loadStyleProfile(raw: unknown): StyleProfile {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const distance = value.narrative_distance;
  const rhythm = value.rhythm;
  const tags = (items: unknown, max: number) =>
    Array.isArray(items)
      ? items.map((item) => String(item).trim().slice(0, 48)).filter(Boolean).slice(0, max)
      : [];
  return {
    narrative_distance:
      distance === "close" || distance === "medium" || distance === "distant" ? distance : undefined,
    rhythm: rhythm === "mixed" || rhythm === "tight" || rhythm === "relaxed" ? rhythm : undefined,
    sensory_focus: tags(value.sensory_focus, 3),
    dialogue_rule: String(value.dialogue_rule ?? "").trim().slice(0, 160),
    avoid: tags(value.avoid, 5),
  };
}

function serializeStyleProfile(profile: StyleProfile): StyleProfile | null {
  const loaded = loadStyleProfile(profile);
  const result: StyleProfile = {
    ...(loaded.narrative_distance ? { narrative_distance: loaded.narrative_distance } : {}),
    ...(loaded.rhythm ? { rhythm: loaded.rhythm } : {}),
    ...(loaded.sensory_focus?.length ? { sensory_focus: loaded.sensory_focus } : {}),
    ...(loaded.dialogue_rule ? { dialogue_rule: loaded.dialogue_rule } : {}),
    ...(loaded.avoid?.length ? { avoid: loaded.avoid } : {}),
  };
  return Object.keys(result).length ? result : null;
}

// 把 AI/存量的 attributes 对象 + initial_state 摊平成编辑用的有序行。
function attrsToRows(
  attributes: Record<string, Record<string, unknown>>,
  initialState: Record<string, unknown>
): AttrRowData[] {
  return Object.entries(attributes || {}).map(([key, spec]) => {
    const type = (["number", "scalar", "set"].includes(String(spec?.type))
      ? spec.type
      : "scalar") as AttrType;
    // initial 优先取 attributes.initial，缺失回落 initial_state[key]
    const rawInit = spec?.initial !== undefined ? spec.initial : initialState?.[key];
    let initial: number | string | string[];
    if (type === "number") initial = Number(rawInit) || 0;
    else if (type === "set") initial = Array.isArray(rawInit) ? (rawInit as string[]) : [];
    else initial = rawInit === undefined || rawInit === null ? "" : String(rawInit);
    return {
      key,
      type,
      initial,
      max: typeof spec?.max === "number" && spec.max > 0 ? spec.max : null,
      hidden: spec?.hidden === true,
      reveal: spec?.reveal === true,
    };
  });
}

// 把 AI 返回的 characters（任意结构）规整为 {name,role,desc}。
function coerceCharacters(raw: unknown[]): Character[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const o = (c || {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? ""),
      role: String(o.role ?? ""),
      desc: String(o.desc ?? o.personality ?? o.description ?? ""),
    };
  });
}

export const useEditorStore = create<EditorState>((set, get) => ({
  ...EMPTY_FORM,
  storyId: null,
  status: "draft",
  loading: false,
  saving: false,
  aiBusy: null,
  error: null,
  toast: null,
  polishInstruction: "",
  polishSourceText: null,
  polishDraft: null,
  polishFeedback: [],
  polishApplied: false,

  reset: () =>
    set({
      ...EMPTY_FORM,
      storyId: null,
      status: "draft",
      loading: false,
      saving: false,
      aiBusy: null,
      error: null,
      toast: null,
      polishInstruction: "",
      polishSourceText: null,
      polishDraft: null,
      polishFeedback: [],
      polishApplied: false,
    }),


  loadStory: async (id) => {
    set({ loading: true, error: null });
    try {
      const s = await api.get<Story>(`/stories/${id}`);
      let w: Record<string, unknown> = {};
      try {
        w = JSON.parse(s.world_config || "{}");
      } catch {
        /* 坏 JSON 当空处理 */
      }
      set({
        storyId: s.id,
        status: s.status,
        title: s.title,
        description: s.description,
        coverUrl: s.cover_url,
        background: String(w.background ?? ""),
        style: String(w.style ?? ""),
        styleProfile: loadStyleProfile(w.style_profile),
        rules: String(w.rules ?? ""),
        outline: String(w.outline ?? ""),
        characters: coerceCharacters((w.characters as unknown[]) ?? []),
        attributes: attrsToRows(
          (w.attributes as Record<string, Record<string, unknown>>) ?? {},
          (w.initial_state as Record<string, unknown>) ?? {}
        ),
        openingContent: s.opening_content || "",
        openingOptions: [],
        recWriteModel: String(
          ((w.recommended_models as Record<string, { model?: string }>)?.write?.model) ?? ""
        ),
        recReviewModel: String(
          ((w.recommended_models as Record<string, { model?: string }>)?.review?.model) ?? ""
        ),
        theme: resolveTheme(w, s.id), // 老数据的字符串 id 在这里被解析成值
        // 作品里已经存着 theme，就是选过了——别让作者重开一部旧作品时看见天空缺一层
        themePicked: w.theme !== undefined && w.theme !== null,
        tags: Array.isArray(w.tags) ? (w.tags as unknown[]).map(String).filter(Boolean) : [],
        polishInstruction: "",
        polishSourceText: null,
        polishDraft: null,
        polishFeedback: [],
        polishApplied: false,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  setField: (key, value) => set({ [key]: value } as Partial<EditorState>),

  setPolishInstruction: (value) => set({ polishInstruction: value }),

  addCharacter: () =>
    set((s) => ({ characters: [...s.characters, { name: "", role: "", desc: "" }] })),
  updateCharacter: (i, patch) =>
    set((s) => ({
      characters: s.characters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    })),
  removeCharacter: (i) =>
    set((s) => ({ characters: s.characters.filter((_, idx) => idx !== i) })),

  addAttr: () =>
    set((s) => ({
      attributes: [
        ...s.attributes,
        { key: "", type: "number", initial: 0, max: null, hidden: false, reveal: false },
      ],
    })),
  updateAttr: (i, patch) =>
    set((s) => ({
      attributes: s.attributes.map((a, idx) => {
        if (idx !== i) return a;
        const next = { ...a, ...patch };
        // 改类型时重置初值为该类型默认，避免残留错型值
        if (patch.type && patch.type !== a.type) next.initial = defaultInitial(patch.type);
        return next;
      }),
    })),
  removeAttr: (i) => set((s) => ({ attributes: s.attributes.filter((_, idx) => idx !== i) })),

  genWorld: async (idea, style) => {
    if (!idea.trim()) {
      set({ error: "请先写一句灵感" });
      return;
    }
    set({ aiBusy: "world", error: null });
    try {
      const d = await api.post<WorldDraft>("/assist/world", {
        idea: idea.trim(),
        style: style.trim(),
      });
      set({
        background: d.background || "",
        style: d.style || "",
        rules: d.rules || "",
        outline: d.outline || "",
        characters: coerceCharacters(d.characters || []),
        attributes: attrsToRows(d.attributes || {}, d.initial_state || {}),
        aiBusy: null,
        toast: "已生成世界观草稿，请审阅微调",
      });
    } catch (e) {
      set({ aiBusy: null, error: (e as Error).message });
    }
  },

  genOpening: async () => {
    set({ aiBusy: "opening", error: null });
    try {
      const d = await api.post<OpeningDraft>("/assist/opening", {
        world: worldObject(get()),
      });
      set({
        openingContent: d.content || "",
        openingOptions: d.options || [],
        aiBusy: null,
        toast: "已生成开场草稿",
      });
    } catch (e) {
      set({ aiBusy: null, error: (e as Error).message });
    }
  },

  polishOpening: async () => {
    const source = get().openingContent;
    if (!source.trim()) {
      set({ error: "请先填写开场正文" });
      return;
    }
    set({
      aiBusy: "polish",
      error: null,
      polishSourceText: source,
      polishDraft: null,
      polishFeedback: [],
      polishApplied: false,
    });
    try {
      const d = await api.post<PolishDraft>("/assist/polish", {
        text: source,
        instruction: get().polishInstruction.trim(),
        world: worldObject(get()),
      });
      set({
        aiBusy: null,
        polishSourceText: source,
        polishDraft: d.text,
        polishFeedback: d.feedback || [],
        polishApplied: d.applied === true,
      });
    } catch (e) {
      set({ aiBusy: null, error: (e as Error).message });
    }
  },

  acceptPolish: () => {
    const state = get();
    if (!state.polishApplied || !state.polishDraft || state.openingContent !== state.polishSourceText) return;
    set({
      openingContent: state.polishDraft,
      polishSourceText: null,
      polishDraft: null,
      polishFeedback: [],
      polishApplied: false,
      toast: "已替换开场正文，请继续审阅",
    });
  },

  dismissPolish: () =>
    set({ polishSourceText: null, polishDraft: null, polishFeedback: [], polishApplied: false }),

  save: async () => {
    const f = get();
    set({ saving: true, error: null });
    try {
      const payload = {
        title: f.title,
        description: f.description,
        cover_url: f.coverUrl,
        world_config: JSON.stringify(worldObject(f)),
        opening_content: f.openingContent,
      };
      let id = f.storyId;
      if (id) {
        await api.put<Story>(`/stories/${id}`, payload);
      } else {
        const created = await api.post<Story>("/stories/", payload);
        id = created.id;
        set({ storyId: id });
      }
      // 已发布的作品保存的是**线上正在被玩的那一份**,不能再说"已保存草稿"。
      set({
        saving: false,
        toast: f.status === "published" ? "已保存，线上作品已更新" : "已保存草稿",
      });
      return id;
    } catch (e) {
      set({ saving: false, error: (e as Error).message });
      return null;
    }
  },

  publish: async () => {
    // 先存盘再发布：发布端点对 world_config 做严格校验
    const id = await get().save();
    if (!id) return;
    set({ saving: true, error: null });
    try {
      const s = await api.put<Story>(`/stories/${id}/status`, { status: "published" });
      set({ status: s.status, saving: false, toast: "已发布，作品已在首页可玩" });
    } catch (e) {
      set({ saving: false, error: (e as Error).message });
    }
  },

  unpublish: async () => {
    const { storyId } = get();
    if (!storyId) return;
    set({ saving: true, error: null });
    try {
      const s = await api.put<Story>(`/stories/${storyId}/status`, { status: "draft" });
      set({ status: s.status, saving: false, toast: "已转为草稿" });
    } catch (e) {
      set({ saving: false, error: (e as Error).message });
    }
  },

  remove: async () => {
    const { storyId } = get();
    if (!storyId) return;
    set({ saving: true, error: null });
    try {
      await api.del(`/stories/${storyId}`);
      set({ saving: false });
    } catch (e) {
      set({ saving: false, error: (e as Error).message });
      throw e;
    }
  },

  showToast: (msg) => set({ toast: msg }),
}));
