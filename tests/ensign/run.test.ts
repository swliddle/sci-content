import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

import {
    replaceCitationsOld,
    rewriteCitationsNew,
    type EnsignCitationRow,
    type EnsignEnv,
    type MaxVerses
} from "../../tools/lib/ensign-citations.js";
import { EN_CONFIG, ES_CONFIG, type EnsignConfig } from "../../tools/lib/ensign-config.js";

const FIXTURES_ROOT = path.join(
    url.fileURLToPath(new URL(".", import.meta.url)),
    "fixtures"
);

interface Meta {
    config: "en" | "es";
    mode: "old" | "new";
    talkId: number;
    protocol?: string;
    server?: string;
    // Nested {bookId: {chapter: maxVerse}}; serialized as JSON object since
    // Map doesn't round-trip through JSON.stringify.
    maxVerses?: Record<string, Record<string, number>>;
}

function resolveConfig(tag: Meta["config"]): EnsignConfig {
    return tag === "en" ? EN_CONFIG : ES_CONFIG;
}

function buildMaxVerses(raw: Meta["maxVerses"]): MaxVerses {
    const result: MaxVerses = new Map();
    if (!raw) return result;
    for (const [bookId, chapters] of Object.entries(raw)) {
        const inner = new Map<number, number>();
        for (const [chapter, max] of Object.entries(chapters)) {
            inner.set(parseInt(chapter, 10), max);
        }
        result.set(parseInt(bookId, 10), inner);
    }
    return result;
}

interface Fixture {
    name: string;
    meta: Meta;
    input: string;
    rows: EnsignCitationRow[];
    expected: string;
}

function discoverFixtures(): Fixture[] {
    const out: Fixture[] = [];
    for (const corpus of fs.readdirSync(FIXTURES_ROOT).sort()) {
        const corpusDir = path.join(FIXTURES_ROOT, corpus);
        for (const caseName of fs.readdirSync(corpusDir).sort()) {
            const dir = path.join(corpusDir, caseName);
            out.push({
                name: `${corpus}/${caseName}`,
                meta: JSON.parse(
                    fs.readFileSync(path.join(dir, "meta.json"), "utf8")
                ) as Meta,
                input: fs.readFileSync(path.join(dir, "input.html"), "utf8"),
                rows: JSON.parse(
                    fs.readFileSync(path.join(dir, "rows.json"), "utf8")
                ) as EnsignCitationRow[],
                expected: fs.readFileSync(path.join(dir, "expected.html"), "utf8")
            });
        }
    }
    return out;
}

// Both seams log "found ... but ====>" lines whenever the placeholder anchor
// text doesn't match the computed reference, which is expected for shortened
// fixture inputs. Suppress so passing runs stay quiet.
function silencingLogs<T>(fn: () => T): T {
    const original = console.log;
    console.log = () => {};
    try {
        return fn();
    } finally {
        console.log = original;
    }
}

for (const fx of discoverFixtures()) {
    test(fx.name, () => {
        const env: EnsignEnv = {
            protocol: fx.meta.protocol ?? "http",
            server: fx.meta.server ?? "www.lds.org",
            maxVerses: buildMaxVerses(fx.meta.maxVerses),
            cfg: resolveConfig(fx.meta.config)
        };

        const seam = fx.meta.mode === "old" ? replaceCitationsOld : rewriteCitationsNew;
        const actual = silencingLogs(() => seam(fx.input, fx.meta.talkId, fx.rows, env));
        assert.strictEqual(actual, fx.expected);
    });
}
