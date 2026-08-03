"use client";

import { useEffect, useState } from "react";
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

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (sessionId) load(sessionId);
    return () => reset();
  }, [sessionId, load, reset]);

  // 星图树至少要有一个分叉（>1 节点）才有内容；早期禁用「星图」入口，避免空抽屉。
  const treeReady = allNodes.length > 1;

  // Esc 关闭抽屉。
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // 回溯后收起抽屉，回到正文看结果。
  const handleBacktrack = (nodeId: string) => {
    backtrack(nodeId);
    setDrawerOpen(false);
  };

  // 本会话已揭示的门控属性键（后端以 JSON 字符串数组返回）。
  let revealedAttrs: string[] = [];
  try {
    revealedAttrs = JSON.parse(session?.revealed_attrs || "[]");
  } catch {
    revealedAttrs = [];
  }

  return (
    <div className="wrap play-wrap">
      <div className="topbar">
        <h1>{storyTitle || "载入中…"}</h1>
        <div className="topbar-actions">
          <button
            className="ghost-btn"
            disabled={!treeReady}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            ✦ 星图
          </button>
          <span className="back" onClick={() => router.push("/")}>
            ← 返回作品
          </span>
        </div>
      </div>

      {loading ? (
        <div className="story loading pulse">载入会话中…</div>
      ) : (
        <div className="play-grid">
          <AttrBar
            stateJSON={session?.current_state ?? null}
            deltaJSON={currentNode?.state_delta ?? null}
            hiddenAttrs={hiddenAttrs}
            revealGated={revealGated}
            revealedAttrs={revealedAttrs}
            turn={session?.node_count}
            explored={allNodes.length || undefined}
          />

          <div className="stage">
            <StoryPane node={currentNode} busy={busy} streamingText={streamingText} />
            <OptionList node={currentNode} busy={busy} onChoose={choose} />
            <div className={`status${error ? " err" : busy ? " pulse" : ""}`}>
              {error
                ? `出错：${error} · 可再次选择或输入以重试`
                : busy
                ? "AI 正在生成剧情…"
                : ""}
            </div>
          </div>
        </div>
      )}

      {/* 星图抽屉：从右侧滑出，展示已探索的剧情轨迹，点节点回溯 */}
      {treeReady && (
        <>
          <div
            className={`drawer-backdrop${drawerOpen ? " open" : ""}`}
            onClick={() => setDrawerOpen(false)}
          />
          <aside className={`drawer${drawerOpen ? " open" : ""}`} aria-hidden={!drawerOpen}>
            <div className="drawer-head">
              <span className="eyebrow">✦ 已探索的轨迹</span>
              <button className="ghost-btn" onClick={() => setDrawerOpen(false)}>
                收起 ✕
              </button>
            </div>
            <StoryTree
              nodes={allNodes}
              currentNodeId={session?.current_node_id ?? null}
              busy={busy}
              onBacktrack={handleBacktrack}
              bare
            />
          </aside>
        </>
      )}
    </div>
  );
}
