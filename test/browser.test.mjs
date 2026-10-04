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

const NB = "\u00a0";

test("auto strategy: nothing left in the buffer, the page's own measures kept", { skip }, () => {
  assert.deepEqual(result("autoStrategyLeavesBufferAlone"), { added: 0, userMeasureKept: 1 });
});

test("timestamp strategy adds nothing to the performance buffer", { skip }, () => {
  assert.equal(result("timestampStrategyAddsNothingToBuffer"), 0);
});

test("lifecycle callbacks go on the Components track, mount/unmount in React's warning color", { skip }, () => {
  assert.deepEqual(result("lifecycleOnComponentsTrack"), [
    ["lc-el connected", "warning"],
    ["lc-el disconnected", "warning"],
  ]);
});

test("base and subclass both instrumented: one bar, named after the element", { skip }, () => {
  assert.deepEqual(result("inheritanceBaseFirst"), ["sub-a connected"]);
  assert.deepEqual(result("inheritanceSubFirst"), ["sub-b connected", "base-b connected"]);
});

test("callbacks under minDuration are not drawn", { skip }, () => {
  assert.deepEqual(result("shortCallbacksHidden"), ["slow-el connected"]);
});

test("a failing define leaves the class untouched", { skip }, () => {
  assert.deepEqual(result("failedDefineLeavesClassAlone"), { threw: "NotSupportedError", untouched: true });
});

test("upgrade count includes elements in shadow roots", { skip }, () => {
  assert.deepEqual(result("upgradeCountIncludesShadowRoots"), { name: "shadow-kid define", count: "8" });
});

test("a throwing callback rethrows and gets a red bar with the error message", { skip }, () => {
  assert.deepEqual(result("throwingCallback"), { message: "kaboom", bars: [["error", "kaboom"]] });
});

test("attribute changes show as a React-style diff", { skip }, () => {
  assert.deepEqual(result("attributeDiff"), {
    name: "attr-el attributeChanged",
    rows: [
      ["Changed Attribute", ""],
      [`-${NB}x`, '"1"'],
      [`+${NB}x`, "null"],
    ],
  });
});

test("instrumenting after define warns", { skip }, () => {
  assert.equal(result("instrumentAfterDefineWarns"), 1);
});

test("Lit first update: Update, Render, Commit, wrapped in Mount, no Changed Props", { skip }, () => {
  const r = result("litFirstUpdate");
  assert.deepEqual(r.scheduler.filter((n) => n !== "Update"), ["Render", "Commit"]);
  assert.deepEqual(r.components, ["Mount", "lit-first", "lit-first"]);
  assert.ok(r.mountWrapsAll);
  assert.ok(r.updateWait < 20, `wait counts from connection, got ${r.updateWait}`);
  assert.equal(r.changedPropsOnFirst, false);
});

test("Lit: Render covers willUpdate and render, Commit covers updated, Changed Props diff", { skip }, () => {
  const r = result("litPhasesAndChangedProps");
  // "Update" is drawn only when the wait is long enough to measure.
  assert.deepEqual(r.scheduler.filter((n) => n !== "Update"), ["Render", "Commit"]);
  assert.ok(r.renderBeforeCommit);
  assert.ok(r.renderMs >= 7.5, `render ${r.renderMs}`);
  assert.ok(r.commitMs >= 3.5, `commit ${r.commitMs}`);
  assert.equal(r.componentBars, 2, "render bar and effects bar");
  assert.equal(r.effectColor, "secondary");
  assert.deepEqual(r.renderRows, [
    ["Changes batched", "5"],
    ["Changed Props", ""],
    [`-${NB}a`, "0"],
    [`+${NB}a`, "5"],
  ]);
  // Two no-op sets are ignored; the bare requestUpdate() is what caused it.
  assert.deepEqual(r.noopRows, [["Update requested", "requestUpdate()"]]);
});

test("Lit: 'Event: click' and 'Update Blocked' when the handler keeps working", { skip }, () => {
  const r = result("litUpdateBlockedAndEvent");
  // Commit is drawn only when the DOM write is long enough to measure.
  assert.deepEqual(r.scheduler.filter((n) => n !== "Commit"), ["Event: click", "Update Blocked", "Render"]);
  assert.ok(r.eventMs >= 2.5, `event ${r.eventMs}`);
  assert.deepEqual(r.updateRows, [
    ["Component name", "lit-e"],
    ["Property", "v"],
  ]);
});

test("Lit: a child updated by its parent shows 'Triggered by', with no extra Update bar", { skip }, () => {
  const r = result("litTriggeredByParent");
  // At most the parent's Update bar (left out when too short to measure).
  assert.ok(r.scheduler.filter((n) => n.startsWith("Update")).length <= 1, r.scheduler.join());
  assert.deepEqual(r.childRows, [
    ["Triggered by", "lit-parent"],
    ["Changed Props", ""],
    [`-${NB}v`, "0"],
    [`+${NB}v`, "1"],
  ]);
});

test("Lit: a change made in updated() is a red Cascading Update around the extra update", { skip }, () => {
  const r = result("litCascadingUpdate");
  assert.ok(r.scheduler.includes("Cascading Update"), r.scheduler.join());
  assert.equal(r.color, "error");
  assert.deepEqual(r.rows, [
    ["Component name", "lit-cascade"],
    ["Requested during", "updated()"],
  ]);
  assert.ok(r.nested.includes("Render"), r.nested.join());
});

test("Lit: skipped and failed updates are shown and do not leak into the next", { skip }, () => {
  assert.deepEqual(result("litSkippedAndFailed"), [
    ["lit-c skipped", "primary-light", "2", null],
    ["lit-c", "error", "1", "render broke"],
    ["lit-c", "primary-light", "1", null],
    ["lit-c", "secondary-light", "1", null],
  ]);
});

test("a value the tracker cannot display does not break the update", { skip }, () => {
  const r = result("badValuesDoNotBreakUpdates");
  assert.equal(r.error, null);
  assert.deepEqual(r.rows, [
    ["Changed Props", ""],
    [`-${NB}when`, "1970-01-01T00:00:00.000Z"],
    [`+${NB}when`, "Invalid Date"],
  ]);
});

test("Lit: a change made while committing (a ref callback) is a Cascading Update", { skip }, () => {
  const r = result("changeDuringCommitIsCascade");
  assert.deepEqual(r.cascadeRows, [
    ["Component name", "lit-ref"],
    ["Requested during", "the commit"],
  ]);
  assert.deepEqual(r.secondRenderRows, [
    ["Changed Props", ""],
    [`-${NB}measured`, "0"],
    [`+${NB}measured`, "10"],
  ]);
});

test("Lit: performUpdate() called inside an update keeps both updates' bars", { skip }, () => {
  const bars = result("nestedPerformUpdateKeepsOuter");
  assert.ok(!bars.some((n) => n.includes("skipped")), bars.join());
  assert.ok(bars.filter((n) => n === "lit-self").length >= 3, bars.join());
});

test("Lit: each element's Update bar is its own", { skip }, () => {
  const owners = result("updateBarBelongsToEachElement");
  assert.ok(owners.includes("lit-x"), owners.join());
  assert.ok(owners.includes("lit-later"), owners.join());
});

test("Lit: a change event inside shadow DOM gets an 'Event: change' bar", { skip }, () => {
  assert.ok(result("changeEventInShadowDom").includes("Event: change"));
});

test("Lit: moving an element with a pending change keeps its Update bar", { skip }, () => {
  assert.equal(result("movedElementKeepsUpdateBar").length, 1);
});

test("an invalid tag name leaves the class untouched and usable", { skip }, () => {
  assert.deepEqual(result("invalidNameLeavesClassAlone"), { threw: "SyntaxError", untouched: true, canRetry: true });
});

test("turned off: nothing is patched, and undefined settings are ignored", { skip }, () => {
  assert.deepEqual(result("disabledDoesNotPatch"), { untouched: true, litUntouched: true, stillOff: true });
});
