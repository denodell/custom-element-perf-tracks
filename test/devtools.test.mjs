// End-to-end: run the demo in a real Chrome/Chromium, record a performance
// trace, and parse it with Chrome DevTools' own trace engine (the code the
// Performance panel uses) to check which tracks it would draw.
// Set CHROME_PATH if Chrome is not found.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, findChrome, launch } from "./browser/harness.mjs";

const skip = findChrome() ? false : "no Chrome found; set CHROME_PATH to run browser tests";

const CLICKS = ["v-define", "v-add", "v-attr", "l-one", "l-five", "l-heavy", "s-cycle", "v-remove"];

async function recordDemo(query) {
  const server = await serve();
  const browser = await launch();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cept-")), "trace.json");
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${server.origin}/demo/index.html${query}`, { waitUntil: "networkidle0" });
    await page.tracing.start({ path: file });
    for (const id of CLICKS) {
      await page.click(`#${id}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.tracing.stop();
    assert.deepEqual(errors, [], "page errors");
  } finally {
    await browser.close();
    server.close();
  }

  // Parse with DevTools' trace engine.
  const { analyzeEvents } = await import("@paulirish/trace_engine/analyze-trace.mjs");
  const { traceEvents } = JSON.parse(fs.readFileSync(file, "utf8"));
  const { parsedTrace } = await analyzeEvents(traceEvents);
  const data = parsedTrace.data?.ExtensionTraceData ?? parsedTrace.ExtensionTraceData;
  return data.extensionTrackData;
}

function summarise(groups) {
  const group = groups.find((g) => g.name === "Web Components");
  assert.ok(group, `no "Web Components" group; got ${groups.map((g) => g.name)}`);
  return Object.fromEntries(
    Object.entries(group.entriesByTrack).map(([track, entries]) => [track, entries]),
  );
}

for (const [mode, query] of [["measure", ""], ["timestamp", "?strategy=timestamp"]]) {
  test(`DevTools draws all three tracks (${mode} mode)`, { skip, timeout: 120000 }, async () => {
    const tracks = summarise(await recordDemo(query));
    assert.deepEqual(Object.keys(tracks).sort(), ["Lifecycle", "Updates", "Upgrade"]);

    const names = (t) => tracks[t].map((e) => e.name);
    assert.deepEqual(names("Upgrade"), ["<demo-card> define"]);
    assert.ok(names("Lifecycle").includes("<demo-card> connected"));
    assert.ok(names("Lifecycle").includes("<demo-card> attributeChanged"));
    assert.ok(names("Lifecycle").includes("<demo-card> disconnected"));
    assert.ok(names("Updates").includes("<demo-counter> update"));
    assert.ok(names("Updates").includes("<fake-stencil-widget> render"));

    const colors = new Set(Object.values(tracks).flat().map((e) => e.devtoolsObj?.color));
    assert.ok(colors.has("tertiary") && colors.has("secondary"), [...colors].join());

    if (mode === "measure") {
      const define = tracks.Upgrade[0].devtoolsObj;
      assert.deepEqual(define.properties, [["elements upgraded", "20"]]);
      const five = tracks.Updates.find((e) =>
        e.devtoolsObj?.properties?.some(([k, v]) => k === "changes batched" && v === "5"),
      );
      assert.ok(five, "a Lit update that batched 5 changes");
    }
  });
}
