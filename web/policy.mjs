export function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "style-src 'self' 'unsafe-inline'",
    process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self' https://tile.openstreetmap.org",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function allowedHosts() {
  const list = new Set(
    (process.env.ALLOWED_HOSTS || "127.0.0.1:4185,localhost:4185,localhost,127.0.0.1")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  try {
    const base = new URL(process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "http://127.0.0.1:4185");
    list.add(base.host.toLowerCase());
    list.add(base.hostname.toLowerCase());
  } catch {
    // An unreadable base URL does not widen the list.
  }
  return list;
}

export function hostAllowed(header) {
  return allowedHosts().has(String(header || "").trim().toLowerCase());
}
