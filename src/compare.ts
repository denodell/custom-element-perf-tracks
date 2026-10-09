import { now } from "./emit.js";

// Long enough to compare a few thousand rows, short enough to stay out of the way.
const TIME_LIMIT_MS = 8;
const MAX_DEPTH = 32;

const GIVE_UP = Symbol("give up");

export type Kind = "array" | "object" | "date";

interface Limits {
  deadline: number;
  visited: number;
}

export function kindOf(value: unknown): Kind | null {
  if (typeof value !== "object" || value === null) return null;
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null ? "object" : null;
}

export function sameContentsNewObject(before: unknown, after: unknown): boolean {
  if (before === after || !kindOf(before) || !kindOf(after)) return false;
  const limits: Limits = { deadline: now() + TIME_LIMIT_MS, visited: 0 };
  try {
    return equal(before, after, 0, limits);
  } catch {
    return false;
  }
}

function equal(a: unknown, b: unknown, depth: number, limits: Limits): boolean {
  if ((++limits.visited & 255) === 0 && now() > limits.deadline) throw GIVE_UP;
  if (Object.is(a, b)) return true;
  const kind = kindOf(a);
  if (!kind || kind !== kindOf(b)) return false;
  if (depth >= MAX_DEPTH) throw GIVE_UP;

  if (kind === "date") return Object.is((a as Date).getTime(), (b as Date).getTime());

  if (kind === "array") {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (!equal(x[i], y[i], depth + 1, limits)) return false;
    }
    return true;
  }

  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(y, key)) return false;
    if (!equal(x[key], y[key], depth + 1, limits)) return false;
  }
  return true;
}
