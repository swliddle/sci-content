import type { HTMLElement } from "node-html-parser";
import type { BaseCitationRow } from "./citation-row.js";

// Shape returned by the JoD citation query:
//   SELECT c.ID, b.CiteAbbr, c.Chapter, c.Verses, c.Flag, c.PageColumn,
//          m.Paragraph, m.Word
//     FROM citation c
//     LEFT JOIN mark_cites m ON (c.ID = m.citationId)
//     LEFT JOIN book b ON (c.BookID = b.ID)
//    WHERE c.TalkID = ?
//
// Paragraph/Word come from LEFT-joined mark_cites and may be null when no
// matching row exists.
export interface JodCitationRow extends BaseCitationRow {
    Paragraph: number | null;
    Word: number | null;
}

export function convertRawUtf8SmartQuotes(str: string): string {
    return str
        .replace(/\u2013/g, "&ndash;")
        .replace(/\u2014/g, "&mdash;")
        .replace(/\u2018/g, "&lsquo;")
        .replace(/\u2019/g, "&rsquo;")
        .replace(/\u201c/g, "&ldquo;")
        .replace(/\u201d/g, "&rdquo;")
        .replace(/\u2026/g, "&hellip;")
        .replace(/\u00a0/g, "&nbsp;");
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function referenceForCitation(cite: JodCitationRow): string {
    let chapter = "";
    let verses = "";
    let flag = "";

    if (cite.Chapter != null && cite.Chapter > 0) {
        chapter = ` ${cite.Chapter}`;

        if (cite.Verses != null && cite.Verses !== "") {
            const versesNum = parseInt(cite.Verses, 10);
            if (!isNaN(versesNum) && versesNum < 1000) {
                verses = `:${cite.Verses}`;
            }
        }
    }

    if (cite.Flag === "J") {
        flag = " (JST)";
    } else if (cite.Flag === "E") {
        flag = " Endnote";
    } else if (cite.Flag === "H") {
        flag = " Headnote";
    }

    return `${cite.CiteAbbr ?? ""}${chapter}${verses}${flag}`;
}

interface InsertCitationArgs {
    reference: string;
    pageColumn: string;
    citeId: number;
    vol: number;
    paragraph: number | null;
    wordIx: number | null;
}

function insertCitationDiv(root: HTMLElement, args: InsertCitationArgs): void {
    const { reference, pageColumn, citeId, vol, paragraph, wordIx } = args;
    const page = pageColumn.slice(0, -1);
    const column = pageColumn.slice(-1);
    const target = column === "a" ? `${page}b` : `${parseInt(page, 10) + 1}a`;

    // PHP builds sync links via DOMDocument::createElement('a', '&nbsp;'),
    // which saveXML emits as the literal entity reference &nbsp; (not the
    // numeric &#xA0; it uses for text-node nbsp's). Emit a placeholder token
    // here and restore it as &nbsp; in stripWrappers after the rest of the
    // named→numeric normalization runs.
    const citationHtml =
        `<span class="citation" id="${citeId}">` +
        `<a href="javascript:void(0)" onclick="sx(this, ${citeId})">__SYNC_NBSP__</a>` +
        `<a href="javascript:void(0)" onclick="gs(${citeId})">${convertRawUtf8SmartQuotes(escapeHtml(reference))}</a>` +
        `</span>`;

    // contains(@class,'wordN') — substring match.  `.word5` would *not*
    // match `word50` or `word5x`; the PHP XPath does, so mirror it with
    // [class*='wordN'].
    const wordSpan = root.querySelector(`div#v${vol}n${paragraph} span[class*='word${wordIx}']`);

    if (wordSpan) {
        wordSpan.insertAdjacentHTML("afterend", citationHtml);
        return;
    }

    const breakDiv = root.querySelector(`div#${target}`);

    if (breakDiv) {
        breakDiv.insertAdjacentHTML("beforebegin", citationHtml);
        return;
    }

    const paragraphs = root.querySelectorAll("div.paragraph.jod");

    if (paragraphs.length > 0) {
        paragraphs[paragraphs.length - 1]!.insertAdjacentHTML("beforeend", citationHtml);
    }
}

export function placeCitationsFromRows(
    root: HTMLElement,
    vol: number,
    rows: JodCitationRow[]
): void {
    for (const cite of rows) {
        insertCitationDiv(root, {
            reference: referenceForCitation(cite),
            pageColumn: cite.PageColumn,
            citeId: cite.ID,
            vol,
            paragraph: cite.Paragraph,
            wordIx: cite.Word
        });
    }
}
