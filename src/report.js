export class CleanError extends Error {
  constructor(reason, cause) {
    super(reason);
    this.name = "CleanError";
    this.reason = reason;
    this.cause = cause;
  }
}

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

// Read as local time, the way the camera wrote it.
export function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const date = new Date(+year, +month - 1, +day, +hour, +minute, +second);
  return Number.isNaN(date.getTime()) ? value : date;
}

export function compare(before, after) {
  const still = new Set(after.map(keyOf));
  return { removed: before.filter((finding) => !still.has(keyOf(finding))), remaining: after };
}

const LONGEST = 80;

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
    return latitude.includes(",") ? `${latitude}; ${longitude}` : `${latitude}, ${longitude}`;
  }
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.length > LONGEST ? `${text.slice(0, LONGEST)}…` : text;
}

function locale(lang) {
  try {
    return Intl.getCanonicalLocales(String(lang || "en"))[0];
  } catch {
    return "en";
  }
}

const EXTENSIONS = { jpeg: "jpg", png: "png", webp: "webp", heic: "heic" };
const LONGEST_NAME = 120;

// A camera names its photos by the date and time they were taken, so a photo leaves as photo.<ext>.
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

export function mimeOf(kind, given = "") {
  if (kind === "heic") return /^image\/heif$/i.test(given) ? "image/heif" : "image/heic";
  return { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[kind];
}
