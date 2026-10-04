# custom-element-perf-tracks

Shows your web components in the Chrome DevTools Performance panel.

![The Chrome DevTools Performance panel with a "Web Components" track group. The Upgrade track shows one wide bar for defining demo-card, and the Lifecycle track below it shows a bar for each element as it upgrades. The summary reports 20 elements upgraded in 60.5 ms.](docs/devtools-upgrade.png)

React 19.2 added its own tracks to the Performance panel, so React developers can see which component rendered and how long it took. Web components had nothing like it. This library adds the same kind of tracks for custom elements, Lit and Stencil, using Chrome's [Performance Extensibility API](https://developer.chrome.com/docs/devtools/performance/extension).

When you record a profile, a **Web Components** group appears in the flame chart with three tracks:

| Track | What it shows | Source |
| --- | --- | --- |
| **Upgrade** | The `customElements.define` call, which upgrades every matching element already in the page, including inside shadow roots | `definePerf` |
| **Lifecycle** | Each `connected`, `disconnected`, `attributeChanged` and `adopted` callback, per element | `definePerf`, `instrumentElement`, Stencil |
| **Updates** | Each Lit update, with how many changes Lit batched into it, or Stencil's own update timings | `trackLitUpdates`, `observeStencilProfile` |

Clicking a bar shows more detail, such as which attribute changed, how many elements were upgraded, or which properties a Lit update picked up. Anything that throws gets a red bar.

## Install

```sh
npm install custom-element-perf-tracks
```

## Usage

### Any custom element

`definePerf` takes the same arguments as `customElements.define`:

```js
import { definePerf } from "custom-element-perf-tracks";

definePerf("my-card", MyCard);
```

When something else defines the element, `instrumentElement(MyCard)` adds the Lifecycle track on its own. It has to run before the class is defined, because that's when the browser reads the lifecycle callbacks. If it runs later, it logs a warning and does nothing.

Classes that extend each other can all be instrumented. You still get one bar per callback, named after the element that ran it.

### Lit

`trackLitUpdates` goes in the constructor:

```js
import { LitElement } from "lit";
import { trackLitUpdates } from "custom-element-perf-tracks/lit";

class MyCounter extends LitElement {
  constructor() {
    super();
    trackLitUpdates(this);
  }
}
```

Each bar covers Lit's whole update: `shouldUpdate`, `willUpdate`, `render` and writing the result to the page, then `firstUpdated` and `updated`. Clicking it shows:

- **changes batched**: how many property changes Lit folded into this one update. Setting a property to the value it already has doesn't count.
- **changed properties**: the names of those properties.
- **waited before update**: the time between the first change and the update starting.

When `shouldUpdate` skips an update, you get a light "update skipped" bar. When an update throws, you get a red "update failed" bar.

![A Lit update bar selected on the Updates track. The summary shows a 25 ms update, one change batched, the changed property "count", and the wait before the update.](docs/devtools-lit.png)

The Lit adapter uses only Lit's public API, and doesn't import Lit at runtime. It's tested with Lit 3 and should also work with Lit 2.

### Stencil

Stencil already records its own timings in dev builds, and in production builds made with `stencil build --profile`. One call at startup picks them up:

```js
import { observeStencilProfile } from "custom-element-perf-tracks/stencil";

observeStencilProfile();
```

This copies Stencil's timings onto the tracks above instead of timing the same work a second time. Stencil's originals also stay in DevTools' general "Timings" lane, so each one appears twice.

## Production builds

None of this code reaches production, and there's nothing to set up. The package contains two versions with the same API: the real one, and an empty one where `definePerf` just calls `customElements.define` and everything else does nothing. Bundlers that know they're making a production build pick the empty version, so calls like `trackLitUpdates(this)` disappear from the output.

| Tool | Development | Production build |
| --- | --- | --- |
| Vite | Real version | Empty version, automatically |
| webpack (`mode: "production"`) | Real version | Empty version, automatically |
| esbuild | Real version | Empty version with `--conditions=production` |
| Rollup | Real version | Empty version with `exportConditions: ["production"]` in `@rollup/plugin-node-resolve` |
| No bundler | Real version | Real version, unless `enabled` is `false` |

Bundlers choose the empty version through the standard `"production"` [export condition](https://nodejs.org/api/packages.html#conditional-exports), so any other tool that supports it works the same way. Tools that don't support it keep the real version, which stays on unless you turn it off.

Vite and webpack decide which build they're making from `NODE_ENV`. A dev server started with `NODE_ENV=production` already set in the shell gets the empty version, and no tracks appear.

## Settings

```js
import { configure } from "custom-element-perf-tracks";

configure({
  trackGroup: "My App",     // rename the group in DevTools
  strategy: "timestamp",    // the lighter mode described below
  enabled: false,           // turn it off completely
});
```

`configure` needs to run before your elements are defined. If `enabled` is `false` at that point, elements and Lit components are left completely alone. Any setting passed as `undefined` is ignored.

There are two ways the library can draw bars:

- **`"measure"`** (the default) uses `performance.measure`. Bars include all the detail described above. Each bar also adds an entry to the page's performance buffer, and that list keeps growing over a long session.
- **`"timestamp"`** uses `console.timeStamp`. It does much less work per bar and adds nothing to the buffer, but bars show only a name and a color.

## Demo

```sh
npm install
npm run demo
```

The demo runs at `http://localhost:5173/demo/`. With DevTools open, you record in the Performance panel, click a few buttons, then stop. Adding `?strategy=timestamp` to the address switches to the lighter mode.

## Limitations

- **Tracks only appear in Chrome and Edge.** Other browsers ignore the extra data, so nothing breaks there.
- **Very fast work can disappear.** Browsers round timestamps to about a tenth of a millisecond, so anything faster has zero length and DevTools doesn't draw it.
- **Only synchronous work is timed.** A lifecycle callback that starts async work gets a bar for the synchronous part only.

## Tests

`npm test` runs everything. The browser tests need Chrome or Chromium, which they look for in the usual places, or wherever `CHROME_PATH` points.

One test runs the demo, records a real performance trace, and reads it with DevTools' own trace engine ([`@paulirish/trace_engine`](https://www.npmjs.com/package/@paulirish/trace_engine)) to check that the Performance panel would draw all three tracks, in both modes. Another set builds a small app with Vite, webpack and esbuild, and checks that production output contains none of the library while development output still contains all of it.

## License

MIT
