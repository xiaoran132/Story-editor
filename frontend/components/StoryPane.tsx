import type { StoryNode } from "@/lib/types";

export default function StoryPane({
  node,
  busy,
  streamingText = "",
}: {
  node: StoryNode | null;
  busy: boolean;
  streamingText?: string;
}) {
  // 流式续写中：优先显示逐字到达的 streamingText（带光标感）；否则显示当前节点正文。
  const streaming = busy && streamingText.length > 0;
  const body = streaming
    ? streamingText
    : node
    ? node.content
    : busy
    ? "AI 正在构思…"
    : "正在开启一段旅程…";
  return (
    <>
      <div className={`story${node || streaming ? "" : " loading"}${busy ? " pulse" : ""}`}>
        {body}
        {streaming ? <span className="caret">▌</span> : null}
      </div>
      {!busy && node?.is_ending && (
        <div className="ending">
          ✦ 结局（{node.ending_type || "end"}）· 可在下方星图回溯重玩
        </div>
      )}
    </>
  );
}
