// Configuration for the mobile content-DB build. Mirrors the knobs that
// were previously spread across mobile/CREATE_CONTENT_DB, PUBLISH*.php, and
// CREATE_CONTENT_DB_ES so there's a single place to bump the version or
// redirect the output.

import type { Lang } from "../lib/args.js";
import { envOr } from "../lib/env.js";
export type { Lang };
export { parseLangArg } from "../lib/args.js";

// Bump on every publish. The old flow duplicated this across two bash
// drivers (CREATE_CONTENT_DB / CREATE_CONTENT_DB_ES); now it lives here.
export const MOBILE_VERSION = 52;

export interface LangTables {
    talk: string;
    talkbody: string;
    speaker: string;
    conferenceTalk: string;
    confSession: string;
    conference: string;
    jodDiscourse: string;
    stpjsPage: string;
}

interface LangVariant {
    tables: LangTables;
    locale: string;       // stored in android_metadata
    dbFileName: string;   // inner sqlite file name
    zipFileName: string;  // packaged artifact name
    configFileName: string;
}

export const LANG_CONFIG: Record<Lang, LangVariant> = {
    en: {
        tables: {
            talk: "talk",
            talkbody: "talkbody",
            speaker: "speaker",
            conferenceTalk: "conference_talk",
            confSession: "conf_session",
            conference: "conference",
            jodDiscourse: "jod_discourse",
            stpjsPage: "stpjs_page"
        },
        locale: "en_US",
        dbFileName: `content.${MOBILE_VERSION}.db`,
        zipFileName: `sci-content.${MOBILE_VERSION}.zip`,
        configFileName: `sci-content.${MOBILE_VERSION}.config`
    },
    es: {
        tables: {
            talk: "talk_es",
            talkbody: "talkbody_es",
            speaker: "speaker",                  // shared, not suffixed
            conferenceTalk: "conference_talk",   // shared, not suffixed
            confSession: "conf_session_es",
            conference: "conference_es",
            jodDiscourse: "jod_discourse",       // shared
            stpjsPage: "stpjs_page"              // shared
        },
        locale: "es_ES",
        dbFileName: `content-es.${MOBILE_VERSION}.db`,
        zipFileName: `sci-content-es.${MOBILE_VERSION}.zip`,
        configFileName: `sci-content-es.${MOBILE_VERSION}.config`
    }
};

// --compress=0 disables per-row gzcompress (rows stored as plain hex).
// Default is compressed, matching the deployed .jar / .zip artifact.
export function parseCompressArg(): boolean {
    const flag = process.argv.find((a) => a.startsWith("--compress="));

    if (flag === undefined) {
        return true;
    }

    const value = flag.slice("--compress=".length);
    return value !== "0" && value !== "false";
}

export function mobileOutDir(): string {
    return envOr("MOBILE_OUT_DIR", "out/mobile");
}
