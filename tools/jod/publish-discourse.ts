import * as fs from "fs";
import * as path from "path";
import * as mysql from "mysql2/promise";
import { parse, HTMLElement, NodeType } from "node-html-parser";
import { createDb } from "../lib/db.js";
import { parseVolumeArg } from "../lib/args.js";
import { envOr } from "../lib/env.js";
import { nodeText } from "../lib/html-utils.js";
import type { JodCitationRow } from "../lib/jod-citations.js";
import { runMain } from "../lib/run-main.js";

function volumePrefix(vol: number): string {
    return String(vol).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const vol = parseVolumeArg();
    const prefix = volumePrefix(vol);
    const divDir = envOr("DIV_DIR", "out/jod/div");
    const publishDir = envOr("PUBLISH_DIR", "out/jod/publish");

    fs.mkdirSync(publishDir, { recursive: true });

    const files = fs
        .readdirSync(divDir)
        .filter((f) => new RegExp(`^JoD${prefix}_Discourse\\d+\\.html$`).test(f))
        .map((f) => path.join(divDir, f))
        .sort();

    if (files.length === 0) {
        console.error(`No discourse files found for volume ${vol} in ${divDir}`);
        process.exit(1);
    }

    const db = await createDb();

    try {
        for (const filePath of files) {
            const match = path.basename(filePath).match(/^JoD(\d+)_Discourse(\d+)\.html$/);
            if (!match || match[1] === undefined || match[2] === undefined) continue;
            const v = parseInt(match[1], 10);
            const discourse = parseInt(match[2], 10);
            const jodId = v * 10000 + discourse;

            console.log(`publish volume ${v}, discourse ${discourse}`);

            const raw = fs.readFileSync(filePath, "utf8");
            const root = parse(convertRawUtf8SmartQuotes(raw), {
                lowerCaseTagName: false,
                comment: true
            });

            removeCitations(root);
            prepareWords(root);
            await placeCitations(db, v, jodId, root);
            removeSpans(root);
            addSpacersForNonHyphens(root);

            const outPath = path.join(publishDir, path.basename(filePath));
            fs.writeFileSync(outPath, wrapAsSaveXml(root.toString()) + "\n", "utf8");
        }
    } finally {
        await db.end();
    }
}

// ---------------------------------------------------------------------------
// Serialization normalizers
// ---------------------------------------------------------------------------

// Normalize named entities and self-closing tags to match PHP saveXML,
// then wrap in the XML/DOCTYPE/html preamble that DOMDocument::loadHTML adds
// and saveXML emits. Input comes from node-html-parser, which does not
// prepend those wrappers on its own.
const VOID_ELEMENTS = /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^<>]*?)?(?<!\/)>/g;

function wrapAsSaveXml(html: string): string {
    const normalized = html
        .replace(/&ndash;/g, "&#x2013;")
        .replace(/&mdash;/g, "&#x2014;")
        .replace(/&lsquo;/g, "&#x2018;")
        .replace(/&rsquo;/g, "&#x2019;")
        .replace(/&ldquo;/g, "&#x201C;")
        .replace(/&rdquo;/g, "&#x201D;")
        .replace(/&hellip;/g, "&#x2026;")
        .replace(/&nbsp;/g, "&#xA0;")
        .replace(/__SYNC_NBSP__/g, "&nbsp;")
        .replace(/<([a-zA-Z][\w:-]*)((?:\s+[^<>]*)?)><\/\1>/g, "<$1$2/>")
        .replace(VOID_ELEMENTS, "<$1$2/>");

    return (
        `<?xml version="1.0" standalone="yes"?>\n` +
        `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">\n` +
        `<html><body>${normalized}</body></html>`
    );
}

function convertRawUtf8SmartQuotes(s: string): string {
    return s
        .replace(/\u2013/g, "&ndash;")
        .replace(/\u2014/g, "&mdash;")
        .replace(/\u2018/g, "&lsquo;")
        .replace(/\u2019/g, "&rsquo;")
        .replace(/\u201c/g, "&ldquo;")
        .replace(/\u201d/g, "&rdquo;")
        .replace(/\u2026/g, "&hellip;")
        .replace(/\u00a0/g, "&nbsp;");
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// DOM transforms
// ---------------------------------------------------------------------------

function removeCitations(root: HTMLElement): void {
    for (const node of root.querySelectorAll("div.citation")) {
        node.remove();
    }
}

function prepareWords(root: HTMLElement): void {
    // contains(@class,'paragraph') — substring match semantics.
    for (const para of root.querySelectorAll("div[class*='paragraph']")) {
        let wordCount = 0;
        let newHtml = "";

        for (const child of para.childNodes) {
            if (child.nodeType === NodeType.TEXT_NODE) {
                // .text decodes entities so downstream HTML assembly can re-escape
                // via escapeHtml + convertRawUtf8SmartQuotes without double-encoding.
                const text = nodeText(child);
                const words = text.trim().split(/\s+/);
                let first = true;

                for (const word of words) {
                    if (!first) {
                        newHtml += " ";
                    }

                    const content = convertRawUtf8SmartQuotes(escapeHtml(word));
                    newHtml += `<span class="word${wordCount}">${content}</span>`;
                    wordCount++;
                    first = false;
                }
            } else {
                newHtml += child.toString();
            }
        }

        newHtml += "\n";
        para.set_content(newHtml);
    }
}

async function placeCitations(
    db: mysql.Connection,
    vol: number,
    jodId: number,
    root: HTMLElement
): Promise<void> {
    const [rows] = await db.execute<JodCitationRow[]>(
        `SELECT c.ID, b.CiteAbbr, c.Chapter, c.Verses, c.Flag, c.PageColumn,
                m.Paragraph, m.Word
           FROM citation c
           LEFT JOIN mark_cites m ON (c.ID = m.citationId)
           LEFT JOIN book b ON (c.BookID = b.ID)
          WHERE c.TalkID = ?
          ORDER BY c.PageColumn, m.Paragraph, m.Word`,
        [jodId]
    );

    for (const cite of rows) {
        let reference = cite.CiteAbbr ?? "";

        if (cite.Chapter != null && String(cite.Chapter) !== "") {
            reference += ` ${cite.Chapter}`;
        }

        if (cite.Verses != null && String(cite.Verses) !== "") {
            reference += `:${cite.Verses}`;
        }

        if (cite.Flag === "J") {
            reference += " (JST)";
        }

        insertCitationDiv(root, {
            reference,
            page: cite.PageColumn.slice(0, -1),
            column: cite.PageColumn.slice(-1),
            citeId: cite.ID,
            vol,
            paragraph: cite.Paragraph,
            wordIx: cite.Word
        });
    }
}

interface InsertCitationArgs {
    reference: string;
    page: string;
    column: string;
    citeId: number;
    vol: number;
    paragraph: number | null;
    wordIx: number | null;
}

function insertCitationDiv(root: HTMLElement, args: InsertCitationArgs): void {
    const { reference, page, column, citeId, vol, paragraph, wordIx } = args;
    const target = column === "a" ? `${page}b` : `${parseInt(page, 10) + 1}a`;

    // PHP builds sync links via DOMDocument::createElement('a', '&nbsp;'),
    // which saveXML emits as the literal entity reference &nbsp;. Emit a
    // placeholder token here and restore it in stripWrappers after the
    // named → numeric entity normalization runs.
    const citationHtml =
        `<div class="citation" id="${citeId}">` +
        `<a href="javascript:void(0)" onclick="sx(this, ${citeId})">__SYNC_NBSP__</a>` +
        `<a href="javascript:void(0)" onclick="gs(${citeId})">${convertRawUtf8SmartQuotes(escapeHtml(reference))}</a>` +
        `</div>`;

    const wordSpan = root.querySelector(`div#v${vol}n${paragraph} span.word${wordIx}`);

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

function removeSpans(root: HTMLElement): void {
    for (const span of root.querySelectorAll("span[class*='word']")) {
        // Use innerHTML, not .text — .text decodes &mdash;/&ldquo;/etc. back
        // to raw Unicode chars, which would then re-serialize as literal code
        // points and diverge from PHP's saveXML.
        span.insertAdjacentHTML("beforebegin", span.innerHTML);
        span.remove();
    }
}

function addSpacersForNonHyphens(root: HTMLElement): void {
    for (const node of root.querySelectorAll("div[class*='break']")) {
        const sibling = node.previousSibling;
        const isHyphen =
            sibling &&
            sibling.nodeType === NodeType.ELEMENT_NODE &&
            (sibling as HTMLElement).tagName === "DIV" &&
            (sibling as HTMLElement).classList.contains("hyphen");

        if (!isHyphen) {
            node.insertAdjacentHTML("beforebegin", " ");
        }
    }
}

// ---------------------------------------------------------------------------

runMain(main());
