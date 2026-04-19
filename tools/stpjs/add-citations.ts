import { argValue } from "../lib/args.js";
import { runAddCitations, type CorpusDefinition } from "../lib/citations.js";
import { runMain } from "../lib/run-main.js";
import { buildConfig, parseLangArg } from "./config.js";

function parseIdsArg(config: CorpusDefinition): number[] | undefined {
    const { firstId, lastId } = config;

    const pageRaw = argValue("--page");
    if (pageRaw !== undefined) {
        const page = parseInt(pageRaw, 10);

        if (!Number.isFinite(page) || page < firstId || page > lastId) {
            throw new Error(`Invalid --page: ${pageRaw}`);
        }

        return [page];
    }

    const rangeRaw = argValue("--range");
    if (rangeRaw !== undefined) {
        const parts = rangeRaw.split("-");
        const lo = parseInt(parts[0] ?? "", 10);
        const hi = parseInt(parts[1] ?? "", 10);

        if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
            throw new Error(`Invalid --range: ${rangeRaw}`);
        }

        const ids: number[] = [];
        for (let p = Math.max(lo, firstId); p <= Math.min(hi, lastId); p++) {
            ids.push(p);
        }
        return ids;
    }

    return undefined;
}

async function main(): Promise<void> {
    const config = buildConfig(parseLangArg());
    const ids = parseIdsArg(config);
    await runAddCitations(config, ids !== undefined ? { ids } : {});
}

runMain(main());
