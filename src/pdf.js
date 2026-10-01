// PDFs (plan of the new plugins, §5): what a PDF says about who made it, and the same PDF without
// it. Read and written with pdf-lib (MIT). The document's Info (author, title, programs, dates)
// and every XMP /Metadata stream are removed; so are the file identifier and whatever an older
// revision left behind, because only the objects the document still uses are written. Loaded with
// `updateMetadata: false`, so pdf-lib does not write its own name or dates. Not touched, and the
// report says so: the authors of annotations, attachments, the text and pictures of the pages
// (with any metadata inside those pictures). A PDF with a password cannot be read, so it cannot be
// cleaned; a digital signature stops being valid once the file changes.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from "pdf-lib";
import { collect, readBlocks } from "./exif.js";
import { kindOf } from "./image.js";
import { CleanError, Findings } from "./report.js";

const name = (text) => PDFName.of(text);
const INFO_KEYS = ["Author", "Creator", "Producer", "CreationDate", "ModDate"];
/** Keys that make a dictionary something other than an Info (an outline item has a /Title too). */
const NOT_INFO = ["Type", "Parent", "Kids", "Dest", "A", "First", "Subtype"];

/** Opens a PDF as it is: no metadata of pdf-lib's own. Throws a CleanError when it cannot. */
async function open(bytes) {
  if (kindOf(bytes) !== "pdf") throw new CleanError("unsupported");
  let document;
  try {
    // Loaded even when encrypted, only to see that it is: pdf-lib's own error loses its class.
    document = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  } catch (error) {
    throw new CleanError("broken", error);
  }
  if (document.isEncrypted) throw new CleanError("locked");
  return document;
}

/** A PDF string as text, or a date for the date keys. */
function decoded(value, date = false) {
  if (!(value instanceof PDFString || value instanceof PDFHexString)) return value instanceof PDFName ? value.decodeText() : undefined;
  if (date) {
    try {
      return value.decodeDate();
    } catch {
      return value.decodeText();
    }
  }
  return value.decodeText();
}

/** What an Info dictionary says, in the report's groups. */
function collectInfo(dict, findings) {
  for (const [key, value] of dict.entries()) {
    const label = key.decodeText();
    if (label === "Author") findings.add("author", decoded(value));
    else if (label === "Creator" || label === "Producer") findings.add("software", decoded(value));
    else if (label === "CreationDate" || label === "ModDate") findings.add("dates", decoded(value, true));
    else if (label === "Title" || label === "Subject" || label === "Keywords") findings.add("comment", decoded(value));
    else if (label !== "Trapped") {
      const text = decoded(value);
      if (text) findings.add("other", `${label}: ${text}`);
    }
  }
}

const isInfoLike = (dict) => INFO_KEYS.some((key) => dict.has(name(key))) && !NOT_INFO.some((key) => dict.has(name(key)));

const isMetadataStream = (stream) =>
  stream.dict.get(name("Type")) === name("Metadata") || stream.dict.get(name("Subtype")) === name("XML");

function streamBytes(stream) {
  try {
    return stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  } catch {
    return null;
  }
}

/** A picture kept as a JPEG that carries EXIF or XMP of its own. */
function isPictureWithMetadata(stream) {
  if (!(stream instanceof PDFRawStream) || stream.dict.get(name("Subtype")) !== name("Image")) return false;
  const filter = stream.dict.get(name("Filter"));
  const filters = filter instanceof PDFArray ? filter.asArray() : [filter];
  if (filters.length !== 1 || filters[0] !== name("DCTDecode")) return false;
  const head = new TextDecoder("latin1").decode(stream.contents.subarray(0, 65536));
  return head.includes("Exif\0\0") || head.includes("http://ns.adobe.com/xap/1.0/");
}

/** The names in a name tree (`/Names [(name) ref …]`, with `/Kids`). */
function namesIn(context, tree, found = [], depth = 0) {
  const node = context.lookup(tree);
  if (!(node instanceof PDFDict) || depth > 32) return found;
  const names = context.lookup(node.get(name("Names")));
  if (names instanceof PDFArray) {
    for (let at = 0; at < names.size(); at += 2) found.push(decoded(names.get(at)) ?? "?");
  }
  const kids = context.lookup(node.get(name("Kids")));
  if (kids instanceof PDFArray) for (const kid of kids.asArray()) namesIn(context, kid, found, depth + 1);
  return found;
}

/**
 * What a PDF says about itself: `{kind: "pdf", findings, signed}`. Groups as for photos (author,
 * software, dates, comment, other), plus identifier, annotations (their authors), attachments,
 * images (pictures that carry their own metadata). Throws a CleanError: unsupported, broken, locked.
 */
export async function inspectPdf(bytes) {
  const document = await open(bytes);
  const { context } = document;
  const findings = new Findings();
  let signed = false;
  let xmp = false;

  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof PDFDict) collectInfo(info, findings);

  for (const [, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict) {
      if (object !== info && isInfoLike(object)) collectInfo(object, findings);
      if (object.has(name("ByteRange")) || object.get(name("Type")) === name("Sig")) signed = true;
    } else if (object instanceof PDFStream) {
      if (isMetadataStream(object)) {
        xmp = true;
        const contents = streamBytes(object);
        const read = contents && (await readBlocks(null, contents));
        if (read) collect(read, findings);
      } else if (isPictureWithMetadata(object)) {
        findings.add("images", null);
      }
    }
  }
  if (xmp) findings.add("other", "XMP");
  if (context.trailerInfo.ID) findings.add("identifier", null);
  if (document.catalog.has(name("Perms"))) signed = true;

  for (const page of document.getPages()) {
    const annotations = context.lookup(page.node.get(name("Annots")));
    if (!(annotations instanceof PDFArray)) continue;
    for (const ref of annotations.asArray()) {
      const annotation = context.lookup(ref);
      if (!(annotation instanceof PDFDict)) continue;
      if (annotation.get(name("Subtype")) === name("Widget")) continue; // a form field's name, not an author
      findings.add("annotations", decoded(annotation.get(name("T"))));
      if (annotation.get(name("Subtype")) === name("FileAttachment")) {
        const spec = context.lookup(annotation.get(name("FS")));
        findings.add("attachments", (spec instanceof PDFDict && decoded(context.lookup(spec.get(name("F"))))) || "📎");
      }
    }
  }
  const names = context.lookup(document.catalog.get(name("Names")));
  if (names instanceof PDFDict) {
    for (const attached of namesIn(context, names.get(name("EmbeddedFiles")))) findings.add("attachments", attached);
  }

  return { kind: "pdf", findings: findings.list, signed };
}

/** Every /Metadata key out of a dictionary and of what it holds directly. */
function stripMetadata(object, depth = 0) {
  if (depth > 64) return;
  const dict = object instanceof PDFStream ? object.dict : object;
  if (dict instanceof PDFDict) {
    dict.delete(name("Metadata"));
    for (const [, value] of dict.entries()) stripMetadata(value, depth + 1);
  } else if (object instanceof PDFArray) {
    for (const value of object.asArray()) stripMetadata(value, depth + 1);
  }
}

/** Drops every object the document no longer reaches from its catalog: what was removed, and
 *  whatever older revisions or a parser's leftovers kept in the file. */
function keepReachable(context) {
  const reached = new Set();
  const pending = [context.trailerInfo.Root];
  while (pending.length) {
    const object = pending.pop();
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reached.has(key)) continue;
      reached.add(key);
      pending.push(context.lookup(object));
    } else if (object instanceof PDFStream) {
      pending.push(object.dict);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) pending.push(value);
    } else if (object instanceof PDFArray) {
      pending.push(...object.asArray());
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) context.delete(ref);
  }
}

/** The same PDF without its Info, XMP, identifier and unused objects. Throws a CleanError. */
export async function cleanPdf(bytes) {
  const document = await open(bytes);
  const { context } = document;
  context.trailerInfo.Info = undefined;
  context.trailerInfo.ID = undefined;
  for (const [, object] of context.enumerateIndirectObjects()) stripMetadata(object);
  keepReachable(context);
  try {
    // Without object streams, every dictionary is plain in the file: what is left can be checked.
    return await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  } catch (error) {
    throw new CleanError("broken", error);
  }
}
