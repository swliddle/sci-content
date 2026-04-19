// `patternCase` tracks which regex variant produced the last attempted
// match so the fallthrough log at the end of replaceCitationOld /
// rewriteCitationNew can identify it. Every path through the function
// either returns early on match or falls through, so intermediate
// assignments look dead to eslint — they're not.
/* eslint-disable no-useless-assignment */

import * as mysql from "mysql2/promise";
import type { BaseCitationRow } from "./citation-row.js";
import { EnsignConfig } from "./ensign-config.js";

export interface EnsignCitationRow extends BaseCitationRow {
    BookID: number | null;
    Abbr: string | null;
}

interface MaxVerseRow extends mysql.RowDataPacket {
    BookID: number;
    Chapter: number;
    MaxVerse: number;
}

export type MaxVerses = Map<number, Map<number, number>>;

// Ambient state shared across all citation replacements in a pipeline run.
// Bundled so callers can't accidentally swap `protocol` and `server` — both
// strings, previously passed positionally next to each other.
export interface EnsignEnv {
    protocol: string;
    server: string;
    maxVerses: MaxVerses;
    cfg: EnsignConfig;
}

export async function loadMaxVerses(db: mysql.Connection): Promise<MaxVerses> {
    const [rows] = await db.execute<MaxVerseRow[]>(
        `SELECT BookID, Chapter, MAX(Verse) AS MaxVerse
           FROM scripture
          WHERE Verse < 1000 AND Flag = 'S'
          GROUP BY BookID, Chapter`
    );

    const maxVerses: MaxVerses = new Map();

    for (const row of rows) {
        let chapters = maxVerses.get(row.BookID);
        if (chapters === undefined) {
            chapters = new Map();
            maxVerses.set(row.BookID, chapters);
        }
        chapters.set(row.Chapter, row.MaxVerse);
    }

    return maxVerses;
}

export async function fetchCitations(
    db: mysql.Connection,
    talkId: number,
    bookTable: string
): Promise<EnsignCitationRow[]> {
    const [rows] = await db.execute<EnsignCitationRow[]>(
        `SELECT c.ID, b.CiteAbbr, c.BookID, c.Chapter, c.Verses, c.Flag, c.PageColumn, b.Abbr
           FROM citation c
           LEFT JOIN mark_cites m ON (c.ID = m.citationId)
           LEFT JOIN ${bookTable} b ON (c.BookID = b.ID)
          WHERE c.TalkID = ?
          ORDER BY page, c.PageColumn, b.ID, c.ID, sequence DESC`,
        [talkId]
    );

    return rows;
}

function referenceForCitation(cite: EnsignCitationRow, cfg: EnsignConfig): string {
    let chapter = "";
    let verses = "";
    let flag = "";

    if (cite.Chapter != null && cite.Chapter > 0) {
        chapter = ` ${cite.Chapter}`;

        if (cite.Verses != null && cite.Verses !== "") {
            const n = parseInt(cite.Verses, 10);
            if (Number.isFinite(n) && n > 0 && n < 1000) {
                verses = `:${cite.Verses}`;
            }
        }
    }

    if (cite.Flag === "J") flag = cfg.flagJst;
    else if (cite.Flag === "E") flag = cfg.flagEndnote;
    else if (cite.Flag === "H") flag = cfg.flagHeadnote;

    return `${cite.CiteAbbr ?? ""}${chapter}${verses}${flag}`;
}

function bookAbbrFromCite(abbr: string | null): string {
    let bookAbbr = (abbr ?? "").replace(/ /g, "-");

    if (bookAbbr === "sec") bookAbbr = "dc";
    else if (bookAbbr === "fac") bookAbbr = "abr/fac";

    return bookAbbr;
}

function subrefFallback(cite: EnsignCitationRow, bookAbbrPlain: string, cfg: EnsignConfig): string {
    let subref: string;
    const bookId = cite.BookID ?? 0;

    if (bookId <= 139) subref = "ot";
    else if (bookId <= 199) subref = "nt";
    else if (bookId <= 299) subref = "bofm";
    else if (bookId <= 399) subref = "dc-testament";
    else subref = "pgp";

    subref += `/${bookAbbrPlain}/${cite.Chapter}`;
    let minVerse = 1;

    if (cite.Verses != null && cite.Verses !== "") {
        subref += `.${cite.Verses}`;
        const parts = cite.Verses.split(/[ ,-]/);
        const first = parseInt(parts[0] ?? "", 10);
        if (Number.isFinite(first)) minVerse = first;
    } else {
        subref += ".title";
    }

    subref += `?lang=${cfg.langParam}#${minVerse - 1}`;
    return subref;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function citationReplacement(cite: EnsignCitationRow, refText: string): string {
    return (
        `<span class="citation" id="${cite.ID}">` +
        `<a href="javascript:void(0)" onclick="sx(this, ${cite.ID})">&nbsp;</a>` +
        `<a href="javascript:void(0)" onclick="gs(${cite.ID})">${refText}</a>` +
        `</span>`
    );
}

function variantRef(ref: string): string {
    return ref.replace(/-/g, "\u2013").replace(/&mdash;/g, "\u2014").replace(/,/g, ", ");
}

function replaceOnce(body: string, re: RegExp, replacement: string): string {
    return body.replace(re, () => replacement);
}

// ---------------------------------------------------------------------------
// Old path (id < 8362): mirrors AddCitations.php
// ---------------------------------------------------------------------------

export function replaceJstCitationOld(
    talkId: number,
    body: string,
    cite: EnsignCitationRow,
    env: EnsignEnv
): string {
    const { cfg } = env;
    // ES hard-codes `https?://`; EN uses `$PROTOCOL://`.
    const protoRe = cfg.direction === "es" ? "https?" : env.protocol;
    const hrefRe = `${protoRe}://scriptures\\.byu\\.edu/getscrip\\.php\\?ID=${cite.ID}`;
    const pattern = new RegExp(`<a href="${hrefRe}(#\\d+)?">([^<]*)</a>`);
    const match = body.match(pattern);

    if (!match) {
        const label = cfg.direction === "es" ? "TJS" : "JST";
        console.log(`talk ${talkId} <a href="${hrefRe}"> <-------- ${label} not found: ${pattern}`);
        return body;
    }

    const ref = referenceForCitation(cite, cfg);
    const longref = match[2]!;

    if (ref !== longref) {
        console.log(`talk ${talkId} found ${hrefRe} but ====> ${longref} != ${ref} <====`);
    }

    return body.replace(pattern, citationReplacement(cite, longref));
}

export function replaceCitationOld(
    talkId: number,
    body: string,
    cite: EnsignCitationRow,
    env: EnsignEnv
): string {
    const { protocol, server, maxVerses, cfg } = env;
    const bookAbbrSlashed = bookAbbrFromCite(cite.Abbr).replace(/\//g, "\\/");
    const bookAbbrPlain = bookAbbrFromCite(cite.Abbr);

    // ES uses https?; EN uses $PROTOCOL.
    const protoRe = cfg.direction === "es" ? "https?" : protocol;
    let href = `${protoRe}:\\/\\/(www[.])?lds\\.org\\/scriptures\\/[^\\/]+\\/${bookAbbrSlashed}`;
    if (talkId >= cfg.oldFormatCutoff) {
        href = `(?:${protoRe}:\\/\\/(?:www[.])?lds\\.org)?\\/scriptures\\/[^\\/]+\\/${bookAbbrSlashed}`;
    }

    let nvhref = href;

    if (cite.Chapter != null && cite.Chapter > 0) {
        if (cite.Abbr === "fac") {
            href += `_${cite.Chapter}`;
        } else {
            href += `\\/${cite.Chapter}`;
        }

        nvhref = href;

        if (cite.Verses != null && cite.Verses !== "") {
            const n = parseInt(cite.Verses, 10);
            if (Number.isFinite(n) && n > 0) {
                href += `\\.${escapeRegex(cite.Verses)}`;
            }
        }
    }

    // ES merges onclick|target into a single first pattern and optionally allows
    // a trailing `class="scripture-ref"`. EN has them as distinct cases.
    const onclickCap = cfg.oldFormatAcceptsOnclickOrTarget ? "(?:onclick|target)" : "onclick";
    const firstTail = cfg.oldFormatAcceptsOnclickOrTarget
        ? `(?:\\s*class="scripture-ref")?`
        : "";

    let pattern = new RegExp(
        `<a href="${href}([.]title)?(\\?lang=${cfg.langAlt})?(#\\d+)?"\\s*${onclickCap}="[^"]*"${firstTail}>([^<]*)</a>`
    );
    let patternCase = 1;

    if (talkId >= 8185) {
        // EN >=8185 switches to target-only; ES still uses onclick|target.
        const secondCap = cfg.oldFormatAcceptsOnclickOrTarget ? "(?:onclick|target)" : "target";
        pattern = new RegExp(
            `<a href="${href}([.]title)?(\\?lang=${cfg.langAlt})?(#\\d+)?"\\s*${secondCap}="[^"]*">([^<]*)</a>`
        );
        patternCase = 2;
    }

    if (talkId >= cfg.oldFormatCutoff) {
        pattern = new RegExp(
            `<a\\s*(class="scripture-ref"\\s*(?:data-old-href="[^"]*")?)\\s*href="${href}([.]title)?(\\?lang=${cfg.langAlt})?(\\??#p?\\d+)?"\\s*(?:old-href="[^"]*")?>([^<]*)</a>`
        );
        patternCase = 3;
    }

    let match = body.match(pattern);

    if (match) {
        const ref = referenceForCitation(cite, cfg);
        const refStr = variantRef(ref);
        const seen = match[5]!;

        if (refStr !== seen && ref !== seen) {
            console.log(`talk ${talkId} found ${href} but ====> ${seen} != ${refStr} <====`);
        }

        return replaceOnce(body, pattern, citationReplacement(cite, seen));
    }

    if (talkId >= cfg.oldFormatCutoff) {
        pattern = new RegExp(
            `<a\\s*(href)="${href}([.]title)?(\\?lang=${cfg.langAlt})?(\\??#p?\\d+)?"\\s*(?:target="[^"]*")?\\s*class="scripture-ref">([^<]*)</a>`
        );
        patternCase = 4;
        match = body.match(pattern);

        if (match) {
            const ref = referenceForCitation(cite, cfg);
            const refStr = variantRef(ref);
            const seen = match[5]!;

            if (refStr !== seen && ref !== seen) {
                console.log(`talk ${talkId} found ${href} but ====> ${seen} != ${refStr} <====`);
            }

            return replaceOnce(body, pattern, citationReplacement(cite, seen));
        }
    }

    const chapterMax = maxVerses.get(cite.BookID ?? -1)?.get(cite.Chapter ?? -1);
    let mv = `1-${chapterMax}`;
    if (mv === "1-1") mv = "1";

    if (cite.Verses === mv) {
        const onclickCap2 = cfg.oldFormatAcceptsOnclickOrTarget ? "(?:onclick|target)" : "onclick";
        pattern = new RegExp(
            `<a href="${nvhref}([.]title)?(\\?lang=${cfg.langAlt})?(#\\d+)?"\\s*${onclickCap2}="[^"]*">([^<]*)</a>`
        );
        patternCase = 5;

        if (talkId >= 8185) {
            pattern = new RegExp(
                `<a href="${nvhref}([.]title)?(\\?lang=${cfg.langAlt})?(#\\d+)?"\\s*target="[^"]*">([^<]*)</a>`
            );
            patternCase = 6;
        }

        if (talkId >= cfg.oldFormatCutoff) {
            pattern = new RegExp(
                `<a\\s*(class="scripture-ref"\\s*(?:data-old-href="[^"]*")?)\\s*href="${nvhref}([.]title)?(\\?lang=${cfg.langAlt})?(\\??#p?\\d+)?"\\s*(?:old-href="[^"]*")?>([^<]*)</a>`
            );
            patternCase = 7;
        }

        match = body.match(pattern);

        if (match) {
            const ref = referenceForCitation(cite, cfg);
            const refStr = variantRef(ref);
            const seen = match[5]!;

            if (refStr !== seen) {
                console.log(`talk ${talkId} found ${href} but ====> ${seen} != ${refStr} <====`);
            }

            return replaceOnce(body, pattern, citationReplacement(cite, seen));
        }

        if (talkId >= cfg.oldFormatCutoff) {
            pattern = new RegExp(
                `<a\\s*(href)="${nvhref}([.]title)?(\\?lang=${cfg.langAlt})?(\\??#p?\\d+)?"\\s*(?:target="[^"]*")?\\s*class="scripture-ref">([^<]*)</a>`
            );
            patternCase = 8;
            match = body.match(pattern);

            if (match) {
                const ref = referenceForCitation(cite, cfg);
                const refStr = variantRef(ref);
                const seen = match[5]!;

                if (refStr !== seen) {
                    console.log(`talk ${talkId} found ${href} but ====> ${seen} != ${refStr} <====`);
                }

                return replaceOnce(body, pattern, citationReplacement(cite, seen));
            }
        }

        console.log(`talk ${talkId} not found range: ${pattern} (${mv})`);
    } else {
        const subref = subrefFallback(cite, bookAbbrPlain, cfg);
        const missingRef = referenceForCitation(cite, cfg).replace(/-/g, "&ndash;");

        console.log(`Pattern ${patternCase}: ${pattern}`);
        console.log(
            `${talkId} missing: <a href="${protocol}://${server}/scriptures/${subref}" target="_blank">${missingRef}</a>`
        );
    }

    return body;
}

export function replaceCitationsOld(
    body: string,
    talkId: number,
    citations: EnsignCitationRow[],
    env: EnsignEnv
): string {
    for (const cite of citations) {
        if (cite.Flag === "J" || cite.Flag === "F") {
            body = replaceJstCitationOld(talkId, body, cite, env);
        } else {
            body = replaceCitationOld(talkId, body, cite, env);
        }
    }

    return body;
}

// ---------------------------------------------------------------------------
// New path (id >= 8362): mirrors ProcessTalk.php
// ---------------------------------------------------------------------------

export function rewriteJstCitationNew(
    talkId: number,
    body: string,
    cite: EnsignCitationRow,
    env: EnsignEnv
): string {
    const { cfg } = env;
    const hrefRe = `https://scriptures\\.byu\\.edu/getscrip\\.php\\?ID=${cite.ID}`;
    const pattern = new RegExp(`<a href="${hrefRe}(#\\d+)?">([^<]*)</a>`);
    const match = body.match(pattern);

    if (!match) {
        const label = cfg.direction === "es" ? "TJS" : "JST";
        console.log(`talk ${talkId} <a href="${hrefRe}"> <-------- ${label} not found: ${pattern}`);
        return body;
    }

    const ref = referenceForCitation(cite, cfg);
    const longref = match[2]!;

    if (ref !== longref) {
        console.log(`talk ${talkId} found ${hrefRe} but ====> ${longref} != ${ref} <====`);
    }

    return body.replace(pattern, citationReplacement(cite, longref));
}

export function rewriteCitationNew(
    talkId: number,
    body: string,
    cite: EnsignCitationRow,
    env: EnsignEnv
): string {
    const { server, maxVerses, cfg } = env;
    const bookAbbrSlashed = bookAbbrFromCite(cite.Abbr).replace(/\//g, "\\/");
    const bookAbbrPlain = bookAbbrFromCite(cite.Abbr);

    let href = `(?:https:\\/\\/(?:www[.])?lds\\.org)?(?:\\/study)?\\/scriptures\\/[^\\/]+\\/${bookAbbrSlashed}`;
    let nvhref = href;

    if (cite.Chapter != null && cite.Chapter > 0) {
        if (cite.Abbr === "fac") {
            href += `_${cite.Chapter}`;
        } else {
            href += `\\/${cite.Chapter}`;
        }

        nvhref = href;

        if (cite.Verses != null && cite.Verses !== "") {
            const n = parseInt(cite.Verses, 10);
            if (Number.isFinite(n) && n > 0) {
                href += `\\.${escapeRegex(cite.Verses)}`;
            }
        }
    }

    let pattern = new RegExp(
        `<a\\s*(class="?scripture-ref"?\\s*(?:data-old-href="[^"]*")?)\\s*href="${href}([.]title)?(\\?lang=${cfg.langAlt})?(\\??#p?\\d+)?"\\s*(?:old-href="[^"]*")?>([^<]*)</a>`
    );
    let patternCase = 3;

    let match = body.match(pattern);
    if (match) {
        const ref = referenceForCitation(cite, cfg);
        const refStr = variantRef(ref);
        const seen = match[5]!;

        if (refStr !== seen && ref !== seen) {
            console.log(`talk ${talkId} found ${href} but ====> ${seen} != ${refStr} <====`);
        }

        return replaceOnce(body, pattern, citationReplacement(cite, seen));
    }

    pattern = new RegExp(
        `<a\\s*(href)="${href}([.]title)?(\\?lang=${cfg.langAlt})?(\\??#p?\\d+)?"\\s*(?:target="[^"]*")?\\s*class="?scripture-ref"?>([^<]*)</a>`
    );
    patternCase = 4;
    match = body.match(pattern);

    if (match) {
        const ref = referenceForCitation(cite, cfg);
        const refStr = variantRef(ref);
        const seen = match[5]!;

        if (refStr !== seen && ref !== seen) {
            console.log(`talk ${talkId} found ${href} but ====> ${seen} != ${refStr} <====`);
        }

        return replaceOnce(body, pattern, citationReplacement(cite, seen));
    }

    const chapterMax = maxVerses.get(cite.BookID ?? -1)?.get(cite.Chapter ?? -1);
    let mv = `1-${chapterMax}`;
    if (mv === "1-1") mv = "1";

    if (cite.Verses === mv) {
        pattern = new RegExp(
            `<a\\s*(class="?scripture-ref"?\\s*(?:data-old-href="?[^"]*"?)?)\\s*href="${nvhref}([.]title)?(\\?lang=${cfg.langAlt})?(\\??#p?\\d+)?"\\s*(?:old-href="[^"]*")?>([^<]*)</a>`
        );
        patternCase = 7;
        match = body.match(pattern);

        if (match) {
            const ref = referenceForCitation(cite, cfg);
            const refStr = variantRef(ref);
            const seen = match[5]!;

            if (refStr !== seen) {
                console.log(`talk ${talkId} found ${href} but ====> ${seen} != ${refStr} <====`);
            }

            return replaceOnce(body, pattern, citationReplacement(cite, seen));
        }

        pattern = new RegExp(
            `<a\\s*(href)="${nvhref}([.]title)?(\\?lang=${cfg.langAlt})?(\\??#p?\\d+)?"\\s*(?:target="[^"]*")?\\s*class="?scripture-ref"?>([^<]*)</a>`
        );
        patternCase = 8;
        match = body.match(pattern);

        if (match) {
            const ref = referenceForCitation(cite, cfg);
            const refStr = variantRef(ref);
            const seen = match[5]!;

            if (refStr !== seen) {
                console.log(`talk ${talkId} found ${href} but ====> ${seen} != ${refStr} <====`);
            }

            return replaceOnce(body, pattern, citationReplacement(cite, seen));
        }

        console.log(`talk ${talkId} not found range: ${pattern} (${mv})`);
    } else {
        const subref = subrefFallback(cite, bookAbbrPlain, cfg);
        const missingRef = referenceForCitation(cite, cfg).replace(/-/g, "&ndash;");

        console.log(`Pattern ${patternCase}: ${pattern}`);
        console.log(
            `${talkId} missing: <a href="https://${server}/scriptures/${subref}" target="_blank">${missingRef}</a>`
        );
    }

    return body;
}

export function rewriteCitationsNew(
    body: string,
    talkId: number,
    citations: EnsignCitationRow[],
    env: EnsignEnv
): string {
    for (const cite of citations) {
        if (cite.Flag === "J" || cite.Flag === "F") {
            body = rewriteJstCitationNew(talkId, body, cite, env);
        } else {
            body = rewriteCitationNew(talkId, body, cite, env);
        }
    }

    return body;
}
