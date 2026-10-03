import { test } from "node:test";
import assert from "node:assert/strict";
import { PerformanceObserver } from "node:perf_hooks";
import { configure, emit } from "../dist/index.js";
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

test("emit writes a DevTools track entry", async () => {
  configure({ enabled: true, trackGroup: "Web Components" });
  const { seen, stop } = collect();
  emit("<x-a> render", performance.now() - 5, performance.now(), {
    track: "Updates",
    color: "secondary",
    properties: [["k", "v"]],
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

test("Stencil profile measures are moved onto the Updates track, once each", async () => {
  const { seen, stop } = collect();
  const unwatch = observeStencilProfile();
  const start = performance.now();
  performance.measure("[Stencil] render() <my-widget>", { start, end: start + 3 });
  performance.measure("not stencil", { start, end: start + 1 });
  await tick();
  unwatch();
  stop();
  const names = seen.map((e) => e.name);
  assert.deepEqual(names, ["<my-widget> render"]);
  assert.equal(seen[0].detail.devtools.track, "Updates");
  assert.equal(Math.round(seen[0].duration), 3);
});
