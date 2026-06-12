// Ports core/PUBLISH_SCRIP.php and PUBLISH_SCRIP_ES.php into one
// lang-parameterized builder. Writes two SQLite tables (book, scripture).
//
// The PHP version encodes scripture.Text as `X'<bin2hex>'` — a BLOB from
// a hex literal. Here we bind a Buffer directly; better-sqlite3 stores it
// as a BLOB with identical bytes.
//
// The book query is two SELECTs UNIONed together. The top branch counts
// citations across child books (books with a ParentBookID matching this
// book) and applies to parent books. The bottom branch counts direct
// citations and applies to child/leaf books. CitationCount ends up being
// the total for a parent, and the leaf's own count for a leaf. We preserve
// the exact UNION structure — the row ordering differs subtly across MySQL
// versions but SQLite's primary-key index makes ordering irrelevant for
// correctness.

import type { Connection, RowDataPacket } from "mysql2/promise";
import type { CoreDb } from "../../lib/core-sqlite.js";
import type { Lang, LangTables } from "../config.js";

interface BookRow extends RowDataPacket {
    ID: number;
    Abbr: string | null;
    CiteAbbr: string | null;
    FullName: string | null;
    NumChapters: number | null;
    URLPath: string | null;
    ParentBookID: number | null;
    WebTitle: string | null;
    JSTTitle: string | null;
    TOCName: string | null;
    Subdiv: string | null;
    BackName: string | null;
    GridName: string | null;
    CiteFull: string | null;
    CitationCount: number;
}

interface ScriptureRow extends RowDataPacket {
    ID: number;
    BookID: number | null;
    Chapter: number | null;
    Verse: number | null;
    Flag: string | null;
    Text: Buffer | string | null;
}

const JST_NOTES: Record<Lang, string> = {
    en: '<div class="note">Note: the JST manuscript states that &ldquo;The Songs of Solomon are not inspired writings&rdquo;.</div>',
    es: '<div class="note">Nota: el manuscrito de la TJS declara que &ldquo;Los Cantares de Salomón no son escritos inspirados&rdquo;.</div>'
};

export async function buildScriptures(
    mysql: Connection,
    core: CoreDb,
    lang: Lang,
    tables: LangTables
): Promise<{ books: number; scriptures: number }> {
    const db = core.db;

    db.exec("DROP TABLE IF EXISTS book");
    db.exec(
        "CREATE TABLE book (" +
        "ID int primary key, Abbr text, CiteAbbr text, FullName text, " +
        "NumChapters int, URLPath text, ParentBookID int, WebTitle text, " +
        "JSTTitle text, TOCName text, Subdiv text, BackName text, " +
        "GridName text, CiteFull text, CitationCount int)"
    );
    const insertBook = db.prepare(
        "INSERT INTO book VALUES (" +
        "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    db.exec("DROP TABLE IF EXISTS scripture");
    db.exec(
        "CREATE TABLE scripture (" +
        "ID int primary key, BookID int, Chapter int, Verse int, " +
        'Flag text, "Text" text)'
    );
    const insertScripture = db.prepare(
        'INSERT INTO scripture (ID, BookID, Chapter, Verse, Flag, "Text") ' +
        "VALUES (?, ?, ?, ?, ?, ?)"
    );

    const bookSql =
        `SELECT b.ID, b.Abbr, b.CiteAbbr, b.FullName, b.NumChapters, b.URLPath, ` +
        `b.ParentBookID, b.WebTitle, b.JSTTitle, b.TOCName, b.Subdiv, ` +
        `b.BackName, b.GridName, b.CiteFull, COUNT(c.ID) AS CitationCount ` +
        `FROM ${tables.book} b ` +
        `JOIN ${tables.book} cb ON b.ID=cb.ParentBookID ` +
        `LEFT JOIN citation c ON cb.ID=c.BookID ` +
        `WHERE b.ParentBookID is null ` +
        `GROUP BY b.ID UNION ` +
        `SELECT b.ID, b.Abbr, b.CiteAbbr, b.FullName, b.NumChapters, b.URLPath, b.ParentBookID, ` +
        `b.WebTitle, b.JSTTitle, b.TOCName, b.Subdiv, b.BackName, b.GridName, b.CiteFull, ` +
        `COUNT(c.ID) AS CitationCount ` +
        `FROM ${tables.book} b LEFT JOIN citation c ON b.ID=c.BookID ` +
        `WHERE b.ParentBookID IS NOT NULL GROUP BY b.ID`;

    const [books] = await mysql.query<BookRow[]>(bookSql);

    const [scriptures] = await mysql.query<ScriptureRow[]>(
        `SELECT ID, BookID, Chapter, Verse, Flag, Text FROM ${tables.scripture}`
    );

    core.transaction(() => {
        for (const r of books) {
            insertBook.run(
                r.ID,
                r.Abbr ?? null,
                r.CiteAbbr ?? null,
                r.FullName ?? null,
                r.NumChapters ?? null,
                r.URLPath ?? null,
                r.ParentBookID ?? null,
                r.WebTitle ?? null,
                r.JSTTitle ?? null,
                r.TOCName ?? null,
                r.Subdiv ?? null,
                r.BackName ?? null,
                r.GridName ?? null,
                r.CiteFull ?? null,
                r.CitationCount
            );
        }

        db.exec("ALTER TABLE book ADD COLUMN JSTNote TEXT");
        db.prepare("UPDATE book SET JSTNote = ? WHERE Abbr = 'song'")
            .run(JST_NOTES[lang]);

        for (const r of scriptures) {
            // mysql2 returns TEXT/BLOB as Buffer by default; coerce string
            // to Buffer so SQLite stores identical bytes either way. Reject
            // anything else — a silent fallthrough used to crash inside
            // Buffer.from with a confusing message.
            let text: Buffer | null;
            if (r.Text === null) {
                text = null;
            } else if (Buffer.isBuffer(r.Text)) {
                text = r.Text;
            } else if (typeof r.Text === "string") {
                text = Buffer.from(r.Text, "utf8");
            } else {
                throw new Error(
                    `scripture ${r.ID}: unexpected Text type ${typeof r.Text}`
                );
            }

            insertScripture.run(
                r.ID,
                r.BookID ?? null,
                r.Chapter ?? null,
                r.Verse ?? null,
                r.Flag ?? null,
                text
            );
        }
    });

    db.exec("CREATE UNIQUE INDEX abbr_ix   ON book (Abbr)");
    db.exec("CREATE INDEX parent_ix        ON book (ParentBookID)");
    db.exec("CREATE INDEX uniqref_ix       ON scripture (ID, BookID, Chapter, Verse, Flag)");
    db.exec("CREATE INDEX chapter_ix       ON scripture (BookID, Chapter, Flag)");
    db.exec("CREATE INDEX verse_ix         ON scripture (Verse)");

    return { books: books.length, scriptures: scriptures.length };
}
