import * as fs from "fs";
import * as path from "path";
import * as mysql from "mysql2/promise";
import { parse, HTMLElement, Node, NodeType } from "node-html-parser";
import { createDb } from "../lib/db.js";
import { parseVolumeArg } from "../lib/args.js";
import { envOr } from "../lib/env.js";
import { nodeRawText, nodeText } from "../lib/html-utils.js";
import {
    convertRawUtf8SmartQuotes,
    escapeHtml,
    placeCitationsFromRows,
    type JodCitationRow
} from "../lib/jod-citations.js";
import { runMain } from "../lib/run-main.js";

function volumePrefix(vol: number): string {
    return String(vol).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StringRef {
    value: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const vol = parseVolumeArg();
    const prefix = volumePrefix(vol);
    const dbDir = envOr("DB_DIR", "out/jod/db");

    const files = fs
        .readdirSync(dbDir)
        .filter((f) => new RegExp(`^JoD${prefix}_Discourse\\d+\\.html$`).test(f))
        .map((f) => path.join(dbDir, f))
        .sort();

    if (files.length === 0) {
        console.error(`No discourse files found for volume ${vol} in ${dbDir}`);
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

            console.log(`add-citations volume ${v}, discourse ${discourse}`);

            const raw = fs.readFileSync(filePath, "utf8");
            const root = parse(convertRawUtf8SmartQuotes(raw), {
                lowerCaseTagName: false,
                comment: true
            });

            prepareWords(root);
            await placeCitations(db, v, jodId, root);
            removeSpans(root);
            addSpacersForNonHyphens(root);

            // PHP file_put_contents preserves the trailing newline from
            // DOMDocument::saveXML(); match that for byte-level parity.
            fs.writeFileSync(filePath, stripWrappers(root.toString()) + "\n", "utf8");
        }
    } finally {
        await db.end();
    }
}

// Strip <?xml?>, DOCTYPE, and <html><body>…</body></html>, then normalize
// named entities and self-closing tags to match PHP saveXML output.
// PHP's DOMDocument has no DTD mapping, so non-core entities get emitted as
// numeric character references; saveXML also uses XML-style self-closing.
function stripWrappers(html: string): string {
    return html
        .replace(/<\?xml[^?]*\?>\s*/, "")
        .replace(/<!DOCTYPE[^>]*>\s*/, "")
        .replace(/^\s*<html>\s*<body>/, "")
        .replace(/<\/body>\s*<\/html>\s*$/, "")
        .replace(/&ndash;/g, "&#x2013;")
        .replace(/&mdash;/g, "&#x2014;")
        .replace(/&lsquo;/g, "&#x2018;")
        .replace(/&rsquo;/g, "&#x2019;")
        .replace(/&ldquo;/g, "&#x201C;")
        .replace(/&rdquo;/g, "&#x201D;")
        .replace(/&hellip;/g, "&#x2026;")
        .replace(/&nbsp;/g, "&#xA0;")
        .replace(/__SYNC_NBSP__/g, "&nbsp;")
        .replace(/<([a-zA-Z][\w:-]*)((?:\s+[^<>]*)?)><\/\1>/g, "<$1$2/>");
}

// ---------------------------------------------------------------------------
// DOM transforms
// ---------------------------------------------------------------------------

function addSpacersForNonHyphens(root: HTMLElement): void {
    // Match PHP XPath contains(@class,'break') — attribute substring, not token.
    const breakDivs = root.querySelectorAll("div[class*='break']");

    for (const node of breakDivs) {
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

function arrayInsert<T>(arr: T[], index: number, value: T): T[] {
    return [...arr.slice(0, index), value, ...arr.slice(index)];
}

// PHP's ctype_space and PCRE \s (without /u) are ASCII-only. JS \s and
// String.trim() also strip \u00A0 (nbsp). Mirror PHP exactly so that nbsp
// text nodes (common inside pre-existing <a>&nbsp;</a> citation placeholders)
// are preserved as word content, not flattened to ASCII space.
const ASCII_SPACE_ONE = /^[ \t\n\r\v\f]$/;
const ASCII_SPACE_ALL = /^[ \t\n\r\v\f]+$/;
const ASCII_SPACE_SPLIT = /[ \t\n\r\v\f]+/;

function isAsciiSpace(char: string): boolean {
    return ASCII_SPACE_ONE.test(char);
}

function asciiTrim(text: string): string {
    return text.replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, "");
}

function hasLeadingSpace(text: string): boolean {
    return text.length > 0 && isAsciiSpace(text.charAt(0));
}

function hasTrailingSpace(text: string): boolean {
    return text.length > 0 && isAsciiSpace(text.charAt(text.length - 1));
}

// Mirrors PHP ctype_punct (ASCII 0x21-0x2F, 0x3A-0x40, 0x5B-0x60, 0x7B-0x7E)
// OR-ed with the explicit smart-quote/ellipsis fallback from the PHP version.
const ASCII_PUNCT = /^[!-/:-@[-`{-~]+$/;

function isPunctuation(char: string): boolean {
    if (char.length === 0) {
        return false;
    }

    return ASCII_PUNCT.test(char) || "\u201c\u201d\u2018\u2019\u2026".includes(char);
}

function splitWords(text: string): string[] {
    const trimmed = asciiTrim(text);

    if (trimmed !== text && ASCII_SPACE_ALL.test(text)) {
        return [" "];
    }

    const leadingSpace = hasLeadingSpace(text);
    const trailingSpace = hasTrailingSpace(text);

    let words = trimmed.split(ASCII_SPACE_SPLIT);

    for (let i = words.length - 1; i >= 0; i--) {
        const word = words[i]!;
        const pos = word.indexOf("\u2014");

        if (pos === -1) {
            if (i < words.length - 1) {
                words[i] = word + " ";
            }
        } else {
            const splitPos = pos + "\u2014".length;
            const part1 = word.slice(0, splitPos);
            let part2 = word.slice(splitPos);

            if (i < words.length - 1) {
                part2 += " ";
            }

            words[i] = part2;
            words = arrayInsert(words, i, part1);
        }
    }

    if (leadingSpace && words.length > 0) {
        words[0] = " " + words[0];
    }

    if (trailingSpace && words.length > 0) {
        words[words.length - 1] += " ";
    }

    return words;
}

function wordIsExtension(word: string, previousWord: string): boolean {
    if (previousWord === "") {
        return false;
    }

    const prevEnd = previousWord.slice(-1);
    const curStart = word.charAt(0);

    if (isPunctuation(prevEnd) && prevEnd !== "\u2014" && !isAsciiSpace(curStart)) {
        return true;
    }

    if (!isAsciiSpace(prevEnd) && prevEnd !== "\u2014" && isPunctuation(curStart)) {
        return true;
    }

    return false;
}

function prepareWords(root: HTMLElement): void {
    // contains(@class,'paragraph') — substring match semantics.
    const paragraphs = root.querySelectorAll("div[class*='paragraph']");

    for (const para of paragraphs) {
        const previousWord: StringRef = { value: "" };
        processParagraphNode(para, 0, previousWord);
    }
}

function processParagraphNode(
    node: HTMLElement,
    wordCount: number,
    previousWord: StringRef
): number {
    const clazz = node.getAttribute("class") ?? "";

    if (node.tagName === "DIV" && (clazz === "citation" || clazz.includes("break"))) {
        return wordCount;
    }

    for (const child of [...node.childNodes]) {
        if (child.nodeType === NodeType.TEXT_NODE) {
            wordCount = processTextNode(child, wordCount, previousWord, node);
        } else if (child.nodeType === NodeType.ELEMENT_NODE) {
            wordCount = processParagraphNode(child as HTMLElement, wordCount, previousWord);
        }
    }

    return wordCount;
}

function processTextNode(
    node: Node,
    wordCount: number,
    previousWord: StringRef,
    parent: HTMLElement
): number {
    // node-html-parser's rawText preserves entity references (&mdash;, &ldquo;);
    // .text decodes them. PHP's DOMDocument decodes on load, so we mirror that
    // here — otherwise splitWords can't find the em-dash character to split on
    // "principle&rdquo;&mdash;&ldquo;if" (one word → three), shifting subsequent
    // word indices relative to PHP.
    const text = nodeText(node);
    const words = splitWords(text);

    if (words.length === 0) {
        return wordCount;
    }

    let spanHtml = "";

    for (const word of words) {
        let wordClass: string;

        if (wordIsExtension(word, previousWord.value)) {
            wordClass = `${wordCount - 1}x`;
        } else {
            wordClass = String(wordCount);
            wordCount++;
        }

        previousWord.value = word;

        const trimmed = convertRawUtf8SmartQuotes(escapeHtml(word.trim()));

        if (hasLeadingSpace(word)) {
            spanHtml += " ";
        }

        spanHtml += `<span class="droptarget word${wordClass}">${trimmed}</span>`;

        if (hasTrailingSpace(word)) {
            spanHtml += " ";
        }
    }

    const wrapper = parse(`<span>${spanHtml}</span>`).querySelector("span")!;

    parent.exchangeChild(node, wrapper);
    // node-html-parser's exchangeChild doesn't set parentNode on the injected
    // element; without it, insertAdjacentHTML/remove() silently no-op in the
    // bare-span unwrap pass of removeSpans.
    wrapper.parentNode = parent;

    return wordCount;
}

// ---------------------------------------------------------------------------
// Citation placement
// ---------------------------------------------------------------------------

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
          ORDER BY page, c.PageColumn, m.Paragraph, m.Word, sequence DESC`,
        [jodId]
    );

    placeCitationsFromRows(root, vol, rows);
}

// ---------------------------------------------------------------------------
// removeSpans
// ---------------------------------------------------------------------------

function removeSpans(root: HTMLElement): void {
    const wordSpans = root.querySelectorAll("span[class*='word']");

    for (const span of wordSpans) {
        const children = [...span.childNodes];

        if (children.length > 1) {
            const textContent = nodeRawText(children[0]);
            const extras = children.slice(1);

            span.insertAdjacentHTML("beforebegin", textContent);

            for (const child of extras) {
                span.insertAdjacentHTML("afterend", child.toString());
            }

            span.remove();
        } else {
            // Use innerHTML, not .text — .text decodes &mdash;/&ldquo;/etc. back to
            // raw Unicode chars, which would then re-serialize as literal code
            // points and diverge from PHP's saveXML (which emits numeric refs).
            span.insertAdjacentHTML("beforebegin", span.innerHTML);
            span.remove();
        }
    }

    const bareSpans = root.querySelectorAll("span");

    for (const span of bareSpans) {
        if (span.attributes && Object.keys(span.attributes).length === 0) {
            span.insertAdjacentHTML("beforebegin", span.innerHTML);
            span.remove();
        }
    }
}

// ---------------------------------------------------------------------------

runMain(main());
