import { Tracks } from "../emit.js";
import { rerouteMeasures } from "../reroute.js";

let stop: (() => void) | null = null;

/**
 * Stencil records its own timings in dev builds and in builds made with
 * `--profile`, as measures named like `[Stencil] render() <my-tag>`. This
 * draws a copy of each one on this library's tracks: `connectedCallback` on
 * the Lifecycle track, everything else on the Updates track. Stencil's
 * originals stay in DevTools' generic "Timings" lane too.
 *
 * Call it once at startup; extra calls do nothing. Returns a function that
 * stops watching.
 */
export function observeStencilProfile(): () => void {
  if (!stop) {
    const disconnect = rerouteMeasures(/^\[Stencil\] (\w+)\(\) <([^>]*)>$/, (match) => {
      const [, fn, tag] = match;
      if (!tag) return null; // app-level timings such as bootstrapLazy()
      const lifecycle = fn === "connectedCallback";
      return {
        name: `<${tag}> ${lifecycle ? "connected" : fn}`,
        track: lifecycle ? Tracks.lifecycle : Tracks.updates,
        color: lifecycle ? "primary" : fn === "render" ? "secondary" : "secondary-light",
        properties: [["source", "Stencil profile timing"]],
      };
    });
    stop = () => {
      disconnect();
      stop = null;
    };
  }
  return stop;
}
