const PLACEHOLDERS = ["replace-with", "password", "secret", "localtest", "changeme"];

function weak(value: string) {
  const folded = value.toLowerCase();
  return value.length < 16 || PLACEHOLDERS.some((item) => folded === item || folded.includes("replace-with"));
}

export function databasePassword() {
  const raw = process.env.DATABASE_URL || "";
  const auth = raw.split("://")[1]?.split("@")[0] || "";
  const password = auth.includes(":") ? auth.slice(auth.indexOf(":") + 1) : "";
  try {
    return decodeURIComponent(password);
  } catch {
    return password;
  }
}

export function assertProductionSecrets(options: { proxy?: boolean } = { proxy: true }) {
  if (process.env.NODE_ENV !== "production") return;
  if (weak(databasePassword())) throw new Error("The database password is missing or still an example. Refusing to start in production.");
  if (options.proxy !== false && weak(process.env.PROXY_SHARED_SECRET || "")) throw new Error("PROXY_SHARED_SECRET is missing or still an example. Refusing to start in production.");
}
