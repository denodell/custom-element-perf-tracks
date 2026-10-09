import type { ReactiveController, ReactiveElement } from "lit";
import {
  ADDED,
  REMOVED,
  Tracks,
  createTask,
  effectColor,
  emit,
  isEnabled,
  minDuration,
  now,
  preview,
  renderColor,
  withError,
  type ConsoleTask,
  type Properties,
} from "../emit.js";
import { labelFor } from "../define.js";
import { groupFor } from "../groups.js";
import { kindOf, sameContentsNewObject, type Kind } from "../compare.js";

interface Protected {
  performUpdate(): unknown;
  render?: (...args: unknown[]) => unknown;
}

type Host = ReactiveElement & Protected;

const notEqual = (value: unknown, old: unknown) => !Object.is(value, old);

const TRACKED = Symbol.for("tuppence.lit");

const UNREADABLE = Symbol("unreadable");

interface EventInfo {
  type: string;
  timeStamp: number;
}

// Browsers hide window.event from shadow DOM, where Lit's handlers run, so events are
// recorded by listening on the window and on each shadow root instead.
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

function currentEvent(): EventInfo | null {
  for (let i = recentEvents.length - 1; i >= 0; i--) {
    const seen = recentEvents[i];
    const e = seen.ref.deref();
    if (e && e.eventPhase !== 0) return { type: seen.type, timeStamp: seen.timeStamp };
  }
  const e = (globalThis as { event?: unknown }).event;
  if (typeof Event !== "undefined" && e instanceof Event) return { type: e.type, timeStamp: e.timeStamp };
  return null;
}

const updating: Frame[] = [];

const schedulerEnds = new Map<string, number>();
const schedulerEnd = (group: string) => schedulerEnds.get(group) ?? 0;

type Phase = "before-render" | "render" | "after-render";

interface Frame {
  tracker: LitUpdateTracker;
  start: number;
  phase: Phase;
  first: boolean;
  cascade: string | null;
  info: UpdateInfo | null;
  renderEnd: number | null;
  effectsStart: number | null;
}

interface UpdateInfo {
  changes: number;
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

  private changes = 0;
  private oldValues = new Map<PropertyKey, unknown>();
  private manual = false;
  private triggeredBy: string | null = null;

  private root: Root | null = null;
  private rootProperty: string | null | undefined;

  private cascadeNext: string | null = null;

  private frames: Frame[] = [];
  private shadowListening: ShadowRoot | null = null;

  constructor(private host: Host) {
    this.tag = labelFor(host);
    this.task = createTask(this.tag);
    host.addController(this);

    if (host.isUpdatePending) this.note(undefined, undefined, true);

    const tracker = this;

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
      } catch {}
      return requestUpdate.apply(this, args);
    };

    const render = host.render;
    if (typeof render === "function") {
      host.render = function (this: Host, ...args: unknown[]) {
        try {
          return render.apply(this, args);
        } finally {
          const frame = tracker.frames[tracker.frames.length - 1];
          if (frame && frame.phase === "render" && frame.renderEnd === null) frame.renderEnd = now();
        }
      };
    }

    const performUpdate = host.performUpdate;
    host.performUpdate = function (this: Host) {
      if (!this.isUpdatePending) return performUpdate.call(this);
      const frame = tracker.begin();
      let result: ReturnType<Host["performUpdate"]> | undefined;
      let error: unknown;
      let failed = true;
      try {
        result = performUpdate.call(this);
        failed = false;
      } catch (e) {
        error = e;
      }
      try {
        tracker.end(frame, failed, error);
      } catch {}
      if (failed) throw error;
      return result;
    };
  }

  private get group(): string {
    return groupFor(this.tag, this.host.constructor);
  }

  private get current(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  private note(property: PropertyKey | undefined, oldValue: unknown, initial: boolean): void {
    const frame = this.current;
    if (frame) {
// Lit discards changes made during render, so they are skipped here too.
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
    if (this.root && !this.host.hasUpdated) {
      this.rootProperty = this.root.property;
      this.root = null;
    }
    if (this.shadowListening) {
      for (const type of SHADOW_EVENTS) this.shadowListening.removeEventListener(type, remember, LISTEN);
      this.shadowListening = null;
    }
  }

  hostUpdate(): void {
    const frame = this.current;
    if (!frame) return;
    frame.phase = "render";
    frame.info = this.takeInfo();
  }

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
        value = UNREADABLE;
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

  private drawUpdateWait(updateStart: number): void {
    const root = this.root;
    if (!root) return;
    const trackGroup = this.group;
    const requestAt = Math.max(root.at, schedulerEnd(trackGroup));
    if (root.event) {
      const eventStart = Math.max(root.event.timeStamp, schedulerEnd(trackGroup));
      if (requestAt > eventStart) {
        emit(`Event: ${root.event.type}`, eventStart, requestAt, {
          track: Tracks.scheduler,
          trackGroup,
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
        trackGroup,
        color: "primary-light",
        task: this.task,
        properties,
      });
    }
    schedulerEnds.set(trackGroup, Math.max(schedulerEnd(trackGroup), updateStart));
  }

  end(frame: Frame, failed: boolean, error: unknown): void {
    let i = this.frames.lastIndexOf(frame);
    if (i !== -1) this.frames.splice(i, 1);
    i = updating.lastIndexOf(frame);
    if (i !== -1) updating.splice(i, 1);
    const end = now();

    const ran = frame.info !== null;
    const info = frame.info ?? this.takeInfo();
    const { tag, task } = this;
    const trackGroup = this.group;
    const { start, first, cascade } = frame;
    const renderEnd = frame.renderEnd ?? frame.effectsStart ?? end;

    const sameContents =
      ran && !first
        ? info.changed
            .filter(([, old, value]) => value !== UNREADABLE && sameContentsNewObject(old, value))
            .map(([name]) => name)
        : [];
    const noChanges = sameContents.length > 0 && sameContents.length === info.changed.length && !info.manual;
    const copies = noChanges ? describeCopies(info.changed) : "";

    const details = (): Properties => {
      const rows: Properties = [];
      if (noChanges) rows.push(["No changes", copies]);
      else if (sameContents.length) rows.push(["Same contents, new object", sameContents.join(", ")]);
      if (info.triggeredBy) rows.push(["Triggered by", info.triggeredBy]);
      if (info.changes > 1) rows.push(["Changes batched", String(info.changes)]);
      if (info.manual && info.changed.length === 0) rows.push(["Update requested", "requestUpdate()"]);
      if (!first && info.changed.length) {
        rows.push(["Changed Props", ""]);
        for (const [name, old, value] of info.changed) {
          rows.push(
            [REMOVED + name, preview(old)],
            [ADDED + name, value === UNREADABLE ? "(could not read)" : preview(value)],
          );
        }
      }
      return rows;
    };

    if (failed || ran) {
      if (cascade) {
        emit("Cascading Update", start, end, {
          track: Tracks.scheduler,
          trackGroup,
          color: "error",
          task,
          properties: [
            ["Component name", tag],
            ["Requested during", cascade],
          ],
        });
      }
      if (failed) {
        emit("Errored", start, end, { track: Tracks.scheduler, trackGroup, color: "error", task });
      } else {
        emit("Render", start, renderEnd, { track: Tracks.scheduler, trackGroup, color: "primary-dark", task });
        if (end > renderEnd) {
          emit("Commit", renderEnd, end, { track: Tracks.scheduler, trackGroup, color: "secondary-dark", task });
        }
      }
      schedulerEnds.set(trackGroup, Math.max(schedulerEnd(trackGroup), end));
    }

    if (failed) {
      emit(tag, start, end, withError({ track: Tracks.components, trackGroup, task, properties: details }, error));
      return;
    }
    if (!ran) {
      emit(`${tag} skipped`, start, end, {
        track: Tracks.components,
        trackGroup,
        color: "primary-light",
        task,
        tooltip: `${tag}: shouldUpdate() returned false`,
        properties: details,
      });
      return;
    }
    if (first) emit("Mount", start, end, { track: Tracks.components, trackGroup, color: "warning", task });
    emit(noChanges ? `${tag} (no changes)` : tag, start, renderEnd, {
      track: Tracks.components,
      trackGroup,
      color: noChanges && renderColor(renderEnd - start) !== "primary-light" ? "warning" : renderColor(renderEnd - start),
      task,
      tooltip: noChanges ? `${tag}: no changes (${copies})` : undefined,
      properties: details,
    });
    if (frame.effectsStart !== null && end - frame.effectsStart >= minDuration()) {
      emit(tag, frame.effectsStart, end, {
        track: Tracks.components,
        trackGroup,
        color: effectColor(end - frame.effectsStart),
        task,
      });
    }
  }
}

/** Tracks a Lit element's updates. Call it from the element's constructor. */
export function trackLitUpdates(host: ReactiveElement): void {
  if (!isEnabled()) return;
  const h = host as Host & { [TRACKED]?: true };
  if (h[TRACKED]) return;
  h[TRACKED] = true;
  listenForEvents();
  new LitUpdateTracker(h);
}

/** Tracks every Lit element defined from now on. Returns a function that stops it. */
function listNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

/** "items was set to a new array with the same values", grouped by kind of value. */
function describeCopies(changed: UpdateInfo["changed"]): string {
  const byKind = new Map<Kind, string[]>();
  for (const [name, , value] of changed) {
    const kind = kindOf(value)!;
    let names = byKind.get(kind);
    if (!names) byKind.set(kind, (names = []));
    names.push(name);
  }
  const clauses = [...byKind].map(([kind, names], i) => {
    const many = names.length > 1;
    const what = many ? `new ${kind}s` : `a new ${kind}`;
    const same = kind === "date" && !many ? "the same value" : "the same values";
    return `${listNames(names)}${i === 0 ? (many ? " were set" : " was set") : ""} to ${what} with ${same}`;
  });
  return clauses.length > 1 ? `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}` : clauses[0];
}
