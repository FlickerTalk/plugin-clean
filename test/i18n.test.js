// What Clean says, in the 21 languages of the app (plan of the new plugins, §13): the same keys in
// each, the same placeholders, nothing empty, English as the fallback, Arabic right to left.
import { describe, expect, it } from "vitest";
import { LANGUAGES, catalogueOf, directionOf, t } from "../src/i18n.js";

const APP_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "ro", "pl", "ru", "uk", "tr", "ar", "hi", "bn", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"];
const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("the catalogue", () => {
  it("speaks the 21 languages of the app, with the same keys in each", () => {
    expect([...LANGUAGES].sort()).toEqual([...APP_LANGUAGES].sort());
    const keys = Object.keys(catalogueOf("en")).sort();
    expect(keys.length).toBeGreaterThan(30);
    for (const lang of LANGUAGES) expect(Object.keys(catalogueOf(lang)).sort(), lang).toEqual(keys);
  });

  it("has every text filled in, with the placeholders of the English one", () => {
    const english = catalogueOf("en");
    for (const lang of LANGUAGES) {
      for (const [key, text] of Object.entries(catalogueOf(lang))) {
        expect(text.trim(), `${lang}.${key}`).not.toBe("");
        expect(placeholders(text), `${lang}.${key}`).toEqual(placeholders(english[key]));
      }
    }
  });

  it("never promises more than it does", () => {
    for (const lang of LANGUAGES) {
      for (const text of Object.values(catalogueOf(lang))) expect(text.toLowerCase()).not.toMatch(/anonym|anónim|anonim/);
    }
  });

  it("falls back to the base language and then to English, and fills the placeholders", () => {
    expect(t("es", "clean")).toBe("Limpiar");
    expect(t("pt-BR", "clean")).toBe(t("pt", "clean"));
    expect(t("xx", "clean")).toBe("Clean");
    expect(t("en", "newName", { name: "photo.jpg" })).toBe("New name: photo.jpg");
    expect(t("en", "no-such-key")).toBe("no-such-key");
  });

  it("writes Arabic right to left, and the rest left to right", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("ar-EG")).toBe("rtl");
    expect(directionOf("es")).toBe("ltr");
    expect(directionOf(undefined)).toBe("ltr");
  });
});
