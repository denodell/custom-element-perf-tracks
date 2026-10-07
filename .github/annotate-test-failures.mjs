import fs from "node:fs";

const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
const failures = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(\s*)not ok \d+ - (.*)$/);
  if (!m) continue;
  const indent = m[1].length;
  const block = [];
  for (let j = i + 1; j < lines.length && block.length < 40; j++) {
    if (lines[j].trim() === "..." && lines[j].indexOf("...") <= indent + 2) break;
    block.push(lines[j].slice(indent));
  }
  if (block.some((l) => l.includes("subtestsFailed"))) continue;
  failures.push({ name: m[2], block });
}

const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
for (const { name, block } of failures.slice(0, 10)) {
  console.log(`::error title=${escape(name).replace(/[:,]/g, " ")}::${escape(block.join("\n"))}`);
}
if (failures.length === 0) console.log("::error::Tests failed, but no failing test was found in the output.");
