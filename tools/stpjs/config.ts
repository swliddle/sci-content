import type { CorpusDefinition, CorpusLabels } from "../lib/citations.js";
import type { Lang } from "../lib/args.js";
import { envOr } from "../lib/env.js";

export type { Lang };
export { parseLangArg } from "../lib/args.js";

interface StpjsLangVariant {
    xmlDir: string;
    bookTable: string;
    talkbodyTable: string;
    labels: CorpusLabels;
}

const STPJS_FIRST_PAGE = 1;
const STPJS_LAST_PAGE = 395;
const STPJS_TALK_ID_OFFSET = 270000;

const VARIANTS: Record<Lang, StpjsLangVariant> = {
    en: {
        xmlDir: "stpjs/en",
        bookTable: "book",
        talkbodyTable: "talkbody2",
        labels: { J: " (JST)", E: " Endnote", H: " Headnote" }
    },
    es: {
        xmlDir: "stpjs/es",
        bookTable: "book_es",
        talkbodyTable: "talkbody2_es",
        labels: {
            J: " (TJS)",
            E: " Nota al Pie de Página",
            H: " Encabezamiento"
        }
    }
};

export function buildConfig(lang: Lang): CorpusDefinition {
    const variant = VARIANTS[lang];

    return {
        name: `stpjs-${lang}`,
        fileStem: "stpjs",
        talkIdOffset: STPJS_TALK_ID_OFFSET,

        firstId: STPJS_FIRST_PAGE,
        lastId: STPJS_LAST_PAGE,
        xmlDir: envOr("XML_DIR", variant.xmlDir),
        outDir: envOr("OUT_DIR", `out/stpjs/${lang}`),
        bookTable: variant.bookTable,
        labels: variant.labels,
        anchorSuffix: '\\s*target="_blank"',
        style: "stpjs",

        talkbodyTable: variant.talkbodyTable,
        // Loader clears this whole range before inserting. Widened past
        // lastId to catch stale rows from earlier, larger builds.
        talkIdRange: [STPJS_TALK_ID_OFFSET + 1, STPJS_TALK_ID_OFFSET + 10000]
    };
}
