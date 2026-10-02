# plugin-clean

**Clean** for [FlickerTalk](https://flickertalk.com): see what a photo or a PDF reveals about you
before you send it, and send a copy without it.

> Shows and removes the location, the phone model, the author and other data hidden in the file,
> on your phone, before you send it. It does not change what you see in the picture.

## Privacy

- **What it sees:** the one file it is handed, from the chat ("Open with") or from the phone's
  picker.
- **What it never sees:** the conversation, the contact, any other file. It has no network (the
  frame's policy allows none, and the bundle has no code that asks for it) and it keeps nothing:
  no settings, no records, no copy of the file.
- **What it removes is checked, not assumed:** after cleaning, Clean reads the clean file again with
  the same reader, and the result screen lists what is gone and what is still there.
- It removes data hidden in the file. It does **not** change what can be seen or read in the
  picture or the pages: a face, a street sign or a name written on a document stay as they are.

## What it does

From a conversation: the tools button → **Clean** → photo (the photo picker) or PDF (the document
picker); or, on a file received in the chat, "Open with" → **Clean**. The report lists what the
file says, by group, each with its Ionicon, in the phone's language: location (coordinates, or
"empty" when Android's photo picker already zeroed them), phone or camera, dates, author and
copyright, program, serial numbers and unique IDs, titles, descriptions and comments, thumbnails
and other pictures inside the file (a preview, an HDR gain map, a depth map), the video of a motion
photo, other data after the picture, Content Credentials (C2PA), the PDF's file identifier, authors
of PDF comments, attachments, and anything else.

**Clean** makes the copy, then shows *Removed*, *Could not be removed* and *Kept on purpose*.
*Send* puts the clean file in the message box (the plugin closes, the user sends it); *Save* saves
it on the phone.

All icons are Ionicons, as in the app: the ones the app lends (`./icon/<name>.svg`) and the rest
from the `ionicons` package (8.1.0, MIT), carried as inline SVG in `src/icons.js`. Every icon is
drawn by one function, `icon()`.

### Photos: JPEG, PNG, WebP, HEIC/HEIF

The metadata blocks are taken out and the image data is copied byte for byte: **nothing is decoded
or encoded again**, so the picture does not lose quality.

| Format | Removed | Kept on purpose |
| --- | --- | --- |
| JPEG | EXIF (with GPS, maker notes and its thumbnail), XMP, IPTC, comments, C2PA, other APP segments, and everything after the end of the image (the video of a motion photo, MPF previews, an Ultra HDR gain map) | the orientation (a small EXIF with only that tag, or the photo would turn) and the colour profile |
| PNG | `tEXt`, `zTXt`, `iTXt` (XMP), `eXIf`, `tIME`, C2PA | the colour profile (`iCCP`) |
| WebP | `EXIF`, `XMP `, C2PA | the colour profile (`ICCP`) |
| HEIC/HEIF | the Exif and XMP items and C2PA, **overwritten with zeros in place** (the file keeps its size: rewriting HEIF boxes would risk breaking the image) | the colour profile |

An Ultra HDR photo loses its gain map: on an HDR screen it shows as an ordinary photo, as on any
other screen. The report names the fields people most often worry about; the cleaning removes the **whole
blocks**, including fields the report does not name.

Not removed, and the result says so: the **thumbnail item** of a HEIC (a small copy of the same
picture), and anything a format keeps where the cleaner does not look. A photo goes out as
`photo.jpg` (`.png`, `.webp`, `.heic`): a camera names its files by the date and time they were
taken. A HEIC has no preview in Android's WebView; it is cleaned all the same.

### PDF

Removed: the document's **Info** (author, title, subject, keywords, programs, dates, custom fields),
every **XMP `/Metadata`** stream, the file identifier (`/ID`), and every object the document no
longer uses, so an older revision's Info does not stay behind. pdf-lib opens the file with
`updateMetadata: false`, so it does not write its own name or dates.

Not touched, and the report says so: the authors of comments (`/T`), attachments, the text and
pictures of the pages, and the metadata inside those pictures. A PDF with a password cannot be read,
so it cannot be cleaned. A PDF with a **digital signature** can be cleaned, after a warning:
the signature stops being valid, because the file changes. A PDF keeps its own name (without any
folder).

Out of scope: Word, Excel and PowerPoint files, video, audio, several files at once.

## What it uses of the app

| Plugin API | For |
| --- | --- |
| `onOpen` | `file` ("Open with"), `lang`, `dark` |
| `ft.pickFile` | `image/*` (the photo picker) or `application/pdf` |
| `ft.send` | the clean file, proposed in the message box (`send: propose`) |
| `ft.save` | the clean file, on the phone |
| `ft.close` | ✕ |

`module.json`: `permissions: { "send": "propose" }`; `opens`: `image/jpeg`, `image/png`,
`image/webp`, `image/heic`, `image/heif`, `application/pdf`; no `views` (a tap on a photo or PDF
still opens the usual viewer). It needs FlickerTalk **1.1.0** (`minCoreVersion`), the version that
brought "Open with". The contract is in [plugin-sdk](https://github.com/FlickerTalk/plugin-sdk).

## Inside

| Component | Version | Licence | For |
| --- | --- | --- | --- |
| [picscrub](https://github.com/fasouto/picscrub) | 1.2.0 | MIT | removing photo metadata without re-encoding |
| [exifr](https://github.com/MikeKovarik/exifr) | 7.1.3 | MIT | reading EXIF, GPS, XMP, IPTC and PNG text for the report |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT | reading and writing the PDF |

pdf-lib brings `@pdf-lib/standard-fonts` (MIT, with Adobe's font metrics), `@pdf-lib/upng` (MIT),
`pako` (MIT and Zlib) and `tslib` (0BSD). Their licences are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), which the build copies to `dist/`.

exifr is built from its sources with only the parts Clean uses; its URL reader (`fetch`) and its
Node readers (dynamic `import()`) are replaced by nothing in the build, so the bundle has no network
code at all. A test fails if `dist/` contains an `https://` address, an `http://` one that is not an
XML namespace name, or any of `fetch`, `XMLHttpRequest`, `WebSocket`, workers, WebAssembly, `eval`,
`localStorage`, `indexedDB` or a dialog.

## Development

```sh
npm install
npm test                      # Vitest + happy-dom: src/, dist/ and the files in test/fixtures
npm run build                 # esbuild: src/ → dist/index.js + dist/THIRD_PARTY_NOTICES.md
node test/fixtures/make.mjs   # remakes the test files
```

The test files are made by that script: 16×16 gradients and hand-written PDFs with made-up names,
places and serial numbers, never anybody's photo or document. The cleaning is checked with exifr on
the result, byte by byte on the image data (the JPEG scan, the PNG `IDAT`, the WebP bitstream, the
HEIF image items), and by searching the clean PDF's raw bytes.

`dist/` is generated and **committed**: what the catalogue signs is `module.json` + `dist/`, and the
CI fails if `dist/` does not come out of `src/`. It weighs about 600 KB (about 230 KB compressed); a
test keeps it under 1 MB. It is not a seed: the app downloads it from the catalogue (Android).

## License

MIT.
