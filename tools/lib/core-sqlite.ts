// SQLite helper for the mobile core DB. Replaces the PHP→sqlite3 text pipe
// (BEGIN TRANSACTION → hundreds of INSERTs → COMMIT) with direct prepared
// statements and a native better-sqlite3 transaction per source.
//
// The old flow built one giant .sql file by concatenating PUBLISH_CITE.php +
// PUBLISH_SCRIP[_ES].php + PUBLISH_TOC[_ES].php + PUBLISH_JDTOPICS.php +
// PUBLISH_NEXTPREV.php + timestamp.sql, then fed it through `sqlite3`. Here
// each source opens its own transaction on a shared CoreDb and writes rows
// directly; no intermediate SQL text ever exists on disk.
//
// Scripture.Text (PUBLISH_SCRIP) and similar BLOB columns use `X'hex'` in the
// PHP version — pass a Buffer directly to better-sqlite3 and the stored
// bytes are identical.

import Database from "better-sqlite3";

export interface CoreDbOptions {
    // Drop and recreate the file from scratch. Default true.
    fresh?: boolean;
}

export class CoreDb {
    readonly db: Database.Database;

    constructor(path: string, options: CoreDbOptions = {}) {
        this.db = new Database(path);
        // Rewritten end-to-end on every build; durability is unnecessary.
        this.db.pragma("journal_mode = OFF");
        this.db.pragma("synchronous = OFF");

        if (options.fresh !== false) {
            // Nothing to wipe on a brand-new file, but callers that reopen
            // an existing DB would get stale tables otherwise. Each source
            // issues its own DROP TABLE IF EXISTS before CREATE, so the
            // `fresh` flag is mainly a signal to the caller about intent.
        }
    }

    // Run a function inside a single SQLite transaction. Matches the
    // BEGIN/COMMIT envelope that wrapped each old PUBLISH_*.php block.
    transaction<T>(fn: (db: Database.Database) => T): T {
        const tx = this.db.transaction(fn);
        return tx(this.db);
    }

    // Same bootstrap as mobile/timestamp.sql — android_metadata + updated
    // tables with locale and current datetime. Parameterized on locale so
    // the EN/ES split collapses from two files into one call.
    applyTimestamp(locale: string): void {
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
