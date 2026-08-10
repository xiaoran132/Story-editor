import type { StoryNode } from "@/lib/types";
import { IconSpark } from "@/components/icons";

const ENDING_LABEL: Record<string, string> = {
  good: "圆满结局",
  bad: "遗憾结局",
  neutral: "平淡结局",
  hidden: "隐藏结局",
};

// 阅读态正文面板：章节 eyebrow + 标题 + 衬线正文（无 drop-cap）+ 流式光标 + 结局横幅。
// 生命周期指示由 play 页控制，这里只渲染正文与结局。
export default function StoryPane({
  node,
  busy,
  streamingText = "",
  chapter,
}: {
  node: StoryNode | null;
  busy: boolean;
  streamingText?: string;
  chapter?: string;
}) {
  const streaming = busy && streamingText.length > 0;
  const content = streaming ? streamingText : node ? node.content : null;
  const placeholder = content === null ? (busy ? "AI 正在构思…" : "正在开启一段旅程…") : null;
  const paras = content ? content.split(/\n+/).map((p) => p.trim()).filter(Boolean) : [];

  return (
    <>
      {chapter && <div className="chapter">{chapter}</div>}
      <div className={`prose${content ? "" : " loading"}`} aria-live="polite" aria-busy={busy}>
        {placeholder !== null ? (
          <p>{placeholder}</p>
        ) : (
          paras.map((p, i) => (
            <p key={i}>
              {p}
              {streaming && i === paras.length - 1 ? <span className="cursor" aria-hidden="true" /> : null}
            </p>
          ))
        )}
      </div>
      {!busy && node?.is_ending && (
        <div className="ending">
          <span className="mk" aria-hidden="true"><IconSpark size={17} /></span>
          <span className="tx">{ENDING_LABEL[node.ending_type || ""] || "故事落幕"}</span>
          <span className="hn">于星图回溯，可另辟一条命运</span>
        </div>
      )}
    </>
  );
}
