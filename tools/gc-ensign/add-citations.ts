import * as fs from "fs";
import * as path from "path";
import { parseIdRangeArgs } from "../lib/args.js";
import { createDb } from "../lib/db.js";
import { toHtmlEntities } from "../lib/html-entities.js";
import {
    fetchCitations,
    loadMaxVerses,
    replaceCitationsOld,
    rewriteCitationsNew
} from "../lib/ensign-citations.js";
import { processTalkDom } from "../lib/ensign-dom.js";
import { runMain } from "../lib/run-main.js";
import { buildConfig, parseLangArg } from "./config.js";

function resolveInputPath(id: number, sourceDirs: string[]): string | null {
    for (const dir of sourceDirs) {
        const candidate = path.join(dir, String(id));
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

async function main(): Promise<void> {
    const run = buildConfig(parseLangArg());
    fs.mkdirSync(run.outDir, { recursive: true });

    const idsArg = parseIdRangeArgs();
    const ids = idsArg ?? (() => {
        const out: number[] = [];
        for (let id = run.firstId; id <= run.lastId; id++) out.push(id);
        return out;
    })();

    const db = await createDb();

    try {
        const maxVerses = await loadMaxVerses(db);

        for (const id of ids) {
            // For ES the ensign-citations regexes force https?, so
            // protocol/server only affect the fallback log line; for EN they
            // drive the actual match.
            let protocol = "http";
            let server = "lds.org";

            if (id >= run.httpsCutoffId) {
                protocol = "https";
                server = "www.lds.org";
            }

            const inPath = resolveInputPath(id, run.sourceDirs);
            if (inPath === null) continue;

            let body = fs.readFileSync(inPath, "utf8");
            body = toHtmlEntities(body);
            // eslint-disable-next-line no-control-regex -- strip NUL bytes from source HTML
            body = body.replace(/\x00+/g, "");
            body = body.replace(/%2[cC]/g, ",");

            const citations = await fetchCitations(db, id, run.cfg.bookTable);
            const isNewFormat = id >= run.newFormatId;
            const env = { protocol, server, maxVerses, cfg: run.cfg };

            if (isNewFormat) {
                body = rewriteCitationsNew(body, id, citations, env);
            } else {
                body = replaceCitationsOld(body, id, citations, env);
            }

            const processed = processTalkDom({ talkId: id, body, isNewFormat, cfg: run.cfg });
            if (processed === null) continue;

            fs.writeFileSync(path.join(run.outDir, String(id)), processed, "utf8");
        }
    } finally {
        await db.end();
    }
}

runMain(main());
