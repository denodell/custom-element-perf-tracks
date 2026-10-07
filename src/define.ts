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
import { groupFor } from "./groups.js";

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

const PATCHED = Symbol.for("tuppence.patched");
const WRAPPED = Symbol.for("tuppence.wrapped");

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
      `tuppence: <${customElements.getName(ctor)}> is already defined, ` +
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
      let result: unknown;
      let error: unknown;
      let failed = true;
      try {
        result = call();
        failed = false;
      } catch (e) {
        error = e;
      }
      active.delete(cb);
      const end = now();
      // Like React's effects, very short callbacks are not drawn.
      if (failed || end - start >= minDuration()) {
        const tag = labelFor(this);
        const options: EmitOptions = {
          track: Tracks.components,
          trackGroup: groupFor(tag, this.constructor),
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
        emit(`${tag} ${label}`, start, end, failed ? withError(options, error) : options);
      }
      if (failed) throw error;
      return result;
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

type Define = (name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions) => void;

/** The registry's own `define`, saved while `instrumentAll` has replaced it. */
let nativeDefine: Define | null = null;

function define(name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions): void {
  if (nativeDefine) nativeDefine(name, ctor, options);
  else customElements.define(name, ctor, options);
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
    define(tagName, ctor, options); // throws the browser's own error
    return;
  }
  const restore = instrument(ctor, options ?? {});
  if (!isEnabled()) {
    define(tagName, ctor, options);
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
    define(tagName, ctor, options);
    failed = false;
  } catch (error) {
    // An invalid name, for example: leave the class as it was.
    restore();
    throw error;
  } finally {
    upgrading = previous;
    emit(`${tagName} define`, start, now(), {
      track: Tracks.upgrade,
      trackGroup: groupFor(tagName, ctor),
      color: failed ? "error" : "tertiary",
      properties: countable ? [["Elements upgraded", String(current.count)]] : undefined,
    });
  }
}

export interface InstrumentAllOptions {
  /**
   * Called with each class just before it is defined, while its instances
   * do not exist yet. The Lit adapter uses this to track Lit elements.
   */
  onDefine?: (ctor: CustomElementConstructor, name: string) => void;
}

const defineHooks = new Set<NonNullable<InstrumentAllOptions["onDefine"]>>();
let users = 0;
let unpatch: (() => void) | null = null;

/**
 * Instrument every custom element defined from now on, as if each one had
 * been defined with `definePerf`. Elements defined before this runs are not
 * affected, so it has to run before the app's components load.
 *
 * Returns a function that stops instrumenting newly defined elements.
 * Does nothing if instrumentation is turned off at this point.
 */
export function instrumentAll(options: InstrumentAllOptions = {}): () => void {
  if (!isEnabled() || typeof customElements === "undefined") return () => {};
  const hook = options.onDefine;
  if (hook) defineHooks.add(hook);
  users++;

  if (!unpatch) {
    const registry = customElements;
    const hadOwn = Object.prototype.hasOwnProperty.call(registry, "define");
    const previous = registry.define;
    nativeDefine = previous.bind(registry);
    const patched = function define(
      this: CustomElementRegistry,
      name: string,
      ctor: CustomElementConstructor,
      opts?: ElementDefinitionOptions,
    ): void {
      if (this !== registry) return previous.call(this, name, ctor, opts);
      for (const h of defineHooks) {
        try {
          h(ctor, name);
        } catch {
          // Never let instrumentation stop an element being defined.
        }
      }
      definePerf(name, ctor, opts);
    };
    registry.define = patched;
    unpatch = () => {
      // Only undo our own change, in case something else wrapped it since.
      if (registry.define === patched) {
        if (hadOwn) registry.define = previous;
        else delete (registry as { define?: unknown }).define;
      }
      nativeDefine = null;
      unpatch = null;
    };
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (hook) defineHooks.delete(hook);
    if (--users === 0) unpatch!();
  };
}
