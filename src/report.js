// The report's own rules: each finding once, dates from what files write, what cleaning removed
// and what is still there (by comparing the two files, never by assuming), how a value is shown in
// the phone's language, and the name and type of the file that goes out.

/** Why a file could not be read or cleaned: `unsupported` (not a kind Clean knows), `broken`, or
 *  `locked` (a PDF with a password). */
export class CleanError extends Error {
  constructor(reason, cause) {
    super(reason);
    this.name = "CleanError";
    this.reason = reason;
    this.cause = cause;
  }
}

/** The findings of one file, each once. A finding is `{group, value}` (and `empty` for a place
 *  whose values were zeroed). Empty text is not a finding. */
export class Findings {
  constructor() {
    this.list = [];
    this.seen = new Set();
  }

  add(group, value, extra = {}) {
    if (typeof value === "string") {
      value = value.replace(/\0+/g, "").trim();
      if (!value) return;
    }
    if (group === "dates") value = asDate(value);
    if (value === undefined) return;
    const finding = { group, value, ...extra };
    const key = keyOf(finding);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(finding);
  }
}

const keyOf = (finding) =>
  `${finding.group}|${finding.empty ? "empty" : finding.value instanceof Date ? finding.value.getTime() : JSON.stringify(finding.value)}`;

/** A date from what files write (`2026:05:17 18:29:59`, `2026-05-17T18:29`, `2026:05:17`), read
 *  as the phone's local time like the camera wrote it; text that is not a date stays text. */
export function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const date = new Date(+year, +month - 1, +day, +hour, +minute, +second);
  return Number.isNaN(date.getTime()) ? value : date;
}

/** What cleaning removed (in the first file, not in the second) and what is still there. */
export function compare(before, after) {
  const still = new Set(after.map(keyOf));
  return { removed: before.filter((finding) => !still.has(keyOf(finding))), remaining: after };
}

const LONGEST = 80;

/** A finding's value as the report shows it, in the phone's language; "" when it has none. */
export function shown(finding, lang) {
  const { value } = finding;
  if (value instanceof Date) {
    const midnight = !value.getHours() && !value.getMinutes() && !value.getSeconds();
    const style = midnight ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" };
    return new Intl.DateTimeFormat(locale(lang), style).format(value);
  }
  if (value && typeof value === "object" && "latitude" in value) {
    const number = new Intl.NumberFormat(locale(lang), { minimumFractionDigits: 5, maximumFractionDigits: 5, useGrouping: false });
    const [latitude, longitude] = [number.format(value.latitude), number.format(value.longitude)];
    // A comma is the decimal mark in many languages: then the two numbers are parted by a semicolon.
    return latitude.includes(",") ? `${latitude}; ${longitude}` : `${latitude}, ${longitude}`;
  }
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.length > LONGEST ? `${text.slice(0, LONGEST)}…` : text;
}

/** A language tag Intl takes; an unknown one falls back to English rather than throwing. */
function locale(lang) {
  try {
    return Intl.getCanonicalLocales(String(lang || "en"))[0];
  } catch {
    return "en";
  }
}

const EXTENSIONS = { jpeg: "jpg", png: "png", webp: "webp", heic: "heic" };
const LONGEST_NAME = 120;

/**
 * The name of the clean file. A photo gets a plain one (`photo.jpg`): a camera names its photos by
 * the date and time they were taken. A PDF keeps its own name, without any folder, control
 * character or character a file system refuses.
 */
export function outputName(name, kind) {
  const given = String(name ?? "");
  if (kind !== "pdf") {
    const extension = kind === "heic" && /\.heif$/i.test(given) ? "heif" : EXTENSIONS[kind];
    return `photo.${extension}`;
  }
  let base = given.split(/[\\/]/).pop() ?? "";
  base = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  base = base.replace(/^[.\s]+/, "");
  if (!base) return "document.pdf";
  if (!/\.pdf$/i.test(base)) base = `${base}.pdf`;
  if (base.length > LONGEST_NAME) base = `${base.slice(0, LONGEST_NAME - 4)}${base.slice(-4)}`;
  return base;
}

/** The media type of what was made, from what it is (a HEIF keeps the type it came with). */
export function mimeOf(kind, given = "") {
  if (kind === "heic") return /^image\/heif$/i.test(given) ? "image/heif" : "image/heic";
  return { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[kind];
}
