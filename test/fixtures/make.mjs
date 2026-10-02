// Makes the files the tests use, by hand and small: `node test/fixtures/make.mjs`. Nothing here is
// anybody's photo or document: the pictures are 16×16 gradients drawn once for these tests (their
// bytes are below), and every name, place and serial number is made up.
//
//   photo.jpg        JPEG with EXIF (GPS, make, model, dates, orientation 6, artist, copyright,
//                    software, serial, unique id, maker note, thumbnail), XMP, IPTC, ICC and a comment
//   wiped-gps.jpg    the same, with the GPS values zeroed the way Android's photo picker leaves them
//   motion.jpg       a "motion photo": XMP that says so and a video after the end of the image
//   photo.png        PNG with tEXt (author, software, creation time), zTXt, iTXt XMP, eXIf, tIME, iCCP
//   photo.webp       lossless WebP with EXIF, XMP and ICC chunks
//   photo.heic       a HEIF container with an Exif item, an XMP item, an ICC colour property and a
//                    thumbnail item (the HEVC bytes are a stand-in: nothing here decodes them)
//   document.pdf     PDF with Info, XMP in the catalog and on an image, an annotation by an author,
//                    an attachment, and an incremental update that left an older Info behind
//   locked.pdf       PDF with an /Encrypt dictionary
//   signed.pdf       PDF with a signature field and its /ByteRange
//   broken.jpg       a JPEG cut in the middle of a segment
//   broken.pdf       text that is not a PDF
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const write = (name, bytes) => writeFileSync(join(here, name), bytes);

// A 16×16 gradient as a baseline JPEG, and a 4×4 red square for the thumbnail (both made once with
// Pillow from pixels drawn in code), and the same gradient as a lossless WebP.
const BASE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxnQvCn3f3f6V3uheFPu/u/wBK7vQvCn3f3f6V3uheFPu/uv0rbNOJ99RcC8Y/D7x//9k=",
  "base64",
);
const THUMB_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAEAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDFoooryz7w/9k=",
  "base64",
);
const BASE_WEBP = Buffer.from("UklGRi4AAABXRUJQVlA4TCIAAAAvD8ADALkyRPQ/dhHR/wCRtk0l3L/hwdOBGMCYAKoO1H8A", "base64");

// ---- TIFF (the inside of EXIF) ----

const TYPES = { byte: 1, ascii: 2, short: 3, long: 4, rational: 5, undefined: 7 };
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

const ascii = (text) => ({ type: TYPES.ascii, count: text.length + 1, bytes: Buffer.from(`${text}\0`, "latin1") });
const short = (...values) => ({ type: TYPES.short, values });
const long = (...values) => ({ type: TYPES.long, values });
const byte = (...values) => ({ type: TYPES.byte, values });
const rational = (...pairs) => ({ type: TYPES.rational, pairs });
const undefinedBytes = (bytes) => ({ type: TYPES.undefined, count: bytes.length, bytes: Buffer.from(bytes) });
const pointer = (to) => ({ type: TYPES.long, pointer: to });

/**
 * A TIFF block: IFD0 (with its next IFD, IFD1, when there is a thumbnail), the EXIF and GPS
 * sub-IFDs, and the thumbnail's bytes. `ifds` maps a name to its entries `{tag: value}`.
 */
function tiff({ little = false, ifd0, exif, gps, ifd1, thumbnail }) {
  const u16 = (value) => {
    const out = Buffer.alloc(2);
    little ? out.writeUInt16LE(value) : out.writeUInt16BE(value);
    return out;
  };
  const u32 = (value) => {
    const out = Buffer.alloc(4);
    little ? out.writeUInt32LE(value >>> 0) : out.writeUInt32BE(value >>> 0);
    return out;
  };
  const payload = (value) => {
    if (value.bytes) return value.bytes;
    if (value.pairs) return Buffer.concat(value.pairs.flatMap(([num, den]) => [u32(num), u32(den)]));
    if (value.type === TYPES.short) return Buffer.concat(value.values.map(u16));
    if (value.type === TYPES.byte) return Buffer.from(value.values);
    return Buffer.concat(value.values.map(u32));
  };
  const countOf = (value) => value.count ?? value.pairs?.length ?? value.values?.length ?? 1;

  const order = [
    ["ifd0", { ...ifd0, ...(exif ? { 0x8769: pointer("exif") } : {}), ...(gps ? { 0x8825: pointer("gps") } : {}) }],
    ["exif", exif],
    ["gps", gps],
    ["ifd1", ifd1 ? { ...ifd1, 0x0201: pointer("thumbnail"), 0x0202: long(thumbnail.length) } : null],
  ].filter(([, entries]) => entries);

  // First pass: where each IFD, its long values and the thumbnail go.
  const at = {};
  let cursor = 8;
  for (const [name, entries] of order) {
    at[name] = cursor;
    cursor += 2 + Object.keys(entries).length * 12 + 4;
    for (const value of Object.values(entries)) {
      if (value.pointer) continue;
      const size = payload(value).length;
      if (size > 4) cursor += size + (size % 2);
    }
  }
  if (thumbnail) at.thumbnail = cursor;

  // Second pass: the bytes.
  const parts = [Buffer.from(little ? "II" : "MM", "latin1"), u16(42), u32(8)];
  for (const [name, entries] of order) {
    const tags = Object.keys(entries).map(Number).sort((a, b) => a - b);
    const heap = [];
    let heapAt = at[name] + 2 + tags.length * 12 + 4;
    parts.push(u16(tags.length));
    for (const tag of tags) {
      const value = entries[tag];
      parts.push(u16(tag), u16(value.type), u32(countOf(value)));
      if (value.pointer) {
        parts.push(u32(at[value.pointer]));
        continue;
      }
      const bytes = payload(value);
      if (bytes.length <= 4) {
        parts.push(Buffer.concat([bytes, Buffer.alloc(4 - bytes.length)]));
      } else {
        parts.push(u32(heapAt));
        heap.push(bytes);
        if (bytes.length % 2) heap.push(Buffer.alloc(1));
        heapAt += bytes.length + (bytes.length % 2);
      }
    }
    const next = name === "ifd0" && ifd1 ? at.ifd1 : 0;
    parts.push(u32(next), ...heap);
  }
  if (thumbnail) parts.push(thumbnail);
  return Buffer.concat(parts);
}

const IFD0 = {
  0x010f: ascii("Fakecam"),
  0x0110: ascii("Model Z 2026"),
  0x0112: short(6),
  0x0131: ascii("Fakecam Firmware 1.0"),
  0x0132: ascii("2026:05:17 18:30:00"),
  0x013b: ascii("Ana Example"),
  0x8298: ascii("(c) Ana Example"),
};
const EXIF = {
  0x9003: ascii("2026:05:17 18:29:59"),
  0x9004: ascii("2026:05:17 18:29:59"),
  0x927c: undefinedBytes(Buffer.from("FAKECAM MAKER NOTE 0123456789", "latin1")),
  0xa420: ascii("0f1e2d3c4b5a69788796a5b4c3d2e1f0"),
  0xa431: ascii("SN-000123456"),
  0xa434: ascii("Fakecam Lens 4mm"),
};
// 40° 24' 59.4" N, 3° 42' 13.6" W: a made-up spot in Madrid.
const GPS = {
  0x0000: byte(2, 2, 0, 0),
  0x0001: ascii("N"),
  0x0002: rational([40, 1], [24, 1], [594, 10]),
  0x0003: ascii("W"),
  0x0004: rational([3, 1], [42, 1], [136, 10]),
  0x001d: ascii("2026:05:17"),
};
// What Android's photo picker leaves (2026, MediaProvider redaction): the same tags, same sizes,
// their values zeroed.
const WIPED_GPS = {
  0x0000: byte(2, 2, 0, 0),
  0x0001: { type: TYPES.ascii, count: 2, bytes: Buffer.alloc(2) },
  0x0002: rational([0, 0], [0, 0], [0, 0]),
  0x0003: { type: TYPES.ascii, count: 2, bytes: Buffer.alloc(2) },
  0x0004: rational([0, 0], [0, 0], [0, 0]),
  0x001d: { type: TYPES.ascii, count: 11, bytes: Buffer.alloc(11) },
};

const exifTiff = (gps = GPS, little = false) =>
  tiff({ little, ifd0: IFD0, exif: EXIF, gps, ifd1: { 0x0103: short(6) }, thumbnail: THUMB_JPEG });

const XMP = (extra = "") =>
  `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
  `<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"` +
  ` xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" xmp:CreatorTool="Fake Editor 3" xmp:CreateDate="2026-05-17T18:29:59"${extra}>` +
  `<dc:creator><rdf:Seq><rdf:li>Ana Example</rdf:li></rdf:Seq></dc:creator>` +
  `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

// A small, valid-looking ICC profile: a header that says "display, RGB", no tags that matter.
function iccProfile() {
  const icc = Buffer.alloc(132);
  icc.writeUInt32BE(132, 0);
  icc.write("appl", 4, "latin1");
  icc.writeUInt32BE(0x04000000, 8);
  icc.write("mntrRGB XYZ ", 12, "latin1");
  icc.write("acsp", 36, "latin1");
  icc.writeUInt32BE(0, 128);
  return icc;
}

// ---- JPEG ----

const segment = (marker, body) => {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(marker, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
};

/** IPTC inside a Photoshop APP13: By-line (2:80) and Copyright Notice (2:116). */
function iptcSegment() {
  const dataset = (number, text) => {
    const value = Buffer.from(text, "latin1");
    const head = Buffer.from([0x1c, 2, number, 0, 0]);
    head.writeUInt16BE(value.length, 3);
    return Buffer.concat([head, value]);
  };
  const iptc = Buffer.concat([dataset(80, "Ana Example"), dataset(116, "(c) Ana Example")]);
  const resource = Buffer.concat([
    Buffer.from("8BIM", "latin1"),
    Buffer.from([0x04, 0x04, 0, 0]),
    Buffer.from([(iptc.length >>> 24) & 255, (iptc.length >>> 16) & 255, (iptc.length >>> 8) & 255, iptc.length & 255]),
    iptc,
    iptc.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
  return segment(0xffed, Buffer.concat([Buffer.from("Photoshop 3.0\0", "latin1"), resource]));
}

/** The base JPEG with these segments after its APP0, and these bytes after its end. */
function jpegWith(segments, trailing = Buffer.alloc(0)) {
  // SOI (2) + APP0 JFIF (2 + 16) = 20 bytes, then the tables, the frame and the scan.
  const app0End = 2 + 2 + BASE_JPEG.readUInt16BE(4);
  return Buffer.concat([BASE_JPEG.subarray(0, app0End), ...segments, BASE_JPEG.subarray(app0End), trailing]);
}

const exifSegment = (body) => segment(0xffe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), body]));
const xmpSegment = (xmp) => segment(0xffe1, Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(xmp, "utf8")]));
const iccSegment = () => segment(0xffe2, Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.from([1, 1]), iccProfile()]));
const comment = (text) => segment(0xfffe, Buffer.from(text, "latin1"));

write("photo.jpg", jpegWith([exifSegment(exifTiff()), xmpSegment(XMP()), iccSegment(), iptcSegment(), comment("Taken at home")]));
write("wiped-gps.jpg", jpegWith([exifSegment(exifTiff(WIPED_GPS)), iccSegment()]));

// A motion photo: the still, then an MP4 (here only its first boxes) after the end of image.
const fakeMp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypmp42", "latin1"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("mp42isom", "latin1"),
  Buffer.from([0, 0, 0, 0x10]),
  Buffer.from("mdatFAKEVIDEO!", "latin1"),
]);
write(
  "motion.jpg",
  jpegWith([exifSegment(exifTiff()), xmpSegment(XMP(` GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1"`))], fakeMp4),
);

const broken = jpegWith([exifSegment(exifTiff())]);
write("broken.jpg", broken.subarray(0, 60));

// ---- PNG ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])));
  return Buffer.concat([head, data, crc]);
}

function png() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(16, 0);
  ihdr.writeUInt32BE(16, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = [];
  for (let y = 0; y < 16; y += 1) {
    rows.push(0); // filter: none
    for (let x = 0; x < 16; x += 1) rows.push(x * 16, y * 16, 128);
  }
  const time = Buffer.from([0x07, 0xea, 5, 17, 18, 30, 0]); // 2026-05-17 18:30:00
  const text = (key, value) => chunk("tEXt", Buffer.from(`${key}\0${value}`, "latin1"));
  const ztxt = chunk("zTXt", Buffer.concat([Buffer.from("Description\0\0", "latin1"), deflateSync(Buffer.from("Our street, the blue door"))]));
  const itxt = chunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0", "latin1"), Buffer.from(XMP(), "utf8")]));
  const iccp = chunk("iCCP", Buffer.concat([Buffer.from("Fake RGB\0\0", "latin1"), deflateSync(iccProfile())]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    iccp,
    text("Author", "Ana Example"),
    text("Software", "Fake Editor 3"),
    text("Creation Time", "2026-05-17 18:29:59"),
    ztxt,
    itxt,
    chunk("eXIf", exifTiff(GPS, true)),
    chunk("tIME", time),
    chunk("IDAT", deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
write("photo.png", png());

// ---- WebP ----

function webp() {
  const riffChunk = (fourcc, data) => {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, "latin1");
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8l = BASE_WEBP.subarray(12); // the VP8L chunk, header included
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0b00101100; // ICC, EXIF, XMP
  vp8x.writeUIntLE(15, 4, 3);
  vp8x.writeUIntLE(15, 7, 3);
  const body = Buffer.concat([
    Buffer.from("WEBP", "latin1"),
    riffChunk("VP8X", vp8x),
    riffChunk("ICCP", iccProfile()),
    vp8l,
    riffChunk("EXIF", exifTiff(GPS, true)),
    riffChunk("XMP ", Buffer.from(XMP(), "utf8")),
  ]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
write("photo.webp", webp());

// ---- HEIF ----

const box = (type, ...contents) => {
  const body = Buffer.concat(contents);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
};
const full = (version, flags = 0) => Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]);
const be16 = (value) => Buffer.from([(value >> 8) & 255, value & 255]);
const be32 = (value) => Buffer.from([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);

function heic() {
  const hevc = Buffer.from("FAKE-HEVC-PRIMARY-IMAGE-DATA-0123456789", "latin1");
  const exif = Buffer.concat([be32(6), Buffer.from("Exif\0\0", "latin1"), exifTiff()]);
  const xmp = Buffer.from(XMP(), "utf8");
  const thumb = Buffer.from("FAKE-HEVC-THUMBNAIL", "latin1");
  const items = [
    { id: 1, type: "hvc1", data: hevc },
    { id: 2, type: "Exif", data: exif },
    { id: 3, type: "mime", data: xmp, contentType: "application/rdf+xml" },
    { id: 4, type: "hvc1", data: thumb },
  ];

  const ftyp = box("ftyp", Buffer.from("heic", "latin1"), be32(0), Buffer.from("mif1heic", "latin1"));
  const infe = (item) =>
    box(
      "infe",
      full(2),
      be16(item.id),
      be16(0),
      Buffer.from(item.type, "latin1"),
      Buffer.from("\0", "latin1"),
      item.contentType ? Buffer.from(`${item.contentType}\0`, "latin1") : Buffer.alloc(0),
    );
  const iinf = box("iinf", full(0), be16(items.length), ...items.map(infe));
  const reference = (type, from, to) => box(type, be16(from), be16(1), be16(to));
  const iref = box("iref", full(0), reference("thmb", 4, 1), reference("cdsc", 2, 1), reference("cdsc", 3, 1));
  const ispe = box("ispe", full(0), be32(16), be32(16));
  const colr = box("colr", Buffer.from("prof", "latin1"), iccProfile());
  const ipco = box("ipco", ispe, colr);
  const ipma = box("ipma", full(0), be32(2), be16(1), Buffer.from([2, 0x81, 0x82]), be16(4), Buffer.from([1, 0x81]));
  const iprp = box("iprp", ipco, ipma);
  const hdlr = box("hdlr", full(0), be32(0), Buffer.from("pict", "latin1"), Buffer.alloc(12), Buffer.from("\0", "latin1"));
  const pitm = box("pitm", full(0), be16(1));

  // iloc, version 0, 4-byte offsets and lengths; the offsets are known once the meta box is.
  const ilocWith = (offsets) =>
    box(
      "iloc",
      full(0),
      Buffer.from([0x44, 0x00]),
      be16(items.length),
      ...items.map((item, at) => Buffer.concat([be16(item.id), be16(0), be16(1), be32(offsets[at]), be32(item.data.length)])),
    );
  const metaWith = (offsets) => box("meta", full(0), hdlr, pitm, ilocWith(offsets), iinf, iref, iprp);
  const metaLength = metaWith(items.map(() => 0)).length;
  let cursor = ftyp.length + metaLength + 8; // the mdat header
  const offsets = items.map((item) => {
    const at = cursor;
    cursor += item.data.length;
    return at;
  });
  return Buffer.concat([ftyp, metaWith(offsets), box("mdat", ...items.map((item) => item.data))]);
}
write("photo.heic", heic());

// ---- PDF ----

/** A PDF from its objects, with a correct xref table; `update` appends an incremental update. */
function pdf(objects, { trailer = "", update = null } = {}) {
  let out = "%PDF-1.6\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objects.forEach((body, at) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${at + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer}>>\nstartxref\n${xref}\n%%EOF\n`;
  if (update) {
    // The new objects, numbered after the old ones; the trailer points back at the first table.
    const first = objects.length + 1;
    const newOffsets = [];
    update.objects.forEach((body, at) => {
      newOffsets.push(Buffer.byteLength(out, "latin1"));
      out += `${first + at} 0 obj\n${body}\nendobj\n`;
    });
    const xref2 = Buffer.byteLength(out, "latin1");
    out += `xref\n${first} ${update.objects.length}\n`;
    for (const offset of newOffsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${first + update.objects.length} /Root 1 0 R /Prev ${xref} ${update.trailer}>>\nstartxref\n${xref2}\n%%EOF\n`;
  }
  return Buffer.from(out, "latin1");
}

const stream = (dict, content) => `<< ${dict} /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
const pdfXmp = XMP(` xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Producer="Fake Writer 2026"`);
const page = (extra = "") =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 5 0 R ${extra}>>`;

// 1 catalog, 2 pages, 3 page, 4 font, 5 content, 6 catalog XMP, 7 image (a JPEG with EXIF) with
// its own XMP (8), 9 old Info, 10 annotation, 11 attachment spec, 12 embedded file
const imageJpeg = jpegWith([exifSegment(exifTiff())]).toString("latin1");
write(
  "document.pdf",
  pdf(
    [
      "<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R /Names << /EmbeddedFiles << /Names [(notes.txt) 11 0 R] >> >> >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      page("/Annots [10 0 R]"),
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      stream("", "BT /F1 18 Tf 40 340 Td (Hello from a test) Tj ET\nq 64 0 0 64 40 200 cm /Im1 Do Q"),
      stream("/Type /Metadata /Subtype /XML", pdfXmp),
      stream("/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Metadata 8 0 R", imageJpeg),
      stream("/Type /Metadata /Subtype /XML", XMP()),
      "<< /Author (Old Author Name) /Producer (Old Producer) /CreationDate (D:20250101090000+01'00') >>",
      "<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /T (Annotation Author) /Contents (Looks good) >>",
      "<< /Type /Filespec /F (notes.txt) /EF << /F 12 0 R >> >>",
      stream("/Type /EmbeddedFile", "attached notes"),
    ],
    {
      trailer: "/Info 9 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] ",
      update: {
        objects: [
          "<< /Title (Salary review) /Author (Ana Example) /Creator (Fake Word 2026) /Producer (Fake Writer 2026) /CreationDate (D:20260517182959+02'00') /ModDate (D:20260518090000+02'00') /Company (Example Ltd) >>",
        ],
        trailer: "/Info 13 0 R /ID [<00112233445566778899aabbccddeeff> <ffeeddccbbaa99887766554433221100>] ",
      },
    },
  ),
);

write(
  "locked.pdf",
  pdf(
    [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>",
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -1 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> >>`,
      "<< /Author (Ana Example) >>",
    ],
    { trailer: "/Encrypt 4 0 R /Info 5 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] " },
  ),
);

write(
  "signed.pdf",
  pdf(
    [
      "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 3 >> >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Annots [4 0 R] >>",
      "<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0] /P 3 0 R /V 5 0 R >>",
      `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 100 200 300] /Contents <${"00".repeat(32)}> /M (D:20260517182959+02'00') /Name (Ana Example) >>`,
      "<< /Author (Ana Example) /Producer (Fake Signer) >>",
    ],
    { trailer: "/Info 6 0 R " },
  ),
);

write("broken.pdf", Buffer.from("this is not a pdf at all, just some text that pretends to be one\n"));

console.log("fixtures written");
