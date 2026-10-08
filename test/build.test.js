// @vitest-environment happy-dom
// What the catalogue signs (`module.json` + `dist/`), checked as it is: under the size the plan
// gives (1 MB), with the licences of what is inside, with no address it could reach and none of
// the APIs the frame forbids, and working: the bundle itself cleans a photo.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readExif } from "../src/exif.js";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/**
 * The only `http://` the bundle may carry: XML namespace names, which identify a vocabulary inside
 * a file's XMP and are compared as text, never requested.
 *  - ns.adobe.com: XMP itself (`http://ns.adobe.com/xap/1.0/` is also the signature of a JPEG's XMP
 *    segment, which is how picscrub and exifr find it);
 *  - www.w3.org/1999/02/22-rdf-syntax-ns: RDF, the syntax XMP is written in;
 *  - purl.org/dc/elements: Dublin Core, where XMP keeps the creator and the rights;
 *  - c2pa.org/manifest, creativecommons.org/ns, www.inkscape.org, sodipodi.sourceforge.net,
 *    www.bohemiancoding.com/sketch/ns: the namespaces picscrub's SVG cleaner looks for (C2PA,
 *    licence, Inkscape and Sketch metadata). Clean does not open SVG, but that code shares a module
 *    with the formats it does use, so the bundler keeps it; the strings are only compared.
 */
const NAMESPACES = [
  /^http:\/\/ns\.adobe\.com\//,
  /^http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns$/,
  /^http:\/\/purl\.org\/dc\/elements$/,
  /^http:\/\/c2pa\.org\/manifest$/,
  /^http:\/\/creativecommons\.org\/ns$/,
  /^http:\/\/www\.inkscape\.org$/,
  /^http:\/\/sodipodi\.sourceforge\.net$/,
  /^http:\/\/www\.bohemiancoding\.com\/sketch\/ns$/,
];

describe("the package", () => {
  it("is dist/index.js and the third-party notices, under 1 MB", () => {
    const all = files(dist);
    expect(all.map((path) => path.slice(dist.length + 1)).sort()).toEqual(["THIRD_PARTY_NOTICES.md", "index.js"]);
    const total = all.reduce((sum, path) => sum + statSync(path).size, 0);
    expect(total).toBeGreaterThan(200_000);
    expect(total).toBeLessThan(1024 * 1024);
  });

  it("carries the licence of every component inside", () => {
    const notices = readFileSync(join(dist, "THIRD_PARTY_NOTICES.md"), "utf8");
    for (const component of ["picscrub", "exifr", "pdf-lib", "ionicons", "@pdf-lib/standard-fonts", "@pdf-lib/upng", "pako", "tslib"]) {
      expect(notices, component).toContain(`## ${component}`);
    }
    expect(notices).toContain("Permission is hereby granted, free of charge");
    expect(notices).toContain("(C) 1995-2013 Jean-loup Gailly and Mark Adler"); // pako's zlib notice
    expect(notices).toEqual(readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8"));
  });

  it("has no https:// address, and no http:// one but XML namespaces", () => {
    for (const path of files(dist)) {
      if (path.endsWith(".md")) continue; // the notices name the projects' homes; nothing loads them
      const text = readFileSync(path, "latin1");
      expect(text.match(/https:\/\/[^\s"'`)]*/g) ?? [], path).toEqual([]);
      const plain = (text.match(/http:\/\/[^\s"'`)\\]*/g) ?? []).filter((url) => !NAMESPACES.some((known) => known.test(url)));
      expect(plain, path).toEqual([]);
    }
  });

  it("uses none of what the frame forbids: network, workers, wasm, eval, storage, dialogs", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8");
    for (const forbidden of [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /WebSocket/,
      /EventSource/,
      /\bnew\s+(Shared)?Worker\b/,
      /importScripts/,
      /WebAssembly/,
      /\beval\s*\(/,
      /new\s+Function\b/,
      /[^.\w]Function\s*\(/,
      /localStorage/,
      /sessionStorage/,
      /indexedDB/,
      /\b(alert|confirm|prompt)\s*\(/,
      /\bimport\s*\(/,
      /sendBeacon/,
    ]) {
      expect(code, String(forbidden)).not.toMatch(forbidden);
    }
  });
});

describe("the bundle", () => {
  it("cleans a photo against a fake core, as the frame would load it", async () => {
    const handlers = [];
    const send = vi.fn();
    globalThis.ft = { onOpen: (handler) => handlers.push(handler), pickFile: vi.fn(), send, save: vi.fn(), close: vi.fn() };
    await import("../dist/index.js");
    const element = document.createElement("ft-clean");
    document.body.append(element);
    const data = readFileSync(join(import.meta.dirname, "fixtures", "photo.jpg")).toString("base64");
    for (const handler of handlers) handler({ lang: "en", dark: false, file: { name: "IMG_1.jpg", mime: "image/jpeg", data } });
    const settle = async () => {
      for (let at = 0; at < 40; at += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await settle();
    element.shadowRoot.querySelector('[data-act="clean"]').click();
    await settle();
    element.shadowRoot.querySelector('[data-act="send"]').click();
    const [name, , sent] = send.mock.calls[0];
    expect(name).toBe("photo.jpg");
    const read = await readExif(new Uint8Array(Buffer.from(sent, "base64")));
    expect(read.gps ?? null).toBe(null);
    expect(read.ifd0.Orientation).toBe(6);
  });
});

describe("the image of the Apps grid", () => {
  // icon.svg beside module.json and dist/, signed with the rest: the app draws it on the tile; the
  // Ionicon in module.json stays as the fallback (2026-10-08).
  const image = join(import.meta.dirname, "..", "icon.svg");

  it("is a square 64 × 64 SVG of at most 4 KB at the root of the package, and not inside dist/", () => {
    expect(existsSync(image), "icon.svg").toBe(true);
    expect(statSync(image).size).toBeLessThanOrEqual(4096);
    const svg = readFileSync(image, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(existsSync(join(import.meta.dirname, "..", "dist", "icon.svg"))).toBe(false);
  });
});
