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
  InstrumentAllOptions,
  EmitOptions,
  InstrumentOptions,
  RerouteTarget,
} from "../index.js";

export type {
  Config,
  InstrumentAllOptions,
  ConsoleTask,
  Properties,
  EmitOptions,
  InstrumentOptions,
  LifecycleCallback,
  RerouteTarget,
  Strategy,
  TrackColor,
} from "../index.js";

export const Tracks = {
  scheduler: "Scheduler",
  components: "Components",
  upgrade: "Upgrade",
} as const;

export function configure(_options: Partial<Config>): void {}

export function getConfig(): Readonly<Config> {
  return { enabled: false, trackGroup: "", strategy: "auto", minDuration: 0.05 };
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

export function instrumentAll(_options?: InstrumentAllOptions): () => void {
  return () => {};
}

export function rerouteMeasures(
  _pattern: RegExp,
  _map: (match: RegExpExecArray, entry: PerformanceEntry) => RerouteTarget | RerouteTarget[] | null,
): () => void {
  return () => {};
}
