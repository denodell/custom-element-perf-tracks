# Tuppence

See your web components in the Chrome DevTools Performance panel, the way React shows its own components.

![Chrome DevTools after clicking a Lit button in the demo. Under Web Components, the Scheduler track shows "Event: click" followed by a blue Render bar and a short Commit bar. The Components track below shows a demo-counter bar lined up with Render.](docs/devtools-lit.png)

React 19.2 added [performance tracks](https://react.dev/reference/dev-tools/react-performance-tracks) that show what caused each update, how long it took, and which components did the work. Tuppence adds the same tracks for Lit, Stencil and other custom elements, with the same names and colors. It also points out renders that didn't need to happen.

## Install

```sh
npm install tuppence
```

## Quick start

Import it at the top of your app's entry file, before any components load:

```js
import "tuppence/register";
```

Record a profile in the Performance panel and you'll see a **Web Components** group with your components in it.

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

You can also match components by tag prefix:

```js
assignTrackGroup("acme-", "Acme Design System");
```

When a component matches both a class and a prefix, the class wins. When it matches more than one prefix, the longest one wins. Rules from different libraries stay separate, so two design systems on the same page each get their own group.

None of this ends up in the production builds of apps that use your design system.

## Wasted renders

When a Lit component re-renders only because it was given a new array, object or date with the same contents, Tuppence draws that render in yellow and lists the property under **Same contents, new object**.

This usually comes from app code that creates a new value on every render:

```jsx
// React
<acme-table columns={[{ key: "name", label: "Name" }]} />
```

```js
// Lit
html`<acme-table .columns=${[{ key: "name", label: "Name" }]}></acme-table>`;
```

Arrays, plain objects and dates are compared by their contents. Anything else, like a class instance or a `Map`, has to be the same object to count as unchanged.

## What you see

**Scheduler** shows each update as a row of steps, like React's Scheduler track:

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
| **my-element** (yellow) | A [wasted render](#wasted-renders). |
| **my-element** (purple) | `firstUpdated()` and `updated()`. |
| **Mount** | A component's first update. |
| **my-element connected** | Lifecycle callbacks: `connected`, `disconnected`, `attributeChanged` and `adopted`. |

**Upgrade** shows each `customElements.define` call. Click it to see how many elements already on the page it upgraded.

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

Stencil records its own timings in dev builds and in builds made with `stencil build --profile`. Call this once at startup to show them on the same tracks:

```js
import { observeStencilProfile } from "tuppence/stencil";

observeStencilProfile();
```

Stencil times rendering and DOM updates together, so each update shows as a single **Render and Commit** bar. A **Loading** track shows the app starting up and each component's code loading.

## Other libraries

Custom elements built with anything else, including Vue's `defineCustomElement`, get the **Upgrade** and lifecycle bars from the one-line setup. The **Scheduler** track and **Changed Props** need a hook into the library's own update cycle, so they only work with Lit and Stencil.

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

- `"auto"` (default) uses `performance.measure` and clears each entry from the performance buffer straight away.
- `"measure"` keeps entries in the buffer, so test scripts can read them.
- `"timestamp"` uses `console.timeStamp`. It's lighter, but bars have no details.

## Demo

```sh
npm install
npm run demo
```

Open `http://localhost:5173/demo/`, start recording in the Performance panel, click a few buttons, then stop.

There's also a design system demo, a small React shop built on a Lit design system:

```sh
npm run demo:design-system
```

Open `http://localhost:5174/` and record while clicking **Add to cart** a few times. Each table render shows up yellow in the **Acme Design System** group. Check **Fix it**, record again, and the table stops re-rendering.

## Limitations

- Tracks only show up in Chrome and Edge. Other browsers ignore them.
- Anything under 0.1 ms is too short to draw.
- Only synchronous work is timed.
- Lit components update one at a time, so their bars sit side by side rather than nested like React's. **Triggered by** shows which parent caused a child's update.

## Development

`npm test` runs the tests. They need Chrome or Chromium; set `CHROME_PATH` if it isn't found automatically. `npm run coverage` reports test coverage.

## License

MIT
