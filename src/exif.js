// What a photo says about itself, read with exifr (MIT). Built from exifr's sources with only the
// parts Clean needs: JPEG, PNG, HEIF and bare TIFF files; the TIFF blocks (IFD0, EXIF, GPS, the
// thumbnail's IFD1), XMP, IPTC and the PNG header with its text chunks. No URL or file readers:
// the bytes are always in hand, and the build replaces exifr's fetch and dynamic import with
// nothing (see build.js), so this can never reach the network.
import { Exifr } from "exifr/src/core.mjs";
import "exifr/src/file-parsers/jpeg.mjs";
import "exifr/src/file-parsers/png.mjs";
import "exifr/src/file-parsers/heif.mjs";
import "exifr/src/file-parsers/tiff.mjs";
import "exifr/src/segment-parsers/tiff-exif.mjs";
import "exifr/src/segment-parsers/xmp.mjs";
import "exifr/src/segment-parsers/iptc.mjs";
import "exifr/src/segment-parsers/ihdr.mjs";
import "exifr/src/dicts/tiff-ifd0-keys.mjs";
import "exifr/src/dicts/tiff-exif-keys.mjs";
import "exifr/src/dicts/tiff-gps-keys.mjs";
import "exifr/src/dicts/tiff-other-keys.mjs";
import "exifr/src/dicts/iptc-keys.mjs";
import "exifr/src/dicts/tiff-revivers.mjs";

/** Everything it can find, segment by segment (`mergeOutput: false`), values untranslated. */
const OPTIONS = {
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  ifd1: true,
  interop: false,
  xmp: true,
  iptc: true,
  ihdr: true,
  icc: false,
  jfif: false,
  makerNote: true,
  userComment: true,
  mergeOutput: false,
  translateValues: false,
  sanitize: true,
  silentErrors: true,
};

/**
 * The metadata of an image's bytes, by segment (`ifd0`, `exif`, `gps`, `ifd1`, `xmp`, `dc`,
 * `iptc`, `ihdr`, `makerNote`…), or null when there is none or the bytes are not an image exifr
 * reads. Only bytes are accepted: a string would make exifr fetch it.
 */
export async function readExif(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  try {
    const reader = new Exifr(OPTIONS);
    await reader.read(bytes);
    const read = await reader.parse();
    return read && Object.keys(read).length ? read : null;
  } catch {
    return null;
  }
}

/** What exifr reads in blocks it would not find by itself (the EXIF and XMP chunks of a WebP, the
 *  XMP item of a HEIF, the XMP streams of a PDF): it reads them from a JPEG made of nothing else. */
export function readBlocks(tiff, xmp) {
  const bytes = wrapped(tiff, xmp);
  return bytes ? readExif(bytes) : Promise.resolve(null);
}

/** A JPEG with nothing but these blocks, for exifr to read them where it would not look. */
function wrapped(tiff, xmp) {
  const segments = [];
  const segment = (prefix, body) => {
    // A segment holds 64 KB: a longer block is cut (exifr's XMP reader takes what it can).
    body = body.subarray(0, 0xffff - 2 - prefix.length);
    const length = 2 + prefix.length + body.length;
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

const ascii = (bytes, from, length) => String.fromCharCode(...bytes.subarray(from, from + length));

const text = (value) => (typeof value === "string" ? value : Array.isArray(value) ? value.filter((one) => typeof one === "string").join(", ") : undefined);

/** UserComment: 8 bytes of character set, then the text. */
function commentText(value) {
  if (typeof value === "string") return value;
  if (!(value instanceof Uint8Array) || value.length <= 8) return undefined;
  const unicode = ascii(value, 0, 7) === "UNICODE";
  const body = value.subarray(8);
  return unicode ? new TextDecoder("utf-16be").decode(body) : new TextDecoder("latin1").decode(body);
}

/** Where each thing exifr reads goes in the report (`findings` is a report.js Findings). */
export function collect(read, findings) {
  const { ifd0 = {}, exif = {}, gps, ifd1, xmp = {}, dc = {}, iptc = {}, ihdr = {}, photoshop = {}, pdf = {} } = read;

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
  findings.add("software", text(pdf.Producer));

  for (const key of ["SerialNumber", "LensSerialNumber", "ImageUniqueID"]) findings.add("serial", text(exif[key]));

  for (const key of ["ImageDescription", "XPComment", "XPTitle", "XPSubject", "XPKeywords"]) findings.add("comment", text(ifd0[key]));
  findings.add("comment", commentText(exif.UserComment));
  for (const key of ["title", "description", "subject"]) findings.add("comment", text(dc[key]));
  for (const key of ["Caption", "Headline", "Keywords", "ObjectName"]) findings.add("comment", text(iptc[key]));
  for (const key of ["Title", "Comment", "Description", "Disclaimer", "Warning"]) findings.add("comment", text(ihdr[key]));
  findings.add("comment", text(pdf.Keywords));

  if (ifd1 && (ifd1.ThumbnailLength > 0 || ifd1.ThumbnailOffset > 0)) findings.add("thumbnail", null);
  if (read.makerNote) findings.add("other", "MakerNote");
}

