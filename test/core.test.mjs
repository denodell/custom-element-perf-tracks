import { test } from "node:test";
import assert from "node:assert/strict";
import { PerformanceObserver } from "node:perf_hooks";
import { configure, getConfig, emit, timed, rerouteMeasures } from "../dist/index.js";
import { observeStencilProfile } from "../dist/adapters/stencil.js";

function collect() {
  const seen = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.detail?.devtools) seen.push(e);
  });
  obs.observe({ entryTypes: ["measure"] });
  return { seen, stop: () => obs.disconnect() };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

// Read bars back as measures.
configure({ strategy: "measure" });
let n = 0;
const unique = (s) => `${s}-${n++}`;

test("emit writes a DevTools track entry", async () => {
  const { seen, stop } = collect();
  emit("<x-a> render", performance.now() - 5, performance.now(), {
    track: "Updates",
    color: "secondary",
    properties: () => [["k", "v"]],
  });
  await tick();
  stop();
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].detail.devtools, {
    dataType: "track-entry",
    trackGroup: "Web Components",
    track: "Updates",
    color: "secondary",
    properties: [["k", "v"]],
    tooltipText: "<x-a> render",
  });
  assert.equal(seen[0].name, "<x-a> render", "measure strategy keeps the plain name");
});

test("emit does nothing when disabled", async () => {
  configure({ enabled: false });
  const { seen, stop } = collect();
  emit("<x-b> render", 0, 1, { track: "Updates" });
  await tick();
  stop();
  configure({ enabled: true });
  assert.equal(seen.length, 0);
});

test("auto strategy: details go through a measure that is cleared, under an invisible prefix", async () => {
  configure({ strategy: "auto" });
  const { seen, stop } = collect();
  performance.measure("same-name", { start: 0, end: 1 });
  emit("same-name", performance.now() - 1, performance.now(), { track: "Components", properties: [["k", "v"]] });
  await tick();
  stop();
  configure({ strategy: "measure" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "\u200bsame-name");
  assert.equal(performance.getEntriesByName("same-name").length, 1, "the page's own measure is kept");
  assert.equal(performance.getEntriesByName("\u200bsame-name").length, 0, "ours is cleared");
});

test("configure ignores undefined and getConfig returns a copy", () => {
  configure({ trackGroup: undefined });
  assert.equal(getConfig().trackGroup, "Web Components");
  getConfig().trackGroup = "changed";
  assert.equal(getConfig().trackGroup, "Web Components");
});

test("timed returns the value, rethrows the error, and colours failures", async () => {
  const { seen, stop } = collect();
  assert.equal(timed("<t> ok", { track: "Updates" }, () => 42), 42);
  const err = new TypeError("orig");
  assert.throws(() => timed("<t> bad", { track: "Updates" }, () => { throw err; }), (e) => e === err);
  await tick();
  stop();
  assert.deepEqual(seen.map((e) => [e.name, e.detail.devtools.color, e.detail.devtools.properties]), [
    ["<t> ok", "primary", undefined],
    ["<t> bad", "error", [["Error", "orig"]]],
  ]);
});

test("rerouteMeasures handles g/y regex flags", async () => {
  const tag = unique("g");
  const { seen, stop } = collect();
  const unwatch = rerouteMeasures(new RegExp(`^\\[${tag}\\] (\\w+)$`, "gy"), (m) => ({ name: `copied ${m[1]}`, track: "Updates" }));
  for (const x of ["a", "b", "c", "d"]) performance.measure(`[${tag}] ${x}`, { start: 0, end: 1 });
  await tick();
  unwatch();
  stop();
  assert.deepEqual(seen.map((e) => e.name), ["copied a", "copied b", "copied c", "copied d"]);
});

test("one failing map call does not stop the rest", async () => {
  const tag = unique("t");
  const reported = [];
  const original = globalThis.reportError;
  globalThis.reportError = (e) => reported.push(e.message);
  const { seen, stop } = collect();
  const unwatch = rerouteMeasures(new RegExp(`^\\[${tag}\\] (\\w+)$`), (m) => {
    if (m[1] === "b") throw new Error("boom");
    return { name: `copied ${m[1]}`, track: "Updates" };
  });
  for (const x of ["a", "b", "c"]) performance.measure(`[${tag}] ${x}`, { start: 0, end: 1 });
  await tick();
  unwatch();
  stop();
  globalThis.reportError = original;
  assert.deepEqual(seen.map((e) => e.name), ["copied a", "copied c"]);
  assert.deepEqual(reported, ["boom"]);
});

test("rerouted output is never copied again, even if the group is renamed", async () => {
  const { seen, stop } = collect();
  const unwatch = rerouteMeasures(/^<loop>/, () => ({ name: "<loop> again", track: "Updates" }));
  performance.measure("<loop> start", { start: 0, end: 1 });
  configure({ trackGroup: "Renamed" });
  await tick();
  configure({ trackGroup: "Web Components" });
  await tick();
  unwatch();
  stop();
  assert.deepEqual(seen.map((e) => e.name), ["<loop> again"]);
});

test("Stencil timings are copied onto the React-style tracks, once each", async () => {
  const { seen, stop } = collect();
  const unwatch = observeStencilProfile();
  assert.equal(observeStencilProfile(), unwatch, "second call reuses the first");
  const t = performance.now();
  // The order Stencil records them in: render ends inside update.
  performance.measure("[Stencil] connectedCallback() <my-widget>", { start: t, end: t + 1 });
  performance.measure("[Stencil] render() <my-widget>", { start: t + 2, end: t + 5 });
  performance.measure("[Stencil] update() <my-widget>", { start: t + 1.5, end: t + 7 });
  performance.measure("[Stencil] postUpdate() <my-widget>", { start: t + 7, end: t + 9 });
  performance.measure("[Stencil] createInstance() <my-widget>", { start: t, end: t + 1 });
  performance.measure("[Stencil] bootstrapLazy() <>", { start: t, end: t + 1 });
  performance.measure("not stencil", { start: t, end: t + 1 });
  await tick();
  unwatch();
  stop();
  const rows = seen.map((e) => [
    e.name,
    e.detail.devtools.track,
    e.detail.devtools.color,
    Math.round((e.startTime - t) * 10) / 10,
    Math.round(e.duration * 10) / 10,
  ]);
  const byStart = (a, b) => a[3] - b[3] || a[0].localeCompare(b[0]);
  assert.deepEqual(rows.sort(byStart), [
    ["my-widget connected", "Components", "warning", 0, 1],
    ["my-widget createInstance", "Upgrade", "tertiary", 0, 1],
    ["Render and Commit", "Scheduler", "primary-dark", 1.5, 5.5],
    ["my-widget", "Components", "primary", 2, 3],
    ["my-widget", "Components", "secondary", 7, 2],
  ]);
});
