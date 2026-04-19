import { runLoad } from "../lib/loader.js";
import { runMain } from "../lib/run-main.js";
import { buildConfig } from "./config.js";

async function main(): Promise<void> {
    await runLoad(buildConfig());
}

runMain(main());
