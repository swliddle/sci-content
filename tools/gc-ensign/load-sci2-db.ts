import { runLoad } from "../lib/loader.js";
import { runMain } from "../lib/run-main.js";
import {
    buildConfig,
    GC_ENSIGN_TALK_ID_OFFSET,
    GC_ENSIGN_TALK_ID_RANGE,
    parseLangArg
} from "./config.js";

async function main(): Promise<void> {
    const run = buildConfig(parseLangArg());

    await runLoad({
        fileStem: "",
        outDir: run.outDir,
        talkbodyTable: run.talkbodyTable,
        talkIdRange: GC_ENSIGN_TALK_ID_RANGE,
        talkIdOffset: GC_ENSIGN_TALK_ID_OFFSET,
        fileRegex: /^(\d+)$/,
        cleanContent: (raw) => raw.trim()
    });
}

runMain(main());
