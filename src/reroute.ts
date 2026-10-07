import { emit, type EmitOptions } from "./emit.js";

export interface RerouteTarget extends EmitOptions {
  name: string;
  start?: number;
  end?: number;
}

/** Copies existing measures whose names match `pattern` onto custom tracks. */
export function rerouteMeasures(
  pattern: RegExp,
  map: (
    match: RegExpExecArray,
    entry: PerformanceEntry,
  ) => RerouteTarget | RerouteTarget[] | null,
): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};

  const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));

  const observer = new PerformanceObserver((list) => {
// In the order they finished, so an inner measure is handled before the one around it.
    const entries = list
      .getEntries()
      .slice()
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
        if (typeof reportError === "function") reportError(error);
        else console.error(error);
      }
    }
  });
  observer.observe({ type: "measure", buffered: true });
  return () => observer.disconnect();
}
