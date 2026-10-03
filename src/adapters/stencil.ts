import { Tracks } from "../emit.js";
import { rerouteMeasures } from "../reroute.js";

/**
 * Stencil already records timings when an app is built with `--profile`,
 * as measures named like `[Stencil] render() <my-tag>`. This moves them onto
 * the "Updates" track, grouped with everything else. Call it once at startup.
 * Returns a function that stops watching.
 */
export function observeStencilProfile(): () => void {
  return rerouteMeasures(/^\[Stencil\] (\w+)\(\) <([^>]+)>$/, (match) => {
    const [, fn, tag] = match;
    return {
      name: `<${tag}> ${fn}`,
      track: Tracks.updates,
      color: fn === "render" ? "secondary" : "secondary-light",
      properties: [["source", "Stencil --profile"]],
    };
  });
}
