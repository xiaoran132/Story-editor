"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { useAuthStore } from "@/store/authStore";
import AppHeader from "@/components/AppHeader";
import StoryEditor from "@/components/editor/StoryEditor";

export default function CreatePage() {
  const router = useRouter();
  const reset = useEditorStore((s) => s.reset);
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

  // 编辑器属管理态（DESIGN §2），沿用全局导航头。
  return (
    <>
      <AppHeader />
      <main className="page-narrow section-space">
        {/* key 固定 new：从 /edit/xxx 切过来时强制重挂载，否则会继承上一部作品的步骤状态 */}
        <StoryEditor key="new" />
      </main>
    </>
  );
}
