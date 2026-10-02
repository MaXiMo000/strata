// Lighthouse against a Playwright-launched Chromium (chrome-launcher can't spawn it on this Windows box).
// Usage: node scripts/lighthouse.mjs [url] [out.json]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const url = process.argv[2] ?? "http://localhost:8012/";
const out = process.argv[3] ?? "lighthouse.json";
const port = 9333;
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  execFileSync("npx", ["-y", "lighthouse@12", url, `--port=${port}`, "--only-categories=performance,accessibility,best-practices",
    "--output=json", `--output-path=${out}`], { stdio: "inherit", shell: true });
} finally {
  await browser.close();
}
