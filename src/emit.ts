/**
 * The one place that talks to Chrome DevTools.
 *
 * Chrome's Performance Extensibility API offers two ways to draw a bar on a
 * custom track:
 *
 * - `console.timeStamp` with extra arguments: very little work, and nothing
 *   is added to the page's performance buffer, but the bar has only a name
 *   and a color.
 * - `performance.measure` with a `detail.devtools` object: the bar can carry
 *   extra details, shown when it is selected.
 *
 * React's own performance tracks use `console.timeStamp` for every bar except
 * the ones with details. Those use `performance.measure` and are removed from
 * the buffer straight away, under a name starting with an invisible
 * zero-width space so that clearing them never removes the page's own
 * measures. This library does the same by default.
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
  | "warning"
  | "error";

export type Strategy = "auto" | "measure" | "timestamp";

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
   * - `"auto"` (default): the same approach as React. Bars without details
   *   use `console.timeStamp`; bars with details use `performance.measure`
   *   and are removed from the performance buffer straight away.
   * - `"measure"`: every bar uses `performance.measure` and stays in the
   *   buffer, so scripts (tests, for example) can read them back with
   *   `performance.getEntriesByType("measure")`.
   * - `"timestamp"`: every bar uses `console.timeStamp`. The least work, but
   *   no bar has details.
   */
  strategy: Strategy;
  /**
   * Lifecycle callbacks and Lit `updated()` work shorter than this many
   * milliseconds are not drawn, to keep the chart readable. React uses the
   * same cut-off for effects. Default: 0.05. Set to 0 to draw everything.
   */
  minDuration: number;
}

const config: Config = {
  enabled: true,
  trackGroup: "Web Components",
  strategy: "auto",
  minDuration: 0.05,
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

/** @internal */
export function minDuration(): number {
  return config.minDuration;
}

/** Track names used by the built-in helpers. */
export const Tracks = {
  /** What caused each update, and its steps: Update, Render, Commit. */
  scheduler: "Scheduler",
  /** Which element did the work: renders, effects and lifecycle callbacks. */
  components: "Components",
  /** `customElements.define` calls, which upgrade existing elements. */
  upgrade: "Upgrade",
} as const;

export type Properties = Array<[string, string]>;

/** The subset of Chrome's `console.createTask` result this library uses. */
export interface ConsoleTask {
  run<T>(fn: () => T): T;
}

export interface EmitOptions {
  track: string;
  color?: TrackColor;
  /**
   * Extra details, shown in the DevTools summary panel when the bar is
   * selected. Ignored by the `"timestamp"` strategy. Can be a function, so
   * the work of building them is skipped when they are not needed.
   */
  properties?: Properties | (() => Properties | undefined);
  tooltip?: string;
  /**
   * A task from `console.createTask`. DevTools then shows the stack where
   * the task was created (for an element, where it was created) in the
   * bar's "Function stack", instead of this library's own code.
   */
  task?: ConsoleTask | null;
}

const hasPerformance = typeof performance !== "undefined";
const ZERO_WIDTH_SPACE = "​";

/** `performance.now()`, or 0 where there is no `performance` (some SSR). */
export function now(): number {
  return hasPerformance ? performance.now() : 0;
}

type TimeStamp = (
  label: string,
  start: number,
  end: number,
  track: string,
  trackGroup: string,
  color: string,
) => void;

/** @internal Create a DevTools task where supported (Chrome), or null. */
export function createTask(name: string): ConsoleTask | null {
  const create = (console as unknown as { createTask?: (name: string) => ConsoleTask }).createTask;
  if (typeof create !== "function") return null;
  try {
    return create.call(console, name);
  } catch {
    return null;
  }
}

/**
 * Draw one bar on a custom track, from `start` to `end`
 * (both `performance.now()` timestamps).
 */
export function emit(name: string, start: number, end: number, options: EmitOptions): void {
  if (!config.enabled || !hasPerformance) return;
  const draw = () => draw_(name, start, end, options);
  try {
    if (options.task) options.task.run(draw);
    else draw();
  } catch {
    // Never let instrumentation break the component it is watching.
  }
}

function draw_(name: string, start: number, end: number, options: EmitOptions): void {
  const color = options.color ?? "primary";
  const strategy = config.strategy;
  const timeStamp = typeof console !== "undefined" ? (console.timeStamp as unknown as TimeStamp) : undefined;

  let properties: Properties | undefined;
  if (strategy !== "timestamp") {
    try {
      properties = typeof options.properties === "function" ? options.properties() : options.properties;
    } catch {
      // Draw the bar without its details rather than not at all.
    }
  }

  const useTimeStamp =
    typeof timeStamp === "function" &&
    (strategy === "timestamp" || (strategy === "auto" && !properties?.length && !options.tooltip));

  if (useTimeStamp) {
    timeStamp!.call(console, name, start, end, options.track, config.trackGroup, color);
    return;
  }

  const measureName = strategy === "measure" ? name : ZERO_WIDTH_SPACE + name;
  performance.measure(measureName, {
    start,
    end,
    detail: {
      devtools: {
        dataType: "track-entry",
        trackGroup: config.trackGroup,
        track: options.track,
        color,
        properties: properties?.length ? properties : undefined,
        tooltipText: options.tooltip ?? name,
      },
    },
  });
  if (strategy !== "measure") performance.clearMeasures(measureName);
}

/**
 * Run `fn`, timing it as one bar. Returns whatever `fn` returns and rethrows
 * whatever it throws. If it throws, the bar is colored `"error"` and the
 * error message is added to its details.
 *
 * Only synchronous work is timed: for an async function the bar ends when
 * the promise is returned, not when it settles.
 */
export function timed<T>(name: string, options: EmitOptions, fn: () => T): T {
  if (!config.enabled || !hasPerformance) return fn();
  const start = performance.now();
  let error: unknown;
  let failed = true;
  try {
    const result = fn();
    failed = false;
    return result;
  } catch (e) {
    error = e;
    throw e;
  } finally {
    emit(name, start, performance.now(), failed ? withError(options, error) : options);
  }
}

/** @internal Add React-style error details to a bar. */
export function withError(options: EmitOptions, error: unknown): EmitOptions {
  const base = options.properties;
  return {
    ...options,
    color: "error",
    properties: () => [
      ["Error", errorMessage(error)],
      ...((typeof base === "function" ? base() : base) ?? []),
    ],
  };
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && typeof (error as Error).message === "string") {
    return (error as Error).message;
  }
  return String(error);
}

/**
 * @internal Format a value for the details panel, briefly, like React's
 * "Changed Props".
 */
export function preview(value: unknown): string {
  try {
    return previewUnsafe(value);
  } catch {
    return "(could not display)";
  }
}

function previewUnsafe(value: unknown): string {
  switch (typeof value) {
    case "string": {
      const s = value.length > 50 ? value.slice(0, 50) + "…" : value;
      return JSON.stringify(s);
    }
    case "function":
      return `ƒ ${value.name || "anonymous"}()`;
    case "symbol":
      return value.toString();
    case "object": {
      if (value === null) return "null";
      if (Array.isArray(value)) return `Array(${value.length})`;
      if (typeof Element !== "undefined" && value instanceof Element) return `<${value.localName}>`;
      if (value instanceof Date) return isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
      const name = (value as object).constructor?.name;
      return name && name !== "Object" ? `${name} {…}` : "{…}";
    }
    default:
      return String(value);
  }
}

/** @internal Render bar color by duration, using React's thresholds. */
export function renderColor(ms: number): TrackColor {
  return ms < 0.5 ? "primary-light" : ms < 10 ? "primary" : ms < 100 ? "primary-dark" : "error";
}

/** @internal Effect bar color by duration, using React's thresholds. */
export function effectColor(ms: number): TrackColor {
  return ms < 1 ? "secondary-light" : ms < 100 ? "secondary" : ms < 500 ? "secondary-dark" : "error";
}

/** @internal React's prefixes for removed and added values. */
export const REMOVED = "- ";
export const ADDED = "+ ";
