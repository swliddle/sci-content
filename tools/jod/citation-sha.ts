import * as crypto from "crypto";
import * as mysql from "mysql2/promise";
import { createDb } from "../lib/db.js";
import { runMain } from "../lib/run-main.js";

// Match PHP strval: null -> "", everything else -> default string form.
// Row cells are SQL primitives (number | string | null | Date | Buffer),
// never plain objects — the default String() coercion matches PHP's strval.
function strval(v: string | number | Date | Buffer | null | undefined): string {
    if (v === null || v === undefined) return "";
    return String(v);
}

async function main(): Promise<void> {
    const db = await createDb({ rowsAsArray: true });
    try {
        const [rows] = await db.query<mysql.RowDataPacket[]>(
            "SELECT ID, TalkID, BookID, Chapter, Verses, Flag, PageColumn " +
                "FROM citation WHERE TalkID >= 10000 AND TalkID < 270000 ORDER BY ID"
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
