// Configuration for the mobile-core DB build. Mirrors the knobs spread
// across core/CREATE_MOBILE_DB, CREATE_MOBILE_DB_ES, and the individual
// PUBLISH_*.php files — all consolidated in one place.

import * as fs from "fs";
import * as url from "url";
import type { Lang } from "../lib/args.js";
import { envOr } from "../lib/env.js";

export type { Lang };
export { parseLangArg } from "../lib/args.js";

// Bump on every publish. Single source of truth — the Makefile reads the
// same VERSION file so filenames stay in sync across TS and Make.
const VERSION_FILE = url.fileURLToPath(new URL("./VERSION", import.meta.url));
export const CORE_VERSION = Number(fs.readFileSync(VERSION_FILE, "utf8").trim());

// Schema versions used in the <entry> tags of the deploy .config XML.
// Logically independent of CORE_VERSION (the publish revision) — they track
// the on-disk sqlite layout, which only bumps when the Android consumer's
// parsing changes. Historically pinned together; if you ever need to bump
// CORE_VERSION without a schema change (or vice versa), split these into
// their own fields in tools/core/VERSION.
export const CORE_SCHEMA_VERSION = CORE_VERSION;
export const CONTENT_SCHEMA_VERSION = CORE_VERSION;

// Source MySQL tables read by the core publishers. Only these five vary by
// language; citation, citation_verse, speaker, jdtopic, jdcite, jdalso,
// jod_discourse, stpjs_page, conference_talk, next_chapter, next_talk,
// talk_stream are shared across EN/ES.
//
// The SQLite output tables are always unsuffixed (`book`, `scripture`,
// `conference`, `conf_session`, `talk`) — the suffix only applies to the
// MySQL source side.
export interface LangTables {
    book: string;
    scripture: string;
    conference: string;
    confSession: string;
    talk: string;
}

interface LangVariant {
    tables: LangTables;
    locale: string;               // android_metadata.locale
    coreFileName: string;         // inner sqlite file name
    contentFileName: string;      // mobile content db bundled into the zip
    zipFileName: string;          // deploy archive name
    configFileName: string;       // deploy manifest name
    constantsFileName: string;    // Constants.java / ConstantsEs.java
    constantsVarName: string;     // ENGLISH / SPANISH
    constantsLangSuffix: string;  // ""       / "-es"
    luceneEntryName: string;      // lucene   / lucene-es (folder name inside the zip)
}

export const LANG_CONFIG: Record<Lang, LangVariant> = {
    en: {
        tables: {
            book: "book",
            scripture: "scripture",
            conference: "conference",
            confSession: "conf_session",
            talk: "talk"
        },
        locale: "en_US",
        coreFileName: `core.${CORE_VERSION}.db`,
        contentFileName: `content.${CORE_VERSION}.db`,
        zipFileName: `sci.${CORE_VERSION}.zip`,
        configFileName: `sci.${CORE_VERSION}.config`,
        constantsFileName: "Constants.java",
        constantsVarName: "ENGLISH",
        constantsLangSuffix: "",
        luceneEntryName: "lucene"
    },
    es: {
        tables: {
            book: "book_es",
            scripture: "scripture_es",
            conference: "conference_es",
            confSession: "conf_session_es",
            talk: "talk_es"
        },
        locale: "es_ES",
        coreFileName: `core-es.${CORE_VERSION}.db`,
        contentFileName: `content-es.${CORE_VERSION}.db`,
        zipFileName: `sci-es.${CORE_VERSION}.zip`,
        configFileName: `sci-es.${CORE_VERSION}.config`,
        constantsFileName: "ConstantsEs.java",
        constantsVarName: "SPANISH",
        constantsLangSuffix: "-es",
        luceneEntryName: "lucene-es"
    }
};

export function coreOutDir(): string {
    return envOr("CORE_OUT_DIR", "out/core");
}

// Location of the mobile content DB produced by `tools/mobile/build.ts`.
// The old CREATE_MOBILE_DB scripts referenced `../mobile/content.$V.db` —
// that path no longer exists, content now lives under out/mobile.
export function mobileOutDir(): string {
    return envOr("MOBILE_OUT_DIR", "out/mobile");
}

// Per-lang Lucene index directory. The old scripts hard-coded diverging
// paths (EN: sci-search/lucene, ES: sci-lucene-indexer/lucene-es — the ES
// path was a bug). Both should live under sci-search now, overridable via
// env so the production host can point elsewhere.
export function luceneDir(lang: Lang): string {
    const suffix = lang === "en" ? "" : "-es";
    const varName = lang === "en" ? "CORE_LUCENE_EN" : "CORE_LUCENE_ES";
    return envOr(varName, `../sci-search/lucene${suffix}`);
}
