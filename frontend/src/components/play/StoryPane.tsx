import type { StoryNode } from "@/lib/types";
import { IconSpark } from "@/components/ui/icons";
import styles from "./StoryPane.module.css";

const ENDING_LABEL: Record<string, string> = {
  good: "圆满结局",
  bad: "遗憾结局",
  neutral: "平淡结局",
  hidden: "隐藏结局",
};

// 正文面板：章节行 + 逐段正文（无首字下沉）+ 流式光标 + 结局横幅。
// 生命周期指示（生成中/生成中断/已交付）由游玩页顶栏负责，这里只渲染正文与结局。
// 出错时 streamingText 保留半截正文（中断态）：正文优先显示它，光标只在 busy 时亮。
export default function StoryPane({
  node,
  busy,
  streamingText = "",
  chapter,
  progress,
}: {
  node: StoryNode | null;
  busy: boolean;
  streamingText?: string;
  chapter?: string;
  /** 章节行右侧那个「第几步」的计数。后端没有章节概念，这里给的是真实的节点深度。 */
  progress?: string;
}) {
  const hasStream = streamingText.length > 0;
  const streaming = busy && hasStream;
  const content = hasStream ? streamingText : node ? node.content : null;
  const placeholder = content === null ? (busy ? "AI 正在构思…" : "正在开启一段旅程…") : null;
  const paras = content
    ? content
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  return (
    <>
      {chapter && (
        <div className={styles.chapter}>
          <span className={styles.no}>{chapter}</span>
          <span className={styles.rule} aria-hidden="true" />
          {progress && <span className={styles.cnt}>{progress}</span>}
        </div>
      )}

      <div
        className={`${styles.prose} ${content ? "" : styles.loading}`}
        aria-live="polite"
        aria-busy={busy}
      >
        {placeholder !== null ? (
          <p>{placeholder}</p>
        ) : (
          paras.map((p, i) => (
            <p key={i}>
              {p}
              {streaming && i === paras.length - 1 ? (
                <span className={styles.cursor} aria-hidden="true" />
              ) : null}
            </p>
          ))
        )}
      </div>

      {!busy && node?.is_ending && (
        <div className={styles.ending}>
          <span className={styles.mk} aria-hidden="true">
            <IconSpark size={17} />
          </span>
          <span className={styles.tx}>{ENDING_LABEL[node.ending_type || ""] || "故事落幕"}</span>
          <span className={styles.hn}>于世界星图回溯，可另辟一条命运</span>
        </div>
      )}
    </>
  );
}
