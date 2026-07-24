import type { Story } from "@/lib/types";

export default function StoryCard({
  story,
  onClick,
  disabled,
}: {
  story: Story;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="card"
      onClick={disabled ? undefined : onClick}
      style={disabled ? { opacity: 0.6, cursor: "default" } : undefined}
    >
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
