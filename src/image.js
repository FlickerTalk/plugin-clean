// Photos (plan of the new plugins, §5): what a JPEG, PNG, WebP or HEIF says about itself, and the
// same file without it. The metadata is read with exifr and removed with picscrub (MIT), which
// copies the image data as it is: nothing is decoded or encoded again, so the picture does not
// change by a single pixel. The orientation is kept (or the photo would turn) and so is the colour
// profile (it says how to show the colours, nothing about the person).
import { heic, jpeg, png, webp } from "picscrub";
import { readExif } from "./exif.js";

/** Why a file could not be read or cleaned: `unsupported` (not a kind Clean knows) or `broken`. */
export class CleanError extends Error {
  constructor(reason, cause) {
    super(reason);
    this.name = "CleanError";
    this.reason = reason;
    this.cause = cause;
  }
}

const HANDLERS = { jpeg, png, webp, heic };

/** What picscrub keeps on purpose: without them the photo would turn or change its colours. */
const KEEP = { preserveOrientation: true, preserveColorProfile: true };

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

const ascii = (bytes, from, length) => String.fromCharCode(...bytes.subarray(from, from + length));
const starts = (bytes, signature, at = 0) => signature.every((byte, index) => bytes[at + index] === byte);

/** The kind of a file by its first bytes, never by its name: jpeg, png, webp, heic, pdf or null. */
export function kindOf(bytes) {
  if (!bytes || bytes.length < 8) return null;
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 4).toLowerCase())) return "heic";
  // A PDF may carry a few bytes of rubbish before its header; readers look in the first kilobyte.
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes("%PDF-")) return "pdf";
  return null;
}

/** The same photo without its metadata. Throws a CleanError when it is not a photo or is broken. */
export function cleanImage(bytes) {
  const handler = handlerOf(bytes);
  try {
    return handler.remove(bytes, KEEP);
  } catch (error) {
    throw new CleanError("broken", error);
  }
}

/**
 * What a photo says about itself: `{kind, findings, kept}`. A finding is `{group, value}` where the
 * group is location, device, dates, author, software, serial, comment, thumbnail, motion (the
 * video of a motion photo), extra (other bytes after the image), c2pa or other; a place whose values were zeroed is `{group: "location", value: null, empty: true}`.
 * `kept` is what cleaning keeps on purpose: the orientation and whether there is a colour profile.
 */
export async function inspectImage(bytes) {
  const handler = handlerOf(bytes);
  const kind = kindOf(bytes);
  let types;
  try {
    types = handler.getMetadataTypes(bytes);
  } catch (error) {
    throw new CleanError("broken", error);
  }
  const findings = new Findings();
  const reads = await readsOf(kind, bytes);
  for (const read of reads) collect(read, findings);

  if (kind === "jpeg") jpegExtras(bytes, findings);
  if (kind === "png") pngExtras(bytes, findings);
  if (kind === "heic" && heifHasThumbnail(bytes)) findings.add("thumbnail", null);
  for (const type of types) {
    if (type === "Trailing data (embedded video)") findings.add("motion", null);
    else if (type === "Trailing data (embedded JPEG)") findings.add("thumbnail", null);
    else if (type === "Trailing data") findings.add("extra", null);
    else if (type === "Content Credentials (C2PA)") findings.add("c2pa", null);
    else if (type === "JUMBF") findings.add("other", "JUMBF");
  }

  const orientation = reads.map((read) => read.ifd0?.Orientation).find((value) => typeof value === "number") ?? null;
  return { kind, findings: findings.list, kept: { orientation, colour: types.includes("ICC Profile") } };
}

function handlerOf(bytes) {
  const kind = kindOf(bytes);
  if (!HANDLERS[kind]) throw new CleanError("unsupported");
  return HANDLERS[kind];
}

// ---- Reading ----

/** What exifr reads: from the file, or from a small JPEG made of the blocks exifr cannot find
 *  itself (the EXIF and XMP chunks of a WebP, the XMP item of a HEIF). */
async function readsOf(kind, bytes) {
  const reads = [];
  if (kind === "webp") {
    const chunks = riffChunks(bytes);
    const exif = chunks.find(([fourcc]) => fourcc === "EXIF")?.[1];
    const xmp = chunks.find(([fourcc]) => fourcc === "XMP ")?.[1];
    reads.push(await readExif(wrapped(exif && withoutExifHeader(exif), xmp)));
  } else {
    reads.push(await readExif(bytes));
  }
  if (kind === "heic") {
    for (const payload of heic.getMetadataPayloads(bytes)) {
      const text = ascii(payload, 0, Math.min(payload.length, 64));
      if (text.includes("<?xpacket") || text.includes("<x:xmpmeta")) reads.push(await readExif(wrapped(null, payload)));
    }
  }
  return reads.filter(Boolean);
}

const withoutExifHeader = (bytes) => (ascii(bytes, 0, 6) === "Exif\0\0" ? bytes.subarray(6) : bytes);

/** A JPEG with nothing but these blocks, for exifr to read them where it would not look. */
function wrapped(tiff, xmp) {
  const segments = [];
  const segment = (prefix, body) => {
    const length = 2 + prefix.length + body.length;
    if (length > 0xffff) return;
    const out = new Uint8Array(2 + length);
    out.set([0xff, 0xe1, length >> 8, length & 255]);
    out.set([...prefix].map((char) => char.charCodeAt(0)), 4);
    out.set(body, 4 + prefix.length);
    segments.push(out);
  };
  if (tiff) segment("Exif\0\0", tiff);
  if (xmp) segment("http://ns.adobe.com/xap/1.0/\0", xmp);
  if (!segments.length) return null;
  const parts = [new Uint8Array([0xff, 0xd8]), ...segments, new Uint8Array([0xff, 0xd9])];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The findings, each once. */
class Findings {
  constructor() {
    this.list = [];
    this.seen = new Set();
  }

  add(group, value, extra = {}) {
    if (typeof value === "string") {
      value = value.replace(/\0+$/g, "").trim();
      if (!value) return;
    }
    if (group === "dates") value = asDate(value);
    if (value === undefined) return;
    const key = `${group}|${value instanceof Date ? value.getTime() : JSON.stringify(value)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ group, value, ...extra });
  }
}

/** A date from what files write: a Date, `2026:05:17 18:29:59`, `2026-05-17T18:29:59`, `2026:05:17`. */
function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const date = new Date(+year, +month - 1, +day, +hour, +minute, +second);
  return Number.isNaN(date.getTime()) ? value : date;
}

const text = (value) => (typeof value === "string" ? value : Array.isArray(value) ? value.filter((one) => typeof one === "string").join(", ") : undefined);

/** UserComment: 8 bytes of character set, then the text. */
function commentText(value) {
  if (typeof value === "string") return value;
  if (!(value instanceof Uint8Array) || value.length <= 8) return undefined;
  const unicode = ascii(value, 0, 7) === "UNICODE";
  const body = value.subarray(8);
  return unicode ? new TextDecoder("utf-16be").decode(body) : new TextDecoder("latin1").decode(body);
}

/** Where each thing exifr reads goes in the report. */
function collect(read, findings) {
  const { ifd0 = {}, exif = {}, gps, ifd1, xmp = {}, dc = {}, iptc = {}, ihdr = {}, photoshop = {} } = read;

  if (gps) {
    const { latitude, longitude } = gps;
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)) {
      findings.add("location", { latitude, longitude });
    } else if (gps.GPSLatitude !== undefined || gps.GPSLongitude !== undefined) {
      findings.add("location", null, { empty: true });
    }
    if (typeof gps.GPSDateStamp === "string") findings.add("dates", gps.GPSDateStamp);
  }
  for (const key of ["City", "Sublocation", "State", "Country", "ContentLocationName"]) findings.add("location", text(iptc[key]));
  for (const key of ["City", "State", "Country"]) findings.add("location", text(photoshop[key]));

  for (const key of ["Make", "Model", "HostComputer"]) findings.add("device", text(ifd0[key]));
  for (const key of ["LensMake", "LensModel"]) findings.add("device", text(exif[key]));
  findings.add("device", text(ihdr.Source));

  findings.add("dates", ifd0.ModifyDate);
  for (const key of ["DateTimeOriginal", "CreateDate"]) findings.add("dates", exif[key]);
  for (const key of ["CreateDate", "ModifyDate", "MetadataDate"]) findings.add("dates", xmp[key]);
  findings.add("dates", photoshop.DateCreated);
  findings.add("dates", text(iptc.DateCreated));
  findings.add("dates", text(ihdr["Creation Time"]));

  for (const key of ["Artist", "Copyright", "XPAuthor"]) findings.add("author", text(ifd0[key]));
  findings.add("author", text(exif.OwnerName));
  for (const key of ["creator", "rights"]) findings.add("author", text(dc[key]));
  for (const key of ["Byline", "CopyrightNotice", "Writer", "Credit", "Contact"]) findings.add("author", text(iptc[key]));
  for (const key of ["Author", "Copyright"]) findings.add("author", text(ihdr[key]));

  findings.add("software", text(ifd0.Software));
  findings.add("software", text(xmp.CreatorTool));
  findings.add("software", text(ihdr.Software));
  findings.add("software", text(iptc.OriginatingProgram));

  for (const key of ["SerialNumber", "LensSerialNumber", "ImageUniqueID"]) findings.add("serial", text(exif[key]));

  for (const key of ["ImageDescription", "XPComment", "XPTitle", "XPSubject", "XPKeywords"]) findings.add("comment", text(ifd0[key]));
  findings.add("comment", commentText(exif.UserComment));
  for (const key of ["title", "description", "subject"]) findings.add("comment", text(dc[key]));
  for (const key of ["Caption", "Headline", "Keywords", "ObjectName"]) findings.add("comment", text(iptc[key]));
  for (const key of ["Title", "Comment", "Description", "Disclaimer", "Warning"]) findings.add("comment", text(ihdr[key]));

  if (ifd1 && (ifd1.ThumbnailLength > 0 || ifd1.ThumbnailOffset > 0)) findings.add("thumbnail", null);
  if (read.makerNote) findings.add("other", "MakerNote");
}

// ---- What exifr does not read ----

/** A JPEG's comment segments, and a thumbnail in its JFIF header (rare, and kept by picscrub). */
function jpegExtras(bytes, findings) {
  for (const segment of jpeg.parseSegments(bytes)) {
    if (segment.marker === 0xfffe) findings.add("comment", new TextDecoder("latin1").decode(segment.data.subarray(4)));
    if (segment.marker === 0xffe0) {
      const head = ascii(segment.data, 4, 5);
      const jfifThumb = head === "JFIF\0" && segment.data[18] > 0 && segment.data[19] > 0;
      if (head.startsWith("JFXX") || jfifThumb) findings.add("thumbnail", null);
    }
  }
}

/** A PNG's compressed text (its key: the text is not unpacked), its other iTXt, and its tIME. */
function pngExtras(bytes, findings) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    const data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + length));
    const key = ascii(data, 0, Math.max(0, data.indexOf(0)));
    if (type === "zTXt") findings.add(textGroup(key), key);
    else if (type === "iTXt" && key !== "XML:com.adobe.xmp") findings.add(textGroup(key), key);
    else if (type === "tIME" && data.length >= 7) {
      findings.add("dates", new Date(Date.UTC((data[0] << 8) | data[1], data[2] - 1, data[3], data[4], data[5], data[6])));
    } else if (type === "tEXt" && !KNOWN_TEXT.has(key)) findings.add("other", key);
    if (type === "IEND") break;
    at += 12 + length;
  }
}

/** The PNG text keys the report already places by what they say. */
const KNOWN_TEXT = new Set(["Author", "Copyright", "Software", "Creation Time", "Source", "Title", "Comment", "Description", "Disclaimer", "Warning"]);

function textGroup(key) {
  if (key === "Author" || key === "Copyright") return "author";
  if (key === "Software") return "software";
  if (key === "Creation Time") return "dates";
  if (key === "Source") return "device";
  if (KNOWN_TEXT.has(key)) return "comment";
  return "other";
}

/** The chunks of a RIFF (WebP) file, as [fourcc, data]. */
function riffChunks(bytes) {
  const chunks = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 12; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at + 4, true);
    chunks.push([ascii(bytes, at, 4), bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + length))]);
    at += 8 + length + (length % 2);
  }
  return chunks;
}

/** Whether a HEIF names a thumbnail item (`thmb` in its item references). */
function heifHasThumbnail(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = (from, to) => {
    const found = [];
    for (let at = from; at + 8 <= to; ) {
      const size = view.getUint32(at);
      if (size < 8 || at + size > to) break;
      found.push({ type: ascii(bytes, at + 4, 4), at, end: at + size });
      at += size;
    }
    return found;
  };
  const meta = boxes(0, bytes.length).find((box) => box.type === "meta");
  if (!meta) return false;
  const iref = boxes(meta.at + 12, meta.end).find((box) => box.type === "iref");
  if (!iref) return false;
  return boxes(iref.at + 12, iref.end).some((box) => box.type === "thmb");
}
