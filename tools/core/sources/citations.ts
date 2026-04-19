// Ports core/PUBLISH_CITE.php. Writes three SQLite tables (citation,
// citation_verse, speaker) from the shared MySQL source tables. None of
// these are lang-suffixed — the same citation data applies to both EN and
// ES core DBs.
//
// citation has four columns computed in PHP (not present as DB columns):
//   MinVerse, MaxVerse  — derived from splitting the Verses string on
//                         `-`, `,`, or whitespace and taking min/max.
//                         PHP initialized minVerse=200, maxVerse=0;
//                         empty Verses → (200, 0), which is the existing
//                         deployed behavior.
//   Page, ColumnAB      — PageColumn trailing `a` or `b` is split off as
//                         ColumnAB; otherwise ColumnAB=''. Note: PHP uses
//                         weak typing so `null`/`0` PageColumn → empty.
//   Volume              — floor(TalkID / 10000) when 10000 <= TalkID <
//                         270000, else empty string. Matches PHP's
//                         intval() + $volume='' default.

import type { Connection, RowDataPacket } from "mysql2/promise";
import type { CoreDb } from "../../lib/core-sqlite.js";

interface CitationRow extends RowDataPacket {
    ID: number;
    TalkID: number | null;
    BookID: number | null;
    Chapter: number | null;
    Verses: string | null;
    Flag: string | null;
    PageColumn: string | null;
}

interface CitationVerseRow extends RowDataPacket {
    CitationID: number;
    Verse: number;
}

interface SpeakerRow extends RowDataPacket {
    ID: number;
    GivenNames: string | null;
    LastNames: string | null;
    Abbr: string | null;
    Info: string | null;
    NameSort: string | null;
}

// Mirrors PHP's loose int conversion + min/max initialization. Empty
// verses → (200, 0) preserved so row-level parity with the old deploy
// holds.
function computeVerseRange(verses: string | null): { min: number; max: number } {
    let min = 200;
    let max = 0;

    if (!verses) {
        return { min, max };
    }

    for (const token of verses.split(/[-,\s]/)) {
        const n = parseInt(token, 10);

        if (Number.isNaN(n)) {
            continue;
        }

        if (n < min) min = n;
        if (n > max) max = n;
    }

    return { min, max };
}

function splitPageColumn(pc: string | null): { page: string; columnAB: string } {
    if (!pc) {
        return { page: "", columnAB: "" };
    }

    const last = pc.slice(-1);

    if (last === "a" || last === "b") {
        return { page: pc.slice(0, -1), columnAB: last };
    }

    return { page: pc, columnAB: "" };
}

function computeVolume(talkId: number | null): string {
    if (talkId === null || talkId < 10000 || talkId >= 270000) {
        return "";
    }

    return String(Math.floor(talkId / 10000));
}

export async function buildCitations(
    mysql: Connection,
    core: CoreDb
): Promise<{ citations: number; citationVerses: number; speakers: number }> {
    const db = core.db;

    db.exec("DROP TABLE IF EXISTS citation");
    db.exec(
        "CREATE TABLE citation (" +
        "ID int primary key, TalkID int, BookID int, Chapter int, " +
        "Verses text, Flag text, MinVerse int, MaxVerse int, " +
        "Page int, Volume int, ColumnAB text)"
    );
    const insertCitation = db.prepare(
        "INSERT INTO citation VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    db.exec("DROP TABLE IF EXISTS citation_verse");
    db.exec(
        "CREATE TABLE citation_verse (CitationID int, Verse int)"
    );
    const insertCitationVerse = db.prepare(
        "INSERT INTO citation_verse VALUES (?, ?)"
    );

    db.exec("DROP TABLE IF EXISTS speaker");
    db.exec(
        "CREATE TABLE speaker (" +
        "ID int, GivenNames text, LastNames text, " +
        "Abbr text, Info text, NameSort text)"
    );
    const insertSpeaker = db.prepare(
        "INSERT INTO speaker VALUES (?, ?, ?, ?, ?, ?)"
    );

    const [citations] = await mysql.execute<CitationRow[]>(
        "SELECT ID, TalkID, BookID, Chapter, Verses, Flag, PageColumn FROM citation"
    );
    const [citationVerses] = await mysql.execute<CitationVerseRow[]>(
        "SELECT CitationID, Verse FROM citation_verse"
    );
    const [speakers] = await mysql.execute<SpeakerRow[]>(
        "SELECT ID, GivenNames, LastNames, Abbr, Info, NameSort " +
        "FROM speaker ORDER BY NameSort"
    );

    core.transaction(() => {
        for (const r of citations) {
            const { min, max } = computeVerseRange(r.Verses);
            const { page, columnAB } = splitPageColumn(r.PageColumn);
            const volume = computeVolume(r.TalkID);

            insertCitation.run(
                r.ID,
                r.TalkID,
                r.BookID,
                r.Chapter,
                r.Verses ?? null,
                r.Flag ?? null,
                min,
                max,
                page === "" ? null : page,
                volume === "" ? null : volume,
                columnAB === "" ? null : columnAB
            );
        }

        for (const r of citationVerses) {
            insertCitationVerse.run(r.CitationID, r.Verse);
        }

        for (const r of speakers) {
            insertSpeaker.run(
                r.ID,
                r.GivenNames ?? null,
                r.LastNames ?? null,
                r.Abbr ?? null,
                r.Info ?? null,
                r.NameSort ?? null
            );
        }
    });

    db.exec("CREATE INDEX reference_ix ON citation (BookID, Chapter)");
    db.exec("CREATE INDEX bookid_ix    ON citation (BookID)");
    db.exec("CREATE INDEX cchapter_ix  ON citation (Chapter)");
    db.exec("CREATE INDEX talkid_ix    ON citation (TalkID)");
    db.exec("CREATE INDEX citation_verse_ix ON citation_verse (CitationID, Verse)");
    db.exec("CREATE INDEX lastnames  ON speaker (LastNames)");
    db.exec("CREATE INDEX givennames ON speaker (LastNames, GivenNames)");
    db.exec("CREATE INDEX abbr       ON speaker (Abbr)");

    return {
        citations: citations.length,
        citationVerses: citationVerses.length,
        speakers: speakers.length
    };
}
