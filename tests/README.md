# tests/

The first committed, repeatable test suite for VCAS — see ROADMAP.md's
"Infrastructure & process gaps" section (#2) and CLAUDE.md's own dated
entry for why this exists: every prior verification in this project's
history (hundreds of real Playwright/Node checks, across dozens of
features) was built fresh in a session's scratchpad and thrown away once
it passed, with nothing left behind to catch a future regression.

## Running

```
node tests/run.js
```

Runs every `tests/logic/*.test.js` file as its own child process and
prints an aggregate summary. Exits non-zero if any file failed. Each test
file also runs fine standalone for quick iteration while working on one
module:

```
node tests/logic/geo.test.js
```

No `npm test`, no framework, no `package.json` — this repo has none
anywhere (see CLAUDE.md's "no bundler, no npm" notes on `src/logic/
localObstruction.js`'s own build history) and this suite keeps that
convention rather than introducing a new dependency just for testing.
`tests/support/assert.js` is a ~40-line, dependency-free assertion
helper; `tests/support/loadLogic.js` loads the real `src/logic/` modules
in plain Node, replicating how `index.html` loads them as sibling
`<script>` tags sharing one global scope (every module in `src/logic/`
already carries its own `module.exports` guard for exactly this).

## Scope

Started with the three highest-value, most self-contained pure-logic
modules — `geo.js`, `visibility.js`, `relevance.js` — per ROADMAP.md's own
recommendation that the pure-logic modules are "the cheapest and
highest-signal place to start." `aircraftExtrapolation.js` and
`indicators.js` were added next — the latter is the orchestration layer
over `Geo`/`Visibility`/`Relevance`/`AircraftExtrapolation` together, so
its own tests lean on cross-checking its output against direct calls to
those already-verified modules (e.g. `Indicators.buildAll()`'s computed
`x`/`y` against an independent `Geo.projectToPolarPosition()` call with
the same inputs) rather than re-deriving expected values by hand.

`contrail.js` was added next — pure Schmidt-Appleman physics with no
dependency on the other modules, verified with analytically-solved
boundary values (the mixing-line-slope cutoff, the "too warm" threshold
temperature, the forms/persistence RH boundaries) the same way `geo.js`'s
own boundary checks are, plus a check that `engineEfficiency` genuinely
changes the result rather than being a dead parameter.

Not yet covered: `trafficRules.js`, `upperAirProvider.js`/
`metarProvider.js` (network-fetch modules, would need a mocked `fetch`),
and any DOM/UI wiring (would need a headless-browser harness, a
materially bigger lift than these plain-Node checks — see ROADMAP.md's
own note that "Playwright/DOM harnesses for UI wiring are more expensive
but still worth a small curated set").

Extending this suite to another `src/logic/` module is the same shape
every time: add `tests/logic/<module>.test.js`, `require` it through
`tests/support/loadLogic.js` (extend that file if the new module needs a
sibling global the way `visibility.js` needs `Geo`/`Contrail`), write
checks against the real, current function signatures (read the source
first — don't guess), and run the file directly before trusting any
assertion in it, the same discipline this project has always applied to
one-off verification scripts, just now kept around afterward instead of
discarded.
