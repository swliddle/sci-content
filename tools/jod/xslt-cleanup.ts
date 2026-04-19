// TypeScript port of edu.byu.ebiz.jod.html.XsltCleanup.
//
// Reads a JoD volume XML, runs three DOM cleanups per <Discourse>
//   1. drop whitespace-only #text children
//   2. merge continuation Paragraphs (Paragraph[@Cont]) into the previous one
//   3. strip trailing whitespace text node after a <hyphen>
// then applies the given XSLT 1.0 stylesheet to each Discourse and writes
// JoDNN_DiscourseNN.html into the output directory.
//
// XSLT engine: SaxonJS 2 (XSLT 3). Stylesheets are compiled to SEF JSON
// on-demand next to the .xsl file via the `xslt3` CLI.

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import SaxonJSUntyped from "saxon-js";
import { runMain } from "../lib/run-main.js";

// saxon-js ships no published types. Pin the one method we use (async
// transform returning a serialized string result) so callsites are typed.
interface SaxonTransformOptions {
    stylesheetInternal: unknown;
    sourceText: string;
    destination: "serialized";
}
interface SaxonTransformResult {
    principalResult: string;
}
interface SaxonJSApi {
    transform(opts: SaxonTransformOptions, mode: "async"): Promise<SaxonTransformResult>;
}
const SaxonJS = SaxonJSUntyped as SaxonJSApi;

interface Args {
    input: string;
    output: string;
    stylesheet: string;
    volume: string;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const out: Partial<Args> = {};
    const map: Record<string, keyof Args> = {
        "-i": "input",
        "--input": "input",
        "-o": "output",
        "--output": "output",
        "-s": "stylesheet",
        "--stylesheet": "stylesheet",
        "-v": "volume",
        "--volume": "volume",
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i]!;
        const key = map[flag];
        if (!key) {
            console.error(`Unknown argument: ${flag}`);
            usage();
        }
        const val = argv[++i];
        if (val === undefined) {
            console.error(`Missing value for ${flag}`);
            usage();
        }
        out[key] = val;
    }
    if (!out.input || !out.output || !out.stylesheet || !out.volume) {
        usage();
    }
    return out as Args;
}

function usage(): never {
    console.error(
        "Usage: xslt-cleanup.ts -i <source.xml> -o <outDir> -s <stylesheet.xsl> -v <volume>"
    );
    process.exit(1);
}

function volumePrefix(vol: string): string {
    const n = parseInt(vol, 10);
    if (!(n >= 1 && n <= 99)) {
        console.error(`Invalid volume: ${vol}`);
        process.exit(1);
    }
    return String(n).padStart(2, "0");
}

function discourseFilename(outDir: string, volPrefix: string, idx: number): string {
    const n = String(idx + 1).padStart(2, "0");
    return path.join(outDir, `JoD${volPrefix}_Discourse${n}.html`);
}

// -----------------------------------------------------------------------------
// SEF compilation (cache next to the .xsl file)
// -----------------------------------------------------------------------------

function ensureSef(xslPath: string): string {
    const sefPath = xslPath.replace(/\.xsl$/, ".sef.json");
    const xslStat = fs.statSync(xslPath);
    const sefStat = fs.existsSync(sefPath) ? fs.statSync(sefPath) : null;
    if (!sefStat || sefStat.mtimeMs < xslStat.mtimeMs) {
        console.log(`Compiling ${xslPath} → ${sefPath}`);
        execFileSync(
            "npx",
            ["xslt3", `-xsl:${xslPath}`, `-export:${sefPath}`, "-nogo", "-t"],
            { stdio: "inherit" }
        );
    }
    return sefPath;
}

// -----------------------------------------------------------------------------
// DOM cleanup passes
// -----------------------------------------------------------------------------

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function processDiscourse(discourse: Element): void {
    discourse.normalize?.();

    const children = discourse.childNodes;
    let index = 0;

    while (index < children.length) {
        const n = children.item(index);
        if (!n) break;

        if (n.nodeType === TEXT_NODE && (n.nodeValue ?? "").trim().length === 0) {
            discourse.removeChild(n);
            continue;
        }

        if (n.nodeType === ELEMENT_NODE && (n as Element).nodeName === "Paragraph") {
            const p = n as Element;
            removeWhitespaceAfterHyphen(p);

            if (p.hasAttribute("Cont")) {
                const prev = p.previousSibling;
                if (!prev) {
                    index++;
                    continue;
                }
                if (prev.nodeName !== "Paragraph") {
                    const realPar = prev.previousSibling;
                    if (realPar) {
                        realPar.appendChild(prev);
                        mergePar(discourse, realPar as Element, p);
                        index--;
                        continue;
                    }
                } else {
                    mergePar(discourse, prev as Element, p);
                    continue;
                }
            }
        }
        index++;
    }
}

function mergePar(discourse: Element, par: Element, cont: Element): void {
    // Strip leading whitespace from the continuation's first text child so
    // hyphenated words join cleanly. xmldom's XMLSerializer has a quirk: it
    // ignores mutations to nodeValue on parsed text nodes and serializes the
    // original text, so replace the node rather than reassigning its value.
    const first = cont.firstChild;
    if (first && first.nodeType === TEXT_NODE) {
        const doc = cont.ownerDocument;
        const stripped = (first.nodeValue ?? "").replace(/^\s+/, "");
        cont.replaceChild(doc.createTextNode(stripped), first);
    }

    while (cont.firstChild) {
        par.appendChild(cont.firstChild);
    }
    discourse.removeChild(cont);
}

function removeWhitespaceAfterHyphen(p: Element): void {
    const kids = p.childNodes;
    if (kids.length > 1) {
        const last = kids.item(kids.length - 1);
        const nextToLast = last?.previousSibling;
        if (nextToLast && nextToLast.nodeName === "hyphen") {
            p.removeChild(last);
        }
    }
}

// -----------------------------------------------------------------------------
// XSLT per-discourse output
// -----------------------------------------------------------------------------

async function writeHtmlFile(
    discourse: Element,
    filename: string,
    sef: unknown
): Promise<void> {
    const xml = new XMLSerializer().serializeToString(discourse);
    const result = await SaxonJS.transform(
        {
            stylesheetInternal: sef,
            sourceText: xml,
            destination: "serialized",
        },
        "async"
    );
    fs.writeFileSync(filename, normalizeOutput(result.principalResult), "utf8");
}

// Re-encode a fixed set of non-ASCII characters as named HTML entities so
// output matches Xalan's HTML serializer (which used the HTML DTD entity map).
function normalizeOutput(html: string): string {
    return html
        .replace(/\u2013/g, "&ndash;")
        .replace(/\u2014/g, "&mdash;")
        .replace(/\u2018/g, "&lsquo;")
        .replace(/\u2019/g, "&rsquo;")
        .replace(/\u201c/g, "&ldquo;")
        .replace(/\u201d/g, "&rdquo;")
        .replace(/\u2026/g, "&hellip;")
        .replace(/\u00a0/g, "&nbsp;");
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = parseArgs();
    const prefix = volumePrefix(args.volume);

    fs.mkdirSync(args.output, { recursive: true });

    const sefPath = ensureSef(args.stylesheet);
    const sef: unknown = JSON.parse(fs.readFileSync(sefPath, "utf8"));

    const xmlSrc = fs.readFileSync(args.input, "utf8");
    const doc = new DOMParser().parseFromString(xmlSrc, "text/xml");
    const root = doc.documentElement;
    console.log(root.tagName);

    const discourses = Array.from(
        doc.getElementsByTagName("Discourse")
    ) as unknown as Element[];

    for (let i = 0; i < discourses.length; i++) {
        const d = discourses[i]!;
        processDiscourse(d);
        const outFile = discourseFilename(args.output, prefix, i);
        console.log(`Writing ${outFile}`);
        await writeHtmlFile(d, outFile, sef);
    }
}

runMain(main());
