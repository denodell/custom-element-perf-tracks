import { defaultTrackGroup } from "./emit.js";

interface Rule {
  trackGroup: string;
}

interface PrefixRule extends Rule {
  prefix: string;
}

const prefixRules: PrefixRule[] = [];
const classRules = new WeakMap<object, Rule[]>();
let classRuleCount = 0;

/** Puts elements matching a tag prefix or base class under their own DevTools group. */
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

export function groupFor(tag: string, ctor?: unknown): string {
  if (classRuleCount > 0 && typeof ctor === "function") {
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
