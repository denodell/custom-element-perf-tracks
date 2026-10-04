import { emit, type EmitOptions } from "./emit.js";

export interface RerouteTarget extends EmitOptions {
  name: string;
  /** Defaults to the original measure's start. */
  start?: number;
  /** Defaults to the original measure's end. */
  end?: number;
}

/**
 * Some tools already record their own User Timing measures (Stencil does in
 * dev and `--profile` builds). Rather than timing the same work again, this
 * watches for measures whose names match `pattern` and draws a copy of each
 * one on a custom track. The originals are left alone, so they still appear
 * in DevTools' generic "Timings" lane as well.
 *
 * `map` gets the regex match and returns where the bar should go, several
 * bars, or `null` to skip it. Measures that already target a DevTools track (including this
 * library's own) are never copied. Returns a function that stops watching.
 */
export function rerouteMeasures(
  pattern: RegExp,
  map: (
    match: RegExpExecArray,
    entry: PerformanceEntry,
  ) => RerouteTarget | RerouteTarget[] | null,
): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};

  // A `g` or `y` flag would make `exec` remember its position between calls.
  const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));

  const observer = new PerformanceObserver((list) => {
    // The browser sorts entries by start time. Handle them in the order they
    // finished instead, which is the order they were recorded: an inner
    // measure (Stencil's render) before the outer one around it (update).
    const entries = list
      .getEntries()
      .slice()
      // Same end time: the one that started later is inside the other.
      .sort((a, b) => a.startTime + a.duration - (b.startTime + b.duration) || b.startTime - a.startTime);
    for (const entry of entries) {
      try {
        const detail = (entry as PerformanceMeasure).detail as
          | { devtools?: unknown }
          | null
          | undefined;
        if (detail && typeof detail === "object" && detail.devtools) continue;
        const match = re.exec(entry.name);
        if (!match) continue;
        const result = map(match, entry);
        if (!result) continue;
        for (const { name, start, end, ...options } of Array.isArray(result) ? result : [result]) {
          emit(name, start ?? entry.startTime, end ?? entry.startTime + entry.duration, options);
        }
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
