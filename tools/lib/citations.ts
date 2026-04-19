import * as fs from "fs";
import * as path from "path";
import * as mysql from "mysql2/promise";
import { createDb } from "./db.js";
import type { BaseCitationRow } from "./citation-row.js";
import type { LoadConfig } from "./loader.js";

const EN_DASH = "\u2013";

export interface CorpusLabels {
    J: string;
    E: string;
    H: string;
}

// Citation-output style. Two pipelines produce two flag combinations that
// never mix:
//   "gc-era": HTML-escape & and U+2014 in ref text (legacy PHP behavior).
//   "stpjs":  strip leading <?xml ... ?> and format verses ("1-2" → "1–2",
//             "," → ", ").
// Collapsed into one tag so corpus configs can't accidentally mix styles.
export type CitationStyle = "gc-era" | "stpjs";

// Single definition for a corpus that flows through the xml → html (via
// runAddCitations) → MySQL (via runLoad) pipeline. Both phases read
// overlapping fields; keeping them in one shape means each corpus config
// exports a single buildConfig() instead of parallel build/load configs.
export interface CorpusDefinition extends LoadConfig {
    // Identity
    name: string;

    // Citation-addition phase (consumed by runAddCitations)
    firstId: number;
    lastId: number;
    skipIds?: number[];
    xmlDir: string;
    bookTable: string;
    labels: CorpusLabels;
    anchorSuffix: string;
    style: CitationStyle;
}

export interface RunOptions {
    ids?: number[];
}

export interface CitationRow extends BaseCitationRow {
    Abbr: string | null;
}

export function defaultIds(config: CorpusDefinition): number[] {
    const skip = new Set(config.skipIds ?? []);
    const ids: number[] = [];

    for (let id = config.firstId; id <= config.lastId; id++) {
        if (!skip.has(id)) ids.push(id);
    }

    return ids;
}

export async function runAddCitations(
    config: CorpusDefinition,
    opts: RunOptions = {}
): Promise<void> {
    fs.mkdirSync(config.outDir, { recursive: true });

    const ids = opts.ids ?? defaultIds(config);
    const db = await createDb();

    try {
        for (const id of ids) {
            const inPath = path.join(config.xmlDir, `${config.fileStem}${id}.xml`);
            const outPath = path.join(config.outDir, `${config.fileStem}${id}.html`);

            if (!fs.existsSync(inPath)) {
                console.error(`missing: ${inPath}`);
                continue;
            }

            const talkId = config.talkIdOffset + id;
            let body = fs.readFileSync(inPath, "utf8");

            if (config.style === "stpjs") {
                body = body.replace(/^<\?xml[^>]*>\n?/, "");
            }

            body = await replaceCitations(db, config, talkId, body);
            fs.writeFileSync(outPath, body, "utf8");
        }
    } finally {
        await db.end();
    }
}

async function replaceCitations(
    db: mysql.Connection,
    config: CorpusDefinition,
    id: number,
    body: string
): Promise<string> {
    const [rows] = await db.execute<CitationRow[]>(
        `SELECT c.ID, b.CiteAbbr, c.Chapter, c.Verses, c.Flag, c.PageColumn, b.Abbr
           FROM citation c
           LEFT JOIN mark_cites m ON (c.ID = m.citationId)
           LEFT JOIN ${config.bookTable} b ON (c.BookID = b.ID)
          WHERE c.TalkID = ?
          ORDER BY page, c.PageColumn, b.ID, c.ID, sequence DESC`,
        [id]
    );

    return applyCitations(config, id, body, rows);
}

// Pure transform: citations-row array + HTML body → HTML body with each
// matched placeholder <a> swapped for the final <span class="citation">…</span>.
// Split out from replaceCitations so tests can feed fixture rows without a
// live MySQL connection.
export function applyCitations(
    config: CorpusDefinition,
    talkId: number,
    body: string,
    rows: CitationRow[]
): string {
    for (const cite of rows) {
        if (cite.Flag === "J" || cite.Flag === "F") {
            body = replaceJstCitation(config, talkId, body, cite);
        } else {
            body = replaceCitation(config, talkId, body, cite);
        }
    }

    return body;
}

function replaceJstCitation(
    config: CorpusDefinition,
    talkId: number,
    body: string,
    cite: CitationRow
): string {
    const href = `http://scriptures.byu.edu/getscrip.php?ID=${cite.ID}`;
    return replaceWithHref(config, talkId, body, cite, href, "JST");
}

function replaceCitation(
    config: CorpusDefinition,
    talkId: number,
    body: string,
    cite: CitationRow
): string {
    let bookAbbr = (cite.Abbr ?? "").replace(/ /g, "_");

    if (bookAbbr === "sec") {
        bookAbbr = "dc";
    } else if (bookAbbr === "ttlpg") {
        bookAbbr = "bm/ttlpg";
    } else if (bookAbbr === "thrwtnss") {
        bookAbbr = "bm/thrwtnss";
    } else if (bookAbbr === "eghtwtnss") {
        bookAbbr = "bm/eghtwtnss";
    } else if (bookAbbr === "fac") {
        bookAbbr = "abr/fac";
    }

    let href = `http://scriptures.lds.org/${bookAbbr}`;

    if (hasChapter(cite)) {
        href += cite.Abbr === "fac" ? `_${cite.Chapter}` : `/${cite.Chapter}`;

        if (hasHrefVerses(cite)) {
            href += `/${cite.Verses}`;
        }
    }

    return replaceWithHref(config, talkId, body, cite, href, "scripture");
}

function replaceWithHref(
    config: CorpusDefinition,
    talkId: number,
    body: string,
    cite: CitationRow,
    href: string,
    kind: string
): string {
    const pattern = new RegExp(
        `<a href="${escapeRegex(href)}(#\\d+)?"${config.anchorSuffix}>([^<]*)</a>`
    );

    const match = body.match(pattern);

    if (!match) {
        console.log(
            `talk ${talkId} ${href} <-------- ${kind} not found: ${pattern}`
        );
        return body;
    }

    const ref = referenceForCitation(config, cite);

    if (ref !== match[2]) {
        console.log(
            `talk ${talkId} found ${href} but ====> ${match[2]} != ${ref} <====`
        );
    }

    const replacement =
        `<span class="citation" id="${cite.ID}">` +
        `<a href="javascript:void(0)" onclick="sx(this, ${cite.ID})">&nbsp;</a>` +
        `<a href="javascript:void(0)" onclick="gs(${cite.ID})">${ref}</a>` +
        `</span>`;

    return body.replace(pattern, replacement);
}

function referenceForCitation(config: CorpusDefinition, cite: CitationRow): string {
    let chapter = "";
    let verses = "";
    let flag = "";

    if (hasChapter(cite)) {
        chapter = ` ${cite.Chapter}`;

        if (hasRefVerses(cite)) {
            verses = `:${cite.Verses}`;
        }
    }

    if (config.style === "stpjs") {
        verses = verses.replace(/-/g, EN_DASH).replace(/,/g, ", ");
    }

    if (cite.Flag === "J" || cite.Flag === "E" || cite.Flag === "H") {
        flag = config.labels[cite.Flag];
    }

    const ref = `${cite.CiteAbbr ?? ""}${chapter}${verses}${flag}`;

    return config.style === "gc-era" ? htmlEntityEscape(ref) : ref;
}

function htmlEntityEscape(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\u2014/g, "&mdash;");
}

function hasChapter(cite: CitationRow): boolean {
    return cite.Chapter != null && cite.Chapter > 0;
}

function hasHrefVerses(cite: CitationRow): boolean {
    if (cite.Verses == null || cite.Verses === "") return false;
    const n = parseInt(cite.Verses, 10);
    return Number.isFinite(n) && n > 0;
}

function hasRefVerses(cite: CitationRow): boolean {
    return hasHrefVerses(cite) && parseInt(cite.Verses!, 10) < 1000;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
