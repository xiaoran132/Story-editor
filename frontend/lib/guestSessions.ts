// 记录"本浏览器匿名创建的会话 id"，供登录后迁移领取（共享 guest 下只迁自己的那些）。
const KEY = "guestSessions";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function trackGuestSession(id: string): void {
  if (typeof window === "undefined") return;
  const arr = read();
  if (!arr.includes(id)) {
    arr.push(id);
    localStorage.setItem(KEY, JSON.stringify(arr));
  }
}

export function getGuestSessions(): string[] {
  return read();
}

export function clearGuestSessions(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
