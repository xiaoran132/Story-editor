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
  const content = streaming ? streamingText : node ? node.content : null;
  const placeholder = content === null ? (busy ? "AI 正在构思…" : "正在开启一段旅程…") : null;
  // 按空行/换行拆段：折叠任意连续换行为段落分隔，交给 <p> 做首行缩进与段间距，
  // 不再依赖 white-space: pre-wrap 把裸 \n\n 渲染成多余空行。
  const paras = content ? content.split(/\n+/).map((p) => p.trim()).filter(Boolean) : [];
  return (
    <>
      <div className={`story${content ? "" : " loading"}${busy ? " pulse" : ""}`}>
        {placeholder !== null
          ? placeholder
          : paras.map((p, i) => (
              <p key={i} className="story-p">
                {p}
                {streaming && i === paras.length - 1 ? <span className="caret">▌</span> : null}
              </p>
            ))}
      </div>
      {!busy && node?.is_ending && (
        <div className="ending">
          ✦ 结局（{node.ending_type || "end"}）· 可在下方星图回溯重玩
        </div>
      )}
    </>
  );
}
