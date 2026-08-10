"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { useAuthStore } from "@/store/authStore";
import AppHeader from "@/components/AppHeader";
import StoryEditor from "@/components/editor/StoryEditor";

export default function EditPage() {
  const params = useParams<{ storyId: string }>();
  const storyId = params.storyId;
  const loadStory = useEditorStore((s) => s.loadStory);
  const reset = useEditorStore((s) => s.reset);
  const initAuth = useAuthStore((s) => s.init);

  useEffect(() => {
    initAuth();
    reset();
    if (storyId) loadStory(storyId);
  }, [storyId, loadStory, reset, initAuth]);

  // 编辑器属管理态（DESIGN §2：只有「走进作品之后」才是阅读态），沿用全局导航头。
  return (
    <>
      <AppHeader />
      <main className="page-narrow section-space">
        <StoryEditor />
      </main>
    </>
  );
}
