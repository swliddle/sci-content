// The four content sources that populate the mobile SQLite `talkbody`
// table. Ports mobile/PUBLISH.php (§1 pre-1971 conference, §2 JoD, §3
// STPJS) and mobile/PUBLISH2.php (Ensign 2000–9999). PUBLISH_ES /
// PUBLISH2_ES are the same queries with `_es` table suffixes — handled
// by the LangTables passed in.

import type { Connection, RowDataPacket } from "mysql2/promise";
import { encodeRow } from "../lib/mobile-encode.js";
import {
    wrapMobileHtml,
    SCAFFOLD_CONFERENCE_PRE1971,
    SCAFFOLD_JOD,
    SCAFFOLD_STPJS,
    SCAFFOLD_ENSIGN
} from "../lib/mobile-html-wrap.js";
import type { MobileDb } from "../lib/mobile-sqlite.js";
import type { LangTables } from "./config.js";

export interface BuildContext {
    db: Connection;
    mobile: MobileDb;
    tables: LangTables;
    compress: boolean;
}

// Row shapes — declared as RowDataPacket so mysql2's typing picks them up.
interface TalkWithMetaRow extends RowDataPacket {
    GivenNames: string;
    LastNames: string;
    Title: string;
    TalkYear: number | null;
    Annual: string | null;
    StartPageNum: string | number | null;
    ID: number;
    ProcessedText: string;
}

interface JodRow extends RowDataPacket {
    GivenNames: string;
    LastNames: string;
    Title: string;
    StartPageNum: string | number | null;
    ID: number;
    ProcessedText: string;
}

interface StpjsRow extends RowDataPacket {
    Page: string | number;
    TalkID: number;
    ProcessedText: string;
}

// Matches PUBLISH.php §1: Annual normalized to 'A' or 'O'.
function formatConferenceTitle(r: TalkWithMetaRow, normalizeAnnual: boolean): string {
    const annual = normalizeAnnual
        ? (r.Annual === "A" ? "A" : "O")
        : (r.Annual ?? "");
    return `${r.TalkYear ?? ""}&ndash;${annual}:${r.StartPageNum ?? ""}, ${r.GivenNames} ${r.LastNames}, ${r.Title}`;
}

// §1: Conference talks pre-1971 (the gc-era range — talks with Year < 1971).
export async function buildPre1971(ctx: BuildContext): Promise<number> {
    const { db, mobile, tables, compress } = ctx;
    const sql =
        `SELECT GivenNames, LastNames, Title, YEAR(t.Date) AS TalkYear, Annual, StartPageNum, t.ID, b.ProcessedText ` +
        `FROM ${tables.talk} t ` +
        `JOIN ${tables.talkbody} b ON t.id=b.TalkId ` +
        `JOIN ${tables.speaker} s ON s.id=t.SpeakerId ` +
        `JOIN ${tables.conferenceTalk} ct ON t.ID=ct.TalkID ` +
        `JOIN ${tables.confSession} cs ON ct.SessionID=cs.ID ` +
        `JOIN ${tables.conference} c ON cs.ConferenceID=c.ID ` +
        `WHERE c.Year < 1971 ORDER BY t.id`;
    const [rows] = await db.execute<TalkWithMetaRow[]>(sql);

    return mobile.insertMany((function* () {
        for (const r of rows) {
            const title = formatConferenceTitle(r, true);
            const html = wrapMobileHtml(r.ProcessedText, {
                ...SCAFFOLD_CONFERENCE_PRE1971,
                title
            });
            yield { talkId: r.ID, hex: encodeRow(html, { compress }) };
        }
    })());
}

// §2: Journal of Discourses. TalkID carries the volume: vol = id / 10000.
export async function buildJod(ctx: BuildContext): Promise<number> {
    const { db, mobile, tables, compress } = ctx;
    const sql =
        `SELECT GivenNames, LastNames, Title, StartPageNum, t.ID, b.ProcessedText ` +
        `FROM ${tables.talk} t ` +
        `JOIN ${tables.talkbody} b ON t.id=b.TalkId ` +
        `JOIN ${tables.speaker} s ON s.id=t.SpeakerId ` +
        `JOIN ${tables.jodDiscourse} j ON t.ID=j.TalkID ` +
        `ORDER BY t.id`;
    const [rows] = await db.execute<JodRow[]>(sql);

    return mobile.insertMany((function* () {
        for (const r of rows) {
            const vol = Math.floor(r.ID / 10000);
            const title = `JD ${vol}:${r.StartPageNum ?? ""}, ${r.GivenNames} ${r.LastNames}, ${r.Title}`;
            const html = wrapMobileHtml(r.ProcessedText, { ...SCAFFOLD_JOD, title });
            yield { talkId: r.ID, hex: encodeRow(html, { compress }) };
        }
    })());
}

// §3: Teachings of the Prophet Joseph Smith — one row per page.
export async function buildStpjs(ctx: BuildContext): Promise<number> {
    const { db, mobile, tables, compress } = ctx;
    const sql =
        `SELECT Page, t.TalkID, t.ProcessedText ` +
        `FROM ${tables.talkbody} t ` +
        `JOIN ${tables.stpjsPage} s ON t.TalkID=s.TalkID ` +
        `ORDER BY t.TalkID`;
    const [rows] = await db.execute<StpjsRow[]>(sql);

    return mobile.insertMany((function* () {
        for (const r of rows) {
            const title = `Teachings of the Prophet Joseph Smith, p. ${r.Page}`;
            const html = wrapMobileHtml(r.ProcessedText, { ...SCAFFOLD_STPJS, title });
            yield { talkId: r.TalkID, hex: encodeRow(html, { compress }) };
        }
    })());
}

// §4: Ensign conference talks (TalkID 2000..9999). PUBLISH2.php used an
// N+1 query pattern (outer SELECT TalkID, then per-id ProcessedText + per-id
// conference join). We collapse that into a single INNER JOIN. If any
// Ensign talk lacks conference metadata it would be dropped here whereas
// the PHP version would emit it with a stale title from the prior
// iteration — we prefer the cleaner behavior; parity testing will flag
// any real divergence.
//
// Another difference from §1: Annual is NOT normalized to A/O in
// PUBLISH2.php, so we pass normalizeAnnual=false here.
export async function buildEnsign(ctx: BuildContext): Promise<number> {
    const { db, mobile, tables, compress } = ctx;
    const sql =
        `SELECT GivenNames, LastNames, Title, YEAR(t.Date) AS TalkYear, Annual, StartPageNum, t.ID, b.ProcessedText ` +
        `FROM ${tables.talk} t ` +
        `JOIN ${tables.talkbody} b ON t.id=b.TalkId ` +
        `JOIN ${tables.speaker} s ON s.id=t.SpeakerId ` +
        `JOIN ${tables.conferenceTalk} ct ON t.ID=ct.TalkID ` +
        `JOIN ${tables.confSession} cs ON ct.SessionID=cs.ID ` +
        `JOIN ${tables.conference} c ON cs.ConferenceID=c.ID ` +
        `WHERE b.TalkID >= 2000 AND b.TalkID < 10000 ORDER BY t.id`;
    const [rows] = await db.execute<TalkWithMetaRow[]>(sql);

    return mobile.insertMany((function* () {
        for (const r of rows) {
            const title = formatConferenceTitle(r, false);
            const html = wrapMobileHtml(r.ProcessedText, { ...SCAFFOLD_ENSIGN, title });
            yield { talkId: r.ID, hex: encodeRow(html, { compress }) };
        }
    })());
}
