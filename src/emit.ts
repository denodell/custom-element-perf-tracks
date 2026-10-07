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
  /** Turns drawing on or off. Set before elements are defined. */
  enabled: boolean;
  /** The DevTools group the tracks appear under. */
  trackGroup: string;
  /** How bars are drawn. See the README's Settings section. */
  strategy: Strategy;
  /** Callbacks shorter than this many milliseconds are left undrawn. */
  minDuration: number;
}

const config: Config = {
  enabled: true,
  trackGroup: "Web Components",
  strategy: "auto",
  minDuration: 0.05,
};

/** Changes settings. Keys set to `undefined` are ignored. */
export function configure(options: Partial<Config>): void {
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) (config as unknown as Record<string, unknown>)[key] = value;
  }
}

/** Returns a copy of the current settings. */
export function getConfig(): Readonly<Config> {
  return { ...config };
}

export function isEnabled(): boolean {
  return config.enabled;
}

export function defaultTrackGroup(): string {
  return config.trackGroup;
}

export function minDuration(): number {
  return config.minDuration;
}

/** The track names the built-in helpers use. */
export const Tracks = {
  scheduler: "Scheduler",
  components: "Components",
  upgrade: "Upgrade",
  loading: "Loading",
} as const;

export type Properties = Array<[string, string]>;

export interface ConsoleTask {
  run<T>(fn: () => T): T;
}

export interface EmitOptions {
  track: string;
  trackGroup?: string;
  color?: TrackColor;
  properties?: Properties | (() => Properties | undefined);
  tooltip?: string;
  task?: ConsoleTask | null;
}

const hasPerformance = typeof performance !== "undefined";
// An invisible prefix, so clearing these measures leaves the page's own measures with the same name in place.
const ZERO_WIDTH_SPACE = "​";

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

export function createTask(name: string): ConsoleTask | null {
  const create = (console as unknown as { createTask?: (name: string) => ConsoleTask }).createTask;
  if (typeof create !== "function") return null;
  try {
    return create.call(console, name);
  } catch {
    return null;
  }
}

/** Draws one bar on a custom track, between two `performance.now()` timestamps. */
export function emit(name: string, start: number, end: number, options: EmitOptions): void {
  if (!config.enabled || !hasPerformance) return;
  if (!(end > start) && options.color !== "error") return;
  const draw = () => draw_(name, start, end, options);
  try {
    if (options.task) options.task.run(draw);
    else draw();
  } catch {}
}

function draw_(name: string, start: number, end: number, options: EmitOptions): void {
  const color = options.color ?? "primary";
  const strategy = config.strategy;
  const timeStamp = typeof console !== "undefined" ? (console.timeStamp as unknown as TimeStamp) : undefined;

  let properties: Properties | undefined;
  if (strategy !== "timestamp") {
    try {
      properties = typeof options.properties === "function" ? options.properties() : options.properties;
    } catch {}
  }

  const useTimeStamp = typeof timeStamp === "function" && strategy === "timestamp";
  const trackGroup = options.trackGroup || config.trackGroup;

  if (useTimeStamp) {
    timeStamp!.call(console, name, start, end, options.track, trackGroup, color);
    return;
  }

  const measureName = strategy === "measure" ? name : ZERO_WIDTH_SPACE + name;
  performance.measure(measureName, {
    start,
    end,
    detail: {
      devtools: {
        dataType: "track-entry",
        trackGroup,
        track: options.track,
        color,
        properties: properties?.length ? properties : undefined,
        tooltipText: options.tooltip ?? name,
      },
    },
  });
  if (strategy !== "measure") performance.clearMeasures(measureName);
}

/** Runs `fn` and draws it as one bar, red with the error message if it throws. */
export function timed<T>(name: string, options: EmitOptions, fn: () => T): T {
  if (!config.enabled || !hasPerformance) return fn();
  const start = performance.now();
  let result: T | undefined;
  let error: unknown;
  let failed = true;
  try {
    result = fn();
    failed = false;
  } catch (e) {
    error = e;
  }
  emit(name, start, performance.now(), failed ? withError(options, error) : options);
  if (failed) throw error;
  return result as T;
}

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

export function renderColor(ms: number): TrackColor {
  return ms < 0.5 ? "primary-light" : ms < 10 ? "primary" : ms < 100 ? "primary-dark" : "error";
}

export function effectColor(ms: number): TrackColor {
  return ms < 1 ? "secondary-light" : ms < 100 ? "secondary" : ms < 500 ? "secondary-dark" : "error";
}

export const REMOVED = "- ";
export const ADDED = "+ ";
