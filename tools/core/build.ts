// CLI entry that builds the mobile-core SQLite DB for one language.
// Runs all five source modules in the same order as the old
// core/CREATE_MOBILE_DB[_ES]: citations → scriptures → toc → topics →
// nextprev, then applies the android_metadata + updated timestamp tables.
//
// Usage:
//     npx tsx tools/core/build.ts --lang en|es
//
// Environment:
//     CORE_OUT_DIR   destination directory (default: out/core)

import * as fs from "fs";
import * as path from "path";
import { createDb } from "../lib/db.js";
import { CoreDb } from "../lib/core-sqlite.js";
import { runMain } from "../lib/run-main.js";
import { LANG_CONFIG, coreOutDir, parseLangArg } from "./config.js";
import { buildCitations } from "./sources/citations.js";
import { buildScriptures } from "./sources/scriptures.js";
import { buildToc } from "./sources/toc.js";
import { buildTopics } from "./sources/topics.js";
import { buildNextPrev } from "./sources/nextprev.js";

async function main(): Promise<void> {
    const lang = parseLangArg();
    const variant = LANG_CONFIG[lang];

    const outDir = coreOutDir();
    fs.mkdirSync(outDir, { recursive: true });
    const dbPath = path.join(outDir, variant.coreFileName);
    fs.rmSync(dbPath, { force: true });

    console.log(`[core build ${lang}] → ${dbPath}`);

    // dateStrings: keep DATE/DATETIME columns as strings so better-sqlite3
    // can bind them directly. conference.IssueDate, conf_session.Date, and
    // talk.Date all flow through unchanged to the SQLite TEXT columns.
    const mysql = await createDb({ dateStrings: true });
    const core = new CoreDb(dbPath, { fresh: true });

    try {
        const cite = await buildCitations(mysql, core);
        console.log(
            `[core build ${lang}] citations: ${cite.citations} ` +
            `(verses=${cite.citationVerses}, speakers=${cite.speakers})`
        );

        const scrip = await buildScriptures(mysql, core, variant.tables);
        console.log(
            `[core build ${lang}] scriptures: ${scrip.scriptures} ` +
            `(books=${scrip.books})`
        );

        const toc = await buildToc(mysql, core, variant.tables);
        console.log(
            `[core build ${lang}] toc: talks=${toc.talks} ` +
            `conferences=${toc.conferences} sessions=${toc.confSessions} ` +
            `jod=${toc.jodDiscourses} stpjs=${toc.stpjsPages} ` +
            `conf-talks=${toc.conferenceTalks}`
        );

        const topics = await buildTopics(mysql, core);
        console.log(
            `[core build ${lang}] topics: jdtopic=${topics.jdTopics} ` +
            `jdcite=${topics.jdCites} jdalso=${topics.jdAlsos}`
        );

        const np = await buildNextPrev(mysql, core);
        console.log(
            `[core build ${lang}] nextprev: chapters=${np.nextChapters} ` +
            `talks=${np.nextTalks} (refreshed ${np.refreshedTalkIds} ids in MySQL)`
        );

        core.applyTimestamp(variant.locale);
    } finally {
        core.close();
        await mysql.end();
    }
}

runMain(main());
