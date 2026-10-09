import type { Config, TrackElementOptions, TrackOptions } from "../index.js";

export type {
  Config,
  LifecycleCallback,
  Properties,
  Strategy,
  TrackColor,
  TrackElementOptions,
  TrackOptions,
} from "../index.js";

export function configure(_options: Partial<Config>): void {}

export function getConfig(): Readonly<Config> {
  return { enabled: false, trackGroup: "Web Components · Tuppence", strategy: "auto", minDuration: 0.05, exclude: [] };
}

export function track<T>(_name: string, fn: () => T, _options?: TrackOptions): T {
  return fn();
}

export function trackElement(_ctor: CustomElementConstructor, _options?: TrackElementOptions): void {}

export function define(
  tagName: string,
  ctor: CustomElementConstructor,
  options?: ElementDefinitionOptions & TrackElementOptions,
): void {
  customElements.define(tagName, ctor, options?.extends ? { extends: options.extends } : undefined);
}

export function assignTrackGroup(
  _match: string | CustomElementConstructor,
  _trackGroup: string,
): () => void {
  return () => {};
}
