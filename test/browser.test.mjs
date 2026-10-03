// Runs in a real Chrome/Chromium. Set CHROME_PATH if it is not found.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { serve, findChrome, launch } from "./browser/harness.mjs";

const chrome = findChrome();
const skip = chrome ? false : "no Chrome found; set CHROME_PATH to run browser tests";

let server, browser, results;

before(async () => {
  if (skip) return;
  server = await serve();
  browser = await launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${server.origin}/test/browser/scenarios.html`);
  await page.waitForFunction("window.__results", { timeout: 30000 });
  results = await page.evaluate("window.__results");
  // The skipped/failed Lit scenario breaks a render on purpose.
  assert.deepEqual(errors.filter((m) => !m.startsWith("render broke")), [], "page errors");
});

after(async () => {
  await browser?.close();
  server?.close();
});

function result(name) {
  const r = results[name];
  assert.ok(r, `scenario ${name} missing`);
  assert.ok(r.ok, r.error);
  return r.value;
}

test("does not delete the page's own measures", { skip }, () => {
  assert.equal(result("userMeasuresSurvive"), 1);
});

test("base and subclass both instrumented: one bar, named after the element", { skip }, () => {
  assert.deepEqual(result("inheritanceBaseFirst"), ["<sub-a> connected"]);
  assert.deepEqual(result("inheritanceSubFirst"), ["<sub-b> connected", "<base-b> connected"]);
});

test("a failing define leaves the class untouched", { skip }, () => {
  assert.deepEqual(result("failedDefineLeavesClassAlone"), { threw: "NotSupportedError", untouched: true });
});

test("upgrade count includes elements in shadow roots", { skip }, () => {
  assert.equal(result("upgradeCountIncludesShadowRoots"), "8");
});

test("a throwing callback rethrows and gets an error-coloured bar", { skip }, () => {
  assert.deepEqual(result("throwingCallback"), { message: "kaboom", colors: ["error"] });
});

test("a removed attribute shows as (none)", { skip }, () => {
  assert.deepEqual(result("attributeRemovedShowsNone"), { attribute: "x", from: "1", to: "(none)" });
});

test("instrumenting after define warns", { skip }, () => {
  assert.equal(result("instrumentAfterDefineWarns"), 1);
});

test("Lit: batching counted, no-op sets ignored", { skip }, () => {
  const { five, noop, two } = result("litBatchingAndNoOps");
  assert.equal(five.length, 1);
  assert.equal(five[0].name, "<lit-a> update");
  assert.equal(five[0]["changes batched"], "5");
  assert.equal(five[0]["changed properties"], "a");
  // two no-op sets plus one bare requestUpdate()
  assert.equal(noop.length, 1);
  assert.equal(noop[0]["changes batched"], "1");
  assert.equal(two[0]["changes batched"], "2");
  assert.equal(two[0]["changed properties"], "a, b");
});

test("Lit: first update measures the wait since construction", { skip }, () => {
  const [first] = result("litFirstUpdateWaits");
  assert.equal(first.name, "<lit-b> first update");
  assert.ok(parseFloat(first["waited before update"]) >= 40, first["waited before update"]);
});

test("Lit: skipped and failed updates are shown and do not leak into the next", { skip }, () => {
  const bars = result("litSkippedAndFailed");
  assert.deepEqual(
    bars.map((b) => [b.name, b.color, b["changes batched"]]),
    [
      ["<lit-c> update skipped", "secondary-light", "2"],
      ["<lit-c> update failed", "error", "1"],
      ["<lit-c> update", "secondary", "1"],
    ],
  );
});

test("Lit: the bar covers willUpdate and updated, not just render", { skip }, () => {
  assert.ok(result("litBarIncludesWillUpdateAndUpdated") >= 15);
});

test("turned off: nothing is patched, and undefined settings are ignored", { skip }, () => {
  assert.deepEqual(result("disabledDoesNotPatch"), { untouched: true, litUntouched: true, stillOff: true });
});

test("timestamp strategy adds nothing to the performance buffer", { skip }, () => {
  assert.equal(result("timestampStrategyAddsNothingToBuffer"), 0);
});
