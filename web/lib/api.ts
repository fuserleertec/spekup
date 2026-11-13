export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string> | null;

  constructor(status: number, code: string, message: string, fields: Record<string, string> | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

let csrf = "";

export function csrfToken() {
  return csrf;
}

export async function refreshCsrf() {
  const data = await fetch("/api/csrf", { credentials: "same-origin" }).then((res) => res.json()).catch(() => null);
  if (data && typeof data.csrfToken === "string") csrf = data.csrfToken;
}

export function rememberNext(path: string) {
  if (path.startsWith("/") && !path.startsWith("//")) sessionStorage.setItem("cv-next", path);
}

export function takeNext() {
  const next = sessionStorage.getItem("cv-next");
  sessionStorage.removeItem("cv-next");
  if (next && next.startsWith("/") && !next.startsWith("//") && next.length < 200) return next;
  return "/";
}

export async function api<T>(path: string, opts: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const method = opts.method || (opts.json || opts.form ? "POST" : "GET");
  const headers = new Headers();
  if (opts.json) headers.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD") headers.set("x-csrf-token", csrf);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.form || (opts.json ? JSON.stringify(opts.json) : undefined),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "offline", "Spekup can't reach its local service.", null);
  }
  const data = await res.json().catch(() => null);
  if (data && typeof data === "object" && "csrfToken" in data && typeof data.csrfToken === "string") csrf = data.csrfToken;
  if (!res.ok) {
    const error = data?.error;
    if (res.status === 403 && error?.code === "csrf") {
      await refreshCsrf();
      throw new ApiError(403, "csrf_refreshed", "Your sign-in check was refreshed. Try that again. Nothing was posted.", error?.fields || null);
    }
    throw new ApiError(res.status, error?.code || "error", error?.message || "Something went wrong.", error?.fields || null);
  }
  return data as T;
}

export async function loadSession() {
  const token = await api<{ csrfToken: string }>("/api/csrf");
  csrf = token.csrfToken;
  const me = await api<{ user: import("./types").User | null }>("/api/auth/me");
  return me.user;
}
