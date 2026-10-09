// @vitest-environment happy-dom
// The plugin in its frame, against a fake core (plan of the new plugins, §5): from the chat with
// nothing (🧰 → 🖼️ or 📄) or with a file ("Open with"), the report, ✨ Clean, what was removed and
// what could not be, then 📤 (the file goes to the composer) or 💾. It only uses what its manifest
// asks for: onOpen, pickFile, send, save and close; nothing is kept.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readExif } from "../src/exif.js";
import "./ionic.setup.js";
import "../src/index.js";

const fixture = (name) => readFileSync(join(import.meta.dirname, "fixtures", name));
const file = (name, mime, as = name) => ({ name: as, mime, data: fixture(name).toString("base64") });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let at = 0; at < 40; at += 1) await tick();
};

/** A fake core: it hands over a file, answers the picker and the save, and notes every call. The
 *  plugin may touch only what its manifest asks for. */
function fakeCore({ picked = null, saved = true } = {}) {
  const handlers = [];
  const touched = new Set();
  const api = {
    onOpen: (handler) => handlers.push(handler),
    pickFile: vi.fn(async () => picked),
    send: vi.fn(),
    save: vi.fn(async () => saved),
    close: vi.fn(),
  };
  const ft = new Proxy(api, {
    get(target, key) {
      touched.add(key);
      return target[key];
    },
  });
  return {
    ft,
    touched,
    open: (opening) => Promise.all(handlers.map((handler) => handler({ text: "", dark: false, lang: "en", file: null, ref: null, reminder: null, live: false, ...opening }))),
  };
}

let core;
let element;
// In the page, not in a shadow root: Ionic's global styles do not cross a shadow boundary.
const inside = () => element;
// Ionic moves a button's label to the native button inside it once it has drawn.
const label = (one) => one?.getAttribute("aria-label") ?? one?.shadowRoot?.querySelector("button")?.getAttribute("aria-label") ?? null;
const button = (act) => inside().querySelector(`[data-act="${act}"]`);
const row = (section, group) => inside().querySelector(`[data-section="${section}"] [data-group="${group}"]`);
const text = () => inside().textContent;

function mount(options) {
  core = fakeCore(options);
  globalThis.ft = core.ft;
  document.body.innerHTML = "";
  element = document.createElement("ft-clean");
  document.body.append(element);
}

describe("opened from the chat without a file", () => {
  beforeEach(() => mount({ picked: file("photo.jpg", "image/jpeg", "IMG_20260517_182959.jpg") }));

  it("offers a photo or a PDF, in the phone's language", async () => {
    await core.open({ lang: "es" });
    await settle();
    expect(label(button("photo"))).toBe("Elegir una foto");
    expect(label(button("pdf"))).toBe("Elegir un PDF");
    // The app's tool window has the way out.
    expect(button("close")).toBe(null);
  });

  it("asks the photo picker for a photo, and the document picker for a PDF", async () => {
    await core.open({});
    await settle();
    button("pdf").click();
    expect(core.ft.pickFile).toHaveBeenLastCalledWith("application/pdf");
    await settle();
    mount({ picked: null });
    await core.open({});
    await settle();
    button("photo").click();
    expect(core.ft.pickFile).toHaveBeenLastCalledWith("image/*");
    await settle();
    expect(button("photo")).toBeTruthy(); // nothing picked: still at the start
  });

  it("writes Arabic right to left", async () => {
    await core.open({ lang: "ar" });
    await settle();
    expect(inside().querySelector(".view").getAttribute("dir")).toBe("rtl");
  });
});

describe("a photo", () => {
  beforeEach(() => mount({ picked: file("photo.jpg", "image/jpeg", "IMG_20260517_182959.jpg") }));

  it("shows what it reveals, cleans it, says what went, and puts the clean photo in the chat", async () => {
    await core.open({});
    await settle();
    button("photo").click();
    await settle();

    expect(row("found", "location").textContent).toContain("40.41650, -3.70378");
    expect(row("found", "device").textContent).toContain("Model Z 2026");
    expect(row("found", "author").textContent).toContain("Ana Example");
    expect(row("found", "serial").textContent).toContain("SN-000123456");
    expect(row("found", "thumbnail")).toBeTruthy();
    expect(row("found", "dates")).toBeTruthy();
    expect(inside().querySelector("img.preview")).toBeTruthy();

    button("clean").click();
    await settle();
    for (const group of ["location", "device", "dates", "author", "software", "serial", "thumbnail", "fileName"]) {
      expect(row("removed", group), group).toBeTruthy();
    }
    expect(inside().querySelector('[data-section="remaining"]')).toBe(null);
    expect(row("kept", "orientation")).toBeTruthy();
    expect(row("kept", "colour")).toBeTruthy();
    expect(text()).toContain("New name: photo.jpg");
    expect(text()).toContain("What you see in the picture does not change.");

    button("send").click();
    expect(core.ft.send).toHaveBeenCalledTimes(1);
    const [name, mime, data] = core.ft.send.mock.calls[0];
    expect([name, mime]).toEqual(["photo.jpg", "image/jpeg"]);
    const sent = new Uint8Array(Buffer.from(data, "base64"));
    const read = await readExif(sent);
    expect(read.gps ?? null).toBe(null);
    expect(read.ifd0.Make ?? null).toBe(null);
    expect(read.ifd0.Orientation).toBe(6);
  });

  it("saves the clean photo on the phone, and says so", async () => {
    await core.open({ file: file("photo.png", "image/png", "Screenshot_20260517.png") });
    await settle();
    button("clean").click();
    await settle();
    button("save").click();
    await settle();
    expect(core.ft.save).toHaveBeenCalledWith("photo.png", "image/png", expect.any(String));
    expect(inside().querySelector("[role=status]").textContent).toBe("Saved");
    expect(core.ft.send).not.toHaveBeenCalled();
  });

  it("says when saving did not work", async () => {
    mount({ saved: null });
    await core.open({ file: file("photo.webp", "image/webp") });
    await settle();
    button("clean").click();
    await settle();
    button("save").click();
    await settle();
    expect(inside().querySelector("[role=status]").textContent).toBe("Could not save");
  });

  it("says the place is empty when Android already wiped it", async () => {
    await core.open({ file: file("wiped-gps.jpg", "image/jpeg") });
    await settle();
    expect(row("found", "location").textContent).toContain("empty, already wiped");
  });

  it("finds the video of a motion photo and removes it", async () => {
    await core.open({ file: file("motion.jpg", "image/jpeg") });
    await settle();
    expect(row("found", "motion")).toBeTruthy();
    button("clean").click();
    await settle();
    expect(row("removed", "motion")).toBeTruthy();
  });

  it("names another picture hidden after the image, and removes it", async () => {
    const twice = Buffer.concat([fixture("wiped-gps.jpg"), fixture("wiped-gps.jpg")]).toString("base64");
    await core.open({ file: { name: "PXL_1.jpg", mime: "image/jpeg", data: twice } });
    await settle();
    expect(row("found", "embedded").textContent).toContain("Other pictures inside the file");
    button("clean").click();
    await settle();
    expect(row("removed", "embedded")).toBeTruthy();
  });

  it("cleans a HEIF it cannot show, and says the thumbnail inside could not be removed", async () => {
    await core.open({ file: file("photo.heic", "image/heic", "IMG_0001.HEIC") });
    await settle();
    expect(inside().querySelector("img.preview")).toBe(null);
    expect(text()).toContain("No preview for this photo here");
    button("clean").click();
    await settle();
    expect(row("removed", "location")).toBeTruthy();
    expect(row("remaining", "thumbnail")).toBeTruthy();
    button("send").click();
    expect(core.ft.send.mock.calls[0].slice(0, 2)).toEqual(["photo.heic", "image/heic"]);
  });

  it("says when a photo hides nothing, before and after cleaning", async () => {
    const { cleanImage } = await import("../src/image.js");
    const bare = Buffer.from(cleanImage(new Uint8Array(fixture("photo.png")))).toString("base64");
    await core.open({ file: { name: "photo.png", mime: "image/png", data: bare } });
    await settle();
    expect(text()).toContain("No hidden data found.");
    button("clean").click();
    await settle();
    expect(inside().querySelector('[data-section="removed"]')).toBe(null);
    expect(text()).toContain("No hidden data found.");
    expect(row("kept", "colour")).toBeTruthy();
  });

  it("starts again with another file", async () => {
    await core.open({ file: file("photo.jpg", "image/jpeg") });
    await settle();
    button("clean").click();
    await settle();
    button("another").click();
    await settle();
    expect(button("photo")).toBeTruthy();
  });
});

describe("a PDF", () => {
  beforeEach(() => mount());

  it("cleans the Info and XMP, and says what it does not touch", async () => {
    await core.open({ file: file("document.pdf", "application/pdf", "Salary review.pdf") });
    await settle();
    expect(row("found", "author").textContent).toContain("Ana Example");
    expect(row("found", "annotations").textContent).toContain("Annotation Author");
    expect(row("found", "attachments").textContent).toContain("notes.txt");
    button("clean").click();
    await settle();
    expect(row("removed", "author")).toBeTruthy();
    expect(row("removed", "software")).toBeTruthy();
    expect(row("removed", "identifier")).toBeTruthy();
    expect(row("remaining", "annotations").textContent).toContain("Annotation Author");
    expect(row("remaining", "attachments")).toBeTruthy();
    expect(row("remaining", "images")).toBeTruthy();
    expect(text()).toContain("The text and the pages do not change");
    button("send").click();
    const [name, mime, data] = core.ft.send.mock.calls[0];
    expect([name, mime]).toEqual(["Salary review.pdf", "application/pdf"]);
    expect(Buffer.from(data, "base64").toString("latin1")).not.toContain("/Info");
  });

  it("warns before cleaning a signed PDF", async () => {
    await core.open({ file: file("signed.pdf", "application/pdf") });
    await settle();
    expect(inside().querySelector("[data-warning=signed]").textContent).toContain("digital signature");
    expect(button("clean")).toBeTruthy();
  });

  it("shows what a file says as text, never as markup", async () => {
    const made = await PDFDocument.create();
    made.addPage();
    made.setAuthor('<img src="x" onerror="alert(1)">');
    const data = Buffer.from(await made.save()).toString("base64");
    await core.open({ file: { name: "x.pdf", mime: "application/pdf", data } });
    await settle();
    expect(inside().querySelector("[data-section=found] img")).toBe(null);
    expect(row("found", "author").textContent).toContain('<img src="x"');
  });
});

describe("what it cannot clean", () => {
  beforeEach(() => mount());

  it.each([
    ["locked.pdf", "application/pdf", "This PDF has a password"],
    ["broken.pdf", "application/pdf", "Clean works with JPEG, PNG, WebP and HEIC photos"],
    ["broken.jpg", "image/jpeg", "This file seems damaged"],
  ])("%s: says why, and offers no ✨", async (name, mime, says) => {
    await core.open({ file: file(name, mime) });
    await settle();
    expect(inside().querySelector("[role=alert]").textContent).toContain(says);
    expect(button("clean")).toBe(null);
    expect(button("another")).toBeTruthy();
  });
});

describe("what it touches", () => {
  it("uses only onOpen, pickFile, send, save and close, and keeps nothing", async () => {
    mount({ picked: file("photo.jpg", "image/jpeg") });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await core.open({});
    await settle();
    button("photo").click();
    await settle();
    button("clean").click();
    await settle();
    button("save").click();
    await settle();
    button("send").click();
    expect([...core.touched].every((key) => ["onOpen", "pickFile", "send", "save", "close"].includes(key))).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("icons, not emoji (brief of the icons, 2026-10-02)", () => {
  const PICTOGRAPH = /\p{Extended_Pictographic}/u;
  const seen = [];
  const look = (where) => seen.push([where, inside().innerHTML]);

  it("paints no emoji on any screen, and every lone icon button keeps its label", async () => {
    mount({ picked: null });
    await core.open({ lang: "es" });
    await settle();
    look("start");
    for (const [name, mime] of [
      ["photo.jpg", "image/jpeg"],
      ["photo.heic", "image/heic"],
      ["signed.pdf", "application/pdf"],
      ["document.pdf", "application/pdf"],
    ]) {
      mount();
      await core.open({ file: file(name, mime) });
      await settle();
      look(`report ${name}`);
      button("clean").click();
      await settle();
      look(`done ${name}`);
      button("save").click();
      await settle();
      look(`saved ${name}`);
      for (const act of ["send", "save", "another"]) expect(label(button(act)), act).toBeTruthy();
    }
    for (const [name, mime] of [["locked.pdf", "application/pdf"], ["broken.jpg", "image/jpeg"], ["broken.pdf", "application/pdf"]]) {
      mount();
      await core.open({ file: file(name, mime) });
      await settle();
      look(`error ${name}`);
    }
    mount({ picked: null });
    await core.open({});
    await settle();
    for (const act of ["photo", "pdf"]) expect(label(button(act)), act).toBeTruthy();
    for (const [where, html] of seen) expect(html.match(PICTOGRAPH)?.[0] ?? null, where).toBe(null);
    expect(seen.length).toBe(16);
  });

  it("has no emoji in any of the 21 languages", async () => {
    const { LANGUAGES, catalogueOf } = await import("../src/i18n.js");
    for (const lang of LANGUAGES) {
      for (const [key, text] of Object.entries(catalogueOf(lang))) expect(PICTOGRAPH.test(text), `${lang}.${key}`).toBe(false);
    }
  });
});

describe("with the Ionic the app lends", () => {
  it("draws in the page, its screens in Ionic's content, every action an Ionic button", async () => {
    mount();
    await core.open({ file: file("photo.jpg", "image/jpeg") });
    await settle();
    expect(element.shadowRoot).toBe(null);
    expect(element.querySelector(":scope > ion-content .view")).toBeTruthy();
    // Nothing of its own in a bar: the name and the way out are the window's.
    expect(element.querySelector("ion-header")).toBe(null);
    expect(button("clean").tagName).toBe("ION-BUTTON");
    expect(button("clean").textContent).toContain("Clean");
    button("clean").click();
    await settle();
    for (const act of ["send", "save", "another"]) {
      expect(button(act).tagName, act).toBe("ION-BUTTON");
      expect(button(act).querySelector('[slot="icon-only"]'), act).toBeTruthy();
    }
    expect(element.querySelector("button")).toBe(null);
  });

  it("offers a photo or a PDF with two large Ionic buttons", async () => {
    mount();
    await core.open({});
    await settle();
    for (const act of ["photo", "pdf"]) {
      expect(button(act).tagName, act).toBe("ION-BUTTON");
      expect(button(act).getAttribute("fill"), act).toBe("outline");
    }
  });
});

describe("as a custom element", () => {
  // A real browser throws NotSupportedError when a constructor leaves attributes or children, and
  // `lang` is an attribute HTMLElement reflects: the language lives in a property of its own.
  it("comes out of document.createElement with no attribute and no child", () => {
    globalThis.ft = fakeCore().ft;
    const made = document.createElement("ft-clean");
    expect(made.attributes.length).toBe(0);
    expect(made.childNodes.length).toBe(0);
    expect(made.getAttribute("lang")).toBe(null);
  });

  it("keeps its content to a comfortable width on a wide screen", async () => {
    mount();
    await core.open({});
    await settle();
    const style = inside().querySelector("style").textContent;
    expect(style).toMatch(/\.view\s*\{[^}]*max-inline-size:\s*640px[^}]*margin-inline:\s*auto/);
  });
});
