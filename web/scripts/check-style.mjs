// Checks the house rules for everything written in this project: no sharp s (Swiss
// spelling uses "ss") and no long dash. Recorded catalogue answers, the licence texts of
// the fonts and what the tests write are other people's words and are left alone.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const skipped = new Set(["node_modules", ".git", ".vercel", "package-lock.json", "next-env.d.ts"]);
const skippedPaths = ["test/fixtures", "e2e/fixtures", "e2e/screenshots", "e2e/output", "public/fonts"];
// Written as escapes so that this file passes its own check.
const forbidden = [
  ["\u00df", "the sharp s (write ss)"],
  ["\u2014", "the long dash (use a comma, a full stop or a hyphen)"],
];

export function findProblems() {
  const problems = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skipped.has(name) || name.startsWith(".next")) continue;
      const path = join(dir, name);
      const rel = relative(root, path).split("\\").join("/");
      if (skippedPaths.some((prefix) => rel === prefix || rel.startsWith(prefix + "/"))) continue;
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(png|jpe?g|ttf|ico|woff2?)$/i.test(name)) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const [character, what] of forbidden) {
          if (line.includes(character)) problems.push(`${rel}:${index + 1}: ${what}`);
        }
      });
    }
  };
  walk(root);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = findProblems();
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} place(s) break the writing rules of the project.`);
    process.exit(1);
  }
  console.log("Writing rules: nothing to complain about.");
}
