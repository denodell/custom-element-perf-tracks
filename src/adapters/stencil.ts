import { Tracks, minDuration, type TrackColor } from "../emit.js";
import { rerouteMeasures } from "../reroute.js";

let stop: (() => void) | null = null;

/** Same thresholds React uses for render and effect colors. */
const renderColor = (ms: number): TrackColor =>
  ms < 0.5 ? "primary-light" : ms < 10 ? "primary" : ms < 100 ? "primary-dark" : "error";
const effectColor = (ms: number): TrackColor =>
  ms < 1 ? "secondary-light" : ms < 100 ? "secondary" : ms < 500 ? "secondary-dark" : "error";

/** One-off setup work, drawn on the Upgrade track. */
const SETUP = new Set(["createInstance", "attachStyles", "registerStyles", "hydrateClient"]);

/**
 * Stencil records its own timings in dev builds and in builds made with
 * `--profile`, as measures named like `[Stencil] render() <my-tag>`. This
 * draws copies of them on this library's tracks, in the same layout as
 * React's performance tracks:
 *
 * - Scheduler: one "Render and Commit" bar for each update. Stencil's
 *   `update()` timing covers both steps, and so does its `render()` timing,
 *   which includes patching the page, so the two cannot be told apart.
 * - Components: each element's render, its `componentDidLoad`/`DidUpdate`
 *   hooks in the effects color, and `connectedCallback`.
 * - Upgrade: one-off setup such as creating the instance and attaching styles.
 *
 * Stencil's originals stay in DevTools' general "Timings" lane too.
 *
 * Call it once at startup; extra calls do nothing. Returns a function that
 * stops watching.
 */
export function observeStencilProfile(): () => void {
  if (stop) return stop;

  const disconnect = rerouteMeasures(/^\[Stencil\] (\w+)\(\) <([^>]*)>$/, (match, entry) => {
    const [, fn, tag] = match;
    if (!tag) return null; // app-level timings such as bootstrapLazy()
    const ms = entry.duration;

    switch (fn) {
      case "render":
        return { name: tag, track: Tracks.components, color: renderColor(ms) };
      case "update":
        return { name: "Render and Commit", track: Tracks.scheduler, color: "primary-dark" };
      case "postUpdate":
        return ms >= minDuration() ? { name: tag, track: Tracks.components, color: effectColor(ms) } : null;
      case "connectedCallback":
        return ms >= minDuration()
          ? { name: `${tag} connected`, track: Tracks.components, color: "warning" }
          : null;
      default:
        if (SETUP.has(fn)) return { name: `${tag} ${fn}`, track: Tracks.upgrade, color: "tertiary" };
        return { name: `${tag} ${fn}`, track: Tracks.components, color: renderColor(ms) };
    }
  });

  stop = () => {
    disconnect();
    stop = null;
  };
  return stop;
}
