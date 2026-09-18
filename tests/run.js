#!/usr/bin/env node
/**
 * Runs every *.test.js file under tests/logic/ as its own child process
 * (so a throw/global leak in one file can never corrupt another's state)
 * and prints an aggregate summary. Exits non-zero if any file failed.
 *
 * Usage: node tests/run.js
 *
 * Deliberately no test framework/npm dependency — see tests/support/
 * assert.js's own header comment for why. Each test file also runs fine
 * standalone (`node tests/logic/geo.test.js`) for quick iteration.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const LOGIC_DIR = path.join(__dirname, "logic");
const files = fs.readdirSync(LOGIC_DIR)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => path.join(LOGIC_DIR, f));

if (files.length === 0) {
  console.error("No test files found under tests/logic/.");
  process.exit(1);
}

let anyFailed = false;

for (const file of files) {
  const rel = path.relative(process.cwd(), file);
  try {
    const out = execFileSync(process.execPath, [file], { encoding: "utf8" });
    process.stdout.write(out);
  } catch (err) {
    anyFailed = true;
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    if (!err.stdout && !err.stderr) console.error(`${rel}: failed to run (${err.message})`);
  }
}

process.exit(anyFailed ? 1 : 0);
