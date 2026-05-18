// Package a built mobile content SQLite DB into a .zip archive and emit
// the companion .config XML manifest (src/dest filename, byte size, md5).
// Replaces the tail end of mobile/CREATE_CONTENT_DB[_ES] — the zip + jar
// + config generation steps.
//
// Layout after running ($V = MOBILE_VERSION = CORE_VERSION, from tools/core/VERSION):
//     out/mobile/content.$V.db                (input)
//     out/mobile/sci-content.$V.zip           (archive containing the db)
//     out/mobile/sci-content.$V.config        (manifest for the deploy)
//
// Usage:
//     npx tsx tools/mobile/package.ts --lang en|es

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { LANG_CONFIG, MOBILE_VERSION, mobileOutDir, parseLangArg } from "./config.js";

function md5File(filePath: string): string {
    const hash = crypto.createHash("md5");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
}

// Matches the exact text layout the old bash script produced (via a chain
// of `echo -n` / `echo` calls). Attribute values are not XML-escaped —
// filenames + digits + hex only, so it doesn't matter here. Kept
// identical so consumers that parse the file position-ally aren't
// surprised.
function renderConfig(zipFileName: string, size: number, md5: string): string {
    return (
        `<config version="${MOBILE_VERSION}">\n` +
        `  <file src="${zipFileName}" dest="${zipFileName}"\n` +
        `        size="${size}" md5="${md5}" />\n` +
        `</config>\n`
    );
}

function main(): void {
    const lang = parseLangArg();
    const variant = LANG_CONFIG[lang];
    const outDir = mobileOutDir();

    const dbPath = path.join(outDir, variant.dbFileName);
    const zipPath = path.join(outDir, variant.zipFileName);
    const configPath = path.join(outDir, variant.configFileName);

    if (!fs.existsSync(dbPath)) {
        console.error(`[mobile package ${lang}] missing db: ${dbPath}`);
        console.error(`run: npx tsx tools/mobile/build.ts --lang ${lang}`);
        process.exit(1);
    }

    fs.rmSync(zipPath, { force: true });

    // `zip` CLI is ubiquitous on macOS and Linux. We cd into outDir so the
    // archive entry is just the bare filename (no `out/mobile/` prefix),
    // matching the old mobile/CREATE_CONTENT_DB output.
    execFileSync("zip", ["-q", variant.zipFileName, variant.dbFileName], {
        cwd: outDir,
        stdio: "inherit"
    });

    const size = fs.statSync(zipPath).size;
    const md5 = md5File(zipPath);
    fs.writeFileSync(configPath, renderConfig(variant.zipFileName, size, md5), "utf8");

    console.log(`[mobile package ${lang}] ${zipPath} (${size} bytes)`);
    console.log(`[mobile package ${lang}] ${configPath} md5=${md5}`);
}

main();
