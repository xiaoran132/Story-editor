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
    busy,
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

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>AI 互动剧情</h1>
        <span className="back" onClick={() => router.push("/")}>
          ← 返回作品
        </span>
      </div>

      {loading ? (
        <div className="story loading pulse">载入会话中…</div>
      ) : (
        <>
          <AttrBar stateJSON={session?.current_state ?? null} />
          <StoryPane node={currentNode} busy={busy} />
          <OptionList node={currentNode} busy={busy} onChoose={choose} />

          <div className={`status${error ? " err" : busy ? " pulse" : ""}`}>
            {error
              ? `出错：${error}`
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
