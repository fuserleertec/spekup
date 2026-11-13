import { HttpError } from "./errors.js";

export const TOPICS = [
  "neighborhood",
  "mutual_aid",
  "local_business",
  "housing",
  "schools",
  "transit",
  "environment",
  "civic_process",
  "care",
] as const;

export const ROLES = ["resident", "organizer", "civic_professional", "community_business"] as const;
export const KINDS = ["share", "ask", "offer", "poll"] as const;
export const PRICE_MODES = ["fixed", "negotiable", "free_service", "free_advice"] as const;
export const LISTING_KINDS = ["local_good", "digital_guide", "service"] as const;

export type Topic = (typeof TOPICS)[number];
export type Role = (typeof ROLES)[number];
export type Kind = (typeof KINDS)[number];
export type PriceMode = (typeof PRICE_MODES)[number];
export type ListingKind = (typeof LISTING_KINDS)[number];

const RESERVED = new Set([
  "admin",
  "administrator",
  "support",
  "help",
  "api",
  "me",
  "login",
  "signup",
  "commonvoice",
  "null",
  "undefined",
  "official",
  "government",
  "moderator",
  "root",
  "system",
]);

function bad(message: string, fields: Record<string, string>): never {
  throw new HttpError(400, "validation", message, fields);
}

export function cleanText(value: unknown, max: number, field: string, label: string, opts?: { required?: boolean; multiline?: boolean }) {
  if (typeof value !== "string") bad(`${label} is required.`, { [field]: `${label} is required.` });
  const text = value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) bad(`${label} contains characters that can't be saved.`, { [field]: "Remove hidden characters." });
  if (!opts?.multiline && /[\n\r]/.test(text)) bad(`${label} must be a single line.`, { [field]: "Use a single line." });
  if (opts?.required !== false && text.length === 0) bad(`${label} is required.`, { [field]: `${label} is required.` });
  if (text.length > max) bad(`${label} is too long.`, { [field]: `Keep it under ${max} characters.` });
  return text;
}

export function requireEmail(value: unknown) {
  const email = cleanText(value, 254, "email", "Email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad("Enter a valid email address.", { email: "Enter a valid email address." });
  return email.toLowerCase();
}

export function requirePassword(value: unknown) {
  if (typeof value !== "string" || value.length < 10 || value.length > 200) {
    bad("Use a password of at least 10 characters.", { password: "Use at least 10 characters." });
  }
  if (value.includes("\u0000")) bad("That password can't be saved.", { password: "Choose a different password." });
  return value;
}

export function requireHandle(value: unknown) {
  const handle = cleanText(value, 24, "handle", "Handle").toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(handle)) {
    bad("Use 3–24 letters, numbers, or underscores.", { handle: "Use 3–24 letters, numbers, or underscores." });
  }
  if (RESERVED.has(handle)) bad("That handle is reserved.", { handle: "Choose a different handle." });
  return handle;
}

export function requireRole(value: unknown): Role {
  if (typeof value !== "string" || !ROLES.includes(value as Role)) {
    bad("Choose a role.", { role: "Choose a role." });
  }
  return value as Role;
}

export function requireTopic(value: unknown): Topic {
  if (typeof value !== "string" || !TOPICS.includes(value as Topic)) {
    bad("Choose a topic.", { topic: "Choose a topic." });
  }
  return value as Topic;
}

export function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    bad(`Choose a valid ${field}.`, { [field]: `Choose a valid ${field}.` });
  }
  return value as T;
}

/** Fixed-precision dollars. Accepts "12", "12.5", and "12.50". Rejects extra fraction digits and JSON numbers. */
export function dollarsToCents(value: unknown): number {
  if (typeof value === "number") {
    bad("Send the amount as a decimal string such as \"12.00\".", { price: "Use a decimal string, not a JSON number." });
  }
  if (typeof value !== "string") bad("Enter a dollar amount.", { price: "Enter a dollar amount." });
  const s = value.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) {
    bad("Use dollars and cents only, such as 25 or 25.00.", { price: "Use at most two decimal places." });
  }
  const [whole, frac = ""] = s.split(".");
  if (whole.length > 1 && whole.startsWith("0")) bad("Enter the amount without leading zeros.", { price: "Drop the leading zeros." });
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000) {
    bad("Enter an amount from $0.01 to $1,000,000.00.", { price: "Amount is out of range." });
  }
  return cents;
}

export function optionalUuid(value: unknown, field: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    bad("That attachment is not valid.", { [field]: "Choose a valid item." });
  }
  return value;
}

export function priceFields(kind: Kind, body: Record<string, unknown>) {
  if (kind === "share" || kind === "poll") {
    if (body.priceMode != null || body.price != null || body.priceCents != null || body.listingKind != null) {
      bad(kind === "poll" ? "A poll does not take a price or a payment." : "A share does not take a price.", { price: "Remove the price." });
    }
    return { priceMode: null, priceCents: null, listingKind: null };
  }
  const priceMode = body.priceMode;
  if (typeof priceMode !== "string" || !PRICE_MODES.includes(priceMode as PriceMode)) {
    bad("Choose how the amount works.", { priceMode: "Choose fixed, negotiable, free service, or free advice." });
  }
  const mode = priceMode as PriceMode;
  let priceCents: number | null = null;
  if (mode === "fixed") {
    if (body.price == null) bad("Enter a dollar amount.", { price: "Enter a dollar amount." });
    priceCents = dollarsToCents(body.price);
  } else if (body.price != null || body.priceCents != null) {
    bad("Only a fixed amount includes a dollar value.", { price: "Clear the amount or choose a fixed price." });
  }
  if (kind === "ask") {
    if (body.listingKind != null) bad("An ask is not a marketplace listing.", { listingKind: "Remove the listing type." });
    return { priceMode: mode, priceCents, listingKind: null };
  }
  const listingKind = body.listingKind;
  if (typeof listingKind !== "string" || !LISTING_KINDS.includes(listingKind as ListingKind)) {
    bad("Choose a local good, digital guide, or service.", { listingKind: "Choose a listing type." });
  }
  return { priceMode: mode, priceCents, listingKind: listingKind as ListingKind };
}
