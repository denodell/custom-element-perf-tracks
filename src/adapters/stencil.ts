import { Tracks, defaultTrackGroup, effectColor, minDuration, renderColor } from "../emit.js";
import { rerouteMeasures } from "../reroute.js";
import { groupFor } from "../groups.js";

/** The track group for a Stencil element, by tag and, once defined, class. */
function stencilGroup(tag: string): string {
  const ctor = typeof customElements !== "undefined" ? customElements.get(tag) : undefined;
  return groupFor(tag, ctor);
}

let stop: (() => void) | null = null;

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
 * - Loading: the app's initial load, and each component's code being loaded.
 *   Loads overlap, so like React's server requests they are spread over
 *   extra rows ("Loading 2" and so on, up to 8).
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
    const trackGroup = stencilGroup(tag);

    switch (fn) {
      case "render":
        return { name: tag, track: Tracks.components, trackGroup, color: renderColor(ms) };
      case "update":
        return { name: "Render and Commit", track: Tracks.scheduler, trackGroup, color: "primary-dark" };
      case "postUpdate":
        return ms >= minDuration() ? { name: tag, track: Tracks.components, trackGroup, color: effectColor(ms) } : null;
      case "connectedCallback":
        return ms >= minDuration()
          ? { name: `${tag} connected`, track: Tracks.components, trackGroup, color: "warning" }
          : null;
      default:
        if (SETUP.has(fn)) return { name: `${tag} ${fn}`, track: Tracks.upgrade, trackGroup, color: "tertiary" };
        // scheduleUpdate (the componentWill… hooks), usually near zero.
        return ms >= minDuration()
          ? { name: `${tag} ${fn}`, track: Tracks.components, trackGroup, color: renderColor(ms) }
          : null;
    }
  });

  // Each group gets its own Loading rows.
  const lanes = new Map<string, Lanes>();
  const disconnectLoads = rerouteMeasures(
    /^\[Stencil\] (?:Load module for <([^>]+)>|(.+ initial load \(by [^)]+\)))$/,
    (match, entry) => {
      const [, tag, appLoad] = match;
      const start = entry.startTime;
      const end = start + entry.duration;
      const trackGroup = tag ? stencilGroup(tag) : defaultTrackGroup();
      let rows = lanes.get(trackGroup);
      if (!rows) lanes.set(trackGroup, (rows = new Lanes(8)));
      const lane = rows.place(start, end);
      return {
        trackGroup,
        name: tag ?? appLoad,
        track: lane === 1 ? Tracks.loading : `${Tracks.loading} ${lane}`,
        color: tag ? "tertiary-light" : "tertiary-dark",
        tooltip: tag ? `Load module for <${tag}>` : appLoad,
      };
    },
  );

  stop = () => {
    disconnect();
    disconnectLoads();
    stop = null;
  };
  return stop;
}

/**
 * Spreads bars over rows so that no two bars on a row partly overlap.
 * A bar may sit inside another on the same row; DevTools nests those.
 */
class Lanes {
  private rows: Array<Array<[number, number]>> = [];

  constructor(private max: number) {}

  /** Returns the row number, starting at 1. */
  place(start: number, end: number): number {
    const fits = (row: Array<[number, number]>) =>
      row.every(([a, b]) => end <= a || start >= b || (start >= a && end <= b) || (start <= a && end >= b));
    let i = this.rows.findIndex(fits);
    if (i === -1) {
      if (this.rows.length < this.max) {
        this.rows.push([]);
        i = this.rows.length - 1;
      } else {
        i = this.max - 1; // like React, the last row takes the overflow
      }
    }
    this.rows[i].push([start, end]);
    return i + 1;
  }
}
