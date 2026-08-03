import type { StoryNode } from "@/lib/types";

const ENDING_LABEL: Record<string, string> = {
  good: "圆满结局",
  bad: "遗憾结局",
  neutral: "平淡结局",
  hidden: "隐藏结局",
};

export default function StoryPane({
  node,
  busy,
  streamingText = "",
  opening = false,
}: {
  node: StoryNode | null;
  busy: boolean;
  streamingText?: string;
  opening?: boolean; // 开场（根节点/开局流式）：首字下沉 + 轻入场，作阅读仪式感
}) {
  // 流式续写中：优先显示逐字到达的 streamingText（带光标感）；否则显示当前节点正文。
  const streaming = busy && streamingText.length > 0;
  const content = streaming ? streamingText : node ? node.content : null;
  const placeholder = content === null ? (busy ? "AI 正在构思…" : "正在开启一段旅程…") : null;
  // 按空行/换行拆段：折叠任意连续换行为段落分隔，交给 <p> 做首行缩进与段间距，
  // 不再依赖 white-space: pre-wrap 把裸 \n\n 渲染成多余空行。
  const paras = content ? content.split(/\n+/).map((p) => p.trim()).filter(Boolean) : [];
  const cls =
    "story" + (content ? "" : " loading") + (busy ? " pulse" : "") + (opening && content ? " opening" : "");
  return (
    <>
      <div className={cls}>
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
          <span className="ending-mark">✦</span>
          <span className="ending-text">
            {ENDING_LABEL[node.ending_type || ""] || "故事落幕"}
          </span>
          <span className="ending-hint">于右侧星图回溯，可另辟一条命运</span>
        </div>
      )}
    </>
  );
}
