// 后端 API 客户端：拼接 base、解 {success,data,error} 信封、失败抛错。

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080/api/v1";

const CONNECT_ERR = "无法连接后端服务，请确认后端已启动";
const httpErr = (status: number) => `请求失败（HTTP ${status}）`;

// 登录 token 存 localStorage；每次请求带上 Authorization（未登录则为空、按匿名 guest 处理）。
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error: { code?: number; message?: string } | null;
  meta?: unknown;
}

// safeFetch：统一 fetch + 连接错误兜底（request 与 postStream 共用；两者在 fetch 后各自处理响应）。
async function safeFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(API_BASE + path, init);
  } catch {
    throw new Error(CONNECT_ERR);
  }
}

const EXPIRED_ERR = "登录已过期，请重新登录";

/**
 * 401 统一处置：清掉失效凭据并跳登录。
 *
 * 为什么必须有：token 有效期 72h，且换过 JWT_SECRET 后旧 token 一律失效。而
 * `user` 是从 localStorage 直接读的、从不校验，所以过期后界面**仍显示已登录**
 * （顶栏有头像、有账户菜单），每个接口却默默 401——表现为"哪儿都用不了"，
 * 且没有任何线索提示该重新登录。线上踩过一次。
 *
 * 用 location.href 硬跳而不是调 authStore.logout()：api.ts 被 authStore 依赖，
 * 反向 import 会成环；硬跳顺带让整个应用从空 localStorage 重新初始化。
 *
 * 返回值 = 是否已处置。**未处置时调用方必须放行到正常的信封解析**，把后端的真实
 * 原因显示出来——否则登录密码错（后端同样回 401）会被盖成「登录已过期」，
 * 用户对着正确的密码一脸茫然。这个坑刚踩过。
 */
function handleUnauthorized(path: string): boolean {
  if (typeof window === "undefined") return false;
  // 登录/注册自身的 401 是"账号密码不对"，要把错误显示在表单上，不能跳走。
  if (path.startsWith("/auth/login") || path.startsWith("/auth/register")) return false;
  if (!localStorage.getItem("token")) return false; // 本来就没登录：让调用方自己处理
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  const here = window.location.pathname + window.location.search;
  if (window.location.pathname !== "/login") {
    window.location.href = `/login?next=${encodeURIComponent(here)}`;
  }
  return true;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const opt: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
  };
  if (body !== undefined) opt.body = JSON.stringify(body);

  const res = await safeFetch(path, opt);

  if (res.status === 401 && handleUnauthorized(path)) {
    throw new Error(EXPIRED_ERR);
  }

  // 204 No Content（如 DELETE）无响应体，直接视为成功。
  if (res.status === 204) {
    if (res.ok) return undefined as T;
    throw new Error(httpErr(res.status));
  }

  let env: Envelope<T>;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    throw new Error(httpErr(res.status));
  }

  if (!env.success) {
    throw new Error(env.error?.message || httpErr(res.status));
  }
  return env.data;
}

// upload：multipart 通道。不能复用 request——那里把 Content-Type 写死成 json，
// 而 multipart 必须由浏览器自己带 boundary，手写 header 反而会让后端解不出来。
async function upload(kind: string, file: File | Blob, filename = "image"): Promise<string> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file, filename);

  const res = await safeFetch("/uploads/image", {
    method: "POST",
    headers: authHeaders(), // 注意：不设 Content-Type
    body: fd,
  });

  if (res.status === 401 && handleUnauthorized("/uploads/image")) {
    throw new Error(EXPIRED_ERR);
  }

  let env: Envelope<{ url: string }>;
  try {
    env = (await res.json()) as Envelope<{ url: string }>;
  } catch {
    throw new Error(httpErr(res.status));
  }
  if (!env.success) throw new Error(env.error?.message || httpErr(res.status));
  return env.data.url;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload,
};

// assetUrl：把后端返回的 /api/v1/uploads/... 变成浏览器能取的地址。
// 生产同源（API_BASE = "/api/v1"）时原样返回；开发时 API_BASE 是绝对地址
// (http://localhost:8080/api/v1)，需要补上它的源。
export function assetUrl(u: string): string {
  if (!u) return "";
  if (/^(https?:)?\/\//.test(u) || u.startsWith("data:")) return u;
  const m = API_BASE.match(/^https?:\/\/[^/]+/);
  return m ? m[0] + u : u;
}

// postStream：消费后端的 SSE 流（text/event-stream）。
// delta 帧 → onDelta(增量正文)；revise 帧 → onRevise(清空重来)；
// done 帧 → resolve 最终 data；error 帧 → reject。与 request 分离（后者硬编码 res.json()）。
export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onRevise?: () => void;
}

export async function postStream<T>(
  path: string,
  body: unknown,
  handlers: StreamHandlers = {}
): Promise<T> {
  const res = await safeFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && handleUnauthorized(path)) {
    throw new Error(EXPIRED_ERR);
  }
  if (!res.ok || !res.body) {
    throw new Error(httpErr(res.status));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done: T | undefined;
  let streamErr: string | null = null;

  const handleFrame = (frame: string) => {
    let event = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (event === "delta") {
      try {
        handlers.onDelta?.(JSON.parse(data).text ?? "");
      } catch {
        /* 忽略坏帧 */
      }
    } else if (event === "revise") {
      handlers.onRevise?.();
    } else if (event === "done") {
      done = JSON.parse(data) as T;
    } else if (event === "error") {
      try {
        streamErr = JSON.parse(data).detail || "生成失败";
      } catch {
        streamErr = "生成失败";
      }
    }
  };

  // 逐块读取，按 SSE 帧分隔（空行 \n\n）切分。
  for (;;) {
    const { value, done: rdDone } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      handleFrame(buf.slice(0, sep));
      buf = buf.slice(sep + 2);
    }
    if (rdDone) break;
  }
  if (buf.trim()) handleFrame(buf); // 末帧无结尾空行时兜底

  if (streamErr) throw new Error(streamErr);
  if (done === undefined) throw new Error("生成中断：未收到完整结果");
  return done;
}
