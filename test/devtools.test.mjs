import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve, findChrome, launch } from "./browser/harness.mjs";

const skip = findChrome() ? false : "no Chrome found; set CHROME_PATH to run browser tests";

const CLICKS = ["v-define", "v-add", "v-attr", "l-one", "l-five", "l-heavy", "l-cascade", "s-cycle", "v-remove"];

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

  const { analyzeEvents } = await import("@paulirish/trace_engine/analyze-trace.mjs");
  const { traceEvents } = JSON.parse(fs.readFileSync(file, "utf8"));
  const { parsedTrace } = await analyzeEvents(traceEvents);
  return parsedTrace.data?.ExtensionTraceData ?? parsedTrace.ExtensionTraceData;
}

const clean = (name) => name.replace(/^\u200b/, "");

function summarise(data) {
  const group = data.extensionTrackData.find((g) => g.name === "Web Components");
  assert.ok(group, `no "Web Components" group; got ${data.extensionTrackData.map((g) => g.name)}`);
  return group.entriesByTrack;
}

const props = (entry) => Object.fromEntries(entry.devtoolsObj?.properties ?? []);

for (const [mode, query] of [
  ["auto", ""],
  ["measure", "?strategy=measure"],
  ["timestamp", "?strategy=timestamp"],
]) {
  test(`DevTools draws the React-style tracks (${mode} mode)`, { skip, timeout: 120000 }, async () => {
    const data = await recordDemo(query);
    const tracks = summarise(data);
    assert.deepEqual(Object.keys(tracks).sort(), ["Components", "Scheduler", "Upgrade"]);
    const names = (t) => tracks[t].map((e) => clean(e.name));

    assert.deepEqual(names("Upgrade"), ["demo-card define"]);

    for (const name of [
      "demo-card connected",
      "demo-card attributeChanged",
      "demo-card disconnected",
      "demo-counter",
      "demo-badge",
      "fake-stencil-widget",
    ]) {
      assert.ok(names("Components").includes(name), `Components is missing ${name}`);
    }

    for (const name of ["Event: click", "Render", "Commit", "Cascading Update"]) {
      assert.ok(names("Scheduler").includes(name), `Scheduler is missing ${name}`);
    }

    const cascade = tracks.Scheduler.find((e) => clean(e.name) === "Cascading Update");
    const children = [...data.entryToNode.values()]
      .filter((node) => node.parent?.entry === cascade)
      .map((node) => clean(node.entry.name));
    assert.ok(children.includes("Render"), `Cascading Update contains ${children}`);

    const colors = new Set(Object.values(tracks).flat().map((e) => e.devtoolsObj?.color));
    for (const c of ["warning", "primary-dark", "secondary-dark", "error", "tertiary"]) {
      assert.ok(colors.has(c), `missing color ${c}; got ${[...colors]}`);
    }

    if (mode === "timestamp") {
      const withDetails = Object.values(tracks).flat().filter((e) => e.devtoolsObj?.properties?.length);
      assert.equal(withDetails.length, 0);
      return;
    }

    assert.deepEqual(props(tracks.Upgrade[0]), { "Elements upgraded": "20" });

    const counter = tracks.Components.filter((e) => clean(e.name) === "demo-counter");
    const five = counter.find((e) => props(e)["Changes batched"] === "5");
    assert.ok(five, "a demo-counter render that batched 5 changes");
    assert.deepEqual(five.devtoolsObj.properties, [
      ["Changes batched", "5"],
      ["Changed Props", ""],
      ["-\u00a0count", "1"],
      ["+\u00a0count", "6"],
    ]);

    const badge = tracks.Components.find((e) => clean(e.name) === "demo-badge");
    assert.equal(props(badge)["Triggered by"], "demo-counter");

    assert.deepEqual(props(cascade), {
      "Component name": "demo-counter",
      "Requested during": "updated()",
    });
  });
}
