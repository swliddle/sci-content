// SQLite helper for the mobile content DB. Replaces the PHP→sqlite3 text
// pipe with direct prepared-statement inserts inside a single transaction.
//
// The PHP version emits `INSERT INTO talkbody VALUES (id, X'...hex...')`,
// which sqlite3 parses as a BLOB from the hex literal. Here we pass a
// Buffer directly — better-sqlite3 binds Buffers as BLOBs, so the stored
// bytes are identical.
//
// Each content source writes into the same `talkbody` table. The table is
// dropped and recreated on first open; subsequent openers should pass
// fresh=false to append instead.

import Database from "better-sqlite3";

export interface MobileRow {
    talkId: number;
    hex: string; // encoded per tools/lib/mobile-encode.ts
}

export interface MobileDbOptions {
    // Drop and recreate `talkbody` on open. First caller passes true; later
    // callers (adding rows from another source to the same db) pass false.
    fresh?: boolean;
}

export class MobileDb {
    private readonly db: Database.Database;
    private readonly insertStmt: Database.Statement;

    constructor(path: string, options: MobileDbOptions = {}) {
        this.db = new Database(path);
        // We rewrite the whole file each build; durability is unnecessary.
        this.db.pragma("journal_mode = OFF");
        this.db.pragma("synchronous = OFF");

        if (options.fresh !== false) {
            this.db.exec("DROP TABLE IF EXISTS talkbody");
            this.db.exec('CREATE TABLE talkbody (TalkID INTEGER PRIMARY KEY, "Text" TEXT)');
        }

        this.insertStmt = this.db.prepare(
            'INSERT INTO talkbody (TalkID, "Text") VALUES (?, ?)'
        );
    }

    // Insert many rows in a single transaction. Accepts an iterable so
    // callers can stream rows from MySQL without materializing them all.
    insertMany(rows: Iterable<MobileRow>): number {
        let count = 0;
        const tx = this.db.transaction((it: Iterable<MobileRow>) => {
            for (const row of it) {
                this.insertStmt.run(row.talkId, Buffer.from(row.hex, "hex"));
                count++;
            }
        });
        tx(rows);
        return count;
    }

    // Run the sqlite3-CLI-style bootstrap that timestamp.sql used to do:
    // drop/create android_metadata and updated, insert current timestamp.
    applyTimestamp(locale: string = "en_US"): void {
        this.db.exec("DROP TABLE IF EXISTS android_metadata");
        this.db.exec("CREATE TABLE android_metadata (locale text)");
        this.db.prepare("INSERT INTO android_metadata VALUES (?)").run(locale);

        this.db.exec("DROP TABLE IF EXISTS updated");
        this.db.exec("CREATE TABLE updated (last_updated text)");
        this.db.exec("INSERT INTO updated VALUES (datetime())");
    }

    close(): void {
        this.db.close();
    }
}
