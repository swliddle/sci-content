// Ports core/PUBLISH_TOC.php and PUBLISH_TOC_ES.php into one
// lang-parameterized builder. Writes seven SQLite tables (conference,
// conf_session, talk, jod_discourse, stpjs_page, stpjs_section,
// conference_talk).
//
// Three source-side tables vary by lang: conference[_es], conf_session[_es],
// talk[_es]. The other source tables (jod_discourse, stpjs_page,
// conference_talk) are shared across both builds. stpjs_section is static
// per language.
//
// talk is LEFT JOINed to talk_stream for the optional Audio/Video URL
// columns. talk_stream is shared across langs.

import type { Connection, RowDataPacket } from "mysql2/promise";
import type { CoreDb } from "../../lib/core-sqlite.js";
import type { Lang, LangTables } from "../config.js";

interface ConferenceRow extends RowDataPacket {
    ID: number;
    Description: string | null;
    Abbr: string | null;
    Year: number | null;
    Annual: string | null;
    IssueDate: string | null;
}

interface ConfSessionRow extends RowDataPacket {
    ID: number;
    Description: string | null;
    Abbr: string | null;
    Date: string | null;
    Sequence: number | null;
    ConferenceID: number | null;
}

interface TalkRow extends RowDataPacket {
    ID: number;
    Corpus: string | null;
    URL: string | null;
    Title: string | null;
    Date: string | null;
    SpeakerID: number | null;
    AudioUrl: string | null;
    VideoLowUrl: string | null;
    VideoMedUrl: string | null;
    VideoHighUrl: string | null;
}

interface JodDiscourseRow extends RowDataPacket {
    TalkID: number;
    Volume: number | null;
    Discourse: number | null;
    StartPageNum: number | null;
    EndPageNum: number | null;
    PageHeader: string | null;
    TitleSort: string | null;
}

interface StpjsPageRow extends RowDataPacket {
    TalkID: number;
    Page: number | null;
}

interface StpjsSectionRow {
    ID: number;
    Title: string;
    StartYear: number | null;
    EndYear: number | null;
    StartPageNum: number;
    EndPageNum: number;
}

interface ConferenceTalkRow extends RowDataPacket {
    TalkID: number;
    SessionID: number | null;
    StartPageNum: number | null;
    EndPageNum: number | null;
    Sequence: number | null;
}

const STPJS_SECTIONS: Record<Lang, StpjsSectionRow[]> = {
    en: [
        {
            ID: 1,
            Title: "Title and Introduction",
            StartYear: null,
            EndYear: null,
            StartPageNum: 1,
            EndPageNum: 4
        },
        {
            ID: 2,
            Title: "Section One: 1830-1834",
            StartYear: 1830,
            EndYear: 1834,
            StartPageNum: 7,
            EndPageNum: 43
        },
        {
            ID: 3,
            Title: "Section Two: 1834-1837",
            StartYear: 1834,
            EndYear: 1837,
            StartPageNum: 47,
            EndPageNum: 113
        },
        {
            ID: 4,
            Title: "Section Three: 1838-1839",
            StartYear: 1838,
            EndYear: 1839,
            StartPageNum: 117,
            EndPageNum: 151
        },
        {
            ID: 5,
            Title: "Section Four: 1839-1842",
            StartYear: 1839,
            EndYear: 1842,
            StartPageNum: 155,
            EndPageNum: 233
        },
        {
            ID: 6,
            Title: "Section Five: 1842-1843",
            StartYear: 1842,
            EndYear: 1843,
            StartPageNum: 237,
            EndPageNum: 281
        },
        {
            ID: 7,
            Title: "Section Six: 1843-1844",
            StartYear: 1843,
            EndYear: 1844,
            StartPageNum: 285,
            EndPageNum: 395
        }
    ],
    es: [
        {
            ID: 1,
            Title: "Título e Introducción",
            StartYear: null,
            EndYear: null,
            StartPageNum: 1,
            EndPageNum: 4
        },
        {
            ID: 2,
            Title: "Sección Uno: 1830-1834",
            StartYear: 1830,
            EndYear: 1834,
            StartPageNum: 7,
            EndPageNum: 43
        },
        {
            ID: 3,
            Title: "Sección Dos: 1834-1837",
            StartYear: 1834,
            EndYear: 1837,
            StartPageNum: 47,
            EndPageNum: 113
        },
        {
            ID: 4,
            Title: "Sección Tres: 1838-1839",
            StartYear: 1838,
            EndYear: 1839,
            StartPageNum: 117,
            EndPageNum: 151
        },
        {
            ID: 5,
            Title: "Sección Cuatro: 1839-1842",
            StartYear: 1839,
            EndYear: 1842,
            StartPageNum: 155,
            EndPageNum: 233
        },
        {
            ID: 6,
            Title: "Sección Cinco: 1842-1843",
            StartYear: 1842,
            EndYear: 1843,
            StartPageNum: 237,
            EndPageNum: 281
        },
        {
            ID: 7,
            Title: "Sección Seis: 1843-1844",
            StartYear: 1843,
            EndYear: 1844,
            StartPageNum: 285,
            EndPageNum: 395
        }
    ]
};

export async function buildToc(
    mysql: Connection,
    core: CoreDb,
    lang: Lang,
    tables: LangTables
): Promise<{
    conferences: number;
    confSessions: number;
    talks: number;
    jodDiscourses: number;
    stpjsPages: number;
    stpjsSections: number;
    conferenceTalks: number;
}> {
    const db = core.db;
    const stpjsSections = STPJS_SECTIONS[lang];

    db.exec("DROP TABLE IF EXISTS conference");
    db.exec(
        "CREATE TABLE conference (" +
            "ID int primary key, Description text, Abbr text, " +
            "Year int, Annual text, IssueDate text)"
    );
    const insertConference = db.prepare("INSERT INTO conference VALUES (?, ?, ?, ?, ?, ?)");

    db.exec("DROP TABLE IF EXISTS conf_session");
    db.exec(
        "CREATE TABLE conf_session (" +
            "ID int primary key, Description text, Abbr text, " +
            "Date text, Sequence int, ConferenceID int)"
    );
    const insertConfSession = db.prepare("INSERT INTO conf_session VALUES (?, ?, ?, ?, ?, ?)");

    db.exec("DROP TABLE IF EXISTS talk");
    db.exec(
        "CREATE TABLE talk (" +
            "ID int primary key, Corpus text, URL text, Title text, Date text, " +
            "SpeakerID int, AudioUrl text, VideoLowUrl text, " +
            "VideoMedUrl text, VideoHighUrl text)"
    );
    const insertTalk = db.prepare("INSERT INTO talk VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    db.exec("DROP TABLE IF EXISTS jod_discourse");
    db.exec(
        "CREATE TABLE jod_discourse (" +
            "TalkID int primary key, Volume int, Discourse int, " +
            "StartPageNum int, EndPageNum int, PageHeader text, TitleSort text)"
    );
    const insertJod = db.prepare("INSERT INTO jod_discourse VALUES (?, ?, ?, ?, ?, ?, ?)");

    db.exec("DROP TABLE IF EXISTS stpjs_page");
    db.exec("CREATE TABLE stpjs_page (TalkID int primary key, Page int)");
    const insertStpjs = db.prepare("INSERT INTO stpjs_page VALUES (?, ?)");

    db.exec("DROP TABLE IF EXISTS stpjs_section");
    db.exec(
        "CREATE TABLE stpjs_section (" +
            "ID INTEGER PRIMARY KEY, " +
            "Title TEXT NOT NULL, " +
            "StartYear INTEGER, " +
            "EndYear INTEGER, " +
            "StartPageNum INTEGER NOT NULL, " +
            "EndPageNum INTEGER NOT NULL)"
    );
    const insertStpjsSection = db.prepare("INSERT INTO stpjs_section VALUES (?, ?, ?, ?, ?, ?)");

    db.exec("DROP TABLE IF EXISTS conference_talk");
    db.exec(
        "CREATE TABLE conference_talk (" +
            "TalkID int primary key, SessionID int, StartPageNum int, " +
            "EndPageNum int, Sequence int)"
    );
    const insertConferenceTalk = db.prepare("INSERT INTO conference_talk VALUES (?, ?, ?, ?, ?)");

    const [conferences] = await mysql.execute<ConferenceRow[]>(
        `SELECT ID, Description, Abbr, Year, Annual, IssueDate FROM ${tables.conference}`
    );
    const [confSessions] = await mysql.execute<ConfSessionRow[]>(
        `SELECT ID, Description, Abbr, Date, Sequence, ConferenceID FROM ${tables.confSession}`
    );
    const [talks] = await mysql.execute<TalkRow[]>(
        `SELECT ID, Corpus, URL, Title, Date, SpeakerID, AudioUrl, ` +
            `VideoLowUrl, VideoMedUrl, VideoHighUrl FROM ${tables.talk} t ` +
            `LEFT JOIN talk_stream s ON (t.ID=s.TalkID)`
    );
    const [jodDiscourses] = await mysql.execute<JodDiscourseRow[]>(
        "SELECT TalkID, Volume, Discourse, StartPageNum, EndPageNum, " +
            "PageHeader, TitleSort FROM jod_discourse"
    );
    const [stpjsPages] = await mysql.execute<StpjsPageRow[]>("SELECT TalkID, Page FROM stpjs_page");
    const [conferenceTalks] = await mysql.execute<ConferenceTalkRow[]>(
        "SELECT TalkID, SessionID, StartPageNum, EndPageNum, Sequence " + "FROM conference_talk"
    );

    core.transaction(() => {
        for (const r of conferences) {
            insertConference.run(
                r.ID,
                r.Description ?? null,
                r.Abbr ?? null,
                r.Year ?? null,
                r.Annual ?? null,
                r.IssueDate ?? null
            );
        }
        db.exec("ALTER TABLE conference ADD COLUMN Publication TEXT");
        db.exec(
            "UPDATE conference SET Publication = CASE " +
                "WHEN Year < 1971 THEN 'Conference Report' " +
                "WHEN Year <= 2020 THEN 'Ensign' " +
                "ELSE 'Liahona' END"
        );

        for (const r of confSessions) {
            insertConfSession.run(
                r.ID,
                r.Description ?? null,
                r.Abbr ?? null,
                r.Date ?? null,
                r.Sequence ?? null,
                r.ConferenceID ?? null
            );
        }
        for (const r of talks) {
            insertTalk.run(
                r.ID,
                r.Corpus ?? null,
                r.URL ?? null,
                r.Title ?? null,
                r.Date ?? null,
                r.SpeakerID ?? null,
                r.AudioUrl ?? null,
                r.VideoLowUrl ?? null,
                r.VideoMedUrl ?? null,
                r.VideoHighUrl ?? null
            );
        }
        for (const r of jodDiscourses) {
            insertJod.run(
                r.TalkID,
                r.Volume ?? null,
                r.Discourse ?? null,
                r.StartPageNum ?? null,
                r.EndPageNum ?? null,
                r.PageHeader ?? null,
                r.TitleSort ?? null
            );
        }
        for (const r of stpjsPages) {
            insertStpjs.run(r.TalkID, r.Page ?? null);
        }
        for (const r of stpjsSections) {
            insertStpjsSection.run(
                r.ID,
                r.Title,
                r.StartYear,
                r.EndYear,
                r.StartPageNum,
                r.EndPageNum
            );
        }
        for (const r of conferenceTalks) {
            insertConferenceTalk.run(
                r.TalkID,
                r.SessionID ?? null,
                r.StartPageNum ?? null,
                r.EndPageNum ?? null,
                r.Sequence ?? null
            );
        }
    });

    db.exec("CREATE UNIQUE INDEX sessionorder_ix ON conf_session (ConferenceID, Sequence)");
    db.exec("CREATE INDEX speakerid_ix           ON talk (SpeakerID)");
    db.exec("CREATE UNIQUE INDEX voldiscourse_ix ON jod_discourse (Volume, Discourse)");
    db.exec("CREATE INDEX titlesort_ix           ON jod_discourse (TitleSort)");
    db.exec("CREATE INDEX stpjspage_ix           ON stpjs_page (Page)");

    return {
        conferences: conferences.length,
        confSessions: confSessions.length,
        talks: talks.length,
        jodDiscourses: jodDiscourses.length,
        stpjsPages: stpjsPages.length,
        stpjsSections: stpjsSections.length,
        conferenceTalks: conferenceTalks.length
    };
}
