import { defaultTrackGroup } from "./emit.js";

/**
 * Which DevTools track group each element's bars go under.
 *
 * By default every bar goes under one group, `configure({ trackGroup })`.
 * A design system can claim its own elements, by tag prefix or by base
 * class, so its bars sit in a group of their own, separate from the app's
 * and from any other library on the page. Rules are added one at a time and
 * never replace each other, so several libraries can each add their own.
 */

interface Rule {
  trackGroup: string;
}

interface PrefixRule extends Rule {
  prefix: string;
}

const prefixRules: PrefixRule[] = [];
const classRules = new WeakMap<object, Rule[]>();
let classRuleCount = 0;

/**
 * Put every element matching `match` under its own track group in DevTools,
 * instead of the default one.
 *
 * - A string matches tag names that start with it: `"acme-"` covers
 *   `<acme-button>`, `<acme-menu>` and so on.
 * - A class matches that class and every class that extends it, so passing
 *   a design system's base class covers all of its components.
 *
 * A class rule wins over a prefix rule. Among prefixes, the longest match
 * wins. When two rules match equally, the one added last wins.
 *
 * Can be called at any time; bars drawn afterwards use the new group.
 * Returns a function that removes this rule.
 */
export function assignTrackGroup(match: string | CustomElementConstructor, trackGroup: string): () => void {
  if (typeof trackGroup !== "string" || trackGroup === "") {
    throw new TypeError("assignTrackGroup: trackGroup must be a non-empty string");
  }

  if (typeof match === "string") {
    if (match === "") throw new TypeError("assignTrackGroup: a tag prefix must not be empty");
    const rule: PrefixRule = { prefix: match.toLowerCase(), trackGroup };
    prefixRules.push(rule);
    return once(() => {
      const i = prefixRules.indexOf(rule);
      if (i !== -1) prefixRules.splice(i, 1);
    });
  }

  if (typeof match === "function") {
    const rule: Rule = { trackGroup };
    let list = classRules.get(match);
    if (!list) classRules.set(match, (list = []));
    list.push(rule);
    classRuleCount++;
    return once(() => {
      const i = list!.indexOf(rule);
      if (i !== -1) {
        list!.splice(i, 1);
        classRuleCount--;
      }
    });
  }

  throw new TypeError("assignTrackGroup: match must be a tag prefix string or a custom element class");
}

function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

/**
 * @internal The track group for an element, from its tag name and, where
 * known, its class.
 */
export function groupFor(tag: string, ctor?: unknown): string {
  if (classRuleCount > 0 && typeof ctor === "function") {
    // Walk up the class chain: the nearest class with a rule wins.
    let c: unknown = ctor;
    while (typeof c === "function" && c !== Function.prototype) {
      const list = classRules.get(c);
      if (list?.length) return list[list.length - 1].trackGroup;
      c = Object.getPrototypeOf(c);
    }
  }

  if (prefixRules.length > 0) {
    const name = tag.toLowerCase();
    let best: PrefixRule | null = null;
    for (const rule of prefixRules) {
      if (name.startsWith(rule.prefix) && (!best || rule.prefix.length >= best.prefix.length)) best = rule;
    }
    if (best) return best.trackGroup;
  }

  return defaultTrackGroup();
}
