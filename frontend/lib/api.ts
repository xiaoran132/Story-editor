// 后端 API 客户端：拼接 base、解 {success,data,error} 信封、失败抛错。

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080/api/v1";

const CONNECT_ERR = "无法连接后端服务，请确认后端已启动";
const httpErr = (status: number) => `请求失败（HTTP ${status}）`;

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

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const opt: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opt.body = JSON.stringify(body);

  const res = await safeFetch(path, opt);

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

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

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
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
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
