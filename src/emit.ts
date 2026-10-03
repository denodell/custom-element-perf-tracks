/**
 * The one place that talks to Chrome DevTools.
 *
 * Chrome's Performance Extensibility API reads a `detail.devtools` object on
 * a User Timing measure and draws the measure on a custom track instead of
 * the generic "Timings" lane. Other browsers ignore the extra detail, so the
 * measure is harmless there.
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
  | "error"
  | "warning";

export interface Config {
  /** Turn all emission on or off. Default: true. */
  enabled: boolean;
  /** Name of the collapsible group the tracks sit under. */
  trackGroup: string;
  /**
   * Remove each measure from the page's performance buffer straight after
   * emitting it. DevTools has already recorded it by then, so this only stops
   * the buffer growing on long-lived pages. Default: true.
   */
  clearAfterEmit: boolean;
}

const config: Config = {
  enabled: true,
  trackGroup: "Web Components",
  clearAfterEmit: true,
};

export function configure(options: Partial<Config>): void {
  Object.assign(config, options);
}

export function getConfig(): Readonly<Config> {
  return config;
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
  /** Shown in the DevTools summary panel when the entry is selected. */
  properties?: Array<[string, string]>;
  tooltip?: string;
}

function canMeasure(): boolean {
  return (
    typeof performance !== "undefined" &&
    typeof performance.measure === "function"
  );
}

/**
 * Draw one bar on a custom track, from `start` to `end`
 * (both `performance.now()` timestamps).
 */
export function emit(
  name: string,
  start: number,
  end: number,
  options: EmitOptions,
): void {
  if (!config.enabled || !canMeasure()) return;
  try {
    performance.measure(name, {
      start,
      end,
      detail: {
        devtools: {
          dataType: "track-entry",
          trackGroup: config.trackGroup,
          track: options.track,
          color: options.color ?? "primary",
          properties: options.properties,
          tooltipText: options.tooltip ?? name,
        },
      },
    });
    if (config.clearAfterEmit) performance.clearMeasures(name);
  } catch {
    // Never let instrumentation break the component it is watching.
  }
}

/** Run `fn`, timing it as one bar. Returns whatever `fn` returns. */
export function timed<T>(name: string, options: EmitOptions, fn: () => T): T {
  if (!config.enabled) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    emit(name, start, performance.now(), options);
  }
}
