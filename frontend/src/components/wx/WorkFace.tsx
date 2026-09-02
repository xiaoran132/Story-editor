"use client";

import { useState } from "react";
import Sky from "@/components/sky/Sky";
import { assetUrl } from "@/lib/api";
import { resolveTheme } from "@/lib/hue";
import { hashSeed } from "@/lib/prng";
import { workKicker } from "@/lib/work";
import type { Story } from "@/lib/types";

// 一张作品卡的**卡面内容**：封面或天空，加一块名牌。外层尺寸、圆角、边框由使用方决定
// （星系卡是 .work、聚焦大卡是 .fcard、作品馆是网格项），这里只管里面。
//
// ⚠️ 不含 <WorldScope>：卡面要染的 --hue 属于**外层那个元素**（星系卡本身就是
// world-scope 的按钮，聚焦卡是浮层里的容器）。在这里再套一层会多出一个无谓的
// 定位盒，也让「谁是这张卡」变得含糊。使用方负责套。
//
// **两条分支都是正常态**：
//   有 cover_url → 用作者的封面，整张铺满，不压色罩（压了等于替作者改图；
//                  名牌自己那层 --w-plate 是 alpha .92 的近黑，文字对比度它兜住了）
//   没有        → 回落到该作品主题色的天空 + 剪影
// 库里 12 部当前 cover_url 全空，所以现在看到的全是天空那条；这不代表另一条是补丁。
//
// 图挂了（403 / 删档 / 域名换了）也回落到天空：卡片是星系里的一个天体，
// 留一块「封面暂不可用」的灰盒子比换回天空更伤。

export type WorkFaceProps = {
  story: Story;
  /** 大卡（聚焦浮层 / 详情页头图）：剪影与名牌一起放大，星点也多一档。 */
  big?: boolean;
};

export default function WorkFace({ story, big }: WorkFaceProps) {
  const [broken, setBroken] = useState(false);
  // assetUrl：上传回来的是 /api/v1/uploads/... 这样的相对路径，要补上后端 origin
  const cover = broken ? "" : assetUrl(story.cover_url || "");

  const { figure } = resolveTheme(story.world_config, story.id);
  // 种子取自 story.id：同一部作品的星图永远一样，换排布、重渲染都不跳。
  const seed = hashSeed(story.id);

  return (
    <>
      {cover ? (
        // alt 留空是有意的：名牌就在旁边写着题材与作品名，给图再配一段描述
        // 会让读屏把同一部作品念两遍。
        <img
          className="wx-cover"
          src={cover}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <Sky
          seed={seed}
          pose={figure}
          className={big ? "wx-card-lg" : undefined}
          layers={{
            halo: true,
            clouds: 2,
            stars: big ? 26 : 14,
            meteor: true,
            horizon: true,
          }}
        />
      )}
      <span className={`wx-plate${big ? " wx-card-lg" : ""}`}>
        <span className="wx-kicker">{workKicker(story)}</span>
        <span className="wx-name">{story.title}</span>
      </span>
    </>
  );
}
