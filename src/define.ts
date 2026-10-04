import {
  ADDED,
  REMOVED,
  Tracks,
  emit,
  isEnabled,
  minDuration,
  now,
  preview,
  withError,
  type EmitOptions,
  type TrackColor,
} from "./emit.js";

export type LifecycleCallback =
  | "connectedCallback"
  | "disconnectedCallback"
  | "attributeChangedCallback"
  | "adoptedCallback";

const LIFECYCLE: readonly LifecycleCallback[] = [
  "connectedCallback",
  "disconnectedCallback",
  "attributeChangedCallback",
  "adoptedCallback",
];

// React colors mounting and unmounting with "warning"; other callbacks use
// the same blue as component renders.
const COLORS: Record<LifecycleCallback, TrackColor> = {
  connectedCallback: "warning",
  disconnectedCallback: "warning",
  attributeChangedCallback: "primary-light",
  adoptedCallback: "primary-light",
};

const PATCHED = Symbol.for("custom-element-perf-tracks.patched");
const WRAPPED = Symbol.for("custom-element-perf-tracks.wrapped");

/**
 * Callbacks currently being timed, per element. When a subclass and its base
 * class are both instrumented, the subclass's wrapper calls the base's
 * wrapper (through `super`). Only the outermost one draws a bar.
 */
const inProgress = new WeakMap<Element, Set<LifecycleCallback>>();

/** While `definePerf` runs `customElements.define`, counts upgrades. */
let upgrading: { ctor: CustomElementConstructor; count: number } | null = null;

export interface InstrumentOptions {
  /** Which lifecycle callbacks to time. Default: all four. */
  callbacks?: readonly LifecycleCallback[];
}

/** @internal The name an element was registered under, falling back to its tag. */
export function labelFor(el: Element): string {
  const ctor = el.constructor as CustomElementConstructor;
  const registered =
    typeof customElements !== "undefined" && typeof customElements.getName === "function"
      ? customElements.getName(ctor)
      : null;
  return registered ?? el.localName;
}

/**
 * Wrap a custom element class's lifecycle callbacks so each call shows up as
 * a bar on the "Components" track. Works on any class, including Lit, Stencil
 * and hand-written elements.
 *
 * Call it before the class is passed to `customElements.define`: browsers
 * read the callbacks at that moment, so later changes have no effect. It
 * changes the class's prototype in place, and does nothing if instrumentation
 * is turned off or the class is already instrumented.
 */
export function instrumentElement(
  ctor: CustomElementConstructor,
  options: InstrumentOptions = {},
): void {
  instrument(ctor, options);
}

/** Returns a function that puts the class back the way it was. */
function instrument(ctor: CustomElementConstructor, options: InstrumentOptions): () => void {
  const nothing = () => {};
  if (!isEnabled()) return nothing;
  const proto = ctor.prototype as Record<PropertyKey, unknown>;
  if (Object.prototype.hasOwnProperty.call(proto, PATCHED)) return nothing;

  if (typeof customElements !== "undefined" && customElements.getName?.(ctor)) {
    console.warn(
      `custom-element-perf-tracks: <${customElements.getName(ctor)}> is already defined, ` +
        "so its lifecycle callbacks can no longer be timed. Instrument it before defining it.",
    );
    return nothing;
  }

  const patches: Array<[LifecycleCallback, PropertyDescriptor]> = [];
  for (const cb of options.callbacks ?? LIFECYCLE) {
    const original = proto[cb];
    if (typeof original !== "function") continue;
    const label = cb.replace("Callback", "");
    const color = COLORS[cb];

    const wrapped = function (this: HTMLElement, ...args: unknown[]): unknown {
      const call = () => (original as (...a: unknown[]) => unknown).apply(this, args);
      if (!isEnabled()) return call();

      let active = inProgress.get(this);
      if (active?.has(cb)) return call(); // an outer wrapper is already timing this
      if (!active) inProgress.set(this, (active = new Set()));
      active.add(cb);

      if (cb === "connectedCallback" && upgrading && this instanceof upgrading.ctor) {
        upgrading.count++;
      }

      const start = now();
      let error: unknown;
      let failed = true;
      try {
        const result = call();
        failed = false;
        return result;
      } catch (e) {
        error = e;
        throw e;
      } finally {
        active.delete(cb);
        const end = now();
        // Like React's effects, very short callbacks are not drawn.
        if (failed || end - start >= minDuration()) {
          const options: EmitOptions = {
            track: Tracks.components,
            color,
            properties:
              cb === "attributeChangedCallback"
                ? () => [
                    ["Changed Attribute", ""],
                    [REMOVED + String(args[0]), preview(args[1])],
                    [ADDED + String(args[0]), preview(args[2])],
                  ]
                : undefined,
          };
          emit(`${labelFor(this)} ${label}`, start, end, failed ? withError(options, error) : options);
        }
      }
    };
    Object.defineProperty(wrapped, "name", { value: (original as { name: string }).name });
    Object.defineProperty(wrapped, WRAPPED, { value: true });
    patches.push([cb, { value: wrapped, writable: true, configurable: true, enumerable: false }]);
  }

  const originals = patches.map(([cb]) => [cb, Object.getOwnPropertyDescriptor(proto, cb)] as const);
  for (const [cb, descriptor] of patches) Object.defineProperty(proto, cb, descriptor);
  Object.defineProperty(proto, PATCHED, { value: true, configurable: true });

  return () => {
    for (const [cb, descriptor] of originals) {
      if (descriptor) Object.defineProperty(proto, cb, descriptor);
      else delete proto[cb];
    }
    delete proto[PATCHED];
  };
}

/**
 * A drop-in for `customElements.define` that also instruments the class.
 *
 * The `define` call itself is timed on the "Upgrade" track, because that is
 * when the browser upgrades every matching element already in the page,
 * including those inside shadow roots.
 */
export function definePerf(
  tagName: string,
  ctor: CustomElementConstructor,
  options?: ElementDefinitionOptions & InstrumentOptions,
): void {
  // Leave the class untouched if `define` is going to fail anyway.
  if (customElements.get(tagName) || customElements.getName?.(ctor)) {
    customElements.define(tagName, ctor, options); // throws the browser's own error
    return;
  }
  const restore = instrument(ctor, options ?? {});
  if (!isEnabled()) {
    customElements.define(tagName, ctor, options);
    return;
  }

  // Upgrades are counted through the timed `connectedCallback` wrapper.
  const connected = ctor.prototype.connectedCallback as { [WRAPPED]?: true } | undefined;
  const countable = Boolean(connected?.[WRAPPED]);
  const previous = upgrading; // `define` can run inside another element's callback
  const current = { ctor, count: 0 };
  upgrading = current;
  const start = now();
  let failed = true;
  try {
    customElements.define(tagName, ctor, options);
    failed = false;
  } catch (error) {
    // An invalid name, for example: leave the class as it was.
    restore();
    throw error;
  } finally {
    upgrading = previous;
    emit(`${tagName} define`, start, now(), {
      track: Tracks.upgrade,
      color: failed ? "error" : "tertiary",
      properties: countable ? [["Elements upgraded", String(current.count)]] : undefined,
    });
  }
}
