import type { ReactiveElement } from "lit";

export function trackLitUpdates(_host: ReactiveElement): void {}

export function trackAllLitElements(): () => void {
  return () => {};
}
