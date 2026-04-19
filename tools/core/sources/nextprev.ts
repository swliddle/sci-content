// Ports core/PUBLISH_NEXTPREV.php AND the UPDATE_IDS bash generator that
// ran ahead of it. Two steps, same ordering as the old CREATE_MOBILE_DB:
//
//   1. Regenerate the `next_talk` rows for TalkID < 10000 by walking the
//      talk IDs in order and emitting (CUR, NEXT, PREV) triples. The old
//      bash kept a three-element sliding window; we do the same here but
//      issue the DELETE + bulk INSERTs inside a single MySQL transaction
//      so parallel EN/ES builds can't interleave mid-rewrite.
//
//   2. Read the resulting `next_chapter` and `next_talk` tables from MySQL
//      and write them to SQLite.
//
// Quirk preserved: the bash always read from the unsuffixed `talk` table,
// so the ES core DB receives the same next/prev pointers derived from the
// EN talk IDs. Matches the deployed behavior; the Android app only uses
// these pointers for EN-id-space navigation.

import type { Connection, RowDataPacket } from "mysql2/promise";
import type { CoreDb } from "../../lib/core-sqlite.js";

interface TalkIdRow extends RowDataPacket {
    ID: number;
}

interface NextChapterRow extends RowDataPacket {
    BookChapter: number;
    NextBookChapter: number | null;
    PrevBookChapter: number | null;
}

interface NextTalkRow extends RowDataPacket {
    TalkID: number;
    NextTalkID: number | null;
    PrevTalkID: number | null;
}

interface Triple {
    cur: number;
    next: number | null;
    prev: number | null;
}

// Sliding-window port of archive/core/UPDATE_IDS. Emits one triple per ID.
function computeTriples(ids: number[]): Triple[] {
    const out: Triple[] = [];
    let prev: number | null = null;
    let cur: number | null = null;

    for (const id of ids) {
        if (cur !== null) {
            out.push({ cur, next: id, prev });
        }
        prev = cur;
        cur = id;
    }

    if (cur !== null) {
        out.push({ cur, next: null, prev });
    }

    return out;
}

// Step 1: recompute next_talk rows in MySQL for TalkID < 10000.
export async function refreshNextTalkIds(mysql: Connection): Promise<number> {
    const [idRows] = await mysql.execute<TalkIdRow[]>(
        "SELECT ID FROM talk WHERE ID < 10000 ORDER BY ID"
    );
    const triples = computeTriples(idRows.map((r) => r.ID));

    await mysql.beginTransaction();
    try {
        await mysql.execute("DELETE FROM next_talk WHERE TalkID < 10000");

        if (triples.length > 0) {
            const placeholders = triples.map(() => "(?, ?, ?)").join(", ");
            const values: (number | null)[] = [];
            for (const t of triples) {
                values.push(t.cur, t.next, t.prev);
            }
            await mysql.query(
                `INSERT INTO next_talk (TalkID, NextTalkID, PrevTalkID) VALUES ${placeholders}`,
                values
            );
        }

        await mysql.commit();
    } catch (err) {
        await mysql.rollback();
        throw err;
    }

    return triples.length;
}

// Step 2: copy next_chapter + next_talk from MySQL to SQLite.
export async function buildNextPrev(
    mysql: Connection,
    core: CoreDb
): Promise<{ nextChapters: number; nextTalks: number; refreshedTalkIds: number }> {
    const refreshedTalkIds = await refreshNextTalkIds(mysql);

    const db = core.db;

    db.exec("DROP TABLE IF EXISTS next_chapter");
    db.exec(
        "CREATE TABLE next_chapter (" +
        "BookChapter int primary key, NextBookChapter int, PrevBookChapter int)"
    );
    const insertNextChapter = db.prepare(
        "INSERT INTO next_chapter VALUES (?, ?, ?)"
    );

    db.exec("DROP TABLE IF EXISTS next_talk");
    db.exec(
        "CREATE TABLE next_talk (" +
        "TalkID int primary key, NextTalkID int, PrevTalkID int)"
    );
    const insertNextTalk = db.prepare(
        "INSERT INTO next_talk VALUES (?, ?, ?)"
    );

    const [nextChapters] = await mysql.execute<NextChapterRow[]>(
        "SELECT BookChapter, NextBookChapter, PrevBookChapter " +
        "FROM next_chapter ORDER BY BookChapter"
    );
    const [nextTalks] = await mysql.execute<NextTalkRow[]>(
        "SELECT TalkID, NextTalkID, PrevTalkID FROM next_talk ORDER BY TalkID"
    );

    core.transaction(() => {
        for (const r of nextChapters) {
            insertNextChapter.run(
                r.BookChapter, r.NextBookChapter ?? null, r.PrevBookChapter ?? null
            );
        }
        for (const r of nextTalks) {
            insertNextTalk.run(
                r.TalkID, r.NextTalkID ?? null, r.PrevTalkID ?? null
            );
        }
    });

    return {
        nextChapters: nextChapters.length,
        nextTalks: nextTalks.length,
        refreshedTalkIds
    };
}
