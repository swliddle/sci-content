import type * as mysql from "mysql2/promise";
import type { Direction } from "./ensign-config.js";
import { createDb } from "./db.js";
import { entityForCodepoint } from "./html-entities.js";

export type { Direction };

// PHP's pipeline does two passes:
//   (1) mb_convert_encoding(UTF-8 -> HTML-ENTITIES): raw chars > 127 become
//       entities (named where HTML 4.01 defines one, &#N; numeric otherwise).
//   (2) str_replace of a specific entity list back to raw UTF-8.
// We mirror both passes so pre-existing entities in the input are normalized
// the same way as raw UTF-8 input.
const ROUNDTRIP_CODEPOINTS: ReadonlyArray<number> = [
    0x2122, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026,
    0x0101,
    0x00C5,
    0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7,
    0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x00EC, 0x00ED, 0x00EE, 0x00EF,
    0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F7, 0x00F8,
    0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FE, 0x00FF,
    0x00A0, 0x00A1, 0x00A2, 0x00A9, 0x00AE,
    0x00B0, 0x00BD, 0x00BF
];

const ROUNDTRIP_CP_SET = new Set<number>(ROUNDTRIP_CODEPOINTS);

// Match PHP's str_replace list in PROCESS.php / PROCESS_ES.php: decimal,
// hex, and named forms all decay to raw UTF-8 for the roundtrip set.
const ROUNDTRIP_ENTITY_REPLACEMENTS: Array<[string, string]> = (() => {
    const pairs: Array<[string, string]> = [];
    for (const cp of ROUNDTRIP_CODEPOINTS) {
        const raw = String.fromCodePoint(cp);
        const named = entityForCodepoint(cp);
        if (named.startsWith("&") && !named.startsWith("&#")) {
            pairs.push([named, raw]);
        }
        pairs.push([`&#${cp};`, raw]);
        pairs.push([`&#x${cp.toString(16).toUpperCase()};`, raw]);
        pairs.push([`&#x${cp.toString(16)};`, raw]);
    }
    return pairs;
})();

function applyEntityRoundtrip(input: string): string {
    let encoded = "";
    for (const ch of input) {
        const cp = ch.codePointAt(0)!;
        if (cp < 128 || ROUNDTRIP_CP_SET.has(cp)) {
            encoded += ch;
        } else {
            encoded += entityForCodepoint(cp);
        }
    }
    for (const [from, to] of ROUNDTRIP_ENTITY_REPLACEMENTS) {
        if (encoded.includes(from)) {
            encoded = encoded.split(from).join(to);
        }
    }
    return encoded;
}

function updateTalkImage(body: string): string {
    const re = /<img[^>]*src="([^"]*)"/gi;
    let result = "";
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        const orig = m[1];
        if (orig === undefined) continue;
        // Locate the exact offset of the captured src value within the full match.
        const valueStart = m.index + m[0].lastIndexOf('src="') + 'src="'.length;
        let replacement = orig.replace(/:/g, ".");
        if (replacement.startsWith("/")) replacement = replacement.slice(1);

        result += body.slice(last, valueStart) + replacement;
        last = valueStart + orig.length;
        re.lastIndex = last;
    }
    result += body.slice(last);
    return result;
}

function leftClassesForString(p: string): string {
    if (p === "(") return " lparen";
    if (p === "\u201C") return " ldquo";
    if (p === "[") return " lbrack";
    if (p === "([") return " lparenbrack";
    if (p === "\u2014") return " lmdash";
    return "";
}

function rightClassesForString(punctuation: string, talkId: number): string {
    let classes = " r";

    for (const ch of punctuation) {
        let toAdd: string | null = null;
        switch (ch) {
            case "!": toAdd = "bang"; break;
            case ",": toAdd = "comma"; break;
            case ".": toAdd = "dot"; break;
            case ":": toAdd = "colon"; break;
            case ";": toAdd = "semi"; break;
            case "?": toAdd = "quest"; break;
            case "'": toAdd = "apos"; break;
            case '"': toAdd = "quote"; break;
            case "\u2019": toAdd = "rsquo"; break;
            case "\u201C": toAdd = "ldquo"; break;
            case "\u201D": toAdd = "rdquo"; break;
            case ")": toAdd = "paren"; break;
            case "]": toAdd = "brack"; break;
            case "\u2014": toAdd = "mdash"; break;
            case "\u2026": toAdd = "ellip"; break;
            default:
                console.log(`Talk ID ${talkId}`);
                console.log(`Punctuation x${Buffer.from(ch, "utf8").toString("hex")} (${ch}) not mapped`);
                console.log(`Context is ${punctuation}`);
        }
        if (toAdd !== null) classes += toAdd;
    }

    if (classes === " r") {
        console.log(`Warning: found no right classes for ${punctuation}`);
    }

    return classes;
}

function pageWithCitationPunctuationSubstitutions(
    content: string,
    direction: Direction,
    talkId: number
): string {
    // EN pattern lacks `…`; ES adds it to the right-capture class.
    const rightChars = direction === "es" ? "\\)\\]!,.:;?'\"\u2019\u201D\u201C\u2026" : "\\)\\]!,.:;?'\"\u2019\u201D\u201C";
    const pattern = new RegExp(
        `(\u2014|[(]|\u201C|\\[|[(]\\[)?<span class="citation[^"]*"[^>]*><a[^>]*>[^<]*<\\/a><a[^>]*>[^<]*<\\/a><\\/span>([${rightChars}]*)([\u2014]?)`,
        "gi"
    );

    const matches: Array<{ full: string; left: string; right1: string; right2: string; pos: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
        matches.push({
            full: m[0],
            left: m[1] ?? "",
            right1: m[2] ?? "",
            right2: m[3] ?? "",
            pos: m.index
        });
        if (m[0].length === 0) pattern.lastIndex++;
    }

    // Walk in reverse so mutation indices earlier in the string stay valid.
    for (let i = matches.length - 1; i >= 0; i--) {
        const r = matches[i]!;
        const leftLength = r.left.length;
        const rightLength1 = r.right1.length;
        const rightLength2 = r.right2.length;
        if (leftLength === 0 && rightLength1 === 0 && rightLength2 === 0) continue;

        const matchLength = r.full.length;
        const matchPosition = r.pos;
        const leftPosition = matchPosition;
        const rightPosition1 = matchPosition + matchLength - rightLength2 - rightLength1;
        const rightPosition2 = matchPosition + matchLength - rightLength2;

        let leftClasses = "";
        let rightPunctuation = "";

        if (leftLength > 0) {
            leftClasses = leftClassesForString(content.substring(leftPosition, leftPosition + leftLength));
        }

        let next = content.slice(0, matchPosition + matchLength)
            + "</span>"
            + content.slice(matchPosition + matchLength);

        if (rightLength2 > 0) {
            rightPunctuation = next.substring(rightPosition2, rightPosition2 + rightLength2);
            next = next.slice(0, rightPosition2) + next.slice(rightPosition2 + rightLength2);
        }
        if (rightLength1 > 0) {
            rightPunctuation = next.substring(rightPosition1, rightPosition1 + rightLength1) + rightPunctuation;
            next = next.slice(0, rightPosition1) + next.slice(rightPosition1 + rightLength1);
        }

        let rightClasses = "";
        if (rightPunctuation.length > 0) {
            rightClasses = rightClassesForString(rightPunctuation, talkId);
        }

        if (leftLength > 0) {
            next = next.slice(0, leftPosition) + next.slice(leftPosition + leftLength);
        }

        const ccontainer = `<span class="ccontainer${leftClasses}${rightClasses}">`;
        next = next.slice(0, matchPosition) + ccontainer + next.slice(matchPosition);

        content = next;
    }

    return content;
}

export function processTalkBody(text: string, id: number, direction: Direction): string {
    let content = text.replace(/<\?xml version="1\.0" encoding="UTF-8"\?>/g, "");
    content = content.split("&#xFEFF;").join("");
    content = applyEntityRoundtrip(content);
    // eslint-disable-next-line no-control-regex -- strip NUL bytes from source HTML
    content = content.replace(/\x00+/g, "");

    if (id >= 2000 && id < 10000) {
        content = updateTalkImage(content);
    }

    content = pageWithCitationPunctuationSubstitutions(content, direction, id);
    return content;
}

export interface ProcessTalkbodyConfig {
    talkbodyTable: string;
    direction: Direction;
}

interface TalkbodyRow extends mysql.RowDataPacket {
    TalkID: number;
    Text: string;
}

export async function runProcess(config: ProcessTalkbodyConfig): Promise<void> {
    const db = await createDb();
    try {
        const [rows] = await db.query<TalkbodyRow[]>(
            `SELECT TalkID, Text FROM ${config.talkbodyTable} WHERE ProcessedText IS NULL ORDER BY TalkID ASC`
        );

        let count = 0;
        for (const row of rows) {
            const id = row.TalkID;
            const processed = processTalkBody(row.Text, id, config.direction);

            await db.execute(
                `UPDATE ${config.talkbodyTable} SET ProcessedText=?, RawText=NULL, TagVector=NULL WHERE TalkID=?`,
                [processed, id]
            );

            count++;
            if (count % 200 === 0) console.log(`TalkID ${id}`);
        }
    } finally {
        await db.end();
    }
}
