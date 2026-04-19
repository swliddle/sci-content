// Package a built mobile-core SQLite DB into the deploy .zip archive and
// emit the companion .config manifest + Constants.java file. Replaces the
// tail end of core/CREATE_MOBILE_DB[_ES] — the tmp-dir copy + zip + config
// + Java snippet steps.
//
// Layout after running:
//     out/core/core.52.db               (input — from tools/core/build.ts)
//     out/mobile/content.52.db          (input — from tools/mobile/build.ts)
//     $LUCENE_DIR/                      (input — Lucene index directory)
//     out/core/sci.52.zip               (output — archive bundling all three)
//     out/core/sci.52.config            (output — deploy manifest)
//     out/core/Constants.java           (output — Android ConfigurationConstants snippet)
//
// Usage:
//     npx tsx tools/core/package.ts --lang en|es
//
// Environment:
//     CORE_OUT_DIR     destination directory           (default: out/core)
//     MOBILE_OUT_DIR   where content.$V.db lives       (default: out/mobile)
//     CORE_LUCENE_EN   EN lucene dir override
//     CORE_LUCENE_ES   ES lucene dir override
//
// Both the .zip layout and the .config XML text are preserved byte-for-byte
// with the old bash version — consumers (the Android app, the deploy
// scripts) parse these position-ally.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
    CORE_VERSION,
    CORE_SCHEMA_VERSION,
    CONTENT_SCHEMA_VERSION,
    LANG_CONFIG,
    coreOutDir,
    luceneDir,
    mobileOutDir,
    parseLangArg
} from "./config.js";

function md5File(filePath: string): string {
    const hash = crypto.createHash("md5");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
}

// Sum the sizes of all regular files directly in `dir` (non-recursive —
// matches `wc --bytes $LUCENE_FILES/*` which only reads one level).
function sumDirFileSizes(dir: string): number {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile()) {
            total += fs.statSync(path.join(dir, entry.name)).size;
        }
    }
    return total;
}

interface ConfigPieces {
    zipFileName: string;
    zipSize: number;
    zipMd5: string;
    contentFileName: string;
    contentSize: number;
    contentMd5: string;
    coreFileName: string;
    coreSize: number;
    coreMd5: string;
    luceneSize: number;
}

// Matches the exact text layout the old bash script produced via a chain
// of `echo -n` / `echo` calls. Two-space indent inside <config>, double
// quotes, no XML escaping (filenames + digits + hex only).
function renderConfig(p: ConfigPieces): string {
    return (
        `<config version="${CORE_VERSION}">\n` +
        `  <file name="${p.zipFileName}" size="${p.zipSize}" md5="${p.zipMd5}" />\n` +
        `  <entry name="${p.contentFileName}" type="file" schema="${CONTENT_SCHEMA_VERSION}" size="${p.contentSize}" md5="${p.contentMd5}" />\n` +
        `  <entry name="${p.coreFileName}" type="file" schema="${CORE_SCHEMA_VERSION}" size="${p.coreSize}" md5="${p.coreMd5}" />\n` +
        `  <entry name="lucene" type="folder" size="${p.luceneSize}" />\n` +
        `</config>\n`
    );
}

// Matches the heredoc in CREATE_MOBILE_DB[_ES] — preserved exactly because
// the Android build pastes this snippet into ConfigurationConstants.java.
function renderConstants(
    varName: string,
    langSuffix: string,
    p: ConfigPieces
): string {
    return (
        `    private static final ConfigurationConstants ${varName} = new ConfigurationConstants(${CORE_SCHEMA_VERSION}, ${p.coreSize}, ${CONTENT_SCHEMA_VERSION}, ${p.contentSize},\n` +
        `            ${p.zipSize}, "${p.zipMd5}", ${p.luceneSize}, "${langSuffix}");\n`
    );
}

function main(): void {
    const lang = parseLangArg();
    const variant = LANG_CONFIG[lang];

    const coreDir = coreOutDir();
    const mobileDir = mobileOutDir();
    const lucene = luceneDir(lang);

    const corePath = path.join(coreDir, variant.coreFileName);
    const contentPath = path.join(mobileDir, variant.contentFileName);
    const zipPath = path.join(coreDir, variant.zipFileName);
    const configPath = path.join(coreDir, variant.configFileName);
    const constantsPath = path.join(coreDir, variant.constantsFileName);

    for (const [label, p] of [
        ["core db", corePath],
        ["content db", contentPath],
        ["lucene dir", lucene]
    ] as const) {
        if (!fs.existsSync(p)) {
            console.error(`[core package ${lang}] missing ${label}: ${p}`);
            if (label === "core db") {
                console.error(`run: npx tsx tools/core/build.ts --lang ${lang}`);
            } else if (label === "content db") {
                console.error(`run: npx tsx tools/mobile/build.ts --lang ${lang}`);
            } else {
                console.error(`set CORE_LUCENE_${lang.toUpperCase()} to override`);
            }
            process.exit(1);
        }
    }

    // Stage core.db + content.db + lucene/ into a fresh tmp dir, then zip
    // it from inside so archive entries are bare filenames (no tmp/
    // prefix). Matches the old bash layout. Using cp -R preserves the
    // symlink-safe behavior of the original.
    const tmpDir = fs.mkdtempSync(path.join(coreDir, ".pkg."));
    try {
        fs.copyFileSync(corePath, path.join(tmpDir, variant.coreFileName));
        fs.copyFileSync(contentPath, path.join(tmpDir, variant.contentFileName));
        execFileSync("cp", ["-R", lucene, path.join(tmpDir, "lucene")], { stdio: "inherit" });

        fs.rmSync(zipPath, { force: true });
        execFileSync(
            "zip",
            ["-9qr", path.resolve(zipPath), variant.coreFileName, variant.contentFileName, "lucene"],
            { cwd: tmpDir, stdio: "inherit" }
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const pieces: ConfigPieces = {
        zipFileName: variant.zipFileName,
        zipSize: fs.statSync(zipPath).size,
        zipMd5: md5File(zipPath),
        contentFileName: variant.contentFileName,
        contentSize: fs.statSync(contentPath).size,
        contentMd5: md5File(contentPath),
        coreFileName: variant.coreFileName,
        coreSize: fs.statSync(corePath).size,
        coreMd5: md5File(corePath),
        luceneSize: sumDirFileSizes(lucene)
    };

    fs.writeFileSync(configPath, renderConfig(pieces), "utf8");
    fs.writeFileSync(
        constantsPath,
        renderConstants(variant.constantsVarName, variant.constantsLangSuffix, pieces),
        "utf8"
    );

    console.log(`[core package ${lang}] ${zipPath} (${pieces.zipSize} bytes, md5=${pieces.zipMd5})`);
    console.log(`[core package ${lang}]   core=${pieces.coreSize} content=${pieces.contentSize} lucene=${pieces.luceneSize}`);
    console.log(`[core package ${lang}] ${configPath}`);
    console.log(`[core package ${lang}] ${constantsPath}`);
}

main();
