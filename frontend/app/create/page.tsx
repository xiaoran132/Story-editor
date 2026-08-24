"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { useAuthStore } from "@/store/authStore";
import Backdrop from "@/components/sky/Backdrop";
import WxHeader from "@/components/wx/WxHeader";
import StoryEditor from "@/components/editor/StoryEditor";

export default function CreatePage() {
  const router = useRouter();
  const reset = useEditorStore((s) => s.reset);
  const theme = useEditorStore((s) => s.theme);
  const user = useAuthStore((s) => s.user);
  const initAuth = useAuthStore((s) => s.init);

  useEffect(() => {
    initAuth();
    reset();
  }, [initAuth, reset]);

  // 未登录不能创作：直接送去登录页（以前甩回首页，用户还得自己找登录入口），
  // 并带上 next 参数，登录后回到创作。
  useEffect(() => {
    if (user === null && typeof window !== "undefined" && !localStorage.getItem("token")) {
      router.replace("/login?next=/create");
    }
  }, [user, router]);

  // 整片深空跟着正在创作的这部作品的色相走：拖色相条时背景一起变，
  // 「这是你的世界的颜色」这件事不必再解释一遍。
  return (
    <div style={{ "--ambient-hue": theme.hue } as CSSProperties}>
      <Backdrop />
      <WxHeader />
      {/* key 固定 new：从 /edit/xxx 切过来时强制重挂载，否则会继承上一部作品的段落状态 */}
      <StoryEditor key="new" />
    </div>
  );
}
