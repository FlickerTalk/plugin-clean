// Clean, for FlickerTalk (plan of the new plugins, §5): show what a photo or a PDF reveals (place,
// phone, dates, author, program, serial numbers, thumbnails, the video of a motion photo, content
// credentials) and give the same file back without it, before it is sent. Everything happens in
// this frame, on the phone: no network, nothing kept. The file comes from the chat ("Open with") or
// from the picker; the clean one goes to the composer (📤, `ft.send`) or to the phone (💾, `ft.save`).
import { t, directionOf } from "./i18n.js";
import { cleanImage, inspectImage, kindOf } from "./image.js";
import { cleanPdf, inspectPdf } from "./pdf.js";
import { compare, mimeOf, outputName, shown } from "./report.js";

/** The groups of the report, in the order shown, with their emoji (§84: icons first). */
const GROUPS = [
  ["location", "📍"],
  ["device", "📱"],
  ["dates", "🕒"],
  ["author", "👤"],
  ["software", "🛠️"],
  ["serial", "🔢"],
  ["comment", "📝"],
  ["thumbnail", "🖼️"],
  ["embedded", "🖼️"],
  ["motion", "🎞️"],
  ["extra", "➕"],
  ["c2pa", "🏷️"],
  ["identifier", "🆔"],
  ["annotations", "💬"],
  ["attachments", "📎"],
  ["images", "🖼️"],
  ["other", "ℹ️"],
  ["fileName", "🏷️"],
];

/** Kinds the frame can show: a HEIF is cleaned all the same, without a preview. */
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

const icon = (name) => `<i class="i" style="--i:url(./icon/${name}.svg)"></i>`;

const STYLE = `
:host { display: block; font: 15px/1.4 system-ui, sans-serif; color: #111; --muted: #666; --line: rgba(0,0,0,.12); --card: rgba(0,0,0,.04); --accent: #0a7d5a; --warn: #9a5b00; }
:host([dark]) { color: #f4f4f4; --muted: #aaa; --line: rgba(255,255,255,.16); --card: rgba(255,255,255,.06); --accent: #3ccf9c; --warn: #f0b04c; }
@media (prefers-color-scheme: dark) { :host { color: #f4f4f4; --muted: #aaa; --line: rgba(255,255,255,.16); --card: rgba(255,255,255,.06); --accent: #3ccf9c; --warn: #f0b04c; } }
* { box-sizing: border-box; }
.view { padding: 4px 8px 16px; }
.bar { display: flex; align-items: center; gap: 6px; min-height: 44px; }
.grow { flex: 1; }
button { appearance: none; border: 1px solid var(--line); background: transparent; color: inherit; min-width: 48px; height: 48px; border-radius: 12px; font: inherit; font-size: 22px; cursor: pointer; }
button.plain { border: 0; }
button.primary { background: var(--accent); color: #fff; border: 0; font-size: 17px; padding: 0 20px; }
.i { display: block; width: 22px; height: 22px; margin: auto; background: currentColor; -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat; }
.pick { display: flex; gap: 16px; justify-content: center; margin: 24px 0; }
.pick button { width: 96px; height: 96px; font-size: 44px; }
.intro, .note, .same { color: var(--muted); text-align: center; }
.same, .note { font-size: 13px; }
.preview { display: block; max-width: 100%; max-height: 40vh; margin: 8px auto; border-radius: 10px; }
h2 { font-size: 15px; margin: 16px 0 6px; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
li { display: flex; gap: 10px; align-items: baseline; padding: 8px 10px; border-radius: 10px; background: var(--card); }
li .e { flex: none; width: 1.4em; text-align: center; }
li .what { font-weight: 600; }
li .value { color: var(--muted); overflow-wrap: anywhere; }
.warning { color: var(--warn); border: 1px solid currentColor; border-radius: 10px; padding: 8px 10px; margin: 10px 0; }
.alert { text-align: center; margin: 32px 8px; }
.actions { display: flex; gap: 12px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }
`;

/** The plugin: start, reading, report, cleaning, done, or why it cannot. */
class Clean extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.lang = "en";
    this.state = "start";
    this.file = null; // {name, mime, bytes, kind}
    this.report = null;
    this.result = null; // {bytes, name, mime, removed, remaining, kept}
    this.reason = null;
    this.note = "";
    this.preview = null;
  }

  connectedCallback() {
    this.root.innerHTML = `<style>${STYLE}</style><div class="view"></div>`;
    this.view = this.root.querySelector(".view");
    this.root.addEventListener("click", (event) => this.onClick(event));
    globalThis.ft?.onOpen?.((opening) => this.onOpen(opening));
    this.paint();
  }

  onOpen(opening) {
    this.lang = opening.lang || "en";
    if (opening.dark) this.setAttribute("dark", "");
    if (opening.file?.data) return this.read(opening.file);
    this.paint();
  }

  onClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const act = button.dataset.act;
    if (act === "close") globalThis.ft.close();
    else if (act === "photo") this.pick("image/*");
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

  /** Reads a file the app handed over: its kind by its bytes, then what it reveals. */
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

  /** Cleans, then reads the clean file again: what is reported as removed is what is gone from it. */
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
    this.note = saved ? t(this.lang, "saved") : t(this.lang, "notSaved");
    this.paint();
  }

  fail(error) {
    // Anything that is not one of our reasons is a file that would not read.
    this.reason = ["unsupported", "broken", "locked"].includes(error?.reason) ? error.reason : "broken";
    if (error?.reason === undefined) console.warn("clean failed", error?.name); // never the file's contents
    this.state = "error";
  }

  reset(paint = true) {
    if (this.preview) URL.revokeObjectURL?.(this.preview);
    Object.assign(this, { state: "start", file: null, report: null, result: null, reason: null, note: "", preview: null });
    if (paint) this.paint();
  }

  // ---- Painting ----

  paint() {
    const T = (key, fill) => escape(t(this.lang, key, fill));
    this.view.setAttribute("dir", directionOf(this.lang));
    const bar = `<div class="bar"><span class="grow"></span><button class="plain" data-act="close" aria-label="${T("close")}">${icon("close-outline")}</button></div>`;
    const another = `<button data-act="another" aria-label="${T("another")}">🔄</button>`;
    let body = "";
    if (this.state === "start") {
      body = `<p class="intro">${T("intro")}</p>
        <div class="pick">
          <button data-act="photo" aria-label="${T("pickPhoto")}">🖼️</button>
          <button data-act="pdf" aria-label="${T("pickPdf")}">📄</button>
        </div>`;
    } else if (this.state === "reading" || this.state === "cleaning") {
      body = `<p class="intro" role="status">${T(this.state)}</p>`;
    } else if (this.state === "error") {
      const emoji = this.reason === "locked" ? "🔒" : "⚠️";
      body = `<div class="alert" role="alert"><div style="font-size:40px">${emoji}</div><p>${T(this.reason)}</p></div>
        <div class="actions">${another}</div>`;
    } else if (this.state === "report") {
      body = this.paintReport(T);
    } else if (this.state === "done") {
      body = this.paintDone(T, another);
    }
    this.view.innerHTML = bar + body;
  }

  paintReport(T) {
    const { kind } = this.file;
    const preview = this.preview
      ? `<img class="preview" src="${escape(this.preview)}" alt="">`
      : kind === "pdf"
        ? ""
        : `<p class="note">🖼️ ${T("noPreview")}</p>`;
    const found = this.report.findings.length
      ? `<h2>${T("reveals")}</h2>${this.list("found", this.report.findings)}`
      : `<p class="intro">✅ ${T("nothing")}</p>`;
    const signed = this.report.signed ? `<p class="warning" data-warning="signed">✍️ ${T("signed")}</p>` : "";
    return `${preview}${signed}${found}
      <div class="actions"><button class="primary" data-act="clean">✨ ${T("clean")}</button></div>`;
  }

  paintDone(T, another) {
    const { removed, remaining, kept, name } = this.result;
    const kind = this.file.kind;
    let html = "";
    if (removed.length) html += `<h2>✅ ${T("removed")}</h2>${this.list("removed", removed)}`;
    if (remaining.length) html += `<h2>⚠️ ${T("notRemoved")}</h2>${this.list("remaining", remaining)}`;
    if (!removed.length && !remaining.length) html += `<p class="intro">✅ ${T("nothing")}</p>`;
    const keptRows = [];
    if (kept?.orientation) keptRows.push(`<li data-group="orientation"><span class="e">🧭</span><span>${T("orientation")}</span></li>`);
    if (kept?.colour) keptRows.push(`<li data-group="colour"><span class="e">🎨</span><span>${T("colour")}</span></li>`);
    if (keptRows.length) html += `<h2>📌 ${T("kept")}</h2><ul data-section="kept">${keptRows.join("")}</ul>`;
    html += `<p class="same">${T(kind === "pdf" ? "pdfSame" : "pictureSame")}</p>`;
    html += `<p class="same">${T("newName", { name })}</p>`;
    html += `<div class="actions">
        <button data-act="send" aria-label="${T("send")}">📤</button>
        <button data-act="save" aria-label="${T("save")}">💾</button>
        ${another}
      </div>`;
    if (this.note) html += `<p class="note" role="status">${escape(this.note)}</p>`;
    return html;
  }

  /** The findings, one row per group, its values in the phone's language. */
  list(section, findings) {
    const rows = [];
    for (const [group, emoji] of GROUPS) {
      const mine = findings.filter((found) => found.group === group);
      if (!mine.length) continue;
      const values = mine.map((found) => (found.empty ? t(this.lang, "locationEmpty") : shown(found, this.lang))).filter(Boolean);
      const value = values.length ? `<span class="value">${escape(values.join(" · "))}</span>` : "";
      rows.push(`<li data-group="${group}"><span class="e">${emoji}</span><span><span class="what">${escape(t(this.lang, group))}</span> ${value}</span></li>`);
    }
    return `<ul data-section="${section}">${rows.join("")}</ul>`;
  }
}

/** A URL the frame may show (`img-src blob:`), or a data URL where there is no Blob URL. */
function urlOf(bytes, mime) {
  try {
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return `data:${mime};base64,${toBase64(bytes)}`;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ft-clean")) customElements.define("ft-clean", Clean);
