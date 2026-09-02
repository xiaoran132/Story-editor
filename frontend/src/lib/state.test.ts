import { describe, expect, it } from "vitest";
import {
  attrLabel,
  buildPath,
  formatAttrValue,
  formatDelta,
  parseOptions,
  parseState,
} from "./state";
import type { StoryNode } from "./types";

// 契约来源：后端把 current_state/suggested_options/state_snapshot 以
// JSON 字符串下发（service 层 Go DTO），这里锁解析兜底与展示格式化。

let seq = 0;
function node(id: string, parent_id: string | null): StoryNode {
  seq += 1;
  return {
    id,
    session_id: "s",
    story_id: "st",
    parent_id,
    depth: 0,
    choice_text: null,
    content: "",
    suggested_options: "[]",
    state_delta: "{}",
    state_snapshot: "{}",
    is_ending: false,
    ending_type: null,
    created_at: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
  };
}

describe("parseState / parseOptions", () => {
  it("合法 JSON 正常解析", () => {
    expect(parseState('{"hp":10}')).toEqual({ hp: 10 });
    expect(parseOptions('[{"text":"进门"}]')).toEqual([{ text: "进门" }]);
  });

  it("null / 空串 / 坏 JSON 给兜底值，不抛错", () => {
    expect(parseState(null)).toEqual({});
    expect(parseState(undefined)).toEqual({});
    expect(parseState("")).toEqual({});
    expect(parseState("{oops")).toEqual({});
    expect(parseOptions(null)).toEqual([]);
    expect(parseOptions("not-json")).toEqual([]);
  });

  it("options 解析出数组以外的形态按空处理", () => {
    expect(parseOptions('{"text":"不是数组"}')).toEqual([]);
  });
});

describe("formatAttrValue", () => {
  it("标量与空值", () => {
    expect(formatAttrValue(3)).toBe("3");
    expect(formatAttrValue("剑")).toBe("剑");
    expect(formatAttrValue(null)).toBe("-");
    expect(formatAttrValue(undefined)).toBe("-");
    expect(formatAttrValue(true)).toBe("是");
    expect(formatAttrValue(false)).toBe("否");
  });

  it("数组用顿号连接，空数组明示为空", () => {
    expect(formatAttrValue(["铁剑", "伤药"])).toBe("铁剑、伤药");
    expect(formatAttrValue([])).toBe("（空）");
  });

  it("set 增量形态 {add,remove} 拆开展示，不出现 [object Object]", () => {
    expect(formatAttrValue({ add: ["火把"] })).toBe("+火把");
    expect(formatAttrValue({ remove: ["地图"] })).toBe("-地图");
    expect(formatAttrValue({ add: ["火把"], remove: ["地图", "干粮"] })).toBe(
      "+火把 -地图、干粮"
    );
    expect(formatAttrValue({ add: [] })).toBe("（空）");
  });

  it("一般对象键值平铺，键走中文标签", () => {
    expect(formatAttrValue({ hp: 10 })).toBe("HP：10");
    expect(formatAttrValue({})).toBe("（空）");
  });
});

describe("attrLabel", () => {
  it("收录的键给约定俗成标签，大小写不敏感", () => {
    expect(attrLabel("hp")).toBe("HP");
    expect(attrLabel("HP")).toBe("HP");
    expect(attrLabel("sanity")).toBe("理智");
  });

  it("未收录的键把下划线换空格，不顶 snake_case", () => {
    expect(attrLabel("some_custom_key")).toBe("some custom key");
  });
});

describe("formatDelta", () => {
  it("数值带符号，0 不展示", () => {
    expect(formatDelta(3)).toBe("+3");
    expect(formatDelta(-2)).toBe("-2");
    expect(formatDelta(0)).toBeNull();
    expect(formatDelta(null)).toBeNull();
  });

  it("set 增量逐项列出，空增量不展示", () => {
    expect(formatDelta({ add: ["火把"] })).toBe("+火把");
    expect(formatDelta({ remove: ["地图"] })).toBe("-地图");
    expect(formatDelta({ add: ["火把"], remove: ["地图"] })).toBe(
      "+火把 -地图"
    );
    expect(formatDelta({ add: [] })).toBeNull();
  });

  it("scalar 覆盖标「更新」", () => {
    expect(formatDelta("新地点")).toBe("更新");
    expect(formatDelta({ set: 1 })).toBe("更新");
  });
});

describe("buildPath", () => {
  const nodes = [
    node("root", null),
    node("a", "root"),
    node("b", "a"),
    node("c", "b"),
    node("side", "a"), // 被放弃的岔路
  ];

  it("沿 parent_id 回溯出根→当前的有序路径", () => {
    expect(buildPath(nodes, "c").map((x) => x.id)).toEqual([
      "root",
      "a",
      "b",
      "c",
    ]);
  });

  it("岔路不在路径上；当前节点为叶子时路径即主线", () => {
    const path = buildPath(nodes, "b");
    expect(path.some((x) => x.id === "side")).toBe(false);
    expect(path.map((x) => x.id)).toEqual(["root", "a", "b"]);
  });

  it("null 当前节点给空路径；环数据不死循环", () => {
    expect(buildPath(nodes, null)).toEqual([]);
    const x = node("x", "y");
    const y = node("y", "x");
    expect(() => buildPath([x, y], "x")).not.toThrow();
  });
});
