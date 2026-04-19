import { parseLangArg } from "../lib/args.js";
import { runProcess } from "../lib/process-talkbody.js";
import { runMain } from "../lib/run-main.js";

const lang = parseLangArg();
const table = lang === "es" ? "talkbody2_es" : "talkbody2";

runMain(runProcess({ talkbodyTable: table, direction: lang }));
