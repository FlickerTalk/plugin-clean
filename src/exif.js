// What a photo says about itself, read with exifr (MIT). Built from exifr's sources with only the
// parts Clean needs: JPEG, PNG, HEIF and bare TIFF files; the TIFF blocks (IFD0, EXIF, GPS, the
// thumbnail's IFD1), XMP, IPTC and the PNG header with its text chunks. No URL or file readers:
// the bytes are always in hand, and the build replaces exifr's fetch and dynamic import with
// nothing (see build.js), so this can never reach the network.
import { Exifr } from "exifr/src/core.mjs";
import "exifr/src/file-parsers/jpeg.mjs";
import "exifr/src/file-parsers/png.mjs";
import "exifr/src/file-parsers/heif.mjs";
import "exifr/src/file-parsers/tiff.mjs";
import "exifr/src/segment-parsers/tiff-exif.mjs";
import "exifr/src/segment-parsers/xmp.mjs";
import "exifr/src/segment-parsers/iptc.mjs";
import "exifr/src/segment-parsers/ihdr.mjs";
import "exifr/src/dicts/tiff-ifd0-keys.mjs";
import "exifr/src/dicts/tiff-exif-keys.mjs";
import "exifr/src/dicts/tiff-gps-keys.mjs";
import "exifr/src/dicts/tiff-other-keys.mjs";
import "exifr/src/dicts/iptc-keys.mjs";
import "exifr/src/dicts/tiff-revivers.mjs";

/** Everything it can find, segment by segment (`mergeOutput: false`), values untranslated. */
const OPTIONS = {
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  ifd1: true,
  interop: false,
  xmp: true,
  iptc: true,
  ihdr: true,
  icc: false,
  jfif: false,
  makerNote: true,
  userComment: true,
  mergeOutput: false,
  translateValues: false,
  sanitize: true,
  silentErrors: true,
};

/**
 * The metadata of an image's bytes, by segment (`ifd0`, `exif`, `gps`, `ifd1`, `xmp`, `dc`,
 * `iptc`, `ihdr`, `makerNote`…), or null when there is none or the bytes are not an image exifr
 * reads. Only bytes are accepted: a string would make exifr fetch it.
 */
export async function readExif(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  try {
    const reader = new Exifr(OPTIONS);
    await reader.read(bytes);
    const read = await reader.parse();
    return read && Object.keys(read).length ? read : null;
  } catch {
    return null;
  }
}
