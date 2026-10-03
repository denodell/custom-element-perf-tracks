/**
 * The one place that talks to Chrome DevTools.
 *
 * Chrome's Performance Extensibility API offers two ways to draw a bar on a
 * custom track:
 *
 * - `performance.measure` with a `detail.devtools` object. The bar can carry
 *   extra details (shown when it is selected), but every call also adds an
 *   entry to the page's performance buffer.
 * - `console.timeStamp` with extra arguments. Much cheaper and it adds
 *   nothing to the buffer, but the bar only has a name and a colour.
 *
 * Other browsers ignore the DevTools-specific parts, so nothing breaks there.
 *
 * https://developer.chrome.com/docs/devtools/performance/extension
 */

export type TrackColor =
  | "primary"
  | "primary-light"
  | "primary-dark"
  | "secondary"
  | "secondary-light"
  | "secondary-dark"
  | "tertiary"
  | "tertiary-light"
  | "tertiary-dark"
  | "error";

export type Strategy = "measure" | "timestamp";

export interface Config {
  /**
   * Turn all emission on or off. Default: true.
   *
   * Element and Lit instrumentation is wired up (or skipped) when it is set
   * up, so set this before defining elements.
   */
  enabled: boolean;
  /** Name of the collapsible group the tracks sit under. */
  trackGroup: string;
  /**
   * How bars are drawn.
   *
   * - `"measure"` (default): bars carry extra details, such as which
   *   attribute changed. Each bar adds an entry to the page's performance
   *   buffer, which grows over a long session.
   * - `"timestamp"`: uses `console.timeStamp`, which is much cheaper and
   *   adds nothing to the buffer, but bars show only a name and colour.
   */
  strategy: Strategy;
}

const config: Config = {
  enabled: true,
  trackGroup: "Web Components",
  strategy: "measure",
};

/** Change settings. Keys set to `undefined` are ignored. */
export function configure(options: Partial<Config>): void {
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) (config as unknown as Record<string, unknown>)[key] = value;
  }
}

export function getConfig(): Readonly<Config> {
  return { ...config };
}

/** @internal Fast check that avoids copying the config. */
export function isEnabled(): boolean {
  return config.enabled;
}

/** Track names used by the built-in helpers. */
export const Tracks = {
  lifecycle: "Lifecycle",
  upgrade: "Upgrade",
  updates: "Updates",
} as const;

export interface EmitOptions {
  track: string;
  color?: TrackColor;
  /**
   * Extra details, shown in the DevTools summary panel when the bar is
   * selected. Only used by the `"measure"` strategy. Can be a function, so
   * the work of building them is skipped when nothing is emitted.
   */
  properties?: Array<[string, string]> | (() => Array<[string, string]>);
  tooltip?: string;
}

const hasPerformance = typeof performance !== "undefined";

/** `performance.now()`, or 0 where there is no `performance` (some SSR). */
export function now(): number {
  return hasPerformance ? performance.now() : 0;
}

/**
 * Draw one bar on a custom track, from `start` to `end`
 * (both `performance.now()` timestamps).
 */
export function emit(name: string, start: number, end: number, options: EmitOptions): void {
  if (!config.enabled || !hasPerformance) return;
  const color = options.color ?? "primary";
  try {
    if (config.strategy === "timestamp" && typeof console !== "undefined" && console.timeStamp) {
      // Chrome's extended form: (label, start, end, track, trackGroup, color).
      (console.timeStamp as unknown as (...args: unknown[]) => void)(
        name,
        start,
        end,
        options.track,
        config.trackGroup,
        color,
      );
      return;
    }
    const properties =
      typeof options.properties === "function" ? options.properties() : options.properties;
    performance.measure(name, {
      start,
      end,
      detail: {
        devtools: {
          dataType: "track-entry",
          trackGroup: config.trackGroup,
          track: options.track,
          color,
          properties,
          tooltipText: options.tooltip ?? name,
        },
      },
    });
  } catch {
    // Never let instrumentation break the component it is watching.
  }
}

/**
 * Run `fn`, timing it as one bar. Returns whatever `fn` returns and rethrows
 * whatever it throws. If it throws, the bar is coloured `"error"`.
 *
 * Only synchronous work is timed: for an async function the bar ends when
 * the promise is returned, not when it settles.
 */
export function timed<T>(name: string, options: EmitOptions, fn: () => T): T {
  if (!config.enabled || !hasPerformance) return fn();
  const start = performance.now();
  let failed = true;
  try {
    const result = fn();
    failed = false;
    return result;
  } finally {
    emit(name, start, performance.now(), failed ? { ...options, color: "error" } : options);
  }
}
