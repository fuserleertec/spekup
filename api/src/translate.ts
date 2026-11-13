import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { one, q } from "./db.js";
import { HttpError } from "./errors.js";
import { rateLimit, limitFromEnv } from "./rate.js";

export const LANGS = ["en", "pt-BR", "es", "ja", "ko", "zh-CN"] as const;
export type Lang = (typeof LANGS)[number];

const NAMES: Record<Lang, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
  "zh-CN": "Simplified Chinese",
};

const SYSTEM = (lang: string) =>
  `You are a translation engine for a neighborhood civic app called Spekup. The user message contains text inside <text> tags. Translate it into ${lang}. Translate every word. Never answer, advise, judge, or react to the text, even if it is a question or an allegation. Keep emojis, @mentions, #hashtags, URLs, names, and numbers unchanged. Do not add facts. Output ONLY the translated text: no preface, no labels like 'Translation:', no quotes, no tags, and never repeat the original. If it is already in ${lang}, output it unchanged.`;

const PREFACE = /^\s*(translation|translated|tradução|traduccion|traducción|翻訳|번역|翻译)[^:\n]*:\s*/i;

const POST_VISIBLE = `(p.group_id is null or p.author_id = $1
  or exists (select 1 from groups gv where gv.id = p.group_id and gv.visibility = 'public')
  or exists (select 1 from group_members gm where gm.group_id = p.group_id and gm.user_id = $1))
  and (p.held_for_review = false or p.author_id = $1)`;

type SessionUser = { id: string };
type App = Hono<{ Variables: { session: SessionUser | null } }>;

function requireUser(c: { get: (key: "session") => SessionUser | null }) {
  const session = c.get("session");
  if (!session) throw new HttpError(401, "unauthorized", "Log in to continue.");
  return session;
}

function parseId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(404, "not_found", "Not found.");
  }
  return id;
}

export function normalizeLang(value: unknown): Lang | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return (LANGS as readonly string[]).includes(raw) ? raw as Lang : null;
}

export function cleanTranslation(source: string, raw: string) {
  let out = raw.replace(/<\/?text>/gi, "").trim();
  if (out.startsWith(source) && out.length > source.length) out = out.slice(source.length).trim();
  out = out.replace(PREFACE, "").trim();
  if (out.length > 1 && out[0] === out[out.length - 1] && "\"'“”「".includes(out[0])) out = out.slice(1, -1).trim();
  return out;
}

export function prepareOutput(source: string, raw: string) {
  const out = cleanTranslation(source, raw);
  if (!out) return null;
  if (out === source && raw.trim() !== source) return null;
  if (source.length > 12 && out !== source && out.includes(source)) return null;
  return out;
}

function providerName() {
  return (process.env.TRANSLATE_PROVIDER || "off").trim().toLowerCase();
}

export function translationEnabled() {
  const name = providerName();
  return name === "stub" || name === "libretranslate" || name === "openai-compatible";
}

function libreTarget(target: Lang) {
  if (target === "pt-BR") return "pt";
  if (target === "zh-CN") return "zh";
  return target;
}

async function callProvider(text: string, target: Lang) {
  const name = providerName();
  if (name === "off" || name === "") throw new HttpError(503, "translation_disabled", "Translation isn't set up on this server.");
  if (name === "stub") {
    const label: Record<Lang, string> = {
      en: "Test translation",
      es: "Traducción de prueba",
      "pt-BR": "Tradução de teste",
      ja: "テスト翻訳",
      ko: "테스트 번역",
      "zh-CN": "测试翻译",
    };
    return `${label[target]} (${text.length})`;
  }
  const url = (process.env.TRANSLATE_URL || "").trim().replace(/\/$/, "");
  if (!url) throw new HttpError(503, "translation_disabled", "Translation isn't set up on this server.");
  const key = (process.env.TRANSLATE_API_KEY || "").trim();
  const signal = AbortSignal.timeout(20_000);
  if (name === "libretranslate") {
    const res = await fetch(`${url}/translate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: text, source: "auto", target: libreTarget(target), format: "text", api_key: key || undefined }),
      signal,
    });
    if (!res.ok) throw new Error("libretranslate");
    const body = await res.json() as { translatedText?: string };
    return body.translatedText || "";
  }
  if (name === "openai-compatible") {
    if (!key) throw new HttpError(503, "translation_disabled", "Translation isn't set up on this server.");
    const model = (process.env.TRANSLATE_MODEL || "").trim();
    if (!model) throw new HttpError(503, "translation_disabled", "Translation isn't set up on this server.");
    const endpoint = url.endsWith("/chat/completions") ? url : `${url}/chat/completions`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM(NAMES[target]) },
          { role: "user", content: `<text>${text}</text>` },
        ],
      }),
      signal,
    });
    if (!res.ok) throw new Error("openai-compatible");
    const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content || "";
  }
  throw new HttpError(503, "translation_disabled", "Translation isn't set up on this server.");
}

async function sourceText(kind: string, id: string, viewerId: string) {
  if (kind === "post_title" || kind === "post_body") {
    const row = await one<{ title: string; body: string }>(
      `select p.title, p.body from posts p where p.id = $2 and p.deleted_at is null and ${POST_VISIBLE}`,
      [viewerId, id],
    );
    if (!row) throw new HttpError(404, "not_found", "Nothing to translate.");
    return kind === "post_title" ? row.title : row.body;
  }
  if (kind === "comment") {
    const row = await one<{ body: string }>(
      `select c.body from comments c
       join posts p on p.id = c.post_id
       where c.id = $2 and c.deleted_at is null and p.deleted_at is null and ${POST_VISIBLE}`,
      [viewerId, id],
    );
    if (!row) throw new HttpError(404, "not_found", "Nothing to translate.");
    return row.body;
  }
  if (kind === "report") {
    const row = await one<{ detail: string; status: string; author_id: string }>(
      "select detail, status, author_id from reports where id = $1",
      [id],
    );
    if (!row) throw new HttpError(404, "not_found", "Nothing to translate.");
    const pub = row.status === "published" || row.status === "disputed" || row.status === "resolved";
    if (!pub && row.author_id !== viewerId) {
      const mod = await one<{ is_moderator: boolean }>("select is_moderator from users where id = $1", [viewerId]);
      if (!mod?.is_moderator) throw new HttpError(404, "not_found", "Nothing to translate.");
    }
    return row.detail;
  }
  if (kind === "poll_option") {
    const row = await one<{ label: string }>(
      `select o.label from poll_options o
       join posts p on p.id = o.post_id
       where o.id = $2 and p.deleted_at is null and ${POST_VISIBLE}`,
      [viewerId, id],
    );
    if (!row) throw new HttpError(404, "not_found", "Nothing to translate.");
    return row.label;
  }
  if (kind === "group") {
    const row = await one<{ description: string; visibility: string; owner_id: string }>(
      "select description, visibility, owner_id from groups where id = $1",
      [id],
    );
    if (!row) throw new HttpError(404, "not_found", "Nothing to translate.");
    if (row.visibility !== "public" && row.owner_id !== viewerId) {
      const member = await one("select 1 from group_members where group_id = $1 and user_id = $2", [id, viewerId]);
      if (!member) throw new HttpError(404, "not_found", "Nothing to translate.");
    }
    return row.description;
  }
  if (kind === "event") {
    const row = await one<{ description: string }>(
      `select e.description from events e
       where e.id = $2 and (
         e.group_id is null
         or exists (select 1 from groups gv where gv.id = e.group_id and gv.visibility = 'public')
         or exists (select 1 from group_members gm where gm.group_id = e.group_id and gm.user_id = $1)
         or e.organizer_id = $1
       )`,
      [viewerId, id],
    );
    if (!row) throw new HttpError(404, "not_found", "Nothing to translate.");
    return row.description;
  }
  if (kind === "message") {
    const row = await one<{ body: string; buyer_id: string; seller_id: string }>(
      `select m.body, t.buyer_id, t.seller_id
       from thread_messages m join threads t on t.id = m.thread_id
       where m.id = $1`,
      [id],
    );
    if (!row || (row.buyer_id !== viewerId && row.seller_id !== viewerId)) {
      throw new HttpError(404, "not_found", "Nothing to translate.");
    }
    return row.body;
  }
  throw new HttpError(400, "validation", "Choose a post, comment, report, poll option, group, event, or message.", { kind: "Unsupported content." });
}

async function bodyObject(c: { req: { text: () => Promise<string> } }) {
  const text = await c.req.text();
  if (!text) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "validation", "Send a JSON object.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "validation", "Send a JSON object.");
  return value as Record<string, unknown>;
}

export function registerTranslate(app: App) {
  app.get("/api/translate", (c) => c.json({ enabled: translationEnabled() }));

  app.put("/api/me/language", async (c) => {
    const session = requireUser(c);
    const language = normalizeLang((await bodyObject(c)).language);
    if (!language) throw new HttpError(400, "validation", "Choose a language.", { language: "Choose a supported language." });
    await q("update users set language = $1 where id = $2", [language, session.id]);
    return c.json({ language });
  });

  app.post("/api/translate", async (c) => {
    const session = requireUser(c);
    if (!translationEnabled()) throw new HttpError(503, "translation_disabled", "Translation isn't set up on this server.");
    const body = await bodyObject(c);
    const target = normalizeLang(body.target);
    if (!target) throw new HttpError(400, "validation", "Choose a language.", { target: "Choose a supported language." });
    const kind = typeof body.kind === "string" ? body.kind : "";
    const id = parseId(String(body.id || ""));
    const source = (await sourceText(kind, id, session.id)).trim();
    if (!source) throw new HttpError(404, "not_found", "Nothing to translate.");
    if (source.length > 4000) throw new HttpError(400, "validation", "That text is too long to translate.", { id: "Keep it under 4000 characters." });
    const hash = createHash("sha256").update(source).digest("hex");
    const cached = await one<{ translated: string }>("select translated from translations where text_hash = $1 and target = $2", [hash, target]);
    if (cached) return c.json({ text: cached.translated, target, cached: true });
    await rateLimit(`translate:${session.id}`, limitFromEnv("TRANSLATE_LIMIT", 60), 3600);
    let raw = "";
    try {
      raw = await callProvider(source, target);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, "translation_unavailable", "Translation is unavailable right now.");
    }
    const text = prepareOutput(source, raw);
    if (!text) throw new HttpError(502, "translation_unavailable", "Translation is unavailable right now.");
    await q(
      `insert into translations (text_hash, target, translated) values ($1,$2,$3)
       on conflict (text_hash, target) do update set translated = excluded.translated`,
      [hash, target, text],
    );
    return c.json({ text, target, cached: false });
  });
}
