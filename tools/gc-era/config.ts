import type { CorpusDefinition } from "../lib/citations.js";
import { envOr } from "../lib/env.js";

export function buildConfig(): CorpusDefinition {
    return {
        name: "gc-era",
        fileStem: "talk",
        talkIdOffset: 0,

        firstId: 1,
        lastId: 1825,
        skipIds: [990],
        xmlDir: envOr("XML_DIR", "gc-era"),
        outDir: envOr("OUT_DIR", "out/gc-era"),
        bookTable: "book",
        labels: { J: " (JST)", E: " Endnote", H: " Headnote" },
        anchorSuffix: "",
        style: "gc-era",

        talkbodyTable: "talkbody2",
        // Wider than [firstId, lastId] so the load step clears any
        // previously-present rows above lastId (e.g. 1826..1830).
        talkIdRange: [1, 1830]
    };
}
