export function publicBaseUrl() {
  const configured = process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "http://127.0.0.1:4185";
  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "http://127.0.0.1:4185";
    return url.origin;
  } catch {
    return "http://127.0.0.1:4185";
  }
}
