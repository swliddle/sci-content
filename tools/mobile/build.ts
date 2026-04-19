// CLI entry that builds the mobile content SQLite DB for one language.
// Runs all four content sources in order (pre-1971 → JoD → STPJS → Ensign)
// and applies the android_metadata + updated tables. Replaces
// mobile/CREATE_CONTENT_DB's PHP→sqlite3 pipe with direct prepared writes.
//
// Usage:
//     npx tsx tools/mobile/build.ts --lang en|es [--compress=0]
//
// Environment:
//     MOBILE_OUT_DIR   destination directory (default: out/mobile)

import * as fs from "fs";
import * as path from "path";
import { createDb } from "../lib/db.js";
import { MobileDb } from "../lib/mobile-sqlite.js";
import { runMain } from "../lib/run-main.js";
import { LANG_CONFIG, mobileOutDir, parseCompressArg, parseLangArg } from "./config.js";
import {
    type BuildContext,
    buildEnsign,
    buildJod,
    buildPre1971,
    buildStpjs
} from "./sources.js";

async function main(): Promise<void> {
    const lang = parseLangArg();
    const compress = parseCompressArg();
    const variant = LANG_CONFIG[lang];

    const outDir = mobileOutDir();
    fs.mkdirSync(outDir, { recursive: true });
    const dbPath = path.join(outDir, variant.dbFileName);
    fs.rmSync(dbPath, { force: true });

    console.log(`[mobile build ${lang}] → ${dbPath} (compress=${compress})`);

    const db = await createDb();
    const mobile = new MobileDb(dbPath, { fresh: true });

    try {
        const ctx: BuildContext = { db, mobile, tables: variant.tables, compress };

        const pre1971 = await buildPre1971(ctx);
        console.log(`[mobile build ${lang}] pre-1971 rows: ${pre1971}`);

        const jod = await buildJod(ctx);
        console.log(`[mobile build ${lang}] jod rows:      ${jod}`);

        const stpjs = await buildStpjs(ctx);
        console.log(`[mobile build ${lang}] stpjs rows:    ${stpjs}`);

        const ensign = await buildEnsign(ctx);
        console.log(`[mobile build ${lang}] ensign rows:   ${ensign}`);

        mobile.applyTimestamp(variant.locale);
        console.log(`[mobile build ${lang}] total rows:    ${pre1971 + jod + stpjs + ensign}`);
    } finally {
        mobile.close();
        await db.end();
    }
}

runMain(main());
