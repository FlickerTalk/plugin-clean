// PDFs (plan of the new plugins, §5): the report of Info, XMP, annotations, attachments, pictures
// with their own metadata and signatures; and the clean file, searched byte by byte: no Info, no
// /Metadata in any object, no Producer of pdf-lib, nothing of an older revision.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { cleanPdf, inspectPdf } from "../src/pdf.js";

const fixture = (name) => new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
const values = (report, group) => report.findings.filter((found) => found.group === group).map((found) => found.value);
const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");

describe("the report of a PDF", () => {
  it("finds the Info, the XMP, an older Info, the annotations, the attachments and the pictures", async () => {
    const report = await inspectPdf(fixture("document.pdf"));
    expect(report.kind).toBe("pdf");
    expect(report.signed).toBe(false);
    expect(values(report, "author")).toEqual(expect.arrayContaining(["Ana Example", "Old Author Name"]));
    expect(values(report, "software")).toEqual(expect.arrayContaining(["Fake Word 2026", "Fake Writer 2026", "Fake Editor 3", "Old Producer"]));
    const dates = values(report, "dates");
    expect(dates.every((date) => date instanceof Date)).toBe(true);
    expect(dates.map((date) => date.toISOString())).toEqual(expect.arrayContaining(["2026-05-17T16:29:59.000Z", "2026-05-18T07:00:00.000Z"]));
    expect(values(report, "comment")).toContain("Salary review");
    expect(values(report, "other")).toEqual(expect.arrayContaining(["Company: Example Ltd", "XMP"]));
    expect(values(report, "identifier")).toHaveLength(1);
    expect(values(report, "annotations")).toEqual(["Annotation Author"]);
    expect(values(report, "attachments")).toEqual(["notes.txt"]);
    expect(values(report, "images")).toHaveLength(1);
  });

  it("finds what pdf-lib itself would leave, in a PDF whose objects are compressed", async () => {
    const made = await PDFDocument.create();
    made.addPage();
    made.setAuthor("Compressed Author");
    const bytes = await made.save({ useObjectStreams: true });
    expect(latin1(bytes)).not.toContain("Compressed Author");
    const report = await inspectPdf(bytes);
    expect(values(report, "author")).toContain("Compressed Author");
    expect(values(report, "software").join(" ")).toContain("pdf-lib");
  });

  it("reads the programs and keywords that only the XMP names", async () => {
    const made = await PDFDocument.create({ updateMetadata: false });
    made.addPage();
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" pdf:Producer="Only In XMP" pdf:Keywords="secret plan"/>' +
      "</rdf:RDF></x:xmpmeta>";
    const stream = made.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
    made.catalog.set(made.context.obj("Metadata"), made.context.register(stream));
    const report = await inspectPdf(await made.save());
    expect(values(report, "software")).toContain("Only In XMP");
    expect(values(report, "comment")).toContain("secret plan");
  });

  it("warns that a digital signature will stop being valid", async () => {
    const report = await inspectPdf(fixture("signed.pdf"));
    expect(report.signed).toBe(true);
    expect(values(report, "author")).toContain("Ana Example");
  });

  it("says a locked PDF cannot be read, and a broken one", async () => {
    await expect(inspectPdf(fixture("locked.pdf"))).rejects.toMatchObject({ reason: "locked" });
    await expect(inspectPdf(fixture("broken.pdf"))).rejects.toMatchObject({ reason: "unsupported" });
    const cut = fixture("document.pdf").slice(0, 300);
    await expect(inspectPdf(cut)).rejects.toMatchObject({ reason: "broken" });
  });
});

describe("cleaning a PDF", () => {
  it("leaves no Info, no /Metadata, no identifier and nothing of the older revision", async () => {
    const before = fixture("document.pdf");
    const after = await cleanPdf(before);
    const raw = latin1(after);
    for (const gone of [
      "/Info",
      "/Metadata",
      "/Producer",
      "/Author",
      "xmpmeta",
      "Salary review",
      "Fake Word 2026",
      "Fake Writer 2026",
      "Old Author Name",
      "Old Producer",
      "Example Ltd",
      "pdf-lib",
      "00112233445566778899aabbccddeeff",
    ]) {
      expect(raw, gone).not.toContain(gone);
    }
    // What it does not touch, and says so: the text, an annotation's author, the attachment and
    // the EXIF inside the picture.
    expect(raw).toContain("Hello from a test");
    expect(raw).toContain("Annotation Author");
    expect(raw).toContain("attached notes");
    expect(raw).toContain("Fakecam");

    const report = await inspectPdf(after);
    expect(report.findings.map((found) => found.group).sort()).toEqual(["annotations", "attachments", "images"]);
    const reopened = await PDFDocument.load(after, { updateMetadata: false });
    expect(reopened.getPageCount()).toBe(1);
    expect(reopened.getProducer()).toBe(undefined);
    expect(reopened.getAuthor()).toBe(undefined);
  });

  it("does not leave pdf-lib's own name in what it writes", async () => {
    const made = await PDFDocument.create();
    made.addPage();
    const after = await cleanPdf(await made.save());
    expect(latin1(after)).not.toContain("pdf-lib");
    expect(latin1(after)).not.toContain("/Producer");
  });

  it("cleans a signed PDF (the signature stops being valid, as the report warned)", async () => {
    const after = await cleanPdf(fixture("signed.pdf"));
    expect(latin1(after)).not.toContain("Fake Signer");
    expect((await PDFDocument.load(after)).getPageCount()).toBe(1);
  });

  it("does not touch what it was given, and refuses a locked or broken PDF", async () => {
    const before = fixture("document.pdf");
    const copy = before.slice();
    await cleanPdf(before);
    expect(before).toEqual(copy);
    await expect(cleanPdf(fixture("locked.pdf"))).rejects.toMatchObject({ reason: "locked" });
    await expect(cleanPdf(fixture("broken.pdf"))).rejects.toMatchObject({ reason: "unsupported" });
  });
});
