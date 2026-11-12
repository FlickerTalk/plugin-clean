import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ICONS, OWN_ICONS, icon } from "../src/icons.js";

const LENT_BY_CORE = {
  "1.3.0": [
    "add-outline", "alarm-outline", "arrow-back-outline", "arrow-redo-outline", "arrow-undo-outline", "arrow-up-outline",
    "brush-outline", "calculator-outline", "chatbubble-outline", "checkmark-outline", "close-outline", "cloud-done-outline",
    "cloud-outline", "cloud-upload-outline", "color-palette-outline", "crop-outline", "document-text-outline", "download-outline",
    "ellipsis-horizontal-outline", "expand-outline", "eye-outline", "folder-open-outline", "folder-outline", "grid-outline",
    "hand-left-outline", "image-outline", "key-outline", "link-outline", "location-outline", "lock-closed-outline",
    "move-outline", "options-outline", "pause-outline", "pencil-outline", "play-outline", "refresh-outline", "remove-outline",
    "resize-outline", "save-outline", "search-outline", "send-outline", "square-outline", "text-outline", "time-outline",
    "trash-outline",
  ],
  "1.6.0": [
    "add-outline", "alarm-outline", "arrow-back-outline", "arrow-redo-outline", "arrow-undo-outline", "arrow-up-outline",
    "brush-outline", "calculator-outline", "camera-outline", "chatbubble-outline", "checkmark-outline", "close-outline",
    "cloud-done-outline", "cloud-outline", "cloud-upload-outline", "color-palette-outline", "crop-outline",
    "document-text-outline", "download-outline", "ellipsis-horizontal-outline", "expand-outline", "eye-outline",
    "folder-open-outline", "folder-outline", "grid-outline", "hand-left-outline", "image-outline", "key-outline",
    "link-outline", "location-outline", "lock-closed-outline", "move-outline", "options-outline", "pause-outline",
    "pencil-outline", "play-outline", "refresh-outline", "remove-outline", "resize-outline", "save-outline",
    "search-outline", "send-outline", "square-outline", "text-outline", "time-outline", "trash-outline",
  ],
};
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "module.json"), "utf8"));
const LENT_BY_APP = LENT_BY_CORE[manifest.minCoreVersion] ?? [];

const source = readFileSync(join(import.meta.dirname, "..", "src", "index.js"), "utf8");
const asked = [...new Set([...source.matchAll(/icon\("([a-z0-9-]+)"/g), ...source.matchAll(/\["[a-zA-Z0-9]+", "([a-z0-9-]+)"\]/g)].map((match) => match[1]))];

describe("the icons", () => {
  it("knows which icons the core of its minCoreVersion lends", () => {
    expect(Object.keys(LENT_BY_CORE)).toContain(manifest.minCoreVersion);
  });

  it("asks the app only for icons its minimum core lends, and carries only the ones it does not", () => {
    for (const name of APP_ICONS) expect(LENT_BY_APP, name).toContain(name);
    for (const name of Object.keys(OWN_ICONS)) expect(LENT_BY_APP, name).not.toContain(name);
    expect(asked.length).toBeGreaterThan(20);
    for (const name of asked) expect(APP_ICONS.includes(name) || name in OWN_ICONS, name).toBe(true);
    for (const name of [...APP_ICONS, ...Object.keys(OWN_ICONS)]) expect(asked, name).toContain(name);
  });

  it("carries Ionicons' own drawings, with no address and no script", () => {
    for (const [name, svg] of Object.entries(OWN_ICONS)) {
      const original = readFileSync(join(import.meta.dirname, "..", "node_modules", "ionicons", "dist", "svg", `${name}.svg`), "utf8");
      expect(svg, name).toBe(original.replace(' xmlns="http://www.w3.org/2000/svg"', "").trim());
      expect(svg).not.toMatch(/https?:|<script|on\w+=/i);
    }
  });

  it("draws an icon beside a text as hidden, and a lone one with its label", () => {
    expect(icon("send-outline")).toBe('<i class="i" style="--i:url(./icon/send-outline.svg)" aria-hidden="true"></i>');
    expect(icon("send-outline", { label: 'Put "in"' })).toBe(
      '<i class="i" style="--i:url(./icon/send-outline.svg)" role="img" aria-label="Put &quot;in&quot;"></i>',
    );
    const own = icon("pin-outline");
    expect(own).toMatch(/^<svg class="i" aria-hidden="true" focusable="false" viewBox="0 0 512 512">/);
    expect(icon("pin-outline", { label: "Kept" })).toMatch(/^<svg class="i" role="img" aria-label="Kept" focusable="false"/);
    expect(() => icon("no-such-icon")).toThrow();
  });
});
