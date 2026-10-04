// Type-only import: this file has no runtime dependency on Lit.
import type { ReactiveController, ReactiveElement } from "lit";
import {
  ADDED,
  REMOVED,
  Tracks,
  createTask,
  emit,
  isEnabled,
  minDuration,
  now,
  preview,
  withError,
  type ConsoleTask,
  type Properties,
  type TrackColor,
} from "../emit.js";
import { labelFor } from "../define.js";

/**
 * Lit update tracking, laid out the way React's performance tracks are.
 *
 * Scheduler track, one row of steps per update:
 *   Event: click   the DOM event that led to the change, if there was one
 *   Update         from the first change to Lit starting the update
 *                  ("Update Blocked" when that wait is over 5 ms)
 *   Render         shouldUpdate, willUpdate and render
 *   Commit         writing the result to the page, then firstUpdated/updated
 *   Cascading Update  wraps an update the element started for itself while
 *                  committing or in updated(), which Lit also warns about
 *
 * Components track, per element:
 *   Mount          wraps an element's first update
 *   my-element     its render, with "Changed Props" when properties changed
 *   my-element     its firstUpdated()/updated() work, in the effects color
 *
 * Colors and names follow React's, so the two read the same way.
 *
 * The order of Lit's update, from @lit/reactive-element's performUpdate:
 * shouldUpdate, willUpdate, controllers' hostUpdate, update() (render, then
 * marking the update done, then writing to the page), controllers'
 * hostUpdated, firstUpdated, updated.
 */

/** `performUpdate` and `render` are protected in Lit's types, but documented. */
interface Protected {
  performUpdate(): unknown;
  render?: (...args: unknown[]) => unknown;
}

type Host = ReactiveElement & Protected;

/** Lit's default change check. */
const notEqual = (value: unknown, old: unknown) => !Object.is(value, old);

const TRACKED = Symbol.for("custom-element-perf-tracks.lit");

/** Same thresholds as React uses for component render colors. */
function renderColor(ms: number): TrackColor {
  return ms < 0.5 ? "primary-light" : ms < 10 ? "primary" : ms < 100 ? "primary-dark" : "error";
}

/** Same thresholds as React uses for effect colors. */
function effectColor(ms: number): TrackColor {
  return ms < 1 ? "secondary-light" : ms < 100 ? "secondary" : ms < 500 ? "secondary-dark" : "error";
}

// ---- Events ---------------------------------------------------------------

interface EventInfo {
  type: string;
  timeStamp: number;
}

/**
 * Events the "Event:" bar can name. React reads `window.event`, but browsers
 * hide that from code in shadow DOM, where Lit's event handlers run. So this
 * listens on the window for discrete user input, and on each tracked
 * element's shadow root for the events that do not leave it.
 */
const COMPOSED_EVENTS = [
  "click", "dblclick", "auxclick", "contextmenu",
  "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend",
  "keydown", "keyup", "beforeinput", "input",
  "focusin", "focusout", "drop", "paste", "cut", "copy",
];
const SHADOW_EVENTS = ["change", "submit", "reset", "toggle", "select"];

interface SeenEvent {
  type: string;
  timeStamp: number;
  /** Weak, so a remembered event never keeps its target alive. */
  ref: { deref(): Event | undefined };
}

const recentEvents: SeenEvent[] = [];
let listening = false;

const weak = (e: Event): SeenEvent["ref"] =>
  typeof WeakRef === "function" ? new WeakRef(e) : { deref: () => e };

function remember(e: Event): void {
  const last = recentEvents[recentEvents.length - 1];
  if (last && last.ref.deref() === e) return;
  recentEvents.push({ type: e.type, timeStamp: e.timeStamp, ref: weak(e) });
  if (recentEvents.length > 8) recentEvents.shift();
}

const LISTEN = { capture: true, passive: true } as const;

function listenForEvents(): void {
  if (listening || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  listening = true;
  for (const type of COMPOSED_EVENTS) window.addEventListener(type, remember, LISTEN);
}

/** The event currently being handled, if any. */
function currentEvent(): EventInfo | null {
  for (let i = recentEvents.length - 1; i >= 0; i--) {
    const seen = recentEvents[i];
    // An event's phase goes back to NONE (0) once handling has finished.
    const e = seen.ref.deref();
    if (e && e.eventPhase !== 0) return { type: seen.type, timeStamp: seen.timeStamp };
  }
  const e = (globalThis as { event?: unknown }).event;
  if (typeof Event !== "undefined" && e instanceof Event) return { type: e.type, timeStamp: e.timeStamp };
  return null;
}

// ---- Shared state across all tracked elements ---------------------------

/** Updates in progress, innermost last. */
const updating: Frame[] = [];

/** End of the last update drawn on the Scheduler track, so bars never overlap. */
let schedulerEnd = 0;

type Phase = "before-render" | "render" | "after-render";

/** Everything about one update in progress. */
interface Frame {
  tracker: LitUpdateTracker;
  start: number;
  phase: Phase;
  first: boolean;
  /** Set when this update was started by the element during its last one. */
  cascade: string | null;
  info: UpdateInfo | null;
  renderEnd: number | null;
  effectsStart: number | null;
}

interface UpdateInfo {
  changes: number;
  /** [name, old value, new value]; formatted only when a bar needs them. */
  changed: Array<[string, unknown, unknown]>;
  manual: boolean;
  triggeredBy: string | null;
}

interface Root {
  at: number;
  event: EventInfo | null;
  property: string | null;
}

class LitUpdateTracker implements ReactiveController {
  readonly tag: string;
  readonly task: ConsoleTask | null;

  // Changes since the last update started.
  private changes = 0;
  private oldValues = new Map<PropertyKey, unknown>();
  private manual = false;
  private triggeredBy: string | null = null;

  /** A change that did not come from another element's update. */
  private root: Root | null = null;
  /** A root change made while disconnected: the wait starts at connection. */
  private rootProperty: string | null | undefined;

  /** Set when the element changes itself after rendering; marks the next update. */
  private cascadeNext: string | null = null;

  /** This element's updates in progress (more than one if nested). */
  private frames: Frame[] = [];
  private shadowListening: ShadowRoot | null = null;

  constructor(private host: Host) {
    this.tag = labelFor(host);
    // Like React, run each bar inside a task created with the element, so
    // DevTools' "Function stack" shows where the element was created.
    this.task = createTask(this.tag);
    host.addController(this);

    // Lit asks for its first update inside its own constructor, before this
    // tracker exists.
    if (host.isUpdatePending) this.note(undefined, undefined, true);

    const tracker = this;

    // Lit's property setters call `requestUpdate(name, oldValue, options)` on
    // every set, then ignore sets that change nothing, using the property's
    // `hasChanged` check. The same check is applied here so only real changes
    // are counted. `requestUpdate()` with no name always causes an update.
    const requestUpdate = host.requestUpdate;
    host.requestUpdate = function (this: Host, ...args: Parameters<Host["requestUpdate"]>) {
      try {
        const [name, oldValue, options, useNewValue, newValue] = args as unknown as [
          PropertyKey | undefined,
          unknown,
          { hasChanged?: (v: unknown, o: unknown) => boolean } | undefined,
          boolean | undefined,
          unknown,
        ];
        if (name === undefined) {
          tracker.note(undefined, undefined, false);
        } else {
          const ctor = this.constructor as typeof ReactiveElement;
          const opts = options ?? ctor.getPropertyOptions(name);
          const value = useNewValue ? newValue : (this as unknown as Record<PropertyKey, unknown>)[name];
          if ((opts?.hasChanged ?? notEqual)(value, oldValue)) tracker.note(name, oldValue, false);
        }
      } catch {
        // Never let tracking break the element.
      }
      return requestUpdate.apply(this, args);
    };

    const render = host.render;
    if (typeof render === "function") {
      host.render = function (this: Host, ...args: unknown[]) {
        try {
          return render.apply(this, args);
        } finally {
          const frame = tracker.frames[tracker.frames.length - 1];
          // Only Lit's own call to render() during the update counts.
          if (frame && frame.phase === "render" && frame.renderEnd === null) frame.renderEnd = now();
        }
      };
    }

    const performUpdate = host.performUpdate;
    host.performUpdate = function (this: Host) {
      if (!this.isUpdatePending) return performUpdate.call(this);
      const frame = tracker.begin();
      let error: unknown;
      let failed = true;
      try {
        const result = performUpdate.call(this);
        failed = false;
        return result;
      } catch (e) {
        error = e;
        throw e;
      } finally {
        try {
          tracker.end(frame, failed, error);
        } catch {
          // Never let tracking replace the element's own result or error.
        }
      }
    };
  }

  private get current(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** Record one accepted change (or a bare `requestUpdate()`). */
  private note(property: PropertyKey | undefined, oldValue: unknown, initial: boolean): void {
    const frame = this.current;
    if (frame) {
      // This element is updating. Changes before render join this update.
      // From render() until Lit marks the update done, changes are dropped.
      // After that (while writing to the page, or in updated()), Lit starts
      // another update straight away: a cascading update.
      if (frame.phase === "render" && this.host.isUpdatePending) return;
      if (frame.phase !== "before-render") {
        this.cascadeNext ??=
          frame.phase === "render" ? "the commit" : frame.first ? "firstUpdated() or updated()" : "updated()";
      }
    } else if (this.changes === 0) {
      const outer = updating[updating.length - 1];
      if (outer) this.triggeredBy = outer.tracker.tag;
      else this.markRoot(property);
    }

    this.changes++;
    if (property === undefined) {
      if (!initial) this.manual = true;
    } else if (!this.oldValues.has(property)) {
      this.oldValues.set(property, oldValue);
    }
  }

  private markRoot(property: PropertyKey | undefined): void {
    const name = property === undefined ? null : String(property);
    // Lit only updates elements that are connected, or have been before.
    if (this.host.isConnected || this.host.hasUpdated) {
      this.root = { at: now(), event: currentEvent(), property: name };
    } else {
      this.rootProperty = name;
    }
  }

  hostConnected(): void {
    if (this.rootProperty !== undefined && this.host.isUpdatePending && !this.root) {
      this.root = { at: now(), event: currentEvent(), property: this.rootProperty };
    }
    this.rootProperty = undefined;

    const root = this.host.renderRoot;
    if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot && !this.shadowListening) {
      for (const type of SHADOW_EVENTS) root.addEventListener(type, remember, LISTEN);
      this.shadowListening = root;
    }
  }

  hostDisconnected(): void {
    // An element that has never updated waits until it is connected again.
    if (this.root && !this.host.hasUpdated) {
      this.rootProperty = this.root.property;
      this.root = null;
    }
    if (this.shadowListening) {
      for (const type of SHADOW_EVENTS) this.shadowListening.removeEventListener(type, remember, LISTEN);
      this.shadowListening = null;
    }
  }

  /** Runs after shouldUpdate and willUpdate, just before render. */
  hostUpdate(): void {
    const frame = this.current;
    if (!frame) return;
    frame.phase = "render";
    frame.info = this.takeInfo();
  }

  /** Runs after the DOM is written, just before firstUpdated/updated. */
  hostUpdated(): void {
    const frame = this.current;
    if (!frame) return;
    frame.phase = "after-render";
    frame.effectsStart = now();
  }

  begin(): Frame {
    const start = now();
    if (updating.length === 0) this.drawUpdateWait(start);
    this.root = null;
    const frame: Frame = {
      tracker: this,
      start,
      phase: "before-render",
      first: !this.host.hasUpdated,
      cascade: this.cascadeNext,
      info: null,
      renderEnd: null,
      effectsStart: null,
    };
    this.cascadeNext = null;
    this.frames.push(frame);
    updating.push(frame);
    return frame;
  }

  private takeInfo(): UpdateInfo {
    const host = this.host as unknown as Record<PropertyKey, unknown>;
    const changed: UpdateInfo["changed"] = [];
    for (const [name, old] of this.oldValues) {
      let value: unknown;
      try {
        value = host[name];
      } catch {
        value = "(could not read)";
      }
      changed.push([String(name), old, value]);
    }
    const info: UpdateInfo = {
      changes: this.changes,
      changed,
      manual: this.manual,
      triggeredBy: this.triggeredBy,
    };
    this.changes = 0;
    this.oldValues = new Map();
    this.manual = false;
    this.triggeredBy = null;
    return info;
  }

  /**
   * Draw the "Event" and "Update" bars on the Scheduler track: from this
   * element's change to its update starting.
   */
  private drawUpdateWait(updateStart: number): void {
    const root = this.root;
    if (!root) return;
    const requestAt = Math.max(root.at, schedulerEnd);
    if (root.event) {
      const eventStart = Math.max(root.event.timeStamp, schedulerEnd);
      if (requestAt > eventStart) {
        emit(`Event: ${root.event.type}`, eventStart, requestAt, {
          track: Tracks.scheduler,
          color: "warning",
          task: this.task,
        });
      }
    }
    if (updateStart > requestAt) {
      const properties: Properties = [["Component name", this.tag]];
      if (root.property) properties.push(["Property", root.property]);
      emit(updateStart - requestAt > 5 ? "Update Blocked" : "Update", requestAt, updateStart, {
        track: Tracks.scheduler,
        color: "primary-light",
        task: this.task,
        properties,
      });
    }
    schedulerEnd = Math.max(schedulerEnd, updateStart);
  }

  end(frame: Frame, failed: boolean, error: unknown): void {
    const end = now();
    let i = this.frames.lastIndexOf(frame);
    if (i !== -1) this.frames.splice(i, 1);
    i = updating.lastIndexOf(frame);
    if (i !== -1) updating.splice(i, 1);

    // hostUpdate runs only when the update goes ahead: not when shouldUpdate
    // returns false, and not if shouldUpdate or willUpdate throws.
    const ran = frame.info !== null;
    const info = frame.info ?? this.takeInfo();
    const { tag, task } = this;
    const { start, first, cascade } = frame;
    const renderEnd = frame.renderEnd ?? frame.effectsStart ?? end;

    // Built only when a bar with details is drawn.
    const details = (): Properties => {
      const rows: Properties = [];
      if (info.triggeredBy) rows.push(["Triggered by", info.triggeredBy]);
      if (info.changes > 1) rows.push(["Changes batched", String(info.changes)]);
      if (info.manual && info.changed.length === 0) rows.push(["Update requested", "requestUpdate()"]);
      // Like React, the first render shows no "Changed Props".
      if (!first && info.changed.length) {
        rows.push(["Changed Props", ""]);
        for (const [name, old, value] of info.changed) {
          rows.push([REMOVED + name, preview(old)], [ADDED + name, preview(value)]);
        }
      }
      return rows;
    };

    // Scheduler track.
    if (failed || ran) {
      if (cascade) {
        emit("Cascading Update", start, end, {
          track: Tracks.scheduler,
          color: "error",
          task,
          properties: [
            ["Component name", tag],
            ["Requested during", cascade],
          ],
        });
      }
      if (failed) {
        emit("Errored", start, end, { track: Tracks.scheduler, color: "error", task });
      } else {
        emit("Render", start, renderEnd, { track: Tracks.scheduler, color: "primary-dark", task });
        if (end > renderEnd) {
          emit("Commit", renderEnd, end, { track: Tracks.scheduler, color: "secondary-dark", task });
        }
      }
      schedulerEnd = Math.max(schedulerEnd, end);
    }

    // Components track.
    if (failed) {
      emit(tag, start, end, withError({ track: Tracks.components, task, properties: details }, error));
      return;
    }
    if (!ran) {
      emit(`${tag} skipped`, start, end, {
        track: Tracks.components,
        color: "primary-light",
        task,
        tooltip: `${tag}: shouldUpdate() returned false`,
        properties: details,
      });
      return;
    }
    if (first) emit("Mount", start, end, { track: Tracks.components, color: "warning", task });
    emit(tag, start, renderEnd, {
      track: Tracks.components,
      color: renderColor(renderEnd - start),
      task,
      properties: details,
    });
    if (frame.effectsStart !== null && end - frame.effectsStart >= minDuration()) {
      emit(tag, frame.effectsStart, end, {
        track: Tracks.components,
        color: effectColor(end - frame.effectsStart),
        task,
      });
    }
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
  listenForEvents();
  new LitUpdateTracker(h);
}
