import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };

export function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        res.end(buf);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

let coverageFiles = 0;

export async function launch() {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const dir = process.env.COVERAGE_DIR;
  if (!dir) return browser;

  const pages = [];
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await newPage();
    await page.coverage.startJSCoverage({ includeRawScriptCoverage: true, resetOnNavigation: false });
    pages.push(page);
    return page;
  };
  const close = browser.close.bind(browser);
  browser.close = async () => {
    for (const page of pages) {
      const entries = await page.coverage.stopJSCoverage().catch(() => []);
      const result = entries
        .filter((e) => e.rawScriptCoverage && new URL(e.url).pathname.startsWith("/dist/"))
        .map((e) => ({
          ...e.rawScriptCoverage,
          url: "file://" + path.join(root, new URL(e.url).pathname),
        }));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `coverage-browser-${process.pid}-${coverageFiles++}.json`),
        JSON.stringify({ result }),
      );
    }
    return close();
  };
  return browser;
}
