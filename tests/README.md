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
changes the result rather than being a dead parameter. `trafficRules.js`
(`TrafficRulesLogic`, the pure rule-matching engine behind the Traffic
Rules feature) came next — also standalone, no dependency on the other
`src/logic/` modules — covering every condition axis (type, comma-
separated type list, category, altitude above/below, military/civil),
the AND-not-OR combination of multiple conditions on one rule, and the
filter (OR-across-enabled-rules) vs. highlight (first-match-wins-in-
list-order) evaluation semantics. `simplifiedType.js` (the ICAO type ->
layperson-family lookup behind the "Simplify aircraft types" setting)
followed the same standalone shape — covering the exact-table tier, the
regex family-root-pattern tier (including deliberately synthetic/
hypothetical variant codes to prove the pattern generalises beyond
today's known variants, not just the ones hand-enumerated), and that the
two tiers don't fight each other. `metarWx.js` (the present-weather/
cloud/visibility decoding behind the Weather screen) came next — also
standalone — covering the WMO present-weather token grammar (intensity +
0-2 descriptors + 1-2 phenomenon codes, the vicinity prefix, and the
real "a descriptor can stand alone with no trailing phenomenon" grammar
quirk), the sky-summary/cloud-label/visibility-formatting helpers, and
graceful passthrough for anything unrecognised. `userep.js` (the shared
vocab tables and pure helpers behind USEREP — user-submitted local
weather reports feeding `Visibility.estimate()`'s own `userep` parameter,
see CLAUDE.md's dated entry) came last so far — depends on `Geo` (loaded
via `loadLogic.js` the same way `visibility.js`/`relevance.js` already
are, since its `distanceMiles()` reads it as a free global) — covering
`pickFreshest()`'s "most recent wins" selection (including malformed/
null entries in the array being skipped rather than crashing),
`ageMinutes()`/`distanceMiles()`'s own edge cases (clock skew never going
negative, missing fields degrading to `null`), and `summarize()`'s exact
output string across several real report shapes. The scoring
INTERPRETATION of a `userep` report (severe-phenomena drop, partial cap,
and the one adjustment in `visibility.js` allowed to RAISE a category) is
tested directly in `visibility.test.js` instead, via `estimate()`'s own
7th parameter — not duplicated here.

Not yet covered: `upperAirProvider.js`/`metarProvider.js`/
`userepProvider.js` themselves
(the network-fetch modules `metarWx.js` sits downstream of — would need
a mocked `fetch`), and any DOM/UI wiring (would need a headless-browser
harness, a materially bigger lift than these plain-Node checks — see
ROADMAP.md's own note that "Playwright/DOM harnesses for UI wiring are
more expensive but still worth a small curated set").

Extending this suite to another `src/logic/` module is the same shape
every time: add `tests/logic/<module>.test.js`, `require` it through
`tests/support/loadLogic.js` (extend that file if the new module needs a
sibling global the way `visibility.js` needs `Geo`/`Contrail`), write
checks against the real, current function signatures (read the source
first — don't guess), and run the file directly before trusting any
assertion in it, the same discipline this project has always applied to
one-off verification scripts, just now kept around afterward instead of
discarded.
