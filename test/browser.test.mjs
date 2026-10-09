import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { serve, findChrome, launch } from "./browser/harness.mjs";

const chrome = findChrome();
const skip = chrome ? false : "no Chrome found; set CHROME_PATH to run browser tests";

const NB = "\u00a0";

for (const lit of ["3", "2"]) {
  describe(`Lit ${lit}`, () => {
    let server, browser, results;

    before(async () => {
      if (skip) return;
      server = await serve();
      browser = await launch();
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${server.origin}/test/browser/scenarios.html?lit=${lit}`);
      await page.waitForFunction("window.__results", { timeout: 30000 });
      results = await page.evaluate("window.__results");
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

    test("auto strategy: nothing left in the buffer, the page's own measures kept", { skip }, () => {
      assert.deepEqual(result("autoStrategyLeavesBufferAlone"), { added: 0, userMeasureKept: 1 });
    });

    test("timestamp strategy adds nothing to the performance buffer", { skip }, () => {
      assert.equal(result("timestampStrategyAddsNothingToBuffer"), 0);
    });

    test("Lit: a render caused only by new objects with the same contents is marked as no changes", { skip }, () => {
      const r = result("litNoChangeRenders");
      assert.equal(r.mount, null, "the first render is never marked");
      const noChanges = (text) => ({ name: "lit-waste (no changes)", color: "warning", noChanges: text, same: null });
      const drop = ({ ms, ...rest }) => rest;
      for (const k of ["newArray", "newArrays", "newNested"]) r[k] = drop(r[k]);
      assert.deepEqual(r.newArray, noChanges("items was set to a new array with the same values"));
      assert.deepEqual(r.newArrays, noChanges("items and tags were set to new arrays with the same values"));
      assert.deepEqual(
        r.newNested,
        noChanges("options was set to a new object with the same values, and when to a new date with the same value"),
      );
      // Quick ones keep the name but stay blue; only slower ones turn yellow.
      assert.equal(r.quick.name, "lit-waste (no changes)");
      assert.equal(r.quick.color, r.quick.ms < 0.5 ? "primary-light" : "warning", `took ${r.quick.ms} ms`);
      assert.equal(r.mixed.noChanges, null);
      assert.equal(r.mixed.same, "items");
      assert.equal(r.mixed.name, "lit-waste");
      assert.notEqual(r.mixed.color, "warning");
      assert.deepEqual([r.realChange.noChanges, r.realChange.same], [null, null]);
      assert.deepEqual([r.classInstances.noChanges, r.classInstances.same], [null, null]);
      assert.equal(r.withRequestUpdate.noChanges, null);
      assert.equal(r.withRequestUpdate.same, "items");
    });

    test("design system elements go under their own track group, by base class or tag prefix", { skip }, () => {
      const r = result("trackGroupsByPrefixAndClass");
      for (const key of [
        "Upgrade: ds-card define",
        "Components: ds-card connected",
        "Components: ds-card",
        "Components: Mount",
        "Scheduler: Render",
        "Upgrade: beta-acme define",
        "Components: beta-acme connected",
      ]) {
        assert.equal(r[key], "Acme", key);
      }
      assert.equal(r["Upgrade: beta-tip define"], "Beta");
      assert.equal(r["Components: beta-tip connected"], "Beta");
      assert.equal(r["Upgrade: app-page define"], "Web Components");
      assert.equal(r["Components: app-page connected"], "Web Components");
      assert.equal(r.afterRemoving, "Web Components");
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
      assert.deepEqual(r.scheduler.filter((n) => !n.startsWith("Update")), ["Render", "Commit"]);
      assert.deepEqual(r.components, ["Mount", "lit-first", "lit-first"]);
      assert.ok(r.mountWrapsAll);
      assert.ok(r.updateWait < 100, `wait counts from connection, got ${r.updateWait}`);
      assert.equal(r.changedPropsOnFirst, false);
    });

    test("Lit: Render covers willUpdate and render, Commit covers updated, Changed Props diff", { skip }, () => {
      const r = result("litPhasesAndChangedProps");
      assert.deepEqual(r.scheduler.filter((n) => !n.startsWith("Update")), ["Render", "Commit"]);
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
      assert.deepEqual(r.noopRows, [["Update requested", "requestUpdate()"]]);
    });

    test("Lit: 'Event: click' and 'Update Blocked' when the handler keeps working", { skip }, () => {
      const r = result("litUpdateBlockedAndEvent");
      assert.deepEqual(r.scheduler.filter((n) => n !== "Commit"), ["Event: click", "Update Blocked", "Render"]);
      assert.ok(r.eventMs >= 2.5, `event ${r.eventMs}`);
      assert.deepEqual(r.updateRows, [
        ["Component name", "lit-e"],
        ["Property", "v"],
      ]);
    });

    test("Lit: a child updated by its parent shows 'Triggered by', with no extra Update bar", { skip }, () => {
      const r = result("litTriggeredByParent");
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
      const r = result("litSkippedAndFailed");
      const [name, color, ...rest] = r[2];
      assert.ok(color.startsWith("primary"), color);
      assert.deepEqual([...r.slice(0, 2), [name, "primary", ...rest]], [
        ["lit-c skipped", "primary-light", "2", null],
        ["lit-c", "error", "1", "render broke"],
        ["lit-c", "primary", "1", null],
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

    test("an already instrumented class with a bad tag name throws and stays instrumented", { skip }, () => {
      assert.deepEqual(result("alreadyInstrumentedClassWithBadName"), { threw: "SyntaxError", stillInstrumented: true });
    });

    test("browsers without customElements.getName() use the tag name", { skip }, () => {
      assert.deepEqual(result("noGetName"), ["old-browser connected"]);
    });

    test("instrumentAll: broken hooks, other registries, double stops and other wrappers", { skip }, () => {
      assert.deepEqual(result("instrumentAllEdgeCases"), {
        defined: true,
        bars: ["hook-broke connected"],
        otherThis: "TypeError",
        restoredAfterTwoStops: true,
        keptOtherWrapper: true,
        restoredOwn: true,
      });
    });

    test("events are still linked to updates in browsers without WeakRef", { skip }, () => {
      assert.deepEqual(result("litWithoutWeakRef"), ["Event: click"]);
    });

    test("a composed event heard in the shadow root and on the window counts once", { skip }, () => {
      assert.deepEqual(result("composedEventSeenOnce"), ["Event: change"]);
    });

    test("a property set inside render() is not counted, since Lit drops it", { skip }, () => {
      const r = result("changeDuringRenderIsDropped");
      assert.ok(!r.scheduler.includes("Cascading Update"), JSON.stringify(r));
      assert.equal(r.batched, "1");
    });

    test("requestUpdate: passed-in new values are counted, unreadable properties pass Lit's error through", { skip }, () => {
      assert.deepEqual(
        result("requestUpdateEdgeCases"),
        lit === "3"
          ? { drawn: true, batched: null, error: "cannot read" }
          : { drawn: false, batched: null, error: "cannot read" },
      );
    });

    test("trackLitUpdates called during an update starts tracking from the next one", { skip }, () => {
      assert.deepEqual(result("trackedFromInsideAnUpdate"), { rendered: "1", first: [], second: ["lit-late"] });
    });

    test("if tracking itself fails, the element is unaffected and later updates are still tracked", { skip }, () => {
      assert.deepEqual(result("trackingFailureNeverBreaksTheElement"), {
        error: null,
        rendered: "6",
        stillTracked: ["Render"],
      });
    });

    test("the production version defines elements, lets Lit render, and draws nothing", { skip }, () => {
      assert.deepEqual(result("productionVersionWorks"), { defined: true, connected: true, litRendered: "1", bars: 0 });
    });

    test("a failed define on a class that inherits its callbacks puts it back exactly", { skip }, () => {
      assert.deepEqual(result("inheritedCallbacksRestoredAfterFailedDefine"), {
        threw: "SyntaxError",
        subHasOwn: false,
        baseUntouched: true,
      });
    });

    test("turning it off after defining still runs callbacks, without bars", { skip }, () => {
      assert.deepEqual(result("turnedOffAfterDefining"), { calls: 1, bars: 0 });
    });

    test("instrumentElement's callbacks option times only those callbacks", { skip }, () => {
      assert.deepEqual(result("onlyChosenCallbacks"), ["picky-el connected"]);
    });

    test("Lit: a change in firstUpdated() is labelled as such", { skip }, () => {
      assert.equal(result("cascadeDuringFirstUpdate"), "firstUpdated() or updated()");
    });

    test("Lit: an element removed before its first update never gets a misleading wait", { skip }, () => {
      const r = result("removedBeforeFirstUpdate");
      assert.equal(r.rendered, "1");
      assert.ok(r.longestUpdateWait < 100, `wait ${r.longestUpdateWait}`);
    });

    test("Lit: a property that throws when read does not break the update", { skip }, () => {
      const r = result("unreadablePropertyStillUpdates");
      assert.equal(r.error, null);
      assert.equal(r.rendered, "5");
      assert.deepEqual(r.rows, [
        ["Changed Props", ""],
        [`-${NB}secret`, "0"],
        [`+${NB}secret`, "(could not read)"],
      ]);
    });

    test("customized built-ins work in both versions", { skip }, () => {
      assert.deepEqual(result("customizedBuiltIn"), {
        devWorks: true,
        prodWorks: true,
        bars: ["fancy-button connected"],
      });
    });

    test("an element passed as a property shows as its tag", { skip }, () => {
      assert.equal(result("elementsPreviewAsTags"), "<my-thing>");
    });

    test("instrumentAll instruments new definitions until every caller stops it", { skip }, () => {
      const r = result("instrumentAllCanBeStopped");
      const connected = (list) => list.filter((n) => n.endsWith("connected"));
      assert.deepEqual(connected(r.during), ["all-one connected"]);
      assert.deepEqual(connected(r.oneStopped), ["all-two connected"]);
      assert.deepEqual(r.allStopped, []);
      assert.equal(r.restored, true);
    });

    test("Lit: an event handled outside shadow DOM is named too", { skip }, () => {
      assert.deepEqual(result("lightDomCustomEvent"), ["Event: my-event"]);
    });
  });
}

for (const lit of ["3", "2"]) {
  describe(`tuppence/register, Lit ${lit}`, () => {
    let server, browser, results;

    before(async () => {
      if (skip) return;
      server = await serve();
      browser = await launch();
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${server.origin}/test/browser/register.html?lit=${lit}`);
      await page.waitForFunction("window.__results", { timeout: 30000 });
      results = await page.evaluate("window.__results");
      assert.deepEqual(errors, [], "page errors");
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

    test("plain elements get Upgrade and lifecycle bars with no code", { skip }, () => {
      assert.deepEqual(result("plainElementsWithoutAnyCode"), {
        upgrade: [["auto-plain define", "3"]],
        connected: 3,
      });
    });

    test("Lit elements get update tracking with no code", { skip }, () => {
      assert.deepEqual(result("litElementsWithoutAnyCode"), {
        scheduler: ["Render"],
        rows: [
          ["Changed Props", ""],
          [`-${NB}count`, "0"],
          [`+${NB}count`, "3"],
        ],
      });
    });

    test("a Lit subclass of a defined Lit class is tracked once", { skip }, () => {
      assert.deepEqual(result("subclassesTrackedOnce"), ["auto-sub"]);
    });

    test("definePerf still works, without doubling bars", { skip }, () => {
      const r = result("definePerfIsNotDoubled");
      assert.ok(r.upgrade.length <= 1, r.upgrade.join());
      assert.deepEqual(r.components, ["auto-explicit connected"]);
    });

    test("customElements.define throws the browser's own errors", { skip }, () => {
      assert.deepEqual(result("defineErrorsAreUnchanged"), { error: "NotSupportedError", invalid: "SyntaxError" });
    });
  });
}

describe("Vue custom elements (defineCustomElement)", () => {
  let server, browser, results, errors;

  before(async () => {
    if (skip) return;
    server = await serve();
    browser = await launch();
    const page = await browser.newPage();
    errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${server.origin}/test/browser/vue.html`);
    await page.waitForFunction("window.__results", { timeout: 30000 });
    results = await page.evaluate("window.__results");
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  test("get Upgrade and lifecycle bars from the one-line setup, and still work", { skip }, () => {
    assert.deepEqual(errors, [], "page errors");
    const r = results.vueElementsGetElementBars;
    assert.ok(r.ok, r.error);
    assert.deepEqual(r.value.upgrade, ["vue-counter define", "2", "Vue Design System"]);
    assert.deepEqual(r.value.rendered, ["1:0", "2:0", "3:1"], "Vue renders and handles clicks as usual");
    assert.deepEqual(r.value.groups, ["Vue Design System"]);
    assert.ok(!r.value.tracks.includes("Scheduler"), r.value.tracks.join());
    assert.ok(r.value.tracks.includes("Components"), r.value.tracks.join());
  });
});
