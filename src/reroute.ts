import { emit, getConfig, type EmitOptions } from "./emit.js";

export interface RerouteTarget extends EmitOptions {
  name: string;
}

/**
 * Some tools already record their own User Timing measures (Stencil does,
 * with its `--profile` flag). Rather than timing the same work twice, this
 * watches for measures whose names match `pattern` and redraws each one on a
 * custom track.
 *
 * `map` gets the regex match and returns where the bar should go, or `null`
 * to skip it. Returns a function that stops watching.
 */
export function rerouteMeasures(
  pattern: RegExp,
  map: (match: RegExpExecArray, entry: PerformanceEntry) => RerouteTarget | null,
): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      // Skip bars this library drew itself.
      const detail = (entry as PerformanceMeasure).detail as
        | { devtools?: { trackGroup?: string } }
        | null
        | undefined;
      if (detail?.devtools?.trackGroup === getConfig().trackGroup) continue;
      const match = pattern.exec(entry.name);
      if (!match) continue;
      const target = map(match, entry);
      if (!target) continue;
      const { name, ...options } = target;
      emit(name, entry.startTime, entry.startTime + entry.duration, options);
    }
  });
  observer.observe({ type: "measure", buffered: true });
  return () => observer.disconnect();
}
