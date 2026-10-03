# custom-element-perf-tracks

Shows your web components in the Chrome DevTools Performance panel.

React 19.2 added its own tracks to the Performance panel, so React developers can see which component rendered and how long it took. Web components had no equivalent. This library fills that gap for custom elements, Lit and Stencil, using Chrome's [Performance Extensibility API](https://developer.chrome.com/docs/devtools/performance/extension).

After recording a profile, a **Web Components** group appears in the flame chart with three tracks:

| Track | What it shows | Source |
| --- | --- | --- |
| **Upgrade** | The `customElements.define` call, which upgrades every matching element already in the page | `definePerf` |
| **Lifecycle** | Each `connected`, `disconnected`, `attributeChanged` and `adopted` callback, per element | `definePerf` or `instrumentElement` |
| **Updates** | Each Lit render, with how many update requests Lit batched into it; or Stencil's own profile timings | `trackLitUpdates`, `observeStencilProfile` |

Each bar carries extra details in the DevTools summary panel, such as which attribute changed or how many requests a Lit render absorbed.

## Install

```sh
npm install custom-element-perf-tracks
```

## Use

### Any custom element

Swap `customElements.define` for `definePerf`:

```js
import { definePerf } from "custom-element-perf-tracks";

definePerf("my-card", MyCard);
```

If something else does the defining, `instrumentElement("my-card", MyCard)` adds the Lifecycle track without touching registration. Call it before the class is defined.

### Lit

Call `trackLitUpdates` from the constructor:

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

This uses a standard Lit reactive controller. The Lit adapter has no runtime dependency on Lit, it only uses Lit's types.

### Stencil

Build with `stencil build --profile`, which makes Stencil record its own timings. Then, once at startup:

```js
import { observeStencilProfile } from "custom-element-perf-tracks/stencil";

observeStencilProfile();
```

This moves Stencil's existing measures onto the Updates track rather than timing the same work twice.

### Settings

```js
import { configure } from "custom-element-perf-tracks";

configure({
  enabled: import.meta.env.DEV, // turn off in production builds
  trackGroup: "My App",         // rename the group in DevTools
});
```

## Try the demo

```sh
npm install
npm run demo
```

Open `http://localhost:5173/demo/`, open DevTools, record in the Performance panel, click a few buttons, then stop.

## Good to know

- **Chrome and Edge only** for the tracks themselves. Other browsers ignore the extra data, so nothing breaks there.
- **Very fast work can vanish.** Browsers round timestamps to about a tenth of a millisecond, so a render faster than that has zero length and DevTools does not draw it.
- **It has a small cost.** Every bar is one `performance.measure` call. That is fine while developing, but `enabled: false` is the safer choice for production.
- **How it was checked.** The demo was run in headless Chromium 153 and the recorded trace was fed through DevTools' own trace engine ([`@paulirish/trace_engine`](https://www.npmjs.com/package/@paulirish/trace_engine)), which built the Web Components group with all three tracks, colours and details intact.

## Licence

MIT
