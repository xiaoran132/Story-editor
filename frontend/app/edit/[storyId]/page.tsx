"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useEditorStore } from "@/store/editorStore";
import { useAuthStore } from "@/store/authStore";
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

  return (
    <div className="wrap">
      <StoryEditor />
    </div>
  );
}
