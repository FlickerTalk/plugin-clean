// The EXIF reader (exifr, built from its sources with only what Clean needs): it reads the
// fixtures' EXIF, GPS, XMP, IPTC and PNG text, and it never reaches for the network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readExif } from "../src/exif.js";

const fixture = (name) => new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

describe("readExif", () => {
  it("reads the EXIF, GPS, XMP and IPTC of a JPEG", async () => {
    const read = await readExif(fixture("photo.jpg"));
    expect(read.ifd0.Make).toBe("Fakecam");
    expect(read.ifd0.Orientation).toBe(6);
    expect(read.gps.latitude).toBeCloseTo(40.4165, 4);
    expect(read.gps.longitude).toBeCloseTo(-3.70378, 4);
    expect(read.exif.DateTimeOriginal).toBeInstanceOf(Date);
    expect(read.iptc.Byline).toBe("Ana Example");
    expect(read.xmp.CreatorTool).toBe("Fake Editor 3");
    expect(read.ifd1.ThumbnailLength).toBeGreaterThan(0);
    expect(read.makerNote).toBeInstanceOf(Uint8Array);
  });

  it("reads the text chunks and the eXIf of a PNG, and the Exif item of a HEIF", async () => {
    const png = await readExif(fixture("photo.png"));
    expect(png.ihdr.Author).toBe("Ana Example");
    expect(png.ifd0.Model).toBe("Model Z 2026");
    const heic = await readExif(fixture("photo.heic"));
    expect(heic.ifd0.Model).toBe("Model Z 2026");
    expect(heic.gps.latitude).toBeCloseTo(40.4165, 4);
  });

  it("reads a bare TIFF block, as WebP and HEIF carry it", async () => {
    const jpeg = fixture("photo.jpg");
    // The TIFF block starts after "Exif\0\0" in the first APP1.
    const at = Buffer.from(jpeg).indexOf("Exif\0\0", 0, "latin1") + 6;
    const length = (jpeg[at - 8] << 8) + jpeg[at - 7] - 8;
    const read = await readExif(jpeg.slice(at, at + length));
    expect(read.ifd0.Make).toBe("Fakecam");
  });

  it("says nothing of what it cannot read, and never fetches", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await readExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(null);
    expect(await readExif("https://example.com/photo.jpg")).toBe(null);
    expect(await readExif(fixture("broken.pdf"))).toBe(null);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
