// Type-only import: this file has no runtime dependency on Lit.
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { Tracks, emit } from "../emit.js";

type Host = ReactiveControllerHost & HTMLElement;

const TRACKED = Symbol.for("custom-element-perf-tracks.lit");

/**
 * Draws one bar per Lit render on the "Updates" track.
 *
 * Lit batches changes: set five properties in a row and it renders once.
 * Each bar records how many update requests were folded into that render,
 * and how long the element waited between the first request and rendering.
 */
class LitUpdateTracker implements ReactiveController {
  private requests = 0;
  private firstRequestAt: number | null = null;
  private renderStart: number | null = null;
  private renders = 0;

  constructor(private host: Host) {
    host.addController(this);
    const original = host.requestUpdate.bind(host);
    // Count requests on this instance only, so other elements are untouched.
    host.requestUpdate = (...args: Parameters<Host["requestUpdate"]>) => {
      this.requests++;
      this.firstRequestAt ??= performance.now();
      return original(...args);
    };
  }

  hostUpdate(): void {
    this.renderStart = performance.now();
  }

  hostUpdated(): void {
    if (this.renderStart === null) return;
    const end = performance.now();
    const tag = this.host.localName;
    const waited =
      this.firstRequestAt === null ? 0 : this.renderStart - this.firstRequestAt;
    this.renders++;
    emit(`<${tag}> ${this.renders === 1 ? "first render" : "render"}`, this.renderStart, end, {
      track: Tracks.updates,
      color: this.renders === 1 ? "secondary-dark" : "secondary",
      properties: [
        ["update requests", String(Math.max(this.requests, 1))],
        ["waited before render", `${waited.toFixed(2)} ms`],
        ["render #", String(this.renders)],
      ],
    });
    this.requests = 0;
    this.firstRequestAt = null;
    this.renderStart = null;
  }
}

/**
 * Call from a LitElement's constructor:
 *
 *   constructor() { super(); trackLitUpdates(this); }
 */
export function trackLitUpdates(host: Host): void {
  const h = host as Host & { [TRACKED]?: true };
  if (h[TRACKED]) return;
  h[TRACKED] = true;
  new LitUpdateTracker(host);
}
