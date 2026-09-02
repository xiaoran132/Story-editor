"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import Backdrop from "@/components/sky/Backdrop";
import WxHeader from "@/components/wx/WxHeader";
import SubNav from "@/components/wx/SubNav";
import Soon from "@/components/wx/Soon";

// 消息。无消息模型、无表、无路由——二级导航里保留这一项（少一项会让人以为功能被砍了），
// 但页面不渲染任何一条假消息（plan.md §一）。
export default function InboxPage() {
  const initAuth = useAuthStore((s) => s.init);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <div>
      <Backdrop />
      <WxHeader />
      <SubNav />
      <Soon
        eyebrow="我的空间 · 消息"
        title="还没有人能给你留言。"
        body={
          <>
            <p>
              消息需要它所承载的事先存在：他人点赞你的作品、从你的世界分叉出一条路、
              关注了你。这些互动<strong>目前仅点赞已实现</strong>，而点赞尚未接入通知。
            </p>
            <p>保留该入口是因为功能确会上线；现在打开是空的，不必假装不是。</p>
          </>
        }
        exits={[
          { href: "/mine", label: "返回我的空间" },
          { href: "/works", label: "前往作品馆" },
        ]}
      />
    </div>
  );
}
