"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { resolveTheme } from "@/lib/hue";
import Backdrop from "@/components/sky/Backdrop";
import WxHeader from "@/components/wx/WxHeader";
import WorkDetail from "@/components/WorkDetail";
import type { Story } from "@/lib/types";
import styles from "./page.module.css";

// 作品详情。设计稿把详情做成星系的**聚焦面板浮层**，没有独立详情页——
// 但深链、分享链接、`/login?next=/story/xxx` 的回跳都需要一个能单独存在的页面。
// 所以这里不写第二套内容，只是把 <WorkDetail> 以整页密度渲染一遍；
// 星系那边是同一个组件的 overlay 密度。
//
// 整片深空跟随本作品的色相（--ambient-hue，过渡 1.1s）：从星海点进来，
// 背景色会一路过渡过来，而不是切成另一个场景。

export default function StoryDetailPage() {
  const params = useParams<{ storyId: string }>();
  const storyId = params.storyId;
  const initAuth = useAuthStore((s) => s.init);

  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (!storyId) return;
    setLoading(true);
    api
      .get<Story>(`/stories/${storyId}`)
      .then(setStory)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [storyId]);

  // 草稿只有作者看得见，别人拿到的是 404——这是有意的（一部草稿的存在是作者的事）。
  // 所以取不到时不猜原因，照实说「打不开」并给回星海的出口。
  const ambient = story ? resolveTheme(story.world_config, story.id).hue : 252;

  return (
    <div style={{ "--ambient-hue": ambient } as CSSProperties}>
      <Backdrop />
      <WxHeader />

      <main className={styles.main}>
        {loading ? (
          <p className={styles.state}>正在打开这个世界…</p>
        ) : story ? (
          <WorkDetail story={story} variant="page" />
        ) : (
          <div className={styles.state}>
            <p className={styles.stateTitle}>暂时无法打开这个世界</p>
            <p className={styles.stateDesc}>
              {error || "它可能已经被作者收回，或者还是一份草稿。"}
            </p>
            <Link className={styles.stateLink} href="/">
              ← 回到星海
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
