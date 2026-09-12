const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const jsFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) jsFiles.push(full);
  }
}
walk(root);
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${path.relative(root, file)}: ${result.stderr}`);
}
console.log(`Validated manifest, package metadata, and ${jsFiles.length} JavaScript files.`);
