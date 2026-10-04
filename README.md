# custom-element-perf-tracks

Shows your web components in the Chrome DevTools Performance panel, the same way React shows its components.

React 19.2 added [performance tracks](https://react.dev/reference/dev-tools/react-performance-tracks) to the Performance panel, so React developers can see what caused each update, how long each step took, and which components did the work. Web components had nothing like it. This library adds the same tracks for custom elements, Lit and Stencil, using Chrome's [Performance Extensibility API](https://developer.chrome.com/docs/devtools/performance/extension). The track names, step names and colors match React's, so anyone who has used React's tracks can read these straight away.

## What you see

When you record a profile, a **Web Components** group appears in the flame chart with three tracks.

![Chrome DevTools after clicking a Lit button in the demo. Under Web Components, the Scheduler track shows "Event: click" followed by a blue Render bar and a short Commit bar. The Components track below shows a demo-counter bar lined up with Render. Chrome's own main-thread track underneath shows the same click and the microtasks Lit ran.](docs/devtools-lit.png)

**Scheduler** shows each update as a row of steps, like React's Scheduler track:

| Bar | What it covers |
| --- | --- |
| **Event: click** | The event handler that made the change, up to the change itself. Any user input event works, not only clicks. |
| **Update** | The wait between the change and Lit starting the update. It becomes **Update Blocked** when the wait is over 5 ms, usually because the event handler kept running after making the change. |
| **Render** | `shouldUpdate`, `willUpdate` and `render`. |
| **Commit** | Writing the result to the page, then `firstUpdated` and `updated`. |
| **Cascading Update** | Red, and wrapped around a whole extra update. The element changed its own properties after rendering, usually in `updated()`, so Lit had to update it a second time. Lit warns about this in development too. |

**Components** shows which element did the work, like React's Components track:

| Bar | What it covers |
| --- | --- |
| **my-element** (blue) | The element's render. Clicking it shows **Changed Props**, with each property's old and new value, the number of **Changes batched** into the update, and which element it was **Triggered by** when a parent passed it new values. |
| **my-element** (purple) | The element's `firstUpdated()` and `updated()` work, in the color React uses for effects. |
| **Mount** | Wraps an element's first update. |
| **my-element connected** | Lifecycle callbacks: `connected`, `disconnected`, `attributeChanged` and `adopted`. Mounting and unmounting use React's warning color. Attribute changes show the old and new value. |

Bars for renders and effects get darker as they get slower, using React's thresholds, and turn red at 100 ms for a render or 500 ms for effects.

**Upgrade** has no React equivalent, because it's specific to web components. It shows each `customElements.define` call, which upgrades every matching element already in the page, including inside shadow roots. Clicking it shows how many elements were upgraded.

Anything that throws gets a red bar with the error message.

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

This adds the Upgrade bar and the lifecycle callbacks. When something else defines the element, `instrumentElement(MyCard)` adds the lifecycle callbacks on their own. It has to run before the class is defined, because that's when the browser reads the lifecycle callbacks. If it runs later, it logs a warning and does nothing.

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

This adds the Scheduler track and the render and effect bars on the Components track. Lit elements can also use `definePerf` to get their lifecycle callbacks and the Upgrade bar.

A few details are specific to Lit:

- **Changes batched** counts only changes Lit accepts. Setting a property to the value it already has isn't counted, because Lit ignores it too.
- An update that `shouldUpdate()` skips shows as a light "my-element skipped" bar.
- The wait shown by **Update** starts when the element is connected, because Lit doesn't update elements until then.

The Lit adapter uses only Lit's public API, and doesn't import Lit at runtime. Every Lit test runs against both Lit 2 and Lit 3.

### Stencil

Stencil already records its own timings in dev builds, and in production builds made with `stencil build --profile`. One call at startup picks them up:

```js
import { observeStencilProfile } from "custom-element-perf-tracks/stencil";

observeStencilProfile();
```

Each Stencil update shows as one **Render and Commit** bar on the Scheduler track. Stencil's timing for `render()` includes patching the page, so the two steps can't be shown separately as they are for Lit. On the Components track, each element gets a render bar, a bar for its `componentDidLoad` and `componentDidUpdate` hooks, and its `connectedCallback`. One-off setup, such as creating the instance and attaching styles, goes on the Upgrade track.

These are copies of Stencil's timings. Stencil's originals also stay in DevTools' general "Timings" lane, so each one appears twice.

Stencil doesn't record what caused an update, so Stencil updates have no **Event** or **Update** bars. Very short timings, such as `scheduleUpdate` for a component with no `componentWillUpdate` work, are hidden by the same `minDuration` cut-off as other short work. This is tested against a real Stencil 4 app, built in dev mode and recorded in Chrome.

## Tested on a real app

The [Home Assistant](https://github.com/home-assistant/frontend) frontend is one of the largest open-source Lit apps. Its demo was instrumented without changing its code, by wrapping `customElements.define` so that every Lit component (376 of them) got `trackLitUpdates`, and recorded in Chrome during page load and some clicking.

- Every bar nested correctly, and nothing broke.
- It found a real inefficiency: every `ha-button` updates twice when it first appears. The button's base class, from the Web Awesome library, sets a `validity` property in `firstUpdated()`, and the Cascading Update bar names that property in its Changed Props.
- With a debugger attached, as it is when DevTools is open, the library added about 4% to the main-thread work of loading the page.

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
  strategy: "timestamp",    // how bars are drawn, described below
  minDuration: 0,           // draw even the shortest callbacks
  enabled: false,           // turn it off completely
});
```

`configure` needs to run before your elements are defined. If `enabled` is `false` at that point, elements and Lit components are left completely alone. Any setting passed as `undefined` is ignored.

`strategy` picks how bars are drawn:

- **`"auto"`** (the default) draws every bar with `performance.measure`, including its details, and removes it from the page's performance buffer straight away. It's saved under a name that starts with an invisible character, so removing it never touches the page's own measures.
- **`"measure"`** does the same but leaves the bars in the buffer, so test scripts can read them back with `performance.getEntriesByType("measure")`.
- **`"timestamp"`** draws every bar with `console.timeStamp`, as React does for most of its bars. No bar has details.

React's choice of `console.timeStamp` is the cheaper one when nothing is listening to the page: about 0.3 µs a bar, against 4 µs for `performance.measure`. But once a debugger is attached, which it always is when DevTools is open, `console.timeStamp` became about six times more expensive than `performance.measure` in testing. That's why `"auto"` uses `performance.measure`.

Bars with no length are invisible, so they aren't drawn at all, except for errors.

`minDuration` hides lifecycle callbacks and effects shorter than this many milliseconds, so the chart isn't covered in tiny bars. It defaults to 0.05 ms, the same cut-off React uses for effects. Renders are always drawn.

## Demo

```sh
npm install
npm run demo
```

The demo runs at `http://localhost:5173/demo/`. With DevTools open, you record in the Performance panel, click a few buttons, then stop. The Lit section has a counter that passes its count to a child badge, and a button that makes a cascading update on purpose. Adding `?strategy=timestamp` or `?strategy=measure` to the address switches drawing mode.

## Limitations

- **Tracks only appear in Chrome and Edge.** Other browsers ignore the extra data, so nothing breaks there.
- **Very fast work can disappear.** Browsers round timestamps to a tenth of a millisecond, so anything faster has zero length and DevTools doesn't draw it. This also means work close to the `minDuration` cut-off can land on either side of it.
- **Only synchronous work is timed.** A lifecycle callback that starts async work gets a bar for the synchronous part only.
- **Lit elements update one at a time**, so their bars sit side by side instead of nesting inside a parent's bar the way React's components do. The **Triggered by** detail links a child's update to its parent.

## Tests

`npm test` runs everything. The browser tests need Chrome or Chromium, which they look for in the usual places, or wherever `CHROME_PATH` points.

- **Browser tests** run each behavior described above in headless Chrome, once with Lit 3 and once with Lit 2.
- **An end-to-end test** runs the demo, records a real performance trace, and reads it with DevTools' own trace engine ([`@paulirish/trace_engine`](https://www.npmjs.com/package/@paulirish/trace_engine)). It checks that the Performance panel would draw all three tracks, with React's names and colors and with bars nested correctly, in all three drawing modes.
- **Bundler tests** build a small app with Vite, webpack and esbuild, and check that production output contains none of the library while development output still contains all of it.
- **A Stencil test** builds a small real Stencil app, records it, and checks the bars DevTools would draw from Stencil's own timings.
- **Node tests** cover the drawing code, value formatting, Stencil timing rules, and the empty production version.

`npm run coverage` runs the same tests and reports which lines of the library they reached, combining what ran in Node with what ran in the browser. The report also goes to `coverage/index.html`.

## License

MIT
