/**
 * Spotting renders caused by a new object with the same contents.
 *
 * An app that passes `items={[...]}` or `options={{ dense: true }}` to a
 * component creates a new array or object every time it renders. Lit
 * compares property values by identity, so it sees a change and renders
 * the component again, even though nothing in it changed.
 *
 * The check is deliberately cautious: it only ever says "same contents"
 * when it is sure. It looks inside arrays, plain objects and dates only;
 * anything else (class instances, Maps, functions, DOM nodes) counts as the
 * same only if it is the very same value. It gives up, and says "different",
 * on deep or very large values, so it stays cheap.
 */

/** Values visited before giving up. */
const BUDGET = 1000;
/** Levels of nesting looked into before giving up. */
const MAX_DEPTH = 5;

const GIVE_UP = Symbol("give up");

type Kind = "array" | "object" | "date";

function kindOf(value: unknown): Kind | null {
  if (typeof value !== "object" || value === null) return null;
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null ? "object" : null;
}

/**
 * @internal True when `before` and `after` are different arrays, plain
 * objects or dates with the same contents.
 */
export function sameContentsNewObject(before: unknown, after: unknown): boolean {
  if (before === after || !kindOf(before) || !kindOf(after)) return false;
  const budget = { left: BUDGET };
  try {
    return equal(before, after, 0, budget);
  } catch {
    // Out of budget, too deep, or a getter threw: don't claim anything.
    return false;
  }
}

function equal(a: unknown, b: unknown, depth: number, budget: { left: number }): boolean {
  if (--budget.left < 0) throw GIVE_UP;
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
      if (!equal(x[i], y[i], depth + 1, budget)) return false;
    }
    return true;
  }

  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(y, key)) return false;
    if (!equal(x[key], y[key], depth + 1, budget)) return false;
  }
  return true;
}
