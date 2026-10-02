// The manifest (plan of the new plugins, §5): exactly the permission and the file types Clean
// needs, the core that brought "Open with" (1.1.0), and the rules of plugin-sdk's module.schema.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "module.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));

describe("module.json", () => {
  it("asks only to propose a file in the chat, and opens photos and PDFs", () => {
    expect(manifest.id).toBe("com.flickertalk.clean");
    expect(manifest.name).toBe("Clean");
    expect(manifest.minCoreVersion).toBe("1.3.0"); // the core it was tested on: it lends location-outline and sends `dark`
    expect(manifest.components).toEqual(["ft-clean"]);
    expect(manifest.permissions).toEqual({ send: "propose" });
    expect(manifest.opens).toEqual(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
    expect(manifest.views).toBe(undefined);
    expect(manifest.version).toBe(pkg.version);
  });

  it("follows the SDK's schema: the fields it knows, their shapes, an English summary", () => {
    const known = ["id", "name", "version", "minCoreVersion", "components", "summary", "views", "opens", "permissions"];
    expect(Object.keys(manifest).every((key) => known.includes(key))).toBe(true);
    expect(manifest.id).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.minCoreVersion).toMatch(/^\d+\.\d+\.\d+$/);
    for (const component of manifest.components) expect(component).toMatch(/^ft-[a-z0-9-]+$/);
    for (const type of manifest.opens) expect(type).toMatch(/^[a-z0-9][a-z0-9.+_-]*\/[a-z0-9][a-z0-9.+_-]*$/);
    expect(manifest.summary.length).toBeGreaterThan(20);
    expect(manifest.summary.length).toBeLessThanOrEqual(200);
    expect(manifest.summary).toMatch(/^[\x20-\x7e]+$/);
    expect(manifest.summary.toLowerCase()).not.toMatch(/anonym/);
  });
});

describe("package.json", () => {
  it("pins every dependency to one version", () => {
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
