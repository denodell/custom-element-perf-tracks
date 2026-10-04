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
const MARKERS = ["track-entry", "Elements upgraded", "Changes batched", "Cascading Update", "PerformanceObserver"];

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

// An app that only uses the one-line setup. The import has no bindings, so
// bundlers keep it only because the package marks it as having side effects.
const AUTO_APP = `
import "custom-element-perf-tracks/auto";
customElements.define("my-card", class extends HTMLElement {});
`;

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cept-bundle-"));
  fs.mkdirSync(path.join(dir, "node_modules"));
  // Install this package the way npm would link it.
  fs.symlinkSync(repo, path.join(dir, "node_modules", "custom-element-perf-tracks"), "dir");
  fs.writeFileSync(path.join(dir, "app.js"), APP);
  fs.writeFileSync(path.join(dir, "auto.js"), AUTO_APP);
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

async function vite(mode, entry = "app.js") {
  const { build } = await import("vite");
  const outDir = path.join(dir, `vite-${mode}-${entry}`);
  await build({
    root: dir,
    mode,
    logLevel: "silent",
    configFile: false,
    build: { outDir, minify: false, rollupOptions: { input: path.join(dir, entry) } },
  });
  return readAll(outDir);
}

async function webpack(mode, entry = "app.js") {
  const { default: webpack } = await import("webpack");
  const outDir = path.join(dir, `webpack-${mode}-${entry}`);
  const stats = await new Promise((resolve, reject) =>
    webpack(
      {
        mode,
        context: dir,
        entry: `./${entry}`,
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

async function esbuild(conditions, entry = "app.js") {
  const { build } = await import("esbuild");
  const result = await build({
    absWorkingDir: dir,
    entryPoints: [entry],
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
  const savedEnv = process.env.NODE_ENV;
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
      ["custom-element-perf-tracks/auto", "dist/auto.js"],
    ]) {
      const resolved = await server.pluginContainer.resolveId(id, importer);
      assert.equal(fs.realpathSync(resolved.id), path.join(repo, file));
    }
  } finally {
    await server.close();
    // Put it back so later builds in this process are not affected.
    if (savedEnv !== undefined) process.env.NODE_ENV = savedEnv;
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

// Strings from the Lit adapter and core that the one-line setup pulls in.
const AUTO_MARKERS = ["Cascading Update", "Elements upgraded", "addInitializer"];

function checkAuto(code, mode) {
  const found = AUTO_MARKERS.filter((m) => code.includes(m));
  assert.match(code, /customElements\.define/);
  if (mode === "production") assert.deepEqual(found, [], `production build contains: ${found}`);
  else assert.deepEqual(found, AUTO_MARKERS, "development build dropped the one-line setup");
}

test("one-line setup: kept in webpack development, gone in production", async () => {
  checkAuto(await webpack("development", "auto.js"), "development");
  checkAuto(await webpack("production", "auto.js"), "production");
});

test("one-line setup: gone in a Vite production build", async () => {
  checkAuto(await vite("production", "auto.js"), "production");
});

test("one-line setup: kept by esbuild, gone with --conditions=production", async () => {
  checkAuto(await esbuild([], "auto.js"), "development");
  checkAuto(await esbuild(["production"], "auto.js"), "production");
});
