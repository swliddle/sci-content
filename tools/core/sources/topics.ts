// Ports core/PUBLISH_JDTOPICS.php. Writes three SQLite tables (jdalso,
// jdcite, jdtopic). All three source tables are shared across EN/ES.
//
// The PHP creates the tables in order jdalso → jdcite → jdtopic but fills
// them in order jdtopic → jdcite → jdalso. We preserve that order for
// parity with the pre-existing SQLite file layout.

import type { Connection, RowDataPacket } from "mysql2/promise";
import type { CoreDb } from "../../lib/core-sqlite.js";

interface JdTopicRow extends RowDataPacket {
    ID: number;
    ParentID: number | null;
    TopicText: string | null;
    TargetID: number | null;
    TargetType: string | null;
}

interface JdCiteRow extends RowDataPacket {
    ID: number;
    JdtopicID: number | null;
    SpeakerID: number | null;
    Pages: string | null;
    Targetvolume: number | null;
    TargetPage: number | null;
    TargetDiscourse: number | null;
}

interface JdAlsoRow extends RowDataPacket {
    ID: number;
    AlsoText: string | null;
    JdtopicID: number | null;
    TargetJdtopicID: number | null;
}

export async function buildTopics(
    mysql: Connection,
    core: CoreDb
): Promise<{ jdTopics: number; jdCites: number; jdAlsos: number }> {
    const db = core.db;

    db.exec("DROP TABLE IF EXISTS jdalso");
    db.exec(
        "CREATE TABLE jdalso (" +
        "ID int primary key, AlsoText text, JdtopicID int, TargetJdtopicID int)"
    );

    db.exec("DROP TABLE IF EXISTS jdcite");
    db.exec(
        "CREATE TABLE jdcite (" +
        "ID int primary key, JdtopicID int, SpeakerID int, Pages text, " +
        "TargetVolume int, TargetPage int, TargetDiscourse int)"
    );

    db.exec("DROP TABLE IF EXISTS jdtopic");
    db.exec(
        "CREATE TABLE jdtopic (" +
        "ID int primary key, ParentID int, TopicText text, " +
        "TargetID int, TargetType text)"
    );

    const insertJdTopic = db.prepare(
        "INSERT INTO jdtopic VALUES (?, ?, ?, ?, ?)"
    );
    const insertJdCite = db.prepare(
        "INSERT INTO jdcite VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertJdAlso = db.prepare(
        "INSERT INTO jdalso VALUES (?, ?, ?, ?)"
    );

    const [jdTopics] = await mysql.execute<JdTopicRow[]>(
        "SELECT ID, ParentID, TopicText, TargetID, TargetType FROM jdtopic"
    );
    const [jdCites] = await mysql.execute<JdCiteRow[]>(
        "SELECT ID, JdtopicID, SpeakerID, Pages, Targetvolume, TargetPage, " +
        "TargetDiscourse FROM jdcite"
    );
    const [jdAlsos] = await mysql.execute<JdAlsoRow[]>(
        "SELECT ID, AlsoText, JdtopicID, TargetJdtopicID FROM jdalso"
    );

    core.transaction(() => {
        for (const r of jdTopics) {
            insertJdTopic.run(
                r.ID, r.ParentID ?? null, r.TopicText ?? null,
                r.TargetID ?? null, r.TargetType ?? null
            );
        }
        for (const r of jdCites) {
            insertJdCite.run(
                r.ID, r.JdtopicID ?? null, r.SpeakerID ?? null,
                r.Pages ?? null, r.Targetvolume ?? null,
                r.TargetPage ?? null, r.TargetDiscourse ?? null
            );
        }
        for (const r of jdAlsos) {
            insertJdAlso.run(
                r.ID, r.AlsoText ?? null,
                r.JdtopicID ?? null, r.TargetJdtopicID ?? null
            );
        }
    });

    db.exec("CREATE INDEX topicIdIx  ON jdalso  (JdtopicID)");
    db.exec("CREATE INDEX topicIdIx2 ON jdcite  (JdtopicID)");
    db.exec("CREATE INDEX volPageIx  ON jdcite  (TargetVolume, TargetPage)");
    db.exec("CREATE INDEX parentIx   ON jdtopic (ParentID)");

    return {
        jdTopics: jdTopics.length,
        jdCites: jdCites.length,
        jdAlsos: jdAlsos.length
    };
}
