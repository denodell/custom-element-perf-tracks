/**
 * The production build of this package: the same API, doing nothing.
 *
 * Bundlers that read the "production" export condition (Vite and webpack do
 * by default in production builds) load this file instead of the real one,
 * so none of the instrumentation code reaches users. `definePerf` still
 * defines the element.
 */
import type {
  Config,
  EmitOptions,
  InstrumentOptions,
  RerouteTarget,
} from "../index.js";

export type {
  Config,
  EmitOptions,
  InstrumentOptions,
  LifecycleCallback,
  RerouteTarget,
  Strategy,
  TrackColor,
} from "../index.js";

export const Tracks = {
  lifecycle: "Lifecycle",
  upgrade: "Upgrade",
  updates: "Updates",
} as const;

export function configure(_options: Partial<Config>): void {}

export function getConfig(): Readonly<Config> {
  return { enabled: false, trackGroup: "", strategy: "measure" };
}

export function emit(_name: string, _start: number, _end: number, _options: EmitOptions): void {}

export function timed<T>(_name: string, _options: EmitOptions, fn: () => T): T {
  return fn();
}

export function instrumentElement(
  _ctor: CustomElementConstructor,
  _options?: InstrumentOptions,
): void {}

export function definePerf(
  tagName: string,
  ctor: CustomElementConstructor,
  options?: ElementDefinitionOptions & InstrumentOptions,
): void {
  customElements.define(tagName, ctor, options?.extends ? { extends: options.extends } : undefined);
}

export function rerouteMeasures(
  _pattern: RegExp,
  _map: (match: RegExpExecArray, entry: PerformanceEntry) => RerouteTarget | null,
): () => void {
  return () => {};
}
