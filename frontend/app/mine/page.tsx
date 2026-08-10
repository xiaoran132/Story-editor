"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import AppHeader from "@/components/AppHeader";
import SessionCard from "@/components/SessionCard";
import { SkeletonWall, EmptyState, ErrorState } from "@/components/State";
import { IconPlus } from "@/components/icons";
import { themeGradient, type SessionListItem, type Story, type UserProfile } from "@/lib/types";

// 「我的空间」（对齐原型 my-space.html）：资料头 + 两个页签——我的创作 / 我在读。
// 「我在读」原先寄居在首页，会让书库首屏被个人数据挤占；按原型迁到这里，
// 导航入口在 AppHeader（/mine#reading）。
type Tab = "works" | "reading";

function parseTheme(worldConfig: string): string {
  try {
    return String(JSON.parse(worldConfig || "{}").theme ?? "star") || "star";
  } catch {
    return "star";
  }
}

export default function MinePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const initAuth = useAuthStore((s) => s.init);

  const [tab, setTab] = useState<Tab>("works");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // 两种错误分开：loadError 决定整块列表要不要换成错误态；
  // actionError（发布/删除失败）只作横幅，不能把用户的作品列表整个抹掉。
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // URL 带 #reading 直接落在「我在读」（原型 my-space.html:225 的直达锚点）
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#reading") setTab("reading");
  }, []);

  const reload = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<Story[]>("/stories/mine"),
      api.get<UserProfile>("/auth/profile"),
      api.get<SessionListItem[]>("/play/sessions"),
    ])
      .then(([st, p, se]) => {
        setStories(st ?? []);
        setProfile(p);
        setSessions(se ?? []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("token")) {
      router.replace("/login?next=/mine");
      return;
    }
    reload();
  }, [user]);

  // 「被游玩 / 获赞」由我的作品求和得出，不需要新接口。
  const totals = useMemo(
    () =>
      stories.reduce(
        (acc, s) => ({ play: acc.play + s.play_count, like: acc.like + s.like_count }),
        { play: 0, like: 0 }
      ),
    [stories]
  );

  // 存档卡的缩略色取自对应作品的主题；不在「我的作品」里的（别人的作品）回落默认。
  const themeOf = useMemo(() => {
    const m = new Map<string, string>();
    stories.forEach((s) => m.set(s.id, parseTheme(s.world_config)));
    return m;
  }, [stories]);

  const toggleStatus = async (s: Story) => {
    const next = s.status === "published" ? "draft" : "published";
    try {
      setActionError(null);
      await api.put(`/stories/${s.id}/status`, { status: next });
      reload();
    } catch (e) {
      setActionError((e as Error).message);
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
      setActionError((e as Error).message);
    }
  };

  const deleteSession = async (id: string) => {
    const prev = sessions;
    setSessions((list) => list.filter((s) => s.id !== id));
    try {
      await api.del(`/play/sessions/${id}`);
    } catch (e) {
      setSessions(prev);
      setActionError((e as Error).message);
    }
  };

  const nickname = profile?.nickname || user?.nickname || user?.username || "我";

  return (
    <>
      <AppHeader />
      <main className="wrap">
        <h1 className="sr-only">我的空间</h1>

        <section className="profile">
          <span className="pic" aria-hidden="true" />
          <div className="who">
            <h2>{nickname}</h2>
            <p>{profile?.bio || "还没有个人简介"}</p>
          </div>
          <div className="nums">
            <div>
              <b>{profile?.work_count ?? stories.length}</b>
              <span>作品</span>
            </div>
            <div>
              <b>{totals.play}</b>
              <span>被游玩</span>
            </div>
            <div>
              <b>{totals.like}</b>
              <span>获赞</span>
            </div>
          </div>
          <Link className="btn secondary sm edit" href="/me">
            编辑资料
          </Link>
        </section>

        <div className="tabs" role="tablist" aria-label="我的空间">
          <button role="tab" type="button" aria-selected={tab === "works"} onClick={() => setTab("works")}>
            我的创作<span className="c">{stories.length}</span>
          </button>
          <button role="tab" type="button" aria-selected={tab === "reading"} onClick={() => setTab("reading")}>
            我在读<span className="c">{sessions.length}</span>
          </button>
        </div>

        {actionError && (
          <div className="status err" role="alert">
            出错：{actionError}
          </div>
        )}

        {/* error 必须排在 empty 前面：拉取失败时显示「还没有作品」
            是把错误伪装成空态，用户会以为自己的作品没了 */}
        {loading ? (
          <SkeletonWall count={3} />
        ) : error ? (
          <ErrorState
            action={
              <button className="btn primary sm" onClick={reload}>
                重试
              </button>
            }
          />
        ) : tab === "works" ? (
          stories.length === 0 ? (
            <EmptyState
              title="还没有作品"
              desc="一句话灵感就能起步，AI 帮你把世界观、开场和分支都搭出来。"
              action={
                <Link className="btn primary sm" href="/create">
                  写第一个故事
                </Link>
              }
            />
          ) : (
            <div className="works">
              {stories.map((s) => {
                const [g0, g1] = themeGradient(parseTheme(s.world_config));
                return (
                  <article className="work" key={s.id}>
                    <div className="cov" style={{ background: `linear-gradient(155deg, ${g0}, ${g1})` }}>
                      <span className="ct">{s.title || "未命名作品"}</span>
                    </div>
                    <div className="info">
                      <div className="trow">
                        <h3>{s.title || "未命名作品"}</h3>
                        <span className={`badge ${s.status === "published" ? "ok" : "info"}`}>
                          {s.status === "published" ? "已发布" : "草稿"}
                        </span>
                      </div>
                      <p className="meta">
                        {s.status === "published"
                          ? `${s.play_count} 游玩 · ${s.like_count} 赞`
                          : "尚未发布"}
                        {" · "}
                        {new Date(s.created_at).toLocaleDateString("zh-CN")}
                      </p>
                      <div className="acts">
                        <button className="btn secondary sm" onClick={() => router.push(`/edit/${s.id}`)}>
                          编辑
                        </button>
                        {s.status === "published" && (
                          <Link className="btn ghost sm" href={`/story/${s.id}`}>
                            查看
                          </Link>
                        )}
                        <button className="btn ghost sm" onClick={() => toggleStatus(s)}>
                          {s.status === "published" ? "下架" : "发布"}
                        </button>
                        {confirmId === s.id ? (
                          <button className="btn danger sm ed-del" onClick={() => remove(s.id)}>
                            确认删除？
                          </button>
                        ) : (
                          <button className="btn ghost sm ed-del" onClick={() => setConfirmId(s.id)}>
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )
        ) : sessions.length === 0 ? (
          <EmptyState
            title="还没有在读的故事"
            desc="挑一个世界走进去，进度会自动存在这里，随时接着往下走。"
            action={
              <Link className="btn primary sm" href="/">
                去书库逛逛
              </Link>
            }
          />
        ) : (
          <div className="saves">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                item={s}
                theme={themeOf.get(s.story_id)}
                onDelete={() => deleteSession(s.id)}
              />
            ))}
          </div>
        )}

        {tab === "works" && stories.length > 0 && (
          <Link className="btn primary newwork" href="/create">
            <IconPlus /> 创作新作品
          </Link>
        )}
      </main>
    </>
  );
}
