// 作品的 world_config 解读。**收敛点**：这套解析原先在首页、详情页、卡片里各写了一份，
// 键名一改就得三处同步。所有消费方从这里取。
//
// world_config 在 API 里是 **JSON 字符串**（service.StoryCreateInput.WorldConfig 是 string），
// 不是对象；未知键后端原样透传（Go 侧 worldConfigShape 忽略它们），所以这里只挑认识的键读，
// 读不到一律给可渲染的兜底值，绝不抛。

import type { Story } from "./types";

export interface AttrSpec {
  type?: string;
  initial?: unknown;
  hidden?: boolean;
  reveal?: boolean;
  max?: number;
}

export interface WorldConfig {
  background?: string;
  style?: string;
  rules?: string;
  outline?: string;
  characters?: Array<{ name?: string; role?: string; personality?: string; desc?: string }>;
  tags?: string[];
  attributes?: Record<string, AttrSpec>;
  initial_state?: Record<string, unknown>;
  recommended_models?: Record<string, unknown>;
  theme?: unknown;
}

export function parseWorld(worldConfig: string | null | undefined): WorldConfig {
  try {
    const o = JSON.parse(worldConfig || "{}");
    return o && typeof o === "object" ? (o as WorldConfig) : {};
  } catch {
    return {};
  }
}

/**
 * 题材标签。约定 `tags[0]` 是主题材，其余作展示标签。
 * ⚠️ 不要拿 `theme` 充题材——theme 只决定配色（hue + 剪影姿态），两者语义不同。
 */
export function storyTags(story: Story): string[] {
  const t = parseWorld(story.world_config).tags;
  return Array.isArray(t) ? t.map(String).filter(Boolean) : [];
}

/**
 * 卡片角标。库里实测 12 部有 11 部带 tags，缺的那一部必须有兜底——
 * 角标是卡片版式的一部分，渲染成空白会让那张卡看起来是坏的。
 */
export function workKicker(story: Story): string {
  return storyTags(story)[0] || "未分类";
}

/**
 * 玩家可见的属性。
 *
 * `hidden` **整条不出现**：它的契约是「仅供 AI 参考、玩家端永不展示」，连它存在都不该
 * 让玩家知道（猜疑度、命运值这类背后压力表一旦亮出来，玩法就变味了）。后端的
 * sanitizeWorldConfig 对非作者已经整条 delete，这里再滤一遍是为了作者自己看自己作品时
 * 的一致性——作者拿到的是未脱敏数据。
 *
 * `reveal` 相反：明说「有东西会在剧情里显现」是钩子，只是不泄露初值。
 */
export function visibleAttrs(world: WorldConfig): Array<[string, AttrSpec]> {
  return Object.entries(world.attributes || {}).filter(([, spec]) => !spec?.hidden);
}
