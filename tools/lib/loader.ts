import * as fs from "fs";
import * as path from "path";
import { createDb } from "./db.js";

// Subset of CorpusDefinition consumed by the load phase. Kept narrower than
// CorpusDefinition so corpora with different citation pipelines (e.g.
// gc-ensign, which doesn't use runAddCitations) can still share the loader.
export interface LoadConfig {
    fileStem: string;
    talkIdOffset: number;
    outDir: string;
    talkbodyTable: string;
    talkIdRange: [number, number];
    cleanContent?: (raw: string) => string;
    fileRegex?: RegExp;
}

export async function runLoad(config: LoadConfig): Promise<void> {
    const re = config.fileRegex ?? new RegExp(`^${config.fileStem}(\\d+)\\.html$`);
    const files = fs
        .readdirSync(config.outDir)
        .map((f) => {
            const m = f.match(re);
            if (!m || m[1] === undefined) return null;
            return { id: parseInt(m[1], 10), filePath: path.join(config.outDir, f) };
        })
        .filter((x): x is { id: number; filePath: string } => x !== null)
        .sort((a, b) => a.id - b.id);

    if (files.length === 0) {
        throw new Error(`No HTML files found in ${config.outDir}`);
    }

    const clean = config.cleanContent ?? defaultClean;
    const [low, high] = config.talkIdRange;
    const db = await createDb();

    try {
        await db.beginTransaction();

        try {
            await db.execute(
                `DELETE FROM ${config.talkbodyTable} WHERE TalkID >= ? AND TalkID <= ?`,
                [low, high]
            );

            for (const { id, filePath } of files) {
                const talkId = config.talkIdOffset + id;
                const content = clean(fs.readFileSync(filePath, "utf8"));

                await db.execute(
                    `INSERT INTO ${config.talkbodyTable} (TalkID, Text) VALUES (?, ?)`,
                    [talkId, content]
                );

                console.log(`load ${config.fileStem} ${id} (TalkID ${talkId})`);
            }

            await db.commit();
        } catch (e) {
            await db.rollback();
            throw e;
        }
    } finally {
        await db.end();
    }
}

function defaultClean(raw: string): string {
    return raw
        .replace(/<\?xml[^?]*\?>\s*/, "")
        .replace(/<!DOCTYPE[^>]*>\s*/, "")
        .replace(/<html>\s*<body>/, "")
        .replace(/<\/body>\s*<\/html>/, "")
        .trim();
}
