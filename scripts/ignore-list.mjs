import fs from "node:fs";
import path from "node:path";

const dir = new URL("../dist/", import.meta.url).pathname;
let count = 0;
for (const file of fs.readdirSync(dir, { recursive: true })) {
  if (!String(file).endsWith(".js.map")) continue;
  const full = path.join(dir, String(file));
  const map = JSON.parse(fs.readFileSync(full, "utf8"));
  const all = map.sources.map((_, i) => i);
  map.ignoreList = all;
  map.x_google_ignoreList = all;
  fs.writeFileSync(full, JSON.stringify(map));
  count++;
}
console.log(`Marked ${count} source maps as ignore-listed.`);
