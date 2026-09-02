import { describe, expect, it } from "vitest";
import {
  FILLER_CHOICE,
  isFillerChoice,
  layoutTree,
  type PositionedNode,
} from "./tree";
import type { StoryNode } from "./types";

// 契约来源：docs/handoff.md 对世界星图折叠规则的描述。
// 这里锁的是「哪些折、哪些绝不折、横轴是什么」——改 tree.ts 的折叠逻辑必跑这份。

let seq = 0;
/** 造节点：只填布局用到的字段，parent/choice/ending 按用例给。 */
function n(
  id: string,
  parent_id: string | null,
  choice_text: string | null,
  extra: Partial<StoryNode> = {}
): StoryNode {
  seq += 1;
  return {
    id,
    session_id: "s",
    story_id: "st",
    parent_id,
    depth: 0,
    choice_text,
    content: "",
    suggested_options: "[]",
    state_delta: "{}",
    state_snapshot: "{}",
    is_ending: false,
    ending_type: null,
    created_at: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    ...extra,
  };
}

const byId = (nodes: PositionedNode[]) =>
  new Map(nodes.map((p) => [p.id, p]));

describe("isFillerChoice", () => {
  it("开局不是翻页", () => {
    expect(isFillerChoice(n("root", null, null))).toBe(false);
    expect(isFillerChoice(n("root", null, FILLER_CHOICE))).toBe(false);
  });

  it("「继续」与空 choice 是翻页，真实选择不是", () => {
    expect(isFillerChoice(n("a", "root", FILLER_CHOICE))).toBe(true);
    expect(isFillerChoice(n("b", "root", null))).toBe(true);
    expect(isFillerChoice(n("c", "root", ""))).toBe(true);
    expect(isFillerChoice(n("d", "root", "走进森林"))).toBe(false);
  });
});

describe("layoutTree 折叠契约", () => {
  it("连续「继续」折成一颗星，node 取段末（终态快照）", () => {
    const nodes = [
      n("root", null, null),
      n("a", "root", FILLER_CHOICE),
      n("b", "a", FILLER_CHOICE),
      n("c", "b", FILLER_CHOICE),
      n("end", "c", "真实选择"),
    ];
    const t = layoutTree(nodes, "end");
    const ids = t.nodes.map((p) => p.id).sort();
    expect(ids).toEqual(["end", "root", "run:a"].sort());
    const run = byId(t.nodes).get("run:a")!;
    expect(run.collapsed?.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(run.node.id).toBe("c"); // 段末：检视面板拿到的是这段的终态
  });

  it("只有一页「继续」不折叠——一颗星换一颗星没有意义", () => {
    const nodes = [
      n("root", null, null),
      n("a", "root", FILLER_CHOICE),
      n("b", "a", "真实选择"),
    ];
    const t = layoutTree(nodes, "b");
    expect(t.nodes.map((p) => p.id)).toEqual(["root", "a", "b"]);
    expect(t.nodes.every((p) => !p.collapsed)).toBe(true);
  });

  it("分叉只终止延伸不阻止折叠：岔路从折叠星上照常挂出", () => {
    const nodes = [
      n("root", null, null),
      n("a", "root", FILLER_CHOICE),
      n("b", "a", FILLER_CHOICE),
      n("left", "b", "向左"),
      n("right", "b", "向右"),
    ];
    const t = layoutTree(nodes, "left");
    const m = byId(t.nodes);
    expect(m.has("run:a")).toBe(true);
    expect(m.get("run:a")!.collapsed?.length).toBe(2);
    // 两个分叉都在，父显示项都是折叠星
    expect(m.get("left")!.parentItemId).toBe("run:a");
    expect(m.get("right")!.parentItemId).toBe("run:a");
  });

  it("结局不折叠，单独留一颗星", () => {
    const nodes = [
      n("root", null, null),
      n("a", "root", FILLER_CHOICE),
      n("e", "a", FILLER_CHOICE, { is_ending: true, ending_type: "end" }),
    ];
    const t = layoutTree(nodes, "e");
    // a 无法与 e 合段（结局终止延伸），单独一枚「继续」又不够折叠：
    // 结果是三颗单星，结局绝不被吞进前一段
    const m = byId(t.nodes);
    expect(m.has("run:a")).toBe(false);
    expect(m.get("a")!.node.id).toBe("a");
    expect(m.get("e")!.node.is_ending).toBe(true);
  });

  it("当前所在可被折进段尾，折叠星被标为当前所在", () => {
    const nodes = [
      n("root", null, null),
      n("a", "root", FILLER_CHOICE),
      n("b", "a", FILLER_CHOICE),
      n("c", "b", FILLER_CHOICE),
    ];
    const t = layoutTree(nodes, "c");
    const run = byId(t.nodes).get("run:a")!;
    expect(run.isCurrent).toBe(true);
    expect(run.node.id).toBe("c"); // 玩家真实状态
  });

  it("回溯后当前节点落在链中间：它收下即止，尾部另起一段照折", () => {
    const nodes = [
      n("root", null, null),
      n("a", "root", FILLER_CHOICE),
      n("b", "a", FILLER_CHOICE),
      n("c", "b", FILLER_CHOICE),
      n("d", "c", FILLER_CHOICE),
    ];
    const t = layoutTree(nodes, "b");
    const m = byId(t.nodes);
    const run = m.get("run:a")!;
    expect(run.collapsed?.map((x) => x.id)).toEqual(["a", "b"]);
    expect(run.node.id).toBe("b");
    expect(run.isCurrent).toBe(true);
    // b 之后的 c、d 自成一段（≥2 枚照折），结构与「我在哪」互不干扰
    expect(m.get("run:c")!.collapsed?.map((x) => x.id)).toEqual(["c", "d"]);
  });

  it("expanded 须含段内每个节点 id 才展开", () => {
    const nodes = [
      n("root", null, null),
      n("a", "root", FILLER_CHOICE),
      n("b", "a", FILLER_CHOICE),
      n("c", "b", FILLER_CHOICE),
    ];
    // 只展开段首：a 单飞，b、c 又从 b 起折出一段新的——尾巴重新塌回去
    const half = layoutTree(nodes, "c", undefined, new Set(["a"]));
    expect(half.nodes.map((p) => p.id).sort()).toEqual(
      ["root", "a", "run:b"].sort()
    );
    // 段内全展开：回到四颗单星
    const full = layoutTree(
      nodes,
      "c",
      undefined,
      new Set(["a", "b", "c"])
    );
    expect(full.nodes.map((p) => p.id).sort()).toEqual(
      ["root", "a", "b", "c"].sort()
    );
  });
});

describe("layoutTree 几何", () => {
  const forked = [
    n("root", null, null),
    n("keep", "root", "主线选择"),
    n("drop", "root", "被放弃的选择"),
    n("tail", "keep", FILLER_CHOICE),
  ];

  it("横轴是显示列：折叠段只占一列，后续节点跟着左移", () => {
    const chain = [
      n("root", null, null),
      n("a", "root", FILLER_CHOICE),
      n("b", "a", FILLER_CHOICE),
      n("c", "b", FILLER_CHOICE),
      n("z", "c", "真实选择"),
    ];
    const t = layoutTree(chain, "z");
    const m = byId(t.nodes);
    expect(m.get("root")!.col).toBe(0);
    expect(m.get("run:a")!.col).toBe(1); // 三页翻页占一列
    expect(m.get("z")!.col).toBe(2); // 而不是 depth=4
  });

  it("主线子节点继承父行：根→当前是一条水平直线", () => {
    const t = layoutTree(forked, "tail");
    const m = byId(t.nodes);
    const rootY = m.get("root")!.y;
    expect(m.get("keep")!.y).toBe(rootY);
    expect(m.get("tail")!.y).toBe(rootY);
    expect(m.get("drop")!.y).toBeGreaterThan(rootY); // 被放弃的岔路挂在下面
  });

  it("主线端点 onPath，岔路不在主线上", () => {
    const t = layoutTree(forked, "tail");
    const m = byId(t.nodes);
    expect(m.get("root")!.onPath).toBe(true);
    expect(m.get("keep")!.onPath).toBe(true);
    expect(m.get("tail")!.onPath).toBe(true);
    expect(m.get("drop")!.onPath).toBe(false);
  });

  it("无 availWidth 时层距回落上限，短局不摊稀", () => {
    const t = layoutTree(forked, "tail");
    expect(t.step).toBe(132); // STEP_MAX：与实现常量一致，改常量请同步这里
  });

  it("环数据不炸：互为父子意味着没有根，布局产出空树而非死循环", () => {
    const a = n("a", "b", FILLER_CHOICE);
    const b = n("b", "a", FILLER_CHOICE);
    const t = layoutTree([a, b], null);
    expect(t.nodes).toEqual([]);
    expect(t.edges).toEqual([]);
  });
});
