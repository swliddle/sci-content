// Row-level encoding for the mobile content SQLite DB.
//
// Mirrors the encoding in mobile/PUBLISH.php / PUBLISH2.php (and their _ES
// siblings): take the UTF-8 HTML body and either
//   - compress=false: plain bin2hex of the UTF-8 bytes
//   - compress=true:  4-char hex length prefix + hex of zlib-compressed bytes
//
// PHP's gzcompress() produces zlib-format output (RFC 1950). Node's
// zlib.deflateSync() at level 9 produces a valid zlib stream of the same
// length with the same Adler32 checksum, but the compressed block payload
// is not byte-identical: Node's zlib often picks dynamic Huffman where
// PHP's picks fixed Huffman (or vice versa) — both are valid, same size.
// Decompression yields identical bytes, so parity is tested by inflating
// both old and new rows and diffing the uncompressed HTML, not by diffing
// the blob hex.
//
// Compatibility quirk preserved: PHP does
//     $hexlen = '0000' . dechex(strlen($content));
//     $hexlen = substr($hexlen, strlen($hexlen) - 4);
// which silently truncates to the low 16 bits once the compressed payload
// exceeds 65535 bytes. We keep the same behavior — downstream consumers
// expect exactly 4 hex chars, and truncation matches what already shipped.

import * as zlib from "node:zlib";

export interface EncodeOptions {
    compress: boolean;
}

export function encodeRow(content: string, options: EncodeOptions): string {
    const utf8 = Buffer.from(content, "utf8");

    if (!options.compress) {
        return utf8.toString("hex");
    }

    const compressed = zlib.deflateSync(utf8, { level: 9 });
    const hexlen = ("0000" + compressed.length.toString(16)).slice(-4);

    return hexlen + compressed.toString("hex");
}
