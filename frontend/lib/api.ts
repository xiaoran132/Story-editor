// 后端 API 客户端：拼接 base、解 {success,data,error} 信封、失败抛错。

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080/api/v1";

interface Envelope<T> {
  success: boolean;
  data: T;
  error: { code?: number; message?: string } | null;
  meta?: unknown;
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

  let res: Response;
  try {
    res = await fetch(API_BASE + path, opt);
  } catch (e) {
    throw new Error("无法连接后端服务，请确认后端已启动");
  }

  // 204 No Content（如 DELETE）无响应体，直接视为成功。
  if (res.status === 204) {
    if (res.ok) return undefined as T;
    throw new Error(`请求失败（HTTP ${res.status}）`);
  }

  let env: Envelope<T>;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    throw new Error(`请求失败（HTTP ${res.status}）`);
  }

  if (!env.success) {
    throw new Error(env.error?.message || `请求失败（HTTP ${res.status}）`);
  }
  return env.data;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export { API_BASE };
