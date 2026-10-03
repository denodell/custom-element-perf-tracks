// Builds a tiny app that uses every entry point, with real Vite, webpack and
// esbuild, and checks what ends up in the output:
// - production builds must contain none of the instrumentation code;
// - development builds must contain it (so the check above means something).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Strings that only exist in the real (development) code.
const MARKERS = ["track-entry", "elements upgraded", "changes batched", "PerformanceObserver"];

const APP = `
import { definePerf, configure } from "custom-element-perf-tracks";
import { trackLitUpdates } from "custom-element-perf-tracks/lit";
import { observeStencilProfile } from "custom-element-perf-tracks/stencil";

configure({ trackGroup: "My App" });
class MyCard extends HTMLElement {}
definePerf("my-card", MyCard);
observeStencilProfile();
window.track = trackLitUpdates;
`;

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cept-bundle-"));
  fs.mkdirSync(path.join(dir, "node_modules"));
  // Install this package the way npm would link it.
  fs.symlinkSync(repo, path.join(dir, "node_modules", "custom-element-perf-tracks"), "dir");
  fs.writeFileSync(path.join(dir, "app.js"), APP);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
});

function readAll(outDir) {
  return fs
    .readdirSync(outDir, { recursive: true })
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(outDir, f), "utf8"))
    .join("\n");
}

function check(code, mode) {
  const found = MARKERS.filter((m) => code.includes(m));
  // Either way the element must still be defined.
  assert.match(code, /customElements\.define/);
  if (mode === "production") assert.deepEqual(found, [], `production build contains: ${found}`);
  else assert.deepEqual(found, MARKERS, "development build should contain the real code");
  return code.length;
}

async function vite(mode) {
  const { build } = await import("vite");
  const outDir = path.join(dir, `vite-${mode}`);
  await build({
    root: dir,
    mode,
    logLevel: "silent",
    configFile: false,
    build: { outDir, minify: false, rollupOptions: { input: path.join(dir, "app.js") } },
  });
  return readAll(outDir);
}

async function webpack(mode) {
  const { default: webpack } = await import("webpack");
  const outDir = path.join(dir, `webpack-${mode}`);
  const stats = await new Promise((resolve, reject) =>
    webpack(
      {
        mode,
        context: dir,
        entry: "./app.js",
        output: { path: outDir },
        optimization: { minimize: false },
        devtool: false,
      },
      (err, s) => (err ? reject(err) : resolve(s)),
    ),
  );
  assert.ok(!stats.hasErrors(), stats.toString("errors-only"));
  return readAll(outDir);
}

async function esbuild(conditions) {
  const { build } = await import("esbuild");
  const result = await build({
    absWorkingDir: dir,
    entryPoints: ["app.js"],
    bundle: true,
    format: "esm",
    write: false,
    conditions,
    logLevel: "silent",
  });
  return result.outputFiles.map((f) => f.text).join("\n");
}

test("Vite production build contains none of the library", async () => {
  check(await vite("production"), "production");
});

test("Vite dev server uses the real code", async () => {
  const { createServer } = await import("vite");
  // An earlier `vite build` in this process sets NODE_ENV=production, which
  // Vite reads when choosing conditions. A fresh dev session has it unset.
  delete process.env.NODE_ENV;
  const server = await createServer({
    root: dir,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, ws: false },
  });
  try {
    const importer = path.join(dir, "app.js");
    for (const [id, file] of [
      ["custom-element-perf-tracks", "dist/index.js"],
      ["custom-element-perf-tracks/lit", "dist/adapters/lit.js"],
      ["custom-element-perf-tracks/stencil", "dist/adapters/stencil.js"],
    ]) {
      const resolved = await server.pluginContainer.resolveId(id, importer);
      assert.equal(fs.realpathSync(resolved.id), path.join(repo, file));
    }
  } finally {
    await server.close();
  }
});

test("webpack production build contains none of the library", async () => {
  check(await webpack("production"), "production");
});

test("webpack development build contains it", async () => {
  check(await webpack("development"), "development");
});

test("esbuild with --conditions=production contains none of the library", async () => {
  check(await esbuild(["production"]), "production");
});

test("esbuild without the flag keeps the real code (documented)", async () => {
  check(await esbuild([]), "development");
});
