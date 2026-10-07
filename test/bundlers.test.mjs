import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MARKERS = ["track-entry", "Elements upgraded", "Changes batched", "Cascading Update", "PerformanceObserver"];

const APP = `
import { definePerf, configure } from "tuppence";
import { trackLitUpdates } from "tuppence/lit";
import { observeStencilProfile } from "tuppence/stencil";

configure({ trackGroup: "My App" });
class MyCard extends HTMLElement {}
definePerf("my-card", MyCard);
observeStencilProfile();
window.track = trackLitUpdates;
`;

const REGISTER_APP = `
import "tuppence/register";
customElements.define("my-card", class extends HTMLElement {});
`;

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cept-bundle-"));
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.symlinkSync(repo, path.join(dir, "node_modules", "tuppence"), "dir");
  fs.writeFileSync(path.join(dir, "app.js"), APP);
  fs.writeFileSync(path.join(dir, "register.js"), REGISTER_APP);
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
      ["tuppence", "dist/index.js"],
      ["tuppence/lit", "dist/adapters/lit.js"],
      ["tuppence/stencil", "dist/adapters/stencil.js"],
      ["tuppence/register", "dist/register.js"],
    ]) {
      const resolved = await server.pluginContainer.resolveId(id, importer);
      assert.equal(fs.realpathSync(resolved.id), path.join(repo, file));
    }
  } finally {
    await server.close();
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

const REGISTER_MARKERS = ["Cascading Update", "Elements upgraded", "addInitializer"];

function checkRegister(code, mode) {
  const found = REGISTER_MARKERS.filter((m) => code.includes(m));
  assert.match(code, /customElements\.define/);
  if (mode === "production") assert.deepEqual(found, [], `production build contains: ${found}`);
  else assert.deepEqual(found, REGISTER_MARKERS, "development build dropped the one-line setup");
}

test("one-line setup: kept in webpack development, gone in production", async () => {
  checkRegister(await webpack("development", "register.js"), "development");
  checkRegister(await webpack("production", "register.js"), "production");
});

test("one-line setup: gone in a Vite production build", async () => {
  checkRegister(await vite("production", "register.js"), "production");
});

test("one-line setup: kept by esbuild, gone with --conditions=production", async () => {
  checkRegister(await esbuild([], "register.js"), "development");
  checkRegister(await esbuild(["production"], "register.js"), "production");
});
