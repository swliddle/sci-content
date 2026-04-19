import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { parse } from "node-html-parser";

import {
    placeCitationsFromRows,
    type JodCitationRow
} from "../../tools/lib/jod-citations.js";

const FIXTURES_ROOT = path.join(
    url.fileURLToPath(new URL(".", import.meta.url)),
    "fixtures"
);

interface Meta {
    vol: number;
}

interface Fixture {
    name: string;
    meta: Meta;
    input: string;
    rows: JodCitationRow[];
    expected: string;
}

function discoverFixtures(): Fixture[] {
    const out: Fixture[] = [];
    for (const caseName of fs.readdirSync(FIXTURES_ROOT).sort()) {
        const dir = path.join(FIXTURES_ROOT, caseName);
        out.push({
            name: caseName,
            meta: JSON.parse(
                fs.readFileSync(path.join(dir, "meta.json"), "utf8")
            ) as Meta,
            input: fs.readFileSync(path.join(dir, "input.html"), "utf8"),
            rows: JSON.parse(
                fs.readFileSync(path.join(dir, "rows.json"), "utf8")
            ) as JodCitationRow[],
            expected: fs.readFileSync(path.join(dir, "expected.html"), "utf8")
        });
    }
    return out;
}

for (const fx of discoverFixtures()) {
    test(fx.name, () => {
        const root = parse(fx.input, { lowerCaseTagName: false, comment: true });
        placeCitationsFromRows(root, fx.meta.vol, fx.rows);
        assert.strictEqual(root.toString(), fx.expected);
    });
}
