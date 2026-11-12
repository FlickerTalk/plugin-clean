// The bundle must not even look able to reach the network. Clean always hands exifr bytes, so its
// fetch and Node import() are stubbed out, and two URLs that only appear in messages are rewritten.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const REWRITES = [
  [/exifr[\\/]src[\\/]file-parsers[\\/]heif\.mjs$/, "https://github.com/MikeKovarik/exifr", "exifr's issue tracker"],
  [/pdf-lib[\\/]es[\\/]api[\\/]PDFDocument\.js$/, "pdf-lib (https://github.com/Hopding/pdf-lib)", "pdf-lib"],
];

const offline = {
  name: "offline",
  setup(builder) {
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
