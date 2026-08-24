"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import Backdrop from "@/components/sky/Backdrop";
import WxHeader from "@/components/wx/WxHeader";
import Soon from "@/components/wx/Soon";

// 社区广场。设计稿（§7.4）画的是一整条跨作者的衍生事件流，但后端**零路由零表零 handler**——
// `/community/*` 至今未注册。照着渲染事件流，每一条都会被读成真的。
// 所以这一页只套新壳 + 说明 + 出口，一条假数据都不放（plan.md §一）。
export default function CommunityPage() {
  const initAuth = useAuthStore((s) => s.init);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <div>
      <Backdrop />
      <WxHeader />
      <Soon
        eyebrow="万象 · 社区"
        title="这片广场还没有开。"
        body={
          <>
            <p>
              社区要做的是<strong>跨作者的衍生</strong>——从别人的世界里岔出一条自己的路，
              再让这些分叉彼此看得见。它依赖的东西现在一样都还没有：没有 fork 模型、没有分支归属、
              没有跨作品的事件流。
            </p>
            <p>
              在这些落地之前，这里不会摆一条假的动态。看着热闹却点不动的广场，
              比一句「还没开」更浪费你的时间。
            </p>
          </>
        }
        have={
          <>
            <b>已经能用的：</b>点赞。任何一部作品的详情页都能赞，计数是真的，
            重复点不会重复计。评论、收藏、关注、分叉都还没有。
          </>
        }
        exits={[
          { href: "/works", label: "去作品馆逛逛" },
          { href: "/", label: "回到星海" },
        ]}
      />
    </div>
  );
}
