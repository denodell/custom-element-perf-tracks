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
  assert.deepEqual(seen.map((e) => [e.name, e.detail.devtools.color]), [
    ["<t> ok", "primary"],
    ["<t> bad", "error"],
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

test("Stencil timings are copied once, with lifecycle and empty tags handled", async () => {
  const { seen, stop } = collect();
  const unwatch = observeStencilProfile();
  assert.equal(observeStencilProfile(), unwatch, "second call reuses the first");
  const start = performance.now();
  performance.measure("[Stencil] render() <my-widget>", { start, end: start + 3 });
  performance.measure("[Stencil] connectedCallback() <my-widget>", { start, end: start + 1 });
  performance.measure("[Stencil] bootstrapLazy() <>", { start, end: start + 1 });
  performance.measure("not stencil", { start, end: start + 1 });
  await tick();
  unwatch();
  stop();
  assert.deepEqual(
    seen.map((e) => [e.name, e.detail.devtools.track]),
    [
      ["<my-widget> render", "Updates"],
      ["<my-widget> connected", "Lifecycle"],
    ],
  );
  assert.equal(Math.round(seen[0].duration), 3);
});
