// Serves the design system demo with Vite, using this repo's own build of
// Tuppence (run `npm run build` first; `npm run demo:design-system` does).
import { fileURLToPath } from "node:url";

const dist = (file) => fileURLToPath(new URL(`../../dist/${file}`, import.meta.url));

export default {
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: [
      { find: /^tuppence\/lit$/, replacement: dist("adapters/lit.js") },
      { find: /^tuppence$/, replacement: dist("index.js") },
    ],
  },
  server: { port: 5174 },
};
