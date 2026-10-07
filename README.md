# Tuppence

Find out which web component did it. Tuppence shows your web components in the Chrome DevTools Performance panel, the same way React shows its components.

React 19.2 added [performance tracks](https://react.dev/reference/dev-tools/react-performance-tracks) to the Performance panel, so React developers can see what caused each update, how long each step took, and which components did the work. This library adds the same tracks for custom elements, Lit and Stencil, with the same names and colors.

Building a design system? Your components run inside apps you don't control. When one of them is slow, the app team can't see which component is doing the work, and when the app passes it a new array or object on every render, your component gets the blame. Tuppence gives your components their own group in DevTools, in every app that uses them, and marks renders the app caused for nothing. See [Design systems](#design-systems).

![Chrome DevTools after clicking a Lit button in the demo. Under Web Components, the Scheduler track shows "Event: click" followed by a blue Render bar and a short Commit bar. The Components track below shows a demo-counter bar lined up with Render.](docs/devtools-lit.png)

## Install

```sh
npm install tuppence
```

## Quick start

Add this as the first import in your app's entry file, before any components load:

```js
import "tuppence/register";
```

Every custom element defined after that is tracked, and Lit elements also get their updates tracked, with no other changes to your code. Record a profile in the Performance panel and a **Web Components** group appears.

None of it reaches production builds. See [Production builds](#production-builds).

## Design systems

A design system can turn Tuppence on for all of its components at once, from its own code, so every app that uses them sees their work in DevTools without any setup of its own. Two lines in the base class do it:

```js
import { LitElement } from "lit";
import { trackLitUpdates } from "tuppence/lit";
import { assignTrackGroup } from "tuppence";

export class AcmeElement extends LitElement {
  constructor() {
    super();
    trackLitUpdates(this);
  }
}

assignTrackGroup(AcmeElement, "Acme Design System");
```

Every component that extends `AcmeElement` now shows up under its own **Acme Design System** group in the Performance panel, separate from the app's tracks. When an app re-renders a component by passing it a new array or object with the same contents, that render is drawn in yellow and named as a wasted render, along with the property that caused it.

Two things design system teams usually ask:

- **What does it cost the apps that use us?** Nothing in production. The package has an empty version that bundlers use in production builds, so apps ship none of it. See [Production builds](#production-builds).
- **Will it clash with the app, or with other libraries using Tuppence?** No. Each `assignTrackGroup` call adds a rule without replacing anyone else's, so every library keeps its own group.

`assignTrackGroup` also takes a tag prefix, for components that don't share a base class:

```js
assignTrackGroup("acme-", "Acme Design System");
```

A class rule covers the class and everything that extends it, and wins over a prefix rule. Among prefixes, the longest match wins. Each group gets its own Scheduler, Components and Upgrade tracks.

To see it working, `npm run demo:design-system` serves a React app built on a small Lit design system. See [Demo](#demo).

## What you see

**Scheduler** shows each update as a row of steps, like React's Scheduler track:

| Bar | What it covers |
| --- | --- |
| **Event: click** | The event handler that made the change, up to the change itself. Any user input event works, not only clicks. |
| **Update** | The wait between the change and Lit starting the update. It becomes **Update Blocked** when the wait is over 5 ms. |
| **Render** | `shouldUpdate`, `willUpdate` and `render`. |
| **Commit** | Writing the result to the page, then `firstUpdated` and `updated`. |
| **Cascading Update** | Red. The element changed its own properties after rendering, usually in `updated()`, so Lit had to update it a second time. |

**Components** shows which element did the work, like React's Components track:

| Bar | What it covers |
| --- | --- |
| **my-element** (blue) | The element's render. Clicking it shows **Changed Props** with old and new values, how many **Changes batched** into the update, and which parent it was **Triggered by**. |
| **my-element** (yellow) | A wasted render: every property that changed was given a new array, object or date with the same contents, so the element rendered again with nothing new to show. Clicking it names the properties under **Same contents, new object**. |
| **my-element** (purple) | The element's `firstUpdated()` and `updated()` work. |
| **Mount** | Wraps an element's first update. |
| **my-element connected** | Lifecycle callbacks: `connected`, `disconnected`, `attributeChanged` and `adopted`. |

**Upgrade** shows each `customElements.define` call, which upgrades every matching element already in the page. Clicking it shows how many were upgraded.

Wasted renders usually come from the app, not the component: code like `<my-table .columns=${[...]}>`, or `columns={[...]}` in React, creates a new array on every render. Only arrays, plain objects and dates are compared by contents; anything else counts as unchanged only if it is the very same object. Lit elements only.

Bars get darker as work gets slower, using React's thresholds. Anything that throws gets a red bar with the error message.

## Instrumenting specific elements

The quick start covers most apps. To instrument only some elements instead:

```js
import { definePerf } from "tuppence";
import { trackLitUpdates } from "tuppence/lit";

// Instead of customElements.define:
definePerf("my-card", MyCard);

// In a Lit element's constructor:
class MyCounter extends LitElement {
  constructor() {
    super();
    trackLitUpdates(this);
  }
}
```

`instrumentElement(MyCard)` adds the lifecycle bars without defining the element. It has to run before the class is defined.

## Stencil

Stencil records its own timings in dev builds, and in builds made with `stencil build --profile`. One call at startup shows them on the same tracks:

```js
import { observeStencilProfile } from "tuppence/stencil";

observeStencilProfile();
```

Stencil's timing for `render()` includes patching the page, so each update is one **Render and Commit** bar. A **Loading** track shows the app starting and each component's code being loaded, with extra rows when loads overlap.

## Other libraries

Any custom element gets the **Upgrade** bars and the lifecycle bars on **Components** from the one-line setup, whatever built it. That includes Vue components packaged with `defineCustomElement`. The **Scheduler** track and the per-update bars with **Changed Props** need a hook into the library's own update cycle, so they cover Lit and Stencil only.

## Production builds

The package has an empty version with the same API, and bundlers pick it for production builds:

| Tool | Production build |
| --- | --- |
| Vite | Empty version, automatically |
| webpack (`mode: "production"`) | Empty version, automatically |
| esbuild | Empty version with `--conditions=production` |
| Rollup | Empty version with `exportConditions: ["production"]` in `@rollup/plugin-node-resolve` |

Any tool that supports the standard `"production"` [export condition](https://nodejs.org/api/packages.html#conditional-exports) works the same way. Without a bundler, `configure({ enabled: false })` turns it off.

Vite and webpack decide from `NODE_ENV`, so a dev server started with `NODE_ENV=production` set gets the empty version and shows no tracks.

## Settings

```js
import { configure } from "tuppence";

configure({
  trackGroup: "My App",   // rename the group in DevTools
  minDuration: 0,         // draw even the shortest callbacks (default 0.05 ms)
  strategy: "timestamp",  // lighter bars, without details
  enabled: false,         // turn it off completely
});
```

`configure` needs to run before your elements are defined.

`strategy` sets how bars are drawn. The default, `"auto"`, uses `performance.measure` and removes each entry from the performance buffer straight away. `"measure"` leaves them in the buffer, for test scripts to read. `"timestamp"` uses `console.timeStamp` and drops the details.

## Demo

```sh
npm install
npm run demo
```

Open `http://localhost:5173/demo/`, record in the Performance panel, click a few buttons, then stop.

For the design system demo, a React shop using a small Lit design system:

```sh
npm run demo:design-system
```

Open `http://localhost:5174/`, record, click **Add to cart** a few times, then stop. The **Acme Design System** group shows each table render in yellow as a wasted render. Tick **Fix it** and record again: the table stops re-rendering.

## Limitations

- Tracks only appear in Chrome and Edge. Other browsers ignore the extra data.
- Work faster than a tenth of a millisecond has no visible length, so it isn't drawn.
- Only synchronous work is timed.
- Lit elements update one at a time, so their bars sit side by side instead of nesting the way React's do. **Triggered by** links a child's update to its parent.

## Development

`npm test` runs the tests, which need Chrome or Chromium (set `CHROME_PATH` if it isn't found). `npm run coverage` reports test coverage.

## License

MIT
