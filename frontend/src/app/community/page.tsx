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
              社区要做的是<strong>跨作者的衍生</strong>——从他人的世界分叉出自己的一条路，
              再让这些分叉彼此可见。它依赖的能力目前都不具备：跨作者的分叉、分支归属与动态流
              都尚未实现。
            </p>
            <p>
              在这些能力落地之前，这里不会放置虚假动态。一个看似热闹却无法交互的广场，
              比一句「尚未开放」更浪费时间。
            </p>
          </>
        }
        have={
          <>
            <b>已经能用的：</b>点赞。任何一部作品的详情页都可点赞，计数真实有效，
            重复点击不会重复计入。评论、收藏、关注、分叉均尚未实现。
          </>
        }
        exits={[
          { href: "/works", label: "前往作品馆" },
          { href: "/", label: "回到星海" },
        ]}
      />
    </div>
  );
}
