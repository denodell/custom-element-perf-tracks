import { emit, type EmitOptions } from "./emit.js";

export interface RerouteTarget extends EmitOptions {
  name: string;
}

/**
 * Some tools already record their own User Timing measures (Stencil does in
 * dev and `--profile` builds). Rather than timing the same work again, this
 * watches for measures whose names match `pattern` and draws a copy of each
 * one on a custom track. The originals are left alone, so they still appear
 * in DevTools' generic "Timings" lane as well.
 *
 * `map` gets the regex match and returns where the bar should go, or `null`
 * to skip it. Measures that already target a DevTools track (including this
 * library's own) are never copied. Returns a function that stops watching.
 */
export function rerouteMeasures(
  pattern: RegExp,
  map: (match: RegExpExecArray, entry: PerformanceEntry) => RerouteTarget | null,
): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};

  // A `g` or `y` flag would make `exec` remember its position between calls.
  const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      try {
        const detail = (entry as PerformanceMeasure).detail as
          | { devtools?: unknown }
          | null
          | undefined;
        if (detail && typeof detail === "object" && detail.devtools) continue;
        const match = re.exec(entry.name);
        if (!match) continue;
        const target = map(match, entry);
        if (!target) continue;
        const { name, ...options } = target;
        emit(name, entry.startTime, entry.startTime + entry.duration, options);
      } catch (error) {
        // One bad entry should not stop the rest. Report it the way the
        // browser reports an uncaught error, without throwing.
        if (typeof reportError === "function") reportError(error);
        else console.error(error);
      }
    }
  });
  observer.observe({ type: "measure", buffered: true });
  return () => observer.disconnect();
}
