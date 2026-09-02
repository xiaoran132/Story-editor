"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useParams } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { useAuthStore } from "@/store/authStore";
import Backdrop from "@/components/sky/Backdrop";
import WxHeader from "@/components/wx/WxHeader";
import StoryEditor from "@/components/editor/StoryEditor";

export default function EditPage() {
  const params = useParams<{ storyId: string }>();
  const storyId = params.storyId;
  const loadStory = useEditorStore((s) => s.loadStory);
  const reset = useEditorStore((s) => s.reset);
  const theme = useEditorStore((s) => s.theme);
  const initAuth = useAuthStore((s) => s.init);

  useEffect(() => {
    initAuth();
    reset();
    if (storyId) loadStory(storyId);
  }, [storyId, loadStory, reset, initAuth]);

  return (
    <div style={{ "--ambient-hue": theme.hue } as CSSProperties}>
      <Backdrop />
      <WxHeader />
      {/* key 随作品 id 变：换一部作品即重挂载，不继承上一部的段落状态 */}
      <StoryEditor key={storyId} />
    </div>
  );
}
