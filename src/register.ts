import type { ReactiveElement } from "lit";
import { instrumentAll } from "./define.js";
import { trackLitUpdates } from "./adapters/lit.js";

instrumentAll({
  onDefine(ctor) {
    const lit = ctor as unknown as {
      addInitializer?: (init: (el: ReactiveElement) => void) => void;
      prototype: { performUpdate?: unknown };
    };
    if (typeof lit.addInitializer === "function" && typeof lit.prototype.performUpdate === "function") {
      lit.addInitializer((el) => trackLitUpdates(el));
    }
  },
});
