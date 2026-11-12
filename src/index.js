import { icon } from "./icons.js";
import { t, directionOf } from "./i18n.js";
import { cleanImage, inspectImage, kindOf } from "./image.js";
import { cleanPdf, inspectPdf } from "./pdf.js";
import { compare, mimeOf, outputName, shown } from "./report.js";

const GROUPS = [
  ["location", "location-outline"],
  ["device", "phone-portrait-outline"],
  ["dates", "time-outline"],
  ["author", "person-outline"],
  ["software", "construct-outline"],
  ["serial", "barcode-outline"],
  ["comment", "text-outline"],
  ["thumbnail", "image-outline"],
  ["embedded", "images-outline"],
  ["motion", "film-outline"],
  ["extra", "ellipsis-horizontal-outline"],
  ["c2pa", "pricetag-outline"],
  ["identifier", "finger-print-outline"],
  ["annotations", "chatbubble-outline"],
  ["attachments", "attach-outline"],
  ["images", "camera-outline"],
  ["other", "information-circle-outline"],
  ["fileName", "document-outline"],
];

// The frame can't show HEIF, so it gets cleaned without a preview.
const SHOWABLE = new Set(["jpeg", "png", "webp"]);

export function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes;
}

export function toBase64(bytes) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[one]);

const STYLE = `
ft-clean { display: flex; flex-direction: column; height: 100%; font: 15px/1.4 system-ui, sans-serif; color: var(--ion-text-color, #111); --muted: var(--ion-color-medium, #666); --line: rgba(0,0,0,.12); --card: rgba(0,0,0,.04); --warn: #9a5b00; }
ft-clean[dark] { color: var(--ion-text-color, #f4f4f4); --muted: var(--ion-color-medium, #aaa); --line: rgba(255,255,255,.16); --card: rgba(255,255,255,.06); --warn: #f0b04c; }
@media (prefers-color-scheme: dark) { ft-clean { color: var(--ion-text-color, #f4f4f4); --muted: var(--ion-color-medium, #aaa); --line: rgba(255,255,255,.16); --card: rgba(255,255,255,.06); --warn: #f0b04c; } }
ft-clean * { box-sizing: border-box; }
ft-clean ion-content { flex: 1; }
ft-clean .view { padding: 4px 8px 16px; max-inline-size: 640px; margin-inline: auto; }
ft-clean .i { display: block; flex: none; width: 22px; height: 22px; margin: auto; }
ft-clean i.i { background: currentColor; -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat; }
ft-clean svg.i { fill: currentColor; }
ft-clean .pick .i { width: 44px; height: 44px; }
ft-clean ion-button .i { margin: 0; }
ft-clean ion-button .i[slot="start"] { margin-inline-end: 6px; }
ft-clean ion-button .i[slot="end"] { margin-inline-start: 6px; }
ft-clean h2, ft-clean .withicon { display: flex; align-items: center; gap: 8px; }
ft-clean h2 .i, ft-clean .withicon .i { margin: 0; width: 20px; height: 20px; }
ft-clean .alert .i { width: 44px; height: 44px; }
ft-clean .pick { display: flex; gap: 16px; justify-content: center; margin: 24px 0; }
ft-clean .pick ion-button { width: 96px; height: 96px; --border-radius: 12px; }
ft-clean .intro, ft-clean .note, ft-clean .same { color: var(--muted); text-align: center; }
ft-clean .same, ft-clean .note { font-size: 13px; }
ft-clean .preview { display: block; max-width: 100%; max-height: 40vh; margin: 8px auto; border-radius: 10px; }
ft-clean h2 { font-size: 15px; margin: 16px 0 6px; }
ft-clean ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
ft-clean li { display: flex; gap: 10px; align-items: baseline; padding: 8px 10px; border-radius: 10px; background: var(--card); }
ft-clean li .i { margin: 0; align-self: center; width: 20px; height: 20px; }
ft-clean li .what { font-weight: 600; }
ft-clean li .value { color: var(--muted); overflow-wrap: anywhere; }
ft-clean .warning { color: var(--warn); border: 1px solid currentColor; border-radius: 10px; padding: 8px 10px; margin: 10px 0; }
ft-clean .alert { text-align: center; margin: 32px 8px; }
ft-clean .actions { display: flex; gap: 12px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }
`;

class Clean extends HTMLElement {
  constructor() {
    super();
    this.language = "en";
    this.state = "start";
    this.file = null;
    this.report = null;
    this.result = null;
    this.reason = null;
    this.note = "";
    this.preview = null;
  }

  connectedCallback() {
    // Light DOM, since Ionic's global styles don't cross a shadow boundary.
    this.innerHTML = `<style>${STYLE}</style><ion-content><div class="view"></div></ion-content>`;
    this.view = this.querySelector(".view");
    this.addEventListener("click", (event) => this.onClick(event));
    globalThis.ft?.onOpen?.((opening) => this.onOpen(opening));
    this.paint();
  }

  onOpen(opening) {
    this.language = opening.lang || "en";
    if (opening.dark) this.setAttribute("dark", "");
    if (opening.file?.data) return this.read(opening.file);
    this.paint();
  }

  onClick(event) {
    const button = event.target.closest("button, ion-button");
    if (!button) return;
    const act = button.dataset.act;
    if (act === "photo") this.pick("image/*");
    else if (act === "pdf") this.pick("application/pdf");
    else if (act === "clean") this.clean();
    else if (act === "send") this.send();
    else if (act === "save") this.save();
    else if (act === "another") this.reset();
  }

  async pick(accept) {
    const picked = await globalThis.ft.pickFile(accept);
    if (picked?.data) await this.read(picked);
  }

  async read({ name, mime, data }) {
    this.reset(false);
    this.state = "reading";
    this.paint();
    try {
      const bytes = fromBase64(data);
      const kind = kindOf(bytes);
      this.file = { name, mime, bytes, kind };
      this.report = kind === "pdf" ? await inspectPdf(bytes) : await inspectImage(bytes);
      if (SHOWABLE.has(kind)) this.preview = urlOf(bytes, mimeOf(kind));
      this.state = "report";
    } catch (error) {
      this.fail(error);
    }
    this.paint();
  }

  // Read the clean file again, so "removed" lists only what is really gone.
  async clean() {
    const { bytes, kind, name, mime } = this.file;
    this.state = "cleaning";
    this.paint();
    try {
      const cleaned = kind === "pdf" ? await cleanPdf(bytes) : cleanImage(bytes);
      const after = kind === "pdf" ? await inspectPdf(cleaned) : await inspectImage(cleaned);
      const { removed, remaining } = compare(this.report.findings, after.findings);
      const outName = outputName(name, kind);
      if (kind !== "pdf" && outName !== name && name) removed.push({ group: "fileName", value: name });
      this.result = { bytes: cleaned, name: outName, mime: mimeOf(kind, mime), removed, remaining, kept: after.kept ?? null };
      this.state = "done";
    } catch (error) {
      this.fail(error);
    }
    this.paint();
  }

  send() {
    const { name, mime, bytes } = this.result;
    globalThis.ft.send(name, mime, toBase64(bytes));
  }

  async save() {
    const { name, mime, bytes } = this.result;
    const saved = await globalThis.ft.save(name, mime, toBase64(bytes));
    this.note = saved ? t(this.language, "saved") : t(this.language, "notSaved");
    this.paint();
  }

  fail(error) {
    this.reason = ["unsupported", "broken", "locked"].includes(error?.reason) ? error.reason : "broken";
    if (error?.reason === undefined) console.warn("clean failed", error?.name); // never the file's contents
    this.state = "error";
  }

  reset(paint = true) {
    if (this.preview) URL.revokeObjectURL?.(this.preview);
    Object.assign(this, { state: "start", file: null, report: null, result: null, reason: null, note: "", preview: null });
    if (paint) this.paint();
  }

  paint() {
    const T = (key, fill) => escape(t(this.language, key, fill));
    this.view.setAttribute("dir", directionOf(this.language));
    const another = `<ion-button fill="outline" data-act="another" aria-label="${T("another")}">${icon("refresh-outline", { slot: "icon-only" })}</ion-button>`;
    let body = "";
    if (this.state === "start") {
      body = `<p class="intro">${T("intro")}</p>
        <div class="pick">
          <ion-button fill="outline" data-act="photo" aria-label="${T("pickPhoto")}">${icon("image-outline", { slot: "icon-only" })}</ion-button>
          <ion-button fill="outline" data-act="pdf" aria-label="${T("pickPdf")}">${icon("document-text-outline", { slot: "icon-only" })}</ion-button>
        </div>`;
    } else if (this.state === "reading" || this.state === "cleaning") {
      body = `<p class="intro" role="status">${T(this.state)}</p>`;
    } else if (this.state === "error") {
      const sign = this.reason === "locked" ? icon("lock-closed-outline") : icon("warning-outline");
      body = `<div class="alert" role="alert">${sign}<p>${T(this.reason)}</p></div>
        <div class="actions">${another}</div>`;
    } else if (this.state === "report") {
      body = this.paintReport(T);
    } else if (this.state === "done") {
      body = this.paintDone(T, another);
    }
    this.view.innerHTML = body;
  }

  paintReport(T) {
    const { kind } = this.file;
    const preview = this.preview
      ? `<img class="preview" src="${escape(this.preview)}" alt="">`
      : kind === "pdf"
        ? ""
        : `<p class="note withicon">${icon("eye-off-outline")}<span>${T("noPreview")}</span></p>`;
    const found = this.report.findings.length
      ? `<h2>${T("reveals")}</h2>${this.list("found", this.report.findings)}`
      : `<p class="intro withicon">${icon("checkmark-outline")}<span>${T("nothing")}</span></p>`;
    const signed = this.report.signed ? `<p class="warning withicon" data-warning="signed">${icon("shield-checkmark-outline")}<span>${T("signed")}</span></p>` : "";
    return `${preview}${signed}${found}
      <div class="actions"><ion-button data-act="clean">${icon("sparkles-outline", { slot: "start" })}<span>${T("clean")}</span></ion-button></div>`;
  }

  paintDone(T, another) {
    const { removed, remaining, kept, name } = this.result;
    const kind = this.file.kind;
    let html = "";
    if (removed.length) html += `<h2>${icon("checkmark-outline")}<span>${T("removed")}</span></h2>${this.list("removed", removed)}`;
    if (remaining.length) html += `<h2>${icon("warning-outline")}<span>${T("notRemoved")}</span></h2>${this.list("remaining", remaining)}`;
    if (!removed.length && !remaining.length) html += `<p class="intro withicon">${icon("checkmark-outline")}<span>${T("nothing")}</span></p>`;
    const keptRows = [];
    if (kept?.orientation) keptRows.push(`<li data-group="orientation">${icon("compass-outline")}<span>${T("orientation")}</span></li>`);
    if (kept?.colour) keptRows.push(`<li data-group="colour">${icon("color-palette-outline")}<span>${T("colour")}</span></li>`);
    if (keptRows.length) html += `<h2>${icon("pin-outline")}<span>${T("kept")}</span></h2><ul data-section="kept">${keptRows.join("")}</ul>`;
    html += `<p class="same">${T(kind === "pdf" ? "pdfSame" : "pictureSame")}</p>`;
    html += `<p class="same">${T("newName", { name })}</p>`;
    html += `<div class="actions">
        <ion-button fill="outline" data-act="send" aria-label="${T("send")}">${icon("send-outline", { slot: "icon-only" })}</ion-button>
        <ion-button fill="outline" data-act="save" aria-label="${T("save")}">${icon("save-outline", { slot: "icon-only" })}</ion-button>
        ${another}
      </div>`;
    if (this.note) html += `<p class="note" role="status">${escape(this.note)}</p>`;
    return html;
  }

  list(section, findings) {
    const rows = [];
    for (const [group, name] of GROUPS) {
      const mine = findings.filter((found) => found.group === group);
      if (!mine.length) continue;
      const values = mine.map((found) => (found.empty ? t(this.language, "locationEmpty") : shown(found, this.language))).filter(Boolean);
      const value = values.length ? `<span class="value">${escape(values.join(" · "))}</span>` : "";
      rows.push(`<li data-group="${group}">${icon(name)}<span><span class="what">${escape(t(this.language, group))}</span> ${value}</span></li>`);
    }
    return `<ul data-section="${section}">${rows.join("")}</ul>`;
  }
}

function urlOf(bytes, mime) {
  try {
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return `data:${mime};base64,${toBase64(bytes)}`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ft-clean")) customElements.define("ft-clean", Clean);
