// Screenshots at the widths docs/DESIGN.md asks for. Usage: node scripts/shots.mjs <outdir> [base-url]
// Each state: arrival, and located at 350 5th Ave (a URL with lat/lon, so no geocoder call).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "../docs/screenshots/1e";
const base = process.argv[3] ?? "http://localhost:8012";
const states = {
  arrival: "/",
  located: "/?q=350+5th+Avenue%2C+Manhattan&lat=40.74844&lon=-73.98566&z=16.4&year=1916",
  swipe: "/?q=350+5th+Avenue%2C+Manhattan&lat=40.74844&lon=-73.98566&z=15.6&year=1916&swipe=1",
};
const sizes = { 390: [390, 844], 1440: [1440, 900] };
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [w, [width, height]] of Object.entries(sizes)) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: Number(process.env.SHOTS_DPR ?? 2), isMobile: width < 768, hasTouch: width < 768 });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const [name, path] of Object.entries(states)) {
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(name === "arrival" ? 2500 : 9000); // flights, warps and IIIF tiles settle
    await page.screenshot({ path: `${out}/${name}-${w}.png` });
    console.log(`${name}-${w}.png`);
  }
  if (errors.length) console.log(`console errors at ${w}:\n  ` + [...new Set(errors)].join("\n  "));
  await page.close();
}
await browser.close();
