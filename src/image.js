// Photos (plan of the new plugins, §5): what a JPEG, PNG, WebP or HEIF says about itself, and the
// same file without it. The metadata is read with exifr and removed with picscrub (MIT), which
// copies the image data as it is: nothing is decoded or encoded again, so the picture does not
// change by a single pixel. The orientation is kept (or the photo would turn) and so is the colour
// profile (it says how to show the colours, nothing about the person).
import { heic, jpeg, png, webp } from "picscrub";
import { collect, readBlocks, readExif } from "./exif.js";
import { CleanError, Findings } from "./report.js";

export { CleanError };

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
 * group is location, device, dates, author, software, serial, comment, thumbnail, embedded (another
 * picture after the image), motion (the video of a motion photo), extra (other bytes after the
 * image), c2pa or other; a place whose values were zeroed is `{group: "location", value: null, empty: true}`.
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
    if (type === "Content Credentials (C2PA)") findings.add("c2pa", null);
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
    reads.push(await readBlocks(exif && withoutExifHeader(exif), xmp));
  } else {
    reads.push(await readExif(bytes));
  }
  if (kind === "heic") {
    for (const payload of heic.getMetadataPayloads(bytes)) {
      const text = ascii(payload, 0, Math.min(payload.length, 64));
      if (text.includes("<?xpacket") || text.includes("<x:xmpmeta")) reads.push(await readBlocks(null, payload));
    }
  }
  return reads.filter(Boolean);
}

const withoutExifHeader = (bytes) => (ascii(bytes, 0, 6) === "Exif\0\0" ? bytes.subarray(6) : bytes);

// ---- What exifr does not read ----

/**
 * A JPEG's comment segments, a thumbnail in its JFIF header (rare, and kept by picscrub), and what
 * follows the end of the image, all of which cleaning cuts: another picture (an MPF preview, an
 * Ultra HDR gain map, a depth map), the video of a motion photo (Google writes the MP4 straight
 * after, Samsung after a `MotionPhoto_Data` marker), or other bytes.
 */
function jpegExtras(bytes, findings) {
  for (const segment of jpeg.parseSegments(bytes)) {
    if (segment.marker === 0x0000) {
      const tail = new TextDecoder("latin1").decode(segment.data);
      const picture = tail.startsWith("\xff\xd8\xff");
      const video = tail.includes("MotionPhoto_Data") || /ftyp(mp4|mp42|isom|iso\d|qt  |avc1|M4V)/.test(tail);
      if (picture) findings.add("embedded", null);
      if (video) findings.add("motion", null);
      if (!picture && !video) findings.add("extra", null);
    }
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
