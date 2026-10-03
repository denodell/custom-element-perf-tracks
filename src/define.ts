import { Tracks, timed, type TrackColor } from "./emit.js";

const LIFECYCLE = [
  "connectedCallback",
  "disconnectedCallback",
  "attributeChangedCallback",
  "adoptedCallback",
] as const;

type LifecycleName = (typeof LIFECYCLE)[number];

const COLORS: Record<LifecycleName, TrackColor> = {
  connectedCallback: "primary",
  disconnectedCallback: "primary-dark",
  attributeChangedCallback: "primary-light",
  adoptedCallback: "primary-light",
};

const PATCHED = Symbol.for("custom-element-perf-tracks.patched");

export interface InstrumentOptions {
  /** Which lifecycle callbacks to time. Default: all four. */
  callbacks?: readonly LifecycleName[];
}

/**
 * Wrap a custom element class's lifecycle callbacks so each call shows up as
 * a bar on the "Lifecycle" track. Works on any class, including Lit, Stencil
 * and hand-written elements. It changes the class's prototype in place and
 * is safe to call more than once.
 */
export function instrumentElement(
  tagName: string,
  ctor: CustomElementConstructor,
  options: InstrumentOptions = {},
): void {
  const proto = ctor.prototype as Record<PropertyKey, unknown>;
  if (Object.prototype.hasOwnProperty.call(proto, PATCHED)) return;
  Object.defineProperty(proto, PATCHED, { value: true });

  for (const cb of options.callbacks ?? LIFECYCLE) {
    const original = proto[cb];
    if (typeof original !== "function") continue;
    const label = cb.replace("Callback", "");
    proto[cb] = function (this: HTMLElement, ...args: unknown[]) {
      const properties: Array<[string, string]> =
        cb === "attributeChangedCallback"
          ? [
              ["attribute", String(args[0])],
              ["from", String(args[1])],
              ["to", String(args[2])],
            ]
          : [];
      return timed(
        `<${tagName}> ${label}`,
        { track: Tracks.lifecycle, color: COLORS[cb], properties },
        () => (original as (...a: unknown[]) => unknown).apply(this, args),
      );
    };
  }
}

/**
 * A drop-in for `customElements.define` that also instruments the class.
 * The `define` call itself is timed on the "Upgrade" track, because that is
 * when the browser upgrades every matching element already in the page.
 */
export function definePerf(
  tagName: string,
  ctor: CustomElementConstructor,
  options?: ElementDefinitionOptions & InstrumentOptions,
): void {
  instrumentElement(tagName, ctor, options);
  const pending = document.querySelectorAll(tagName).length;
  timed(
    `<${tagName}> define`,
    {
      track: Tracks.upgrade,
      color: "tertiary",
      properties: [["elements upgraded", String(pending)]],
    },
    () => customElements.define(tagName, ctor, options),
  );
}
