import type { StoryNode } from "@/lib/types";

export default function StoryPane({
  node,
  busy,
}: {
  node: StoryNode | null;
  busy: boolean;
}) {
  return (
    <>
      <div className={`story${node ? "" : " loading"}`}>
        {node ? node.content : "正在开启一段旅程…"}
      </div>
      {node?.is_ending && (
        <div className="ending">
          ✦ 结局（{node.ending_type || "end"}）· 可在下方星图回溯重玩
        </div>
      )}
    </>
  );
}
