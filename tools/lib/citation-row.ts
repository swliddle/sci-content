import type * as mysql from "mysql2/promise";

// Columns selected by every citation-pipeline query (citations.ts,
// ensign-citations.ts, jod add-citations / publish-discourse). Each pipeline
// declares its own row interface that extends this base with whatever extra
// columns its SELECT pulls in (e.g. b.Abbr, c.BookID, m.Paragraph/Word).
//
// Nullability rationale:
//   - CiteAbbr: from b.CiteAbbr via LEFT JOIN, so structurally nullable.
//   - Chapter / Verses / Flag: nullable in the citation schema itself.
//   - PageColumn: NOT NULL in citation, so non-null here.
export interface BaseCitationRow extends mysql.RowDataPacket {
    ID: number;
    CiteAbbr: string | null;
    Chapter: number | null;
    Verses: string | null;
    Flag: string | null;
    PageColumn: string;
}
