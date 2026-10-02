// The report's own rules: each finding once, dates from what files write, what was removed and
// what is still there (compared, not assumed), how a value is shown, and the name and type of the
// file that goes out (never a path).
import { describe, expect, it } from "vitest";
import { Findings, asDate, compare, mimeOf, outputName, shown } from "../src/report.js";

describe("findings", () => {
  it("keeps each finding once, and no empty text", () => {
    const findings = new Findings();
    findings.add("author", "Ana Example");
    findings.add("author", " Ana Example\0\0");
    findings.add("author", "");
    findings.add("author", undefined);
    findings.add("dates", "2026:05:17 18:29:59");
    findings.add("dates", new Date(2026, 4, 17, 18, 29, 59));
    findings.add("location", null, { empty: true });
    findings.add("thumbnail", null);
    findings.add("thumbnail", null);
    expect(findings.list).toEqual([
      { group: "author", value: "Ana Example" },
      { group: "dates", value: new Date(2026, 4, 17, 18, 29, 59) },
      { group: "location", value: null, empty: true },
      { group: "thumbnail", value: null },
    ]);
  });

  it("reads the dates files write, and leaves alone what is not one", () => {
    expect(asDate("2026:05:17 18:29:59")).toEqual(new Date(2026, 4, 17, 18, 29, 59));
    expect(asDate("2026-05-17T18:29")).toEqual(new Date(2026, 4, 17, 18, 29, 0));
    expect(asDate("2026:05:17")).toEqual(new Date(2026, 4, 17));
    expect(asDate("next Tuesday")).toBe("next Tuesday");
    expect(asDate(new Date(Number.NaN))).toBe(undefined);
    expect(asDate(42)).toBe(undefined);
  });
});

describe("compare", () => {
  it("says what went and what is still there, by looking at both files", () => {
    const before = [
      { group: "location", value: { latitude: 1, longitude: 2 } },
      { group: "author", value: "Ana Example" },
      { group: "thumbnail", value: null },
      { group: "dates", value: new Date(2026, 4, 17) },
    ];
    const after = [{ group: "thumbnail", value: null }];
    expect(compare(before, after)).toEqual({
      removed: [before[0], before[1], before[3]],
      remaining: [{ group: "thumbnail", value: null }],
    });
  });
});

describe("what is shown", () => {
  it("writes dates, places and texts in the language of the phone", () => {
    expect(shown({ group: "dates", value: new Date(2026, 4, 17, 18, 29) }, "en")).toMatch(/May 17, 2026/);
    expect(shown({ group: "dates", value: new Date(2026, 4, 17, 18, 29) }, "es")).toMatch(/17 may 2026/);
    expect(shown({ group: "dates", value: new Date(2026, 4, 17) }, "en")).toBe("May 17, 2026");
    expect(shown({ group: "location", value: { latitude: 40.4165, longitude: -3.7037777 } }, "en")).toBe("40.41650, -3.70378");
    expect(shown({ group: "location", value: { latitude: 40.4165, longitude: -3.7037777 } }, "de")).toBe("40,41650; -3,70378");
    expect(shown({ group: "author", value: "Ana" }, "en")).toBe("Ana");
    expect(shown({ group: "thumbnail", value: null }, "en")).toBe("");
    expect(shown({ group: "comment", value: "x".repeat(200) }, "en")).toHaveLength(81);
  });
});

describe("the file that goes out", () => {
  it("gives a photo a plain name, since a camera's name is its date", () => {
    expect(outputName("IMG_20260517_182959.jpg", "jpeg")).toBe("photo.jpg");
    expect(outputName("PXL_20260517.png", "png")).toBe("photo.png");
    expect(outputName("x.webp", "webp")).toBe("photo.webp");
    expect(outputName("IMG_0001.HEIC", "heic")).toBe("photo.heic");
    expect(outputName("IMG_0001.heif", "heic")).toBe("photo.heif");
  });

  it("keeps a PDF's name, without any path or control character", () => {
    expect(outputName("Contract.pdf", "pdf")).toBe("Contract.pdf");
    expect(outputName("/storage/emulated/0/Download/Contract.pdf", "pdf")).toBe("Contract.pdf");
    expect(outputName("C:\\Users\\ana\\Contract.PDF", "pdf")).toBe("Contract.PDF");
    expect(outputName("../../etc/passwd", "pdf")).toBe("passwd.pdf");
    expect(outputName("bad\u0000na\u001fme?.pdf", "pdf")).toBe("badname.pdf");
    expect(outputName("", "pdf")).toBe("document.pdf");
    expect(outputName(undefined, "pdf")).toBe("document.pdf");
    expect(outputName("..", "pdf")).toBe("document.pdf");
    const long = outputName(`${"a".repeat(300)}.pdf`, "pdf");
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("says the type of what it made, from what it is", () => {
    expect(mimeOf("jpeg")).toBe("image/jpeg");
    expect(mimeOf("png")).toBe("image/png");
    expect(mimeOf("webp")).toBe("image/webp");
    expect(mimeOf("heic", "image/heif")).toBe("image/heif");
    expect(mimeOf("heic", "application/octet-stream")).toBe("image/heic");
    expect(mimeOf("pdf")).toBe("application/pdf");
  });
});
