import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

import {
    applyCitations,
    type CitationRow,
    type CorpusDefinition
} from "../../tools/lib/citations.js";
import { buildConfig as buildGcEraConfig } from "../../tools/gc-era/config.js";
import { buildConfig as buildStpjsConfig } from "../../tools/stpjs/config.js";

const FIXTURES_ROOT = path.join(
    url.fileURLToPath(new URL(".", import.meta.url)),
    "fixtures"
);

function resolveConfig(tag: string): CorpusDefinition {
    switch (tag) {
        case "gc-era":
            return buildGcEraConfig();
        case "stpjs-en":
            return buildStpjsConfig("en");
        case "stpjs-es":
            return buildStpjsConfig("es");
        default:
            throw new Error(`Unknown config tag: ${tag}`);
    }
}

interface Fixture {
    name: string;
    configTag: string;
    input: string;
    rows: CitationRow[];
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
                configTag: fs.readFileSync(path.join(dir, "config"), "utf8").trim(),
                input: fs.readFileSync(path.join(dir, "input.html"), "utf8"),
                rows: JSON.parse(
                    fs.readFileSync(path.join(dir, "rows.json"), "utf8")
                ) as CitationRow[],
                expected: fs.readFileSync(path.join(dir, "expected.html"), "utf8")
            });
        }
    }
    return out;
}

// applyCitations logs a "found ... but ====>" line whenever the placeholder
// anchor text doesn't match the computed reference (expected for shortened
// fixture inputs). Suppress so passing runs stay quiet.
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
        const config = resolveConfig(fx.configTag);
        const actual = silencingLogs(() =>
            applyCitations(config, 1, fx.input, fx.rows)
        );
        assert.strictEqual(actual, fx.expected);
    });
}
