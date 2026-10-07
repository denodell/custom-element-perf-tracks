import { Tracks, defaultTrackGroup, effectColor, minDuration, renderColor } from "../emit.js";
import { rerouteMeasures } from "../reroute.js";
import { groupFor } from "../groups.js";

function stencilGroup(tag: string): string {
  const ctor = typeof customElements !== "undefined" ? customElements.get(tag) : undefined;
  return groupFor(tag, ctor);
}

let stop: (() => void) | null = null;

const SETUP = new Set(["createInstance", "attachStyles", "registerStyles", "hydrateClient"]);

/** Shows Stencil's own dev-build timings on the same tracks. */
export function observeStencilProfile(): () => void {
  if (stop) return stop;

  const disconnect = rerouteMeasures(/^\[Stencil\] (\w+)\(\) <([^>]*)>$/, (match, entry) => {
    const [, fn, tag] = match;
    if (!tag) return null;
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
        return ms >= minDuration()
          ? { name: `${tag} ${fn}`, track: Tracks.components, trackGroup, color: renderColor(ms) }
          : null;
    }
  });

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

class Lanes {
  private rows: Array<Array<[number, number]>> = [];

  constructor(private max: number) {}

  place(start: number, end: number): number {
    const fits = (row: Array<[number, number]>) =>
      row.every(([a, b]) => end <= a || start >= b || (start >= a && end <= b) || (start <= a && end >= b));
    let i = this.rows.findIndex(fits);
    if (i === -1) {
      if (this.rows.length < this.max) {
        this.rows.push([]);
        i = this.rows.length - 1;
      } else {
        i = this.max - 1;
      }
    }
    this.rows[i].push([start, end]);
    return i + 1;
  }
}
