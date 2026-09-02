import { readFile, writeFile } from "node:fs/promises";

const controllerPath =
	process.env.BROWSERJS_CONTROLLER_PATH ??
	"./packages/chrome/src/proxy/Controller.ts";
const original = "return Math.abs(hash).toString(36).substring(0, 8);";
const replacement =
	"return `bjs-${Math.abs(hash).toString(36).substring(0, 8)}`;";

const source = await readFile(controllerPath, "utf8");
if (!source.includes(original)) {
	throw new Error("Unable to locate the browser.js isolation hash function");
}

await writeFile(controllerPath, source.replace(original, replacement));
