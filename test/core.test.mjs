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
    trackGroup: "Web Components · Tuppence",
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
  assert.equal(getConfig().trackGroup, "Web Components · Tuppence");
  getConfig().trackGroup = "changed";
  assert.equal(getConfig().trackGroup, "Web Components · Tuppence");
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
  configure({ trackGroup: "Web Components · Tuppence" });
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

import { preview, renderColor, effectColor, createTask } from "../dist/emit.js";
import { observeStencilProfile as observeAgain } from "../dist/adapters/stencil.js";

test("preview formats each kind of value briefly, like React's Changed Props", () => {
  class Point {}
  const fn = function onTap() {};
  assert.equal(preview("hi"), '"hi"');
  assert.equal(preview("x".repeat(60)), JSON.stringify("x".repeat(50) + "…"));
  assert.equal(preview(42), "42");
  assert.equal(preview(true), "true");
  assert.equal(preview(undefined), "undefined");
  assert.equal(preview(null), "null");
  assert.equal(preview(10n), "10");
  assert.equal(preview(Symbol("s")), "Symbol(s)");
  assert.equal(preview(fn), "ƒ onTap()");
  assert.equal(preview(() => {}), "ƒ anonymous()");
  assert.equal(preview([1, 2, 3]), "Array(3)");
  assert.equal(preview({ a: 1 }), "{…}");
  assert.equal(preview(Object.create(null)), "{…}");
  assert.equal(preview(new Point()), "Point {…}");
  assert.equal(preview(new Date(0)), "1970-01-01T00:00:00.000Z");
  assert.equal(preview(new Date("nope")), "Invalid Date");
});

test("preview never throws, whatever the value", () => {
  const hostile = new Proxy({}, { get() { throw new Error("no"); }, getPrototypeOf() { throw new Error("no"); } });
  assert.equal(preview(hostile), "(could not display)");
});

test("render and effect colors use React's thresholds", () => {
  assert.deepEqual([0.4, 0.5, 9.9, 10, 99, 100].map(renderColor), [
    "primary-light", "primary", "primary", "primary-dark", "primary-dark", "error",
  ]);
  assert.deepEqual([0.9, 1, 99, 100, 499, 500].map(effectColor), [
    "secondary-light", "secondary", "secondary", "secondary-dark", "secondary-dark", "error",
  ]);
});

test("a bar whose details fail to build is still drawn, without details", async () => {
  const { seen, stop } = collect();
  emit("<d> still drawn", performance.now() - 1, performance.now(), {
    track: "Components",
    properties: () => { throw new Error("details broke"); },
  });
  await tick();
  stop();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].detail.devtools.properties, undefined);
});

test("if drawing itself fails, emit swallows the error", () => {
  const measure = performance.measure;
  performance.measure = () => { throw new Error("drawing broke"); };
  try {
    assert.doesNotThrow(() => emit("<d> x", 0, 1, { track: "Components" }));
    assert.equal(timed("<d> y", { track: "Components" }, () => "kept"), "kept");
  } finally {
    performance.measure = measure;
  }
});

test("timed reports non-Error throws and does nothing extra when disabled", async () => {
  const { seen, stop } = collect();
  assert.throws(() => timed("<t> str", { track: "Updates" }, () => { throw "plain string"; }));
  configure({ enabled: false });
  assert.equal(timed("<t> off", { track: "Updates" }, () => 7), 7);
  configure({ enabled: true });
  await tick();
  stop();
  assert.deepEqual(seen.map((e) => [e.name, e.detail.devtools.properties]), [["<t> str", [["Error", "plain string"]]]]);
});

test("createTask falls back to null when the console cannot make tasks", () => {
  const original = console.createTask;
  try {
    console.createTask = undefined;
    assert.equal(createTask("x"), null);
    console.createTask = () => { throw new Error("no tasks"); };
    assert.equal(createTask("x"), null);
  } finally {
    console.createTask = original;
  }
});

test("rerouted errors go to console.error where reportError does not exist", async () => {
  const tag = unique("e");
  const original = globalThis.reportError;
  const logged = [];
  const error = console.error;
  globalThis.reportError = undefined;
  console.error = (e) => logged.push(e.message);
  const unwatch = rerouteMeasures(new RegExp(`^\\[${tag}\\]`), () => { throw new Error("map broke"); });
  performance.measure(`[${tag}] a`, { start: 0, end: 1 });
  await tick();
  unwatch();
  globalThis.reportError = original;
  console.error = error;
  assert.deepEqual(logged, ["map broke"]);
});

test("Stencil: short connectedCallback, postUpdate and scheduleUpdate timings are hidden", async () => {
  configure({ minDuration: 0.5 });
  performance.clearMeasures();
  const { seen, stop } = collect();
  const unwatch = observeAgain();
  const t = performance.now();
  performance.measure("[Stencil] connectedCallback() <tiny-widget>", { start: t, end: t + 0.1 });
  performance.measure("[Stencil] postUpdate() <tiny-widget>", { start: t, end: t + 0.1 });
  performance.measure("[Stencil] postUpdate() <tiny-widget>", { start: t, end: t + 2 });
  performance.measure("[Stencil] scheduleUpdate() <tiny-widget>", { start: t, end: t + 0.1 });
  performance.measure("[Stencil] scheduleUpdate() <tiny-widget>", { start: t, end: t + 3 });
  await tick();
  unwatch();
  stop();
  configure({ minDuration: 0.05 });
  assert.deepEqual(seen.map((e) => Math.round(e.duration)).sort(), [2, 3]);
});

test("the production version has exactly the same exports, and does nothing", async () => {
  const dev = await import("../dist/index.js");
  const prod = await import("../dist/production/index.js");
  const devLit = await import("../dist/adapters/lit.js");
  const prodLit = await import("../dist/production/adapters/lit.js");
  const devStencil = await import("../dist/adapters/stencil.js");
  const prodStencil = await import("../dist/production/adapters/stencil.js");
  assert.deepEqual(Object.keys(prod).sort(), Object.keys(dev).sort());
  assert.deepEqual(Object.keys(prodLit).sort(), Object.keys(devLit).sort());
  assert.deepEqual(Object.keys(prodStencil).sort(), Object.keys(devStencil).sort());
  assert.deepEqual(prod.Tracks, dev.Tracks);
  assert.deepEqual(Object.keys(prod.getConfig()).sort(), Object.keys(dev.getConfig()).sort());

  const { seen, stop } = collect();
  assert.equal(prod.timed("x", { track: "Components" }, () => 5), 5);
  prod.emit("x", 0, 1, { track: "Components" });
  prod.configure({ enabled: true });
  assert.equal(prod.getConfig().enabled, false);
  assert.equal(typeof prod.rerouteMeasures(/x/, () => null), "function");
  assert.equal(typeof prodStencil.observeStencilProfile(), "function");
  prodLit.trackLitUpdates({});
  prod.instrumentElement(class {});
  await tick();
  stop();
  assert.equal(seen.length, 0);
});

test("every built file is marked as library code, so DevTools hides it from stacks", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = new URL("../dist/", import.meta.url).pathname;
  const js = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".js"));
  assert.ok(js.length >= 9);
  for (const file of js) {
    const map = JSON.parse(fs.readFileSync(path.join(dir, file + ".map"), "utf8"));
    assert.deepEqual(map.ignoreList, [0], file);
    assert.ok(map.sourcesContent?.[0], `${file} map includes its source`);
  }
});

test("bars with no length are not drawn", async () => {
  const { seen, stop } = collect();
  const t = performance.now();
  emit("<z> zero", t, t, { track: "Components" });
  emit("<z> backwards", t, t - 1, { track: "Components" });
  emit("<z> real", t, t + 1, { track: "Components" });
  await tick();
  stop();
  assert.deepEqual(seen.map((e) => e.name), ["<z> real"]);
});

test("error bars are drawn even with no length", async () => {
  const { seen, stop } = collect();
  const t = performance.now();
  assert.throws(() => timed("<z> instant failure", { track: "Components" }, () => { throw new Error("now"); }));
  emit("<z> instant error", t, t, { track: "Components", color: "error" });
  await tick();
  stop();
  assert.deepEqual(seen.map((e) => e.name).sort(), ["<z> instant error", "<z> instant failure"]);
});

test("Stencil module loads go on Loading rows, so overlapping loads never share a row", async () => {
  configure({ minDuration: 0.05 });
  performance.clearMeasures();
  const { seen, stop } = collect();
  const unwatch = observeAgain();
  const t = performance.now();
  performance.measure("[Stencil] demo initial load (by my-app)", { start: t, end: t + 100 });
  performance.measure("[Stencil] Load module for <a-one>", { start: t + 10, end: t + 50 });
  performance.measure("[Stencil] Load module for <a-two>", { start: t + 20, end: t + 60 });
  performance.measure("[Stencil] Load module for <a-three>", { start: t + 30, end: t + 70 });
  performance.measure("[Stencil] Load module for <a-four>", { start: t + 80, end: t + 90 });
  await tick();
  unwatch();
  stop();
  const rows = Object.fromEntries(seen.map((e) => [e.name.replace(/^\u200b/, ""), e.detail.devtools.track]));
  assert.equal(rows["demo initial load (by my-app)"], "Loading");
  assert.equal(new Set([rows["a-one"], rows["a-two"], rows["a-three"]]).size, 3, JSON.stringify(rows));
  assert.equal(rows["a-four"], "Loading");
});

test("rerouteMeasures skips entries the map function turns down", async () => {
  const { seen, stop } = collect();
  const name = unique("skip-me");
  const unwatch = rerouteMeasures(/^skip-me/, () => null);
  performance.measure(name, { start: performance.now() - 2, end: performance.now() });
  await tick();
  unwatch();
  stop();
  assert.equal(seen.length, 0);
});

test("rerouteMeasures can turn one entry into several bars", async () => {
  const { seen, stop } = collect();
  const name = unique("split-me");
  const unwatch = rerouteMeasures(/^split-me/, (m, e) => [
    { name: "first half", track: "Components", end: e.startTime + e.duration / 2 },
    { name: "second half", track: "Components", start: e.startTime + e.duration / 2 },
  ]);
  const t = performance.now();
  performance.measure(name, { start: t - 4, end: t });
  await tick();
  unwatch();
  stop();
  assert.deepEqual(seen.map((e) => [e.name, Math.round(e.duration)]), [["first half", 2], ["second half", 2]]);
});

test("Stencil: more than eight overlapping loads share the last Loading row", async () => {
  configure({ minDuration: 0.05 });
  const { seen, stop } = collect();
  const unwatch = observeAgain();
  const t = performance.now() + 10000;
  for (let i = 0; i < 10; i++) {
    performance.measure(`[Stencil] Load module for <many-${i}>`, { start: t + i, end: t + 50 + i });
  }
  await tick();
  unwatch();
  stop();
  const rows = seen.filter((e) => e.name.includes("many-")).map((e) => e.detail.devtools.track);
  assert.deepEqual(rows, [
    "Loading", "Loading 2", "Loading 3", "Loading 4", "Loading 5", "Loading 6", "Loading 7", "Loading 8",
    "Loading 8", "Loading 8",
  ]);
});

test("the production version's setup functions do nothing", async () => {
  const prod = await import("../dist/production/index.js");
  const prodLit = await import("../dist/production/adapters/lit.js");
  const stop = prod.instrumentAll({ onDefine: () => assert.fail("called") });
  assert.equal(typeof stop, "function");
  stop();
  assert.equal(typeof prodLit.trackAllLitElements(), "function");
  prodLit.trackAllLitElements()();
});

test("without customElements (Node, some SSR), the element helpers do nothing harmful", async () => {
  const { instrumentAll, instrumentElement } = await import("../dist/index.js");
  const { labelFor } = await import("../dist/define.js");
  assert.equal(typeof customElements, "undefined");
  const stop = instrumentAll();
  stop();
  stop();
  assert.equal(labelFor({ constructor: class {}, localName: "x-fallback" }), "x-fallback");
  class Plain { connectedCallback() { return "ran"; } }
  instrumentElement(Plain);
  assert.equal(new Plain().connectedCallback.call({ constructor: Plain, localName: "x-plain" }), "ran");
});

test("with no performance, PerformanceObserver or console, nothing is drawn and nothing breaks", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = `
    delete globalThis.performance;
    delete globalThis.PerformanceObserver;
    delete globalThis.console;
    const { emit, timed, rerouteMeasures } = await import(${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)});
    const { now } = await import(${JSON.stringify(new URL("../dist/emit.js", import.meta.url).href)});
    emit("x", 0, 1, { track: "Components" });
    const out = [timed("x", { track: "Components" }, () => 7), now()];
    rerouteMeasures(/x/, () => null)();
    process.stdout.write(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "[7,0]");
});

test("with no console, the timestamp strategy falls back to performance.measure", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = `
    const log = console.log.bind(console);
    const seen = [];
    new PerformanceObserver((l) => seen.push(...l.getEntries().map((e) => e.name))).observe({ entryTypes: ["measure"] });
    delete globalThis.console;
    const { emit, configure } = await import(${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)});
    configure({ strategy: "timestamp" });
    emit("no-console", performance.now() - 1, performance.now(), { track: "Components" });
    setTimeout(() => log(JSON.stringify(seen)), 20);
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ["\u200bno-console"]);
});

import { assignTrackGroup } from "../dist/index.js";

test("emit can put one bar under its own track group", async () => {
  const { seen, stop } = collect();
  emit("grouped", performance.now() - 1, performance.now(), { track: "Components", trackGroup: "Acme" });
  emit("default", performance.now() - 1, performance.now(), { track: "Components" });
  await tick();
  stop();
  assert.deepEqual(
    seen.map((e) => [e.name, e.detail.devtools.trackGroup]),
    [["grouped", "Acme"], ["default", "Web Components · Tuppence"]],
  );
});

test("assignTrackGroup checks its arguments", () => {
  assert.throws(() => assignTrackGroup("acme-", ""), TypeError);
  assert.throws(() => assignTrackGroup("acme-"), TypeError);
  assert.throws(() => assignTrackGroup("", "Acme"), TypeError);
  assert.throws(() => assignTrackGroup(42, "Acme"), TypeError);
});

test("tag prefixes put Stencil elements in their own groups: longest prefix wins, then the latest", async () => {
  const undo = [
    assignTrackGroup("acme-", "Acme"),
    assignTrackGroup("ACME-CHART-", "Acme Charts"),
    assignTrackGroup("beta-", "Beta (old)"),
    assignTrackGroup("beta-", "Beta"),
  ];
  performance.clearMeasures();
  const { seen, stop } = collect();
  const unwatch = observeStencilProfile();
  const t = performance.now();
  for (const tag of ["acme-button", "acme-chart-bar", "beta-menu", "app-shell"]) {
    performance.measure(`[Stencil] render() <${tag}>`, { start: t, end: t + 1 });
  }
  performance.measure("[Stencil] Load module for <acme-button>", { start: t, end: t + 3 });
  performance.measure("[Stencil] Load module for <beta-menu>", { start: t + 1, end: t + 2 });
  await tick();
  unwatch();
  stop();
  for (const u of undo) u();
  const rows = seen.map((e) => [e.name.replace(/^​/, ""), e.detail.devtools.track, e.detail.devtools.trackGroup]);
  assert.deepEqual(rows.filter((r) => r[1] === "Components").sort(), [
    ["acme-button", "Components", "Acme"],
    ["acme-chart-bar", "Components", "Acme Charts"],
    ["app-shell", "Components", "Web Components · Tuppence"],
    ["beta-menu", "Components", "Beta"],
  ]);
  assert.deepEqual(rows.filter((r) => r[1].startsWith("Loading")).sort(), [
    ["acme-button", "Loading", "Acme"],
    ["beta-menu", "Loading", "Beta"],
  ]);
});

test("removing a rule puts elements back in the default group, and removing twice is harmless", async () => {
  const undo = assignTrackGroup("gone-", "Gone");
  undo();
  undo();
  performance.clearMeasures();
  const { seen, stop } = collect();
  const unwatch = observeStencilProfile();
  const t = performance.now();
  performance.measure("[Stencil] render() <gone-el>", { start: t, end: t + 1 });
  await tick();
  unwatch();
  stop();
  assert.deepEqual(seen.map((e) => e.detail.devtools.trackGroup), ["Web Components · Tuppence"]);
});

test("the production assignTrackGroup does nothing and returns an undo function", async () => {
  const prod = await import("../dist/production/index.js");
  const undo = prod.assignTrackGroup("acme-", "Acme");
  assert.equal(typeof undo, "function");
  undo();
});

import { sameContentsNewObject as same } from "../dist/compare.js";

test("same contents, new object: arrays, plain objects and dates, compared by what's in them", () => {
  assert.equal(same([1, 2, { a: [3] }], [1, 2, { a: [3] }]), true);
  assert.equal(same({ a: 1, b: { c: "x" } }, { b: { c: "x" }, a: 1 }), true, "key order does not matter");
  assert.equal(same(Object.assign(Object.create(null), { a: 1 }), { a: 1 }), true);
  assert.equal(same(new Date(5), new Date(5)), true);
  assert.equal(same([NaN], [NaN]), true);
  assert.equal(same(new Date(NaN), new Date(NaN)), true);
});

test("same contents, new object: anything it is not sure about counts as different", () => {
  const shared = [1];
  assert.equal(same(shared, shared), false, "the same object is not a new one");
  assert.equal(same([1, 2], [1, 3]), false);
  assert.equal(same([1, 2], [1, 2, 3]), false);
  assert.equal(same({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(same({ a: 1 }, { a: 2 }), false);
  assert.equal(same({ a: 1, b: undefined }, { a: 1, c: undefined }), false);
  assert.equal(same([1], { 0: 1, length: 1 }), false, "array and object");
  assert.equal(same([new Date(1)], [new Date(2)]), false);
  class Thing {}
  assert.equal(same(new Thing(), new Thing()), false, "class instances");
  assert.equal(same([new Thing()], [new Thing()]), false);
  assert.equal(same(new Map(), new Map()), false);
  assert.equal(same([() => 1], [() => 1]), false, "functions");
  assert.equal(same(1, 1), false);
  assert.equal(same(null, {}), false);
  assert.equal(same("a", "a"), false);
  assert.equal(same([0], [-0]), false);
});

test("same contents, new object: gives up on deep, huge or throwing values", () => {
  const deep = () => ({ a: { b: { c: { d: { e: { f: 1 } } } } } });
  assert.equal(same(deep(), deep()), false, "too deep");
  const big = () => Array.from({ length: 2000 }, (_, i) => i);
  assert.equal(same(big(), big()), false, "too many values");
  const throwing = () => Object.defineProperty({}, "x", { enumerable: true, get() { throw new Error("no"); } });
  assert.equal(same(throwing(), throwing()), false);
  const shallow = () => ({ a: { b: { c: { d: 1 } } } });
  assert.equal(same(shallow(), shallow()), true, "within the depth limit");
});
