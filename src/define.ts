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

const COLORS: Record<LifecycleCallback, TrackColor> = {
  connectedCallback: "warning",
  disconnectedCallback: "warning",
  attributeChangedCallback: "primary-light",
  adoptedCallback: "primary-light",
};

const PATCHED = Symbol.for("tuppence.patched");
const WRAPPED = Symbol.for("tuppence.wrapped");

const inProgress = new WeakMap<Element, Set<LifecycleCallback>>();

let upgrading: { ctor: CustomElementConstructor; count: number } | null = null;

export interface TrackElementOptions {
  /** Which lifecycle callbacks to time. Default: all four. */
  callbacks?: readonly LifecycleCallback[];
}

export function labelFor(el: Element): string {
  const ctor = el.constructor as CustomElementConstructor;
  const registered =
    typeof customElements !== "undefined" && typeof customElements.getName === "function"
      ? customElements.getName(ctor)
      : null;
  return registered ?? el.localName;
}

/** Times a class's lifecycle callbacks. Call it before the class is defined. */
export function trackElement(
  ctor: CustomElementConstructor,
  options: TrackElementOptions = {},
): void {
  instrument(ctor, options);
}

function instrument(ctor: CustomElementConstructor, options: TrackElementOptions): () => void {
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
// When a subclass and its base class are both wrapped, the outer wrapper draws the one bar.
      if (active?.has(cb)) return call();
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

let nativeDefine: Define | null = null;

function defineNative(name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions): void {
  if (nativeDefine) nativeDefine(name, ctor, options);
  else customElements.define(name, ctor, options);
}

/** `customElements.define`, plus lifecycle bars and an Upgrade bar for the define itself. */
export function define(
  tagName: string,
  ctor: CustomElementConstructor,
  options?: ElementDefinitionOptions & TrackElementOptions,
): void {
  if (customElements.get(tagName) || customElements.getName?.(ctor)) {
    defineNative(tagName, ctor, options);
    return;
  }
  const restore = instrument(ctor, options ?? {});
  if (!isEnabled()) {
    defineNative(tagName, ctor, options);
    return;
  }

  const connected = ctor.prototype.connectedCallback as { [WRAPPED]?: true } | undefined;
  const countable = Boolean(connected?.[WRAPPED]);
  const previous = upgrading;
  const current = { ctor, count: 0 };
  upgrading = current;
  const start = now();
  let failed = true;
  try {
    defineNative(tagName, ctor, options);
    failed = false;
  } catch (error) {
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

const defineAndTrack = define;

export interface InstrumentAllOptions {
  onDefine?: (ctor: CustomElementConstructor, name: string) => void;
}

const defineHooks = new Set<NonNullable<InstrumentAllOptions["onDefine"]>>();
let users = 0;
let unpatch: (() => void) | null = null;

/** Instruments every custom element defined from now on. Returns a function that stops it. */
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
        } catch {}
      }
      defineAndTrack(name, ctor, opts);
    };
    registry.define = patched;
    unpatch = () => {
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
