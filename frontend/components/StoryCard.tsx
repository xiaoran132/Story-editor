import type { CSSProperties } from "react";
import { themeAccent, type Story } from "@/lib/types";

// 从 world_config 取主题 id（缺省 star）。首页卡片仅据此微染，不整卡换肤。
function cardTheme(worldConfig: string): string {
  try {
    return String(JSON.parse(worldConfig || "{}").theme ?? "star") || "star";
  } catch {
    return "star";
  }
}

export default function StoryCard({
  story,
  onClick,
  disabled,
}: {
  story: Story;
  onClick: () => void;
  disabled?: boolean;
}) {
  const theme = cardTheme(story.world_config);
  const themed = theme !== "star";
  const accent = themeAccent(theme);
  // 非默认主题：本地覆盖 --glow/--glow-soft，使 hover 描边与光晕呼应作品强调色（不影响其他卡）。
  const accentVars = themed
    ? ({ "--glow": accent, "--glow-soft": `${accent}22` } as CSSProperties)
    : undefined;

  return (
    <div
      className={`card${themed ? " themed" : ""}`}
      onClick={disabled ? undefined : onClick}
      style={{
        ...accentVars,
        ...(disabled ? { opacity: 0.6, cursor: "default" } : {}),
      }}
    >
      {themed && (
        <span className="card-theme-dot" style={{ background: accent }} aria-hidden />
      )}
      <div className="title">{story.title}</div>
      {story.description ? (
        <div className="desc">{story.description}</div>
      ) : (
        <div className="desc">（暂无简介）</div>
      )}
      <div className="metaline">
        <span>▶ {story.play_count}</span>
        <span>♥ {story.like_count}</span>
      </div>
    </div>
  );
}
