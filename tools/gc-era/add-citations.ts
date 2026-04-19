import { runAddCitations } from "../lib/citations.js";
import { runMain } from "../lib/run-main.js";
import { buildConfig } from "./config.js";

async function main(): Promise<void> {
    await runAddCitations(buildConfig());
}

runMain(main());
