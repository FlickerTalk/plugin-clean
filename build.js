// Builds `dist/` from `src/`: one bundle with picscrub, exifr and pdf-lib inside, and the notices of
// what it bundles beside it. The package the catalogue signs is `module.json` + `dist/`.
//
// The frame has no network (`connect-src 'none'`), and the bundle should not even look as if it
// could: exifr's URL reader and its Node `import()` are replaced by nothing (Clean always hands it
// bytes), and two addresses that only ever appear in messages are taken out of the text.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";

/** [file it is in, text, what replaces it]. */
const REWRITES = [
  [/exifr[\\/]src[\\/]file-parsers[\\/]heif\.mjs$/, "https://github.com/MikeKovarik/exifr", "exifr's issue tracker"],
  [/pdf-lib[\\/]es[\\/]api[\\/]PDFDocument\.js$/, "pdf-lib (https://github.com/Hopding/pdf-lib)", "pdf-lib"],
];

const offline = {
  name: "offline",
  setup(builder) {
    // exifr: no fetch (its URL reader) and no dynamic import (its Node readers and zlib).
    builder.onLoad({ filter: /exifr[\\/]src[\\/]polyfill[\\/]fetch\.mjs$/ }, () => ({
      contents: "export let fetch = undefined; export const set = () => {};",
      loader: "js",
    }));
    builder.onLoad({ filter: /exifr[\\/]src[\\/]util[\\/]import\.mjs$/ }, () => ({
      contents: "export default function () { return undefined; }",
      loader: "js",
    }));
    for (const [filter, from, to] of REWRITES) {
      builder.onLoad({ filter }, ({ path }) => {
        const source = readFileSync(path, "utf8");
        if (!source.includes(from)) throw new Error(`${path} no longer says ${from}: check the rewrite`);
        return { contents: source.replaceAll(from, to), loader: "js" };
      });
    }
  },
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2022"],
  outfile: "dist/index.js",
  legalComments: "none",
  logLevel: "info",
  plugins: [offline],
});

copyFileSync("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
