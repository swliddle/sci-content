import { parseVolumeArg } from "../lib/args.js";
import { envOr } from "../lib/env.js";
import { runLoad } from "../lib/loader.js";
import { runMain } from "../lib/run-main.js";

function volumePrefix(vol: number): string {
    return String(vol).padStart(2, "0");
}

// JoD files have an extra `<b class="impdf"/>` / `<b class="imhbll"/>` pair
// that downstream consumers parse as open+close, not self-closing. Rewrite
// them before insertion so the stored content round-trips through HTML
// parsers unchanged.
function cleanJodContent(raw: string): string {
    return raw
        .replace(/<[?]xml.*[?]>/, "")
        .replace(/<[!]DOCTYPE.*>/, "")
        .replace(/<html><body>/, "")
        .replace(/<\/body><\/html>/, "")
        .replace(/<b\s+class="impdf"\/>/g, '<b class="impdf"></b>')
        .replace(/<b\s+class="imhbll"\/>/g, '<b class="imhbll"></b>')
        .trim();
}

async function main(): Promise<void> {
    const vol = parseVolumeArg();
    const prefix = volumePrefix(vol);
    const low = vol * 10000;
    const high = low + 9999;

    await runLoad({
        fileStem: `JoD${prefix}_Discourse`,
        fileRegex: new RegExp(`^JoD${prefix}_Discourse(\\d+)\\.html$`),
        talkIdOffset: low,
        outDir: envOr("DB_DIR", "out/jod/db"),
        talkbodyTable: "talkbody2",
        talkIdRange: [low, high],
        cleanContent: cleanJodContent
    });
}

runMain(main());
