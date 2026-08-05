"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import type { Story } from "@/lib/types";

// 「我的作品」：列出当前创作者全部作品（含草稿），支持编辑/发布切换/删除。
export default function MinePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const initAuth = useAuthStore((s) => s.init);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const reload = () => {
    api
      .get<Story[]>("/stories/mine")
      .then((st) => setStories(st ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("token")) {
      router.replace("/");
      return;
    }
    reload();
  }, [user]);

  const toggleStatus = async (s: Story) => {
    const next = s.status === "published" ? "draft" : "published";
    try {
      await api.put(`/stories/${s.id}/status`, { status: next });
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    const prev = stories;
    setStories((list) => list.filter((s) => s.id !== id));
    setConfirmId(null);
    try {
      await api.del(`/stories/${id}`);
    } catch (e) {
      setStories(prev);
      setError((e as Error).message);
    }
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <span className="back" onClick={() => router.push("/")}>
          ← 返回首页
        </span>
        <button className="primary-btn" onClick={() => router.push("/create")}>
          + 创作新作品
        </button>
      </div>

      <h1 className="ed-h1">我的作品</h1>
      {error && <div className="status err">出错：{error}</div>}

      {loading ? (
        <div className="empty pulse">载入中…</div>
      ) : stories.length === 0 ? (
        <div className="empty">还没有作品，点右上角开始创作</div>
      ) : (
        <div className="grid">
          {stories.map((s) => (
            <div className="card" key={s.id}>
              <div className="title">{s.title || "未命名作品"}</div>
              <div className="desc">{s.description || "（暂无简介）"}</div>
              <div className="metaline">
                <span className={`badge ${s.status === "published" ? "active" : "ended"}`}>
                  {s.status === "published" ? "已发布" : "草稿"}
                </span>
              </div>
              <div className="ed-card-actions">
                <button className="ghost-btn" onClick={() => router.push(`/edit/${s.id}`)}>
                  编辑
                </button>
                <button className="ghost-btn" onClick={() => toggleStatus(s)}>
                  {s.status === "published" ? "取消发布" : "发布"}
                </button>
                {confirmId === s.id ? (
                  <button className="ed-del confirm" onClick={() => remove(s.id)}>
                    确认删除？
                  </button>
                ) : (
                  <button className="ed-del" onClick={() => setConfirmId(s.id)}>
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
