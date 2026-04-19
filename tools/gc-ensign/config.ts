import type { Lang } from "../lib/args.js";
import { EN_CONFIG, ES_CONFIG, EnsignConfig } from "../lib/ensign-config.js";
import { envOr } from "../lib/env.js";

export type { Lang };
export { parseLangArg } from "../lib/args.js";

interface GcEnsignLangVariant {
    cfg: EnsignConfig;
    origDir: string;
    editDir: string;
    outDir: string;
    talkbodyTable: string;
}

const FIRST_ID = 2000;
const LAST_ID = 8493;
const NEW_FORMAT_ID = 8362;
const HTTPS_CUTOFF_ID = 8000;

const EN_DEFAULT_ORIG = "gc-ensign/orig";
const EN_DEFAULT_EDIT = "gc-ensign/edit";

const VARIANTS: Record<Lang, GcEnsignLangVariant> = {
    en: {
        cfg: EN_CONFIG,
        origDir: EN_DEFAULT_ORIG,
        editDir: EN_DEFAULT_EDIT,
        outDir: "out/gc-ensign",
        talkbodyTable: "talkbody2"
    },
    es: {
        cfg: ES_CONFIG,
        origDir: "gc-ensign-es/orig",
        editDir: "gc-ensign-es/edit",
        outDir: "out/gc-ensign-es",
        talkbodyTable: "talkbody2_es"
    }
};

export interface GcEnsignRunConfig {
    lang: Lang;
    cfg: EnsignConfig;
    // Ordered list of directories to probe for a source file named `${id}`.
    // EN: [edit, orig]. ES: [es-edit, es-orig, en-edit, en-orig] — older ES
    // talks are identical to the English text and fall back to the EN dirs.
    sourceDirs: string[];
    outDir: string;
    talkbodyTable: string;
    firstId: number;
    lastId: number;
    newFormatId: number;
    httpsCutoffId: number;
}

export function buildConfig(lang: Lang): GcEnsignRunConfig {
    const v = VARIANTS[lang];
    const sourceDirs = [
        envOr("EDIT_DIR", v.editDir),
        envOr("ORIG_DIR", v.origDir)
    ];
    if (lang === "es") {
        sourceDirs.push(
            envOr("EN_EDIT_DIR", EN_DEFAULT_EDIT),
            envOr("EN_ORIG_DIR", EN_DEFAULT_ORIG)
        );
    }

    return {
        lang,
        cfg: v.cfg,
        sourceDirs,
        outDir: envOr("OUT_DIR", v.outDir),
        talkbodyTable: v.talkbodyTable,
        firstId: FIRST_ID,
        lastId: LAST_ID,
        newFormatId: NEW_FORMAT_ID,
        httpsCutoffId: HTTPS_CUTOFF_ID
    };
}

export const GC_ENSIGN_TALK_ID_RANGE: [number, number] = [FIRST_ID, LAST_ID];
export const GC_ENSIGN_TALK_ID_OFFSET = 0;
