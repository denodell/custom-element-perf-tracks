import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, launch } from "./browser/harness.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(repo, "test", "stencil-app");
const skip = findChrome() ? false : "no Chrome found; set CHROME_PATH to run browser tests";

function build() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cept-stencil-"));
  execFileSync(process.execPath, [path.join(repo, "node_modules/@stencil/core/bin/stencil"), "build", "--dev"], {
    cwd: app,
    env: { ...process.env, STENCIL_OUT: out },
    stdio: "pipe",
  });
  return out;
}

function serve(out) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = url.startsWith("/dist/") ? path.join(repo, url) : path.join(out, url === "/" ? "index.html" : url);
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html" : "text/javascript" });
        res.end(buf);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

test("real Stencil timings become React-style bars", { skip, timeout: 180000 }, async () => {
  const out = build();
  const server = await serve(out);
  const browser = await launch();
  const trace = path.join(out, "trace.json");
  let rendered;
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.tracing.start({ path: trace });
    await page.goto(server.origin, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => document.querySelector("my-counter").shadowRoot.querySelector("button").click());
      await new Promise((r) => setTimeout(r, 200));
    }
    rendered = await page.evaluate(() => document.querySelector("my-counter").shadowRoot.textContent);
    await page.tracing.stop();
    assert.deepEqual(errors, [], "page errors");
  } finally {
    await browser.close();
    server.close();
  }
  assert.match(rendered, /count: 2/);

  const { analyzeEvents } = await import("@paulirish/trace_engine/analyze-trace.mjs");
  const { parsedTrace } = await analyzeEvents(JSON.parse(fs.readFileSync(trace, "utf8")).traceEvents);
  const data = parsedTrace.data?.ExtensionTraceData ?? parsedTrace.ExtensionTraceData;
  const group = data.extensionTrackData.find((g) => g.name === "Web Components · Tuppence");
  assert.ok(group, "no Web Components · Tuppence group");
  const tracks = group.entriesByTrack;
  const names = (t) => (tracks[t] ?? []).map((e) => e.name.replace(/^​/, ""));
  const count = (t, n) => names(t).filter((x) => x === n).length;

  try {
    checkBars(tracks, names, count, data);
  } catch (error) {
    const summary = Object.entries(tracks)
      .map(([t, es]) => `${t}: ${es.map((e) => `${e.name.replace(/^\u200b/, "")} ${(e.dur / 1000).toFixed(2)}ms`).join(", ")}`)
      .join("\n");
    error.message += `\n\nBars drawn:\n${summary}`;
    throw error;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

function checkBars(tracks, names, count, data) {
  assert.equal(count("Scheduler", "Render and Commit"), 6, names("Scheduler").join());
  assert.ok(count("Components", "my-counter") >= 3 + 2, "renders, and componentDidUpdate after each click");
  assert.ok(count("Components", "my-badge") >= 3);
  assert.ok(names("Components").includes("my-counter connected"));
  assert.ok(names("Components").includes("my-badge connected"));
  assert.ok(names("Components").includes("my-counter scheduleUpdate"), "componentWillUpdate work is drawn");
  const scheduled = tracks.Components.filter((e) => e.name.endsWith("scheduleUpdate"));
  assert.ok(scheduled.every((e) => e.dur >= 50), "every drawn one is at least minDuration (0.05 ms)");
  assert.deepEqual(names("Upgrade").filter((n) => n.endsWith("createInstance")).sort(), [
    "my-badge createInstance",
    "my-counter createInstance",
  ]);

  const loads = Object.entries(tracks)
    .filter(([t]) => t.startsWith("Loading"))
    .flatMap(([, es]) => es.map((e) => e.name.replace(/^\u200b/, "")));
  assert.ok(loads.includes("my-counter"), `loads: ${loads}`);
  assert.ok(loads.includes("my-badge"), `loads: ${loads}`);
  assert.ok(loads.some((n) => /initial load \(by /.test(n)), `loads: ${loads}`);

  const badgeConnected = tracks.Components.find((e) => e.name.replace(/^​/, "") === "my-badge connected");
  assert.equal(data.entryToNode.get(badgeConnected)?.parent?.entry?.name.replace(/^​/, ""), "my-counter");
}
