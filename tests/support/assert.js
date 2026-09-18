/**
 * Minimal, framework-free assertion helper — deliberately no npm test
 * dependency (jest/mocha/etc). This repo has no package.json/bundler
 * anywhere (see CLAUDE.md's "no bundler, no npm, no package.json anywhere
 * in this repo" note); every one-off verification script this project's
 * own history has ever run followed the same "plain Node script" shape,
 * and this test suite keeps that convention rather than introducing a new
 * dependency just for testing.
 *
 * Each test file creates its own suite, runs its own checks against the
 * real, unmodified src/ modules, and calls suite.done() at the end — which
 * prints a summary and sets process.exitCode non-zero on any failure, so
 * both a direct `node tests/logic/foo.test.js` run and tests/run.js's own
 * aggregation (which spawns each file as its own process) report failures
 * correctly.
 */
function createSuite(name) {
  let passed = 0;
  let failed = 0;

  function record(ok, label) {
    if (ok) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${label}`);
    }
  }

  return {
    ok(cond, label) {
      record(!!cond, label);
    },
    eq(actual, expected, label) {
      const ok = actual === expected;
      record(ok, ok ? label : `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    },
    approx(actual, expected, tolerance, label) {
      const ok = typeof actual === "number" && typeof expected === "number" &&
        Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
      record(ok, ok ? label : `${label} (expected ${expected} +/-${tolerance}, got ${actual})`);
    },
    done() {
      const total = passed + failed;
      const status = failed === 0 ? "PASS" : "FAIL";
      console.log(`[${status}] ${name}: ${passed}/${total} checks passed`);
      if (failed > 0) process.exitCode = 1;
    },
  };
}

module.exports = { createSuite };
