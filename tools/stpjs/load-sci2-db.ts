import { runLoad } from "../lib/loader.js";
import { runMain } from "../lib/run-main.js";
import { buildConfig, parseLangArg } from "./config.js";

async function main(): Promise<void> {
    await runLoad(buildConfig(parseLangArg()));
}

runMain(main());
