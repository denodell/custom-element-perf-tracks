# Tuppence

<img width="200" height="200" alt="4AA625DC-3AB2-4B6B-ADAE-D1711727993F" src="https://github.com/user-attachments/assets/df550980-b876-4f23-accc-131814d89a72" />

Tuppence adds tracks to the Chrome DevTools Performance panel that show when your web components update, what caused it, and how long it took.

![Chrome DevTools after clicking a Lit button in the demo. Under Web Components, the Scheduler track shows "Event: click" followed by a blue Render bar and a short Commit bar. The Components track below shows a demo-counter bar lined up with Render.](docs/devtools-lit.png)

It works like the [performance tracks](https://react.dev/reference/dev-tools/react-performance-tracks) React 19.2 added, with the same names and colors, but for Lit, Stencil and other custom elements. It also points out renders that didn't need to happen.

## Install

```sh
npm install tuppence
```

## Quick start

Import it at the top of your app's entry file, before any components load:

```js
import "tuppence/register";
```

Record a profile in the [Performance panel](https://developer.chrome.com/docs/devtools/performance/overview) and you'll see a **Web Components · Tuppence** group with your components in it. If it's missing, turn on **Show custom tracks** in the panel's capture settings.

Tuppence is a development tool. Production builds use an empty version of the package, so none of it ships to your users. See [Production builds](#production-builds).

## Design systems

If you maintain a design system, you can turn Tuppence on from your base class. Every app that uses your components then sees them in DevTools, in a group of their own:

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

Components that extend `AcmeElement` show up under **Acme Design System**, separate from the app's own tracks.

Or match them by tag prefix:

```js
assignTrackGroup("acme-", "Acme Design System");
```

## What you see

**Scheduler** shows each update as a row of steps, like React's Scheduler track. The steps follow Lit's [update lifecycle](https://lit.dev/docs/components/lifecycle/):

| Bar | What it shows |
| --- | --- |
| **Event: click** | The event handler that caused the update. Key presses and other input show up here too. |
| **Update** | The time between the change and Lit starting the update. Shown as **Update Blocked** when it's over 5 ms. |
| **Render** | `shouldUpdate`, `willUpdate` and `render`. |
| **Commit** | Writing to the DOM, then `firstUpdated` and `updated`. |
| **Cascading Update** | Red. The component changed its own properties after rendering, usually in `updated()`, so Lit had to update it again. |

**Components** shows which component did the work, like React's Components track:

| Bar | What it shows |
| --- | --- |
| **my-element** (blue) | The render. Click it to see **Changed Props** with old and new values, how many **Changes batched** into the update, and which parent it was **Triggered by**. |
| **my-element** (yellow) | A wasted render: the only change was a new array, object or date with the same contents, often from passing `[...]` or `{...}` inline. |
| **my-element** (purple) | `firstUpdated()` and `updated()`. |
| **Mount** | A component's first update. |
| **my-element connected** | Lifecycle callbacks: `connected`, `disconnected`, `attributeChanged` and `adopted`. |

**Upgrade** shows each [`customElements.define`](https://developer.mozilla.org/en-US/docs/Web/API/CustomElementRegistry/define) call. Click it to see how many elements already on the page it upgraded.

Bars get darker the longer they take, using React's thresholds. Errors show as red bars with the error message.

## Tracking specific elements

If you'd rather not track everything, skip the one-line setup and use these instead:

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

`instrumentElement(MyCard)` adds the lifecycle bars without defining the element. Call it before `customElements.define`.

## Stencil

Stencil records its own timings in dev builds and in builds made with [`stencil build --profile`](https://stenciljs.com/docs/cli). Call this once at startup to show them on the same tracks:

```js
import { observeStencilProfile } from "tuppence/stencil";

observeStencilProfile();
```

Stencil times rendering and DOM updates together, so each update shows as a single **Render and Commit** bar. A **Loading** track shows the app starting up and each component's code loading.

## Production builds

The package includes an empty version with the same API. Bundlers pick it for production builds:

| Tool | Production build |
| --- | --- |
| Vite | Empty version, automatically |
| webpack (`mode: "production"`) | Empty version, automatically |
| esbuild | Empty version with `--conditions=production` |
| Rollup | Empty version with `exportConditions: ["production"]` in `@rollup/plugin-node-resolve` |

This works with any tool that supports the `"production"` [export condition](https://nodejs.org/api/packages.html#conditional-exports). Without a bundler, use `configure({ enabled: false })`.

Vite and webpack decide based on `NODE_ENV`, so a dev server started with `NODE_ENV=production` won't show any tracks.

## Settings

```js
import { configure } from "tuppence";

configure({
  trackGroup: "My App",   // rename the group in DevTools
  minDuration: 0,         // draw even the shortest callbacks (default 0.05 ms)
  strategy: "timestamp",  // lighter bars, name and color only
  enabled: false,         // turn it off completely
});
```

Call `configure` before your elements are defined.

`strategy` controls how bars are drawn:

- `"auto"` (default) uses [`performance.measure`](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measure) and clears each entry from the performance buffer straight away.
- `"measure"` keeps entries in the buffer, so test scripts can read them.
- `"timestamp"` uses `console.timeStamp`. It's lighter, but bars have no details.

All three use Chrome's [Performance panel extensibility API](https://developer.chrome.com/docs/devtools/performance/extension).

## Demo

```sh
npm install
npm run demo
```

Open `http://localhost:5173/demo/`, start recording in the Performance panel, click a few buttons, then stop.

`npm run demo:design-system` runs a second demo, a React app using a small Lit design system, at `http://localhost:5174/`.

## Limitations

- Tracks only show up in Chrome and Edge. Other browsers ignore them.
- Anything under 0.1 ms is too short to draw.
- Only synchronous work is timed.
- Render details are for Lit and Stencil. Other custom elements get the Upgrade and lifecycle bars.
- Lit components update one at a time, so their bars sit side by side rather than nested like React's. **Triggered by** shows which parent caused a child's update.

## Development

`npm test` runs the tests. They need Chrome or Chromium; set `CHROME_PATH` if it isn't found automatically. `npm run coverage` reports test coverage.

## License

MIT
