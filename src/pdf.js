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
const NOT_INFO = ["Type", "Parent", "Kids", "Dest", "A", "First", "Subtype"];

// updateMetadata: false, or pdf-lib writes its own name and dates into the file.
async function open(bytes) {
  if (kindOf(bytes) !== "pdf") throw new CleanError("unsupported");
  let document;
  try {
    // ignoreEncryption only to detect a locked PDF, pdf-lib's own error loses its class.
    document = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  } catch (error) {
    throw new CleanError("broken", error);
  }
  if (document.isEncrypted) throw new CleanError("locked");
  return document;
}

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

function isPictureWithMetadata(stream) {
  if (!(stream instanceof PDFRawStream) || stream.dict.get(name("Subtype")) !== name("Image")) return false;
  const filter = stream.dict.get(name("Filter"));
  const filters = filter instanceof PDFArray ? filter.asArray() : [filter];
  if (filters.length !== 1 || filters[0] !== name("DCTDecode")) return false;
  const head = new TextDecoder("latin1").decode(stream.contents.subarray(0, 65536));
  return head.includes("Exif\0\0") || head.includes("http://ns.adobe.com/xap/1.0/");
}

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
        findings.add("attachments", (spec instanceof PDFDict && decoded(context.lookup(spec.get(name("F"))))) || null);
      }
    }
  }
  const names = context.lookup(document.catalog.get(name("Names")));
  if (names instanceof PDFDict) {
    for (const attached of namesIn(context, names.get(name("EmbeddedFiles")))) findings.add("attachments", attached);
  }

  return { kind: "pdf", findings: findings.list, signed };
}

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

// Older revisions and parser leftovers stay in the file as unreachable objects, so drop those too.
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

export async function cleanPdf(bytes) {
  const document = await open(bytes);
  const { context } = document;
  context.trailerInfo.Info = undefined;
  context.trailerInfo.ID = undefined;
  for (const [, object] of context.enumerateIndirectObjects()) stripMetadata(object);
  keepReachable(context);
  try {
    // No object streams, so every dictionary stays plain in the file and what is left can be checked.
    return await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  } catch (error) {
    throw new CleanError("broken", error);
  }
}
