import { create } from "zustand";
import { api, postStream } from "@/lib/api";
import type { Session, SessionResult, Story, StoryNode } from "@/lib/types";
import { DEFAULT_THEME, resolveTheme, type Theme } from "@/lib/hue";
import { workKicker } from "@/lib/work";

interface PlayState {
  session: Session | null;
  currentNode: StoryNode | null;
  allNodes: StoryNode[]; // 该会话已探索的全部节点，供树状视图建树
  storyTitle: string; // 作品标题，用于游玩页顶栏展示
  coverUrl: string; // 作品封面：作为阅读背景图注入 --reader-bg（无则保持纯场景色）
  storyKicker: string; // 题材角标（tags[0]，缺 tags 时有兜底），顶栏作品名下那行
  theme: Theme; // 作品主题：{hue, figure}，驱动整页 --hue 与身后剪影的姿态
  hiddenAttrs: string[]; // world_config.attributes 里标了 hidden 的属性键：仅供 AI 参考，玩家端不展示
  revealGated: string[]; // world_config.attributes 里标了 reveal 的门控属性键：揭示前不显示
  attrMax: Record<string, number>; // 声明了 max 的 number 属性上限：只有它才画进度条，其余只显示数字
  busy: boolean; // AI 生成中，禁用交互
  readOnly: boolean; // 作品已被作者取消发布：可读完，不可推进（引用模式的下架语义）
  streamingText: string; // 流式正文（done 后清空回落 currentNode.content；出错时保留半截正文标记中断态）
  loading: boolean; // 首次加载会话中
  error: string | null;

  load: (sessionId: string) => Promise<void>;
  startOpening: () => Promise<void>;
  choose: (choice: string) => Promise<void>;
  backtrack: (nodeId: string) => Promise<void>;
  abort: () => void; // 中断进行中的生成流（页面卸载/重置时调用，防 reader 后台续写与 busy 锁死）
  reset: () => void;
}

// 从作品 world_config.attributes 解析出标了某布尔标记的属性键集合。
function parseFlaggedAttrs(worldConfig: string, flag: "hidden" | "reveal"): string[] {
  try {
    const attrs = (JSON.parse(worldConfig || "{}").attributes || {}) as Record<
      string,
      Record<string, unknown>
    >;
    return Object.keys(attrs).filter((k) => attrs[k] && attrs[k][flag] === true);
  } catch {
    return [];
  }
}

// 取 number 属性声明的上限 max（可选）。没声明就不画条——硬编码 0–100 会让 gold:500 直接满格，
// 一条错的进度条比没有条更误导。
function parseAttrMax(worldConfig: string): Record<string, number> {
  try {
    const attrs = (JSON.parse(worldConfig || "{}").attributes || {}) as Record<
      string,
      Record<string, unknown>
    >;
    const out: Record<string, number> = {};
    Object.entries(attrs).forEach(([k, spec]) => {
      const m = spec?.max;
      if (spec?.type === "number" && typeof m === "number" && m > 0) out[k] = m;
    });
    return out;
  } catch {
    return {};
  }
}

// 开场流式的去重守卫（按 sessionId）：避免 React 严格模式下 effect 双触发重复生成开场。
// 放模块级，reset() 不清除，跨重挂载有效；出错时清除以允许重试。
const openingRequested: Record<string, boolean> = {};

// 进行中生成流的 AbortController。模块级而非 store 状态：控制器不是可渲染数据，
// 放 state 反而会诱发无意义的订阅渲染。reset/abort 时中断，防止离开页面后 reader
// 仍在后台往全局 store 写、连接停滞时 busy 永久锁死（optimization-plan.md P0-1）。
let streamAbort: AbortController | null = null;

type Setter = (
  partial: Partial<PlayState> | ((s: PlayState) => Partial<PlayState>)
) => void;

// runStream：开局/续写共用的流式执行外壳——起始置 busy、逐字累积 streamingText、
// revise 清空、done 后由 onDone 决定如何并入节点、收尾清标志；出错保留半截正文
// 标记中断态（玩家能看到已生成多少），下一次 runStream 开头自然归零。
async function runStream(
  set: Setter,
  path: string,
  body: unknown,
  onDone: (r: SessionResult) => void,
  onError?: () => void
): Promise<void> {
  const controller = new AbortController();
  streamAbort = controller;
  set({ busy: true, error: null, streamingText: "" });
  try {
    const r = await postStream<SessionResult>(
      path,
      body,
      {
        onDelta: (t) => set((s) => ({ streamingText: s.streamingText + t })),
        onRevise: () => set({ streamingText: "" }),
      },
      { signal: controller.signal }
    );
    onDone(r);
    set({ busy: false, streamingText: "" });
  } catch (e) {
    onError?.();
    set({ busy: false, error: (e as Error).message });
  } finally {
    streamAbort = null;
  }
}

export const usePlayStore = create<PlayState>((set, get) => ({
  session: null,
  currentNode: null,
  allNodes: [],
  storyTitle: "",
  storyKicker: "",
  coverUrl: "",
  theme: DEFAULT_THEME,
  hiddenAttrs: [],
  revealGated: [],
  attrMax: {},
  busy: false,
  readOnly: false,
  streamingText: "",
  loading: false,
  error: null,

  reset: () => {
    // 先断流再清状态：离开页面时进行中的 SSE 不能继续在后台写这个 store。
    streamAbort?.abort();
    streamAbort = null;
    set({
      session: null,
      currentNode: null,
      allNodes: [],
      storyTitle: "",
      storyKicker: "",
      coverUrl: "",
      theme: DEFAULT_THEME,
      hiddenAttrs: [],
      revealGated: [],
      attrMax: {},
      busy: false,
      readOnly: false,
      streamingText: "",
      loading: false,
      error: null,
    });
  },

  load: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const r = await api.get<SessionResult>(`/play/sessions/${sessionId}`);
      set({
        session: r.session,
        currentNode: r.current_node,
        allNodes: r.nodes ?? [],
        readOnly: r.read_only === true,
        loading: false,
      });
      // 取作品：标题（顶栏展示）+ 隐藏属性键（AI 参考）+ 揭示门控属性键（发现前不显示）。失败忽略，不影响游玩。
      api
        .get<Story>(`/stories/${r.session.story_id}`)
        .then((story) =>
          set({
            storyTitle: story.title,
            storyKicker: workKicker(story),
            coverUrl: story.cover_url ?? "",
            // resolveTheme 两种形态都吃：库里 12 部有 5 部是对象 {hue,figure}、7 部是
            // 字符串预设 id。旧的 parseTheme 对对象形态会 String() 成 "[object Object]"。
            theme: resolveTheme(story.world_config, story.id),
            hiddenAttrs: parseFlaggedAttrs(story.world_config, "hidden"),
            revealGated: parseFlaggedAttrs(story.world_config, "reveal"),
            attrMax: parseAttrMax(story.world_config),
          })
        )
        .catch(() => {});
      // 空会话（尚无开场根节点）→ 触发开场流式生成。
      if (!r.current_node && r.session.status === "active") {
        get().startOpening();
      }
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  startOpening: async () => {
    const { session, busy } = get();
    if (!session || busy || openingRequested[session.id]) return;
    openingRequested[session.id] = true;
    // 开局：整局第一个节点，allNodes 从空开始置为 [根节点]。
    await runStream(
      set,
      `/play/sessions/${session.id}/opening/stream`,
      {},
      (r) =>
        set({
          session: r.session,
          currentNode: r.current_node,
          allNodes: r.current_node ? [r.current_node] : [],
        }),
      () => delete openingRequested[session.id] // 出错清守卫，允许重试
    );
  },

  choose: async (choice) => {
    const { session, busy } = get();
    if (!session || busy || !choice.trim()) return;
    // 续写：新子节点增量并入 allNodes。**按 id 去重**——后端可能复用既有节点而不新建
    // （逐字相同的选择走 reuseExistingChild，近义选择走 tryMerge），此时返回的节点
    // 已经在 allNodes 里，无脑 push 会让树上冒出一个重复分支。
    await runStream(
      set,
      `/play/sessions/${session.id}/choice/stream`,
      { choice: choice.trim() },
      (r) =>
        set((s) => ({
          session: r.session,
          currentNode: r.current_node,
          allNodes: r.current_node
            ? [...s.allNodes.filter((n) => n.id !== r.current_node!.id), r.current_node]
            : s.allNodes,
        }))
    );
  },

  abort: () => {
    streamAbort?.abort();
    streamAbort = null;
  },

  backtrack: async (nodeId) => {
    const { session, busy } = get();
    if (!session || busy) return;
    set({ busy: true, error: null });
    try {
      const r = await api.post<SessionResult>(
        `/play/sessions/${session.id}/backtrack`,
        { node_id: nodeId }
      );
      // 回溯只移动当前指针，不产生新节点，allNodes 保持不变
      set({
        session: r.session,
        currentNode: r.current_node,
        busy: false,
      });
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
    }
  },
}));
