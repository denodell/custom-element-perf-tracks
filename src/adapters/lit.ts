// Type-only import: this file has no runtime dependency on Lit.
import type { ReactiveController, ReactiveElement } from "lit";
import { Tracks, emit, isEnabled, now } from "../emit.js";
import { labelFor } from "../define.js";

/** `performUpdate` is protected in Lit's types, but documented and stable. */
interface Protected {
  performUpdate(): unknown;
}

type Host = ReactiveElement & Protected;

/** Lit's default change check. */
const notEqual = (value: unknown, old: unknown) => !Object.is(value, old);

const TRACKED = Symbol.for("custom-element-perf-tracks.lit");

interface RenderInfo {
  requests: number;
  waited: number;
  changed: string;
}

/**
 * Draws one bar per Lit update on the "Updates" track, covering the whole of
 * Lit's update: `shouldUpdate`, `willUpdate`, `render` and committing it to
 * the DOM, then `firstUpdated` and `updated`.
 *
 * Lit batches changes: set five properties in a row and it updates once.
 * Each bar records how many changes were folded into that update, which
 * properties changed, and how long the element waited between the first
 * change and the update starting.
 */
class LitUpdateTracker implements ReactiveController {
  /** Changes since the last update started. */
  private requests = 0;
  private changed = new Set<string>();
  private firstRequestAt: number | null = null;
  /** Set by `hostUpdate`, so we know the update was not skipped. */
  private info: RenderInfo | null = null;
  private updateStart = 0;
  private updates = 0;

  constructor(private host: Host) {
    host.addController(this);

    // Lit asks for the first update inside its own constructor, before this
    // tracker exists. Count it, starting the wait from now.
    if (host.isUpdatePending) this.note();

    const tracker = this;

    // Lit's property setters call `requestUpdate(name, oldValue, options)`
    // on every set. Lit then ignores sets that change nothing, using the
    // property's `hasChanged` check, so the same check is applied here.
    // `requestUpdate()` with no name always causes an update.
    const requestUpdate = host.requestUpdate;
    host.requestUpdate = function (this: Host, ...args: Parameters<Host["requestUpdate"]>) {
      const [name, oldValue, options, useNewValue, newValue] = args as unknown as [
        PropertyKey | undefined,
        unknown,
        { hasChanged?: (v: unknown, o: unknown) => boolean } | undefined,
        boolean | undefined,
        unknown,
      ];
      if (name === undefined) {
        tracker.note();
      } else {
        try {
          const ctor = this.constructor as typeof ReactiveElement;
          const opts = options ?? ctor.getPropertyOptions(name);
          const value = useNewValue ? newValue : (this as unknown as Record<PropertyKey, unknown>)[name];
          if ((opts?.hasChanged ?? notEqual)(value, oldValue)) tracker.note(String(name));
        } catch {
          tracker.note(String(name));
        }
      }
      return requestUpdate.apply(this, args);
    };

    const performUpdate = host.performUpdate;
    host.performUpdate = function (this: Host) {
      if (!this.isUpdatePending) return performUpdate.call(this);
      tracker.updateStart = now();
      tracker.info = null;
      let failed = true;
      try {
        const result = performUpdate.call(this);
        failed = false;
        return result;
      } finally {
        tracker.finish(failed);
      }
    };
  }

  private note(property?: string): void {
    this.requests++;
    if (property !== undefined) this.changed.add(property);
    this.firstRequestAt ??= now();
  }

  /** Runs after `willUpdate`, just before `render`. */
  hostUpdate(): void {
    this.info = this.takeInfo();
  }

  private takeInfo(): RenderInfo {
    const info: RenderInfo = {
      requests: this.requests,
      waited: this.firstRequestAt === null ? 0 : this.updateStart - this.firstRequestAt,
      changed: this.changed.size ? [...this.changed].join(", ") : "(none)",
    };
    // Anything requested from here on (for example in `updated`) belongs to
    // the next update.
    this.requests = 0;
    this.changed = new Set();
    this.firstRequestAt = null;
    return info;
  }

  private finish(failed: boolean): void {
    const end = now();
    // `hostUpdate` runs only when the update goes ahead: not when
    // `shouldUpdate` returns false, and not if `shouldUpdate`/`willUpdate`
    // throws.
    const ran = this.info !== null;
    const info = this.info ?? this.takeInfo();
    this.info = null;

    const tag = labelFor(this.host);
    let name: string;
    let color: "secondary" | "secondary-dark" | "secondary-light" | "error";
    if (failed) {
      name = `<${tag}> update failed`;
      color = "error";
    } else if (!ran) {
      name = `<${tag}> update skipped`;
      color = "secondary-light";
    } else {
      this.updates++;
      name = this.updates === 1 ? `<${tag}> first update` : `<${tag}> update`;
      color = this.updates === 1 ? "secondary-dark" : "secondary";
    }

    emit(name, this.updateStart, end, {
      track: Tracks.updates,
      color,
      properties: [
        ["changes batched", String(info.requests)],
        ["changed properties", info.changed],
        ["waited before update", `${info.waited.toFixed(2)} ms`],
      ],
    });
  }
}

/**
 * Call from a LitElement's constructor:
 *
 *   constructor() { super(); trackLitUpdates(this); }
 *
 * Does nothing if instrumentation is turned off at that point.
 */
export function trackLitUpdates(host: ReactiveElement): void {
  if (!isEnabled()) return;
  const h = host as Host & { [TRACKED]?: true };
  if (h[TRACKED]) return;
  h[TRACKED] = true;
  new LitUpdateTracker(h);
}
