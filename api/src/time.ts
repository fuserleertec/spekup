import { HttpError } from "./errors.js";
import { cleanText } from "./validate.js";

export function requireTimezone(value: unknown) {
  const timezone = cleanText(value, 64, "timezone", "Time zone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new HttpError(400, "validation", "Choose a valid time zone.", { timezone: "Use an IANA name such as America/New_York." });
  }
  return timezone;
}

/** Wall-clock `YYYY-MM-DDTHH:mm` in an IANA zone, as an absolute instant. */
export function localToUtc(local: string, timeZone: string, field = "startsAt") {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
    throw new HttpError(400, "validation", "Enter a date and time.", { [field]: "Use a date and time." });
  }
  requireTimezone(timeZone);
  const [date, clock] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new HttpError(400, "validation", "Enter a real date and time.", { [field]: "That date is not valid." });
  }
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const guess = new Date(desired);
  const parts = zonedParts(guess, timeZone);
  const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(desired - (got - desired));
}

function zonedParts(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const bag = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour) % 24,
    minute: Number(bag.minute),
  };
}
