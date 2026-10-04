// Marks every file in dist as library code in its source map, the way React
// does. Chrome DevTools then hides this library's own functions from stack
// traces, including the "Function stack" of each bar, wherever it is loaded
// from. https://developer.chrome.com/docs/devtools/x-google-ignore-list
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
  map.x_google_ignoreList = all; // older Chrome versions
  fs.writeFileSync(full, JSON.stringify(map));
  count++;
}
console.log(`Marked ${count} source maps as ignore-listed.`);
