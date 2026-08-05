"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { useAuthStore } from "@/store/authStore";
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

  // 未登录不能创作：给出提示并回首页登录。
  useEffect(() => {
    if (user === null && typeof window !== "undefined" && !localStorage.getItem("token")) {
      router.replace("/");
    }
  }, [user, router]);

  return (
    <div className="wrap">
      <StoryEditor />
    </div>
  );
}
