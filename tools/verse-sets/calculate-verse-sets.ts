import * as mysql from "mysql2/promise";
import { createDb } from "../lib/db.js";
import { runMain } from "../lib/run-main.js";

const CITE_TABLE = "citation";
const VERSE_TABLE = "citation_verse";

interface CitationRow extends mysql.RowDataPacket {
    ID: number;
    Verses: string | null;
}

async function processCitation(
    db: mysql.Connection,
    row: CitationRow
): Promise<void> {
    const { ID, Verses } = row;

    if (Verses == null || Verses.trim() === "") {
        return;
    }

    console.log(ID);

    let min = 0;
    let max = 0;
    let first = true;

    for (const range of Verses.split(",")) {
        const parts = range.split("-");
        const verse1 = parseInt(parts[0] ?? "", 10);
        const verse2 = parts.length === 2 ? parseInt(parts[1] ?? "", 10) : verse1;

        if (first) {
            min = verse1;
            first = false;
        }

        for (let i = verse1; i <= verse2; i++) {
            if (i > max) max = i;

            await db.execute(
                `REPLACE INTO ${VERSE_TABLE} (CitationID, Verse) VALUES (?, ?)`,
                [ID, i]
            );
        }
    }

    await db.execute(
        `UPDATE ${CITE_TABLE} SET MinVerse=?, MaxVerse=? WHERE ID=?`,
        [min, max, ID]
    );
}

async function main(): Promise<void> {
    console.log("Calculating verse sets");
    const db = await createDb();

    try {
        const [rows] = await db.execute<CitationRow[]>(
            `SELECT ID, Verses FROM ${CITE_TABLE} WHERE MinVerse=0 OR MaxVerse=0`
        );

        for (const row of rows) {
            await processCitation(db, row);
        }
    } finally {
        await db.end();
    }
}

runMain(main());
