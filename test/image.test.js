// Photos (plan of the new plugins, §5): what the report finds in each format, and what is left
// after cleaning. The cleaning is checked with exifr on the result, and the image data (the JPEG
// scan, the PNG IDAT, the WebP bitstream, the HEIF image items) must come out byte for byte.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readExif } from "../src/exif.js";
import { cleanImage, inspectImage, kindOf } from "../src/image.js";

const fixture = (name) => new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
const values = (report, group) => report.findings.filter((found) => found.group === group).map((found) => found.value);
const groups = (report) => [...new Set(report.findings.map((found) => found.group))].sort();
const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

/** The entropy-coded scan of a JPEG: from its SOS marker to its EOI, both included. */
function jpegScan(bytes) {
  let at = 2;
  while (at < bytes.length) {
    const marker = (bytes[at] << 8) | bytes[at + 1];
    if (marker === 0xffda) {
      const end = latin1(bytes).indexOf("\xff\xd9", at);
      return bytes.slice(at, end + 2);
    }
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }
  throw new Error("no scan");
}

/** The chunks of a PNG, as [type, data]. */
function pngChunks(bytes) {
  const chunks = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    chunks.push([latin1(bytes.slice(at + 4, at + 8)), bytes.slice(at + 8, at + 8 + length)]);
    at += 12 + length;
  }
  return chunks;
}

/** The chunks of a WebP, as [fourcc, data]. */
function webpChunks(bytes) {
  const chunks = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 12; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at + 4, true);
    chunks.push([latin1(bytes.slice(at, at + 4)), bytes.slice(at + 8, at + 8 + length)]);
    at += 8 + length + (length % 2);
  }
  return chunks;
}

describe("what kind of file it is", () => {
  it("knows each kind by its first bytes, not by its name", () => {
    expect(kindOf(fixture("photo.jpg"))).toBe("jpeg");
    expect(kindOf(fixture("photo.png"))).toBe("png");
    expect(kindOf(fixture("photo.webp"))).toBe("webp");
    expect(kindOf(fixture("photo.heic"))).toBe("heic");
    expect(kindOf(fixture("document.pdf"))).toBe("pdf");
    expect(kindOf(fixture("broken.pdf"))).toBe(null);
    expect(kindOf(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]))).toBe(null); // a GIF
    expect(kindOf(new Uint8Array(0))).toBe(null);
  });
});

describe("the report of a photo", () => {
  it("finds everything a JPEG says: place, phone, dates, author, program, serial, thumbnail, comment", async () => {
    const report = await inspectImage(fixture("photo.jpg"));
    expect(report.kind).toBe("jpeg");
    const [place] = values(report, "location");
    expect(place.latitude).toBeCloseTo(40.4165, 4);
    expect(place.longitude).toBeCloseTo(-3.70378, 4);
    expect(values(report, "device")).toEqual(expect.arrayContaining(["Fakecam", "Model Z 2026", "Fakecam Lens 4mm"]));
    const dates = values(report, "dates");
    expect(dates.every((date) => date instanceof Date)).toBe(true);
    expect(dates.map((date) => date.getFullYear())).toContain(2026);
    expect(values(report, "author")).toEqual(expect.arrayContaining(["Ana Example", "(c) Ana Example"]));
    expect(new Set(values(report, "author")).size).toBe(values(report, "author").length);
    expect(values(report, "software")).toEqual(expect.arrayContaining(["Fakecam Firmware 1.0", "Fake Editor 3"]));
    expect(values(report, "serial")).toEqual(expect.arrayContaining(["SN-000123456", "0f1e2d3c4b5a69788796a5b4c3d2e1f0"]));
    expect(values(report, "thumbnail")).toHaveLength(1);
    expect(values(report, "comment")).toContain("Taken at home");
    expect(values(report, "other")).toEqual(expect.arrayContaining(["MakerNote"]));
    expect(report.kept).toEqual({ orientation: 6, colour: true });
  });

  it("says the place is empty, not found, when the GPS values were zeroed (Android's picker)", async () => {
    const report = await inspectImage(fixture("wiped-gps.jpg"));
    const places = report.findings.filter((found) => found.group === "location");
    expect(places).toEqual([{ group: "location", value: null, empty: true }]);
    expect(values(report, "device")).toContain("Model Z 2026");
    expect(values(report, "serial")).toContain("SN-000123456");
  });

  it("finds the video of a motion photo after the end of the image", async () => {
    const report = await inspectImage(fixture("motion.jpg"));
    expect(values(report, "motion")).toHaveLength(1);
  });

  it("finds other bytes hidden after the end of the image, and cuts them", async () => {
    const tail = new TextEncoder().encode("SECRET TRAILER");
    const bytes = new Uint8Array([...fixture("wiped-gps.jpg"), ...tail]);
    expect((await inspectImage(bytes)).findings).toContainEqual({ group: "extra", value: null });
    expect(latin1(cleanImage(bytes))).not.toContain("SECRET TRAILER");
  });

  it("finds the text chunks, the eXIf and the time of a PNG", async () => {
    const report = await inspectImage(fixture("photo.png"));
    expect(report.kind).toBe("png");
    expect(values(report, "location")).toHaveLength(1);
    expect(values(report, "author")).toContain("Ana Example");
    expect(values(report, "software")).toContain("Fake Editor 3");
    expect(values(report, "comment")).toContain("Description");
    expect(values(report, "dates").length).toBeGreaterThanOrEqual(2);
    expect(report.kept.colour).toBe(true);
  });

  it("finds the EXIF and XMP chunks of a WebP", async () => {
    const report = await inspectImage(fixture("photo.webp"));
    expect(report.kind).toBe("webp");
    expect(values(report, "device")).toContain("Model Z 2026");
    expect(values(report, "location")).toHaveLength(1);
    expect(values(report, "author")).toContain("Ana Example");
    expect(values(report, "software")).toContain("Fake Editor 3");
  });

  it("finds the Exif item, the XMP item and the thumbnail of a HEIF", async () => {
    const report = await inspectImage(fixture("photo.heic"));
    expect(report.kind).toBe("heic");
    expect(values(report, "device")).toContain("Model Z 2026");
    expect(values(report, "location")).toHaveLength(1);
    expect(values(report, "thumbnail")).toHaveLength(1);
    expect(values(report, "software")).toContain("Fake Editor 3"); // only in the XMP item
  });

  it("finds nothing in a photo that says nothing", async () => {
    const report = await inspectImage(cleanImage(fixture("photo.png")));
    expect(report.findings).toEqual([]);
  });
});

describe("cleaning a photo", () => {
  /** What exifr still reads in the result: the plan's test (no GPS, make, model, dates, author). */
  async function leftovers(bytes) {
    const read = (await readExif(bytes)) ?? {};
    const { ifd0 = {}, exif = {}, gps, xmp, dc, iptc } = read;
    return {
      gps: gps ?? null,
      make: ifd0.Make ?? null,
      model: ifd0.Model ?? null,
      dates: [ifd0.ModifyDate, exif.DateTimeOriginal, exif.CreateDate].filter(Boolean),
      author: ifd0.Artist ?? ifd0.Copyright ?? dc?.creator ?? iptc?.Byline ?? null,
      xmp: xmp ?? null,
      orientation: ifd0.Orientation ?? null,
    };
  }
  const nothing = { gps: null, make: null, model: null, dates: [], author: null, xmp: null };

  it("leaves a JPEG with its orientation, its colour profile and its scan, and nothing else", async () => {
    const before = fixture("photo.jpg");
    const after = cleanImage(before);
    expect(await leftovers(after)).toEqual({ ...nothing, orientation: 6 });
    expect(jpegScan(after)).toEqual(jpegScan(before));
    expect(latin1(after)).toContain("ICC_PROFILE");
    expect(latin1(after)).not.toContain("Taken at home");
    expect(latin1(after)).not.toContain("Photoshop");
    expect(latin1(after)).not.toContain("Ana Example");
    expect(latin1(after)).not.toContain("SN-000123456");
    expect(after.slice(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
    const report = await inspectImage(after);
    expect(report.findings).toEqual([]);
    expect(report.kept).toEqual({ orientation: 6, colour: true });
  });

  it("cuts the video after the end of a motion photo", async () => {
    const before = fixture("motion.jpg");
    const after = cleanImage(before);
    expect(latin1(after)).not.toContain("ftyp");
    expect(latin1(after)).not.toContain("MotionPhoto");
    expect(after.slice(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
    expect(jpegScan(after)).toEqual(jpegScan(before));
  });

  it("leaves a PNG with its pixels and its colour profile, and no text, eXIf or time", async () => {
    const before = fixture("photo.png");
    const after = cleanImage(before);
    expect(await leftovers(after)).toEqual({ ...nothing, orientation: null });
    const types = pngChunks(after).map(([type]) => type);
    expect(types).toEqual(["IHDR", "iCCP", "IDAT", "IEND"]);
    const data = (bytes) => pngChunks(bytes).filter(([type]) => type === "IDAT" || type === "IHDR");
    expect(data(after)).toEqual(data(before));
  });

  it("leaves a WebP with its bitstream and its colour profile, and no EXIF or XMP", () => {
    const before = fixture("photo.webp");
    const after = cleanImage(before);
    expect(webpChunks(after).map(([fourcc]) => fourcc)).toEqual(["VP8X", "ICCP", "VP8L"]);
    const bitstream = (bytes) => webpChunks(bytes).find(([fourcc]) => fourcc === "VP8L");
    expect(bitstream(after)).toEqual(bitstream(before));
    expect(latin1(after)).not.toContain("Ana Example");
    expect(latin1(after)).not.toContain("Fakecam");
  });

  it("zeroes the Exif and XMP of a HEIF in place: same size, same image items", async () => {
    const before = fixture("photo.heic");
    const after = cleanImage(before);
    expect(after.length).toBe(before.length);
    expect(await leftovers(after)).toEqual({ ...nothing, orientation: null });
    expect(latin1(after)).not.toContain("Ana Example");
    expect(latin1(after)).not.toContain("Fakecam");
    for (const item of ["FAKE-HEVC-PRIMARY-IMAGE-DATA-0123456789", "FAKE-HEVC-THUMBNAIL"]) {
      expect(latin1(after).indexOf(item)).toBe(latin1(before).indexOf(item));
    }
    // The thumbnail is a second picture inside the file: it stays, and the report says so.
    const report = await inspectImage(after);
    expect(report.findings).toEqual([{ group: "thumbnail", value: null }]);
  });

  it("does not touch what it was given", () => {
    const before = fixture("photo.heic");
    const copy = before.slice();
    cleanImage(before);
    expect(before).toEqual(copy);
  });

  it("refuses a broken photo and a file it does not know, with a reason", async () => {
    expect(() => cleanImage(fixture("broken.jpg"))).toThrow(expect.objectContaining({ reason: "broken" }));
    expect(() => cleanImage(fixture("broken.pdf"))).toThrow(expect.objectContaining({ reason: "unsupported" }));
    await expect(inspectImage(fixture("broken.jpg"))).rejects.toMatchObject({ reason: "broken" });
  });
});
