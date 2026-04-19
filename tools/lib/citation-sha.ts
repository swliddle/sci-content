// Emits a SHA1 digest over the `citation` rows whose TalkID falls in a given
// inclusive range. Downstream Makefile stamps depend on the SHA file so a
// citation edit in MySQL triggers a rebuild of the affected corpus on the
// next `make` run, even though no source file changed.
//
// citation_verse is intentionally not hashed: it is derived from
// citation.Verses by verse-sets, so any change to it implies a change in
// citation.Verses.
//
// Usage:
//     npx tsx tools/lib/citation-sha.ts --range <low>-<high>
// Writes the hex digest to stdout; the Makefile compares against the prior
// stamp and only updates (and invalidates dependents) on a change.

import * as crypto from "crypto";
import * as mysql from "mysql2/promise";
import { requireArg } from "./args.js";
import { createDb } from "./db.js";
import { runMain } from "./run-main.js";

function strval(v: string | number | Date | Buffer | null | undefined): string {
    if (v === null || v === undefined) return "";
    return String(v);
}

function parseRange(): [number, number] {
    const raw = requireArg("--range", "Usage: --range <low>-<high>");
    const m = raw.match(/^(\d+)-(\d+)$/);
    if (!m) throw new Error(`Invalid --range: ${raw} (expected <low>-<high>)`);
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (lo > hi) throw new Error(`Invalid --range: ${raw} (low > high)`);
    return [lo, hi];
}

async function main(): Promise<void> {
    const [low, high] = parseRange();
    const db = await createDb({ rowsAsArray: true });
    try {
        const [rows] = await db.query<mysql.RowDataPacket[]>(
            "SELECT ID, TalkID, BookID, Chapter, Verses, Flag, PageColumn " +
                "FROM citation WHERE TalkID >= ? AND TalkID <= ? ORDER BY ID",
            [low, high]
        );

        const hash = crypto.createHash("sha1");
        type Cell = string | number | Date | Buffer | null;
        for (const row of rows as unknown as Cell[][]) {
            hash.update(row.map(strval).join("\t") + "\n");
        }
        process.stdout.write(hash.digest("hex") + "\n");
    } finally {
        await db.end();
    }
}

runMain(main());
