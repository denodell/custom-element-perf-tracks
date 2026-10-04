import type { ReactiveElement } from "lit";

/** Production build: does nothing. */
export function trackLitUpdates(_host: ReactiveElement): void {}

/** Production build: does nothing. */
export function trackAllLitElements(): () => void {
  return () => {};
}
