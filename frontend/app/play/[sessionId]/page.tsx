"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePlayStore } from "@/store/playStore";
import AttrBar from "@/components/AttrBar";
import StoryPane from "@/components/StoryPane";
import OptionList from "@/components/OptionList";
import StoryTree from "@/components/StoryTree";

export default function PlayPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const {
    session,
    currentNode,
    allNodes,
    storyTitle,
    hiddenAttrs,
    revealGated,
    busy,
    streamingText,
    loading,
    error,
    load,
    choose,
    backtrack,
    reset,
  } = usePlayStore();

  useEffect(() => {
    if (sessionId) load(sessionId);
    return () => reset();
  }, [sessionId, load, reset]);

  // 本会话已揭示的门控属性键（后端以 JSON 字符串数组返回）。
  let revealedAttrs: string[] = [];
  try {
    revealedAttrs = JSON.parse(session?.revealed_attrs || "[]");
  } catch {
    revealedAttrs = [];
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>{storyTitle || "载入中…"}</h1>
        <span className="back" onClick={() => router.push("/")}>
          ← 返回作品
        </span>
      </div>

      {loading ? (
        <div className="story loading pulse">载入会话中…</div>
      ) : (
        <>
          <AttrBar
            stateJSON={session?.current_state ?? null}
            deltaJSON={currentNode?.state_delta ?? null}
            hiddenAttrs={hiddenAttrs}
            revealGated={revealGated}
            revealedAttrs={revealedAttrs}
          />
          <StoryPane node={currentNode} busy={busy} streamingText={streamingText} />
          <OptionList node={currentNode} busy={busy} onChoose={choose} />

          <div className={`status${error ? " err" : busy ? " pulse" : ""}`}>
            {error
              ? `出错：${error} · 可再次选择或输入以重试`
              : busy
              ? "AI 正在生成剧情…"
              : ""}
          </div>

          <StoryTree
            nodes={allNodes}
            currentNodeId={session?.current_node_id ?? null}
            busy={busy}
            onBacktrack={backtrack}
          />
        </>
      )}
    </div>
  );
}
