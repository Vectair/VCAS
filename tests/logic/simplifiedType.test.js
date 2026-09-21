/**
 * Real-execution checks for src/logic/simplifiedType.js — the ICAO type
 * designator -> layperson-recognisable group lookup behind the "Simplify
 * aircraft types" setting. See CLAUDE.md's dated entry and ROADMAP.md's
 * own entry for this feature for the full design writeup, including the
 * grouping principle these checks verify against (collapse Boeing 737/
 * 747/757/767/787 fully to the bare model number; keep Airbus A318/319/
 * 320/321 as four distinct buckets, only folding the neo/ceo engine
 * suffix together; everything unmapped passes through unchanged).
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { SimplifiedType } = loadLogic();
const t = createSuite("simplifiedType.js");

// ---- degenerate/falsy inputs pass straight through unchanged ----
t.eq(SimplifiedType.get(null), null, "null passes through unchanged");
t.eq(SimplifiedType.get(undefined), undefined, "undefined passes through unchanged");
t.eq(SimplifiedType.get(""), "", "empty string passes through unchanged");

// ---- Boeing 737 family: every real-world variant collapses to "737" ----
// (the tester's own literal example — B738/B39M/B3XM/B736 are all "a 737")
["B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739",
 "B37M", "B38M", "B39M", "B3XM"].forEach(code => {
  t.eq(SimplifiedType.get(code), "737", `${code} -> 737`);
});

// ---- Boeing widebodies: full-family collapse, same principle ----
["B741", "B742", "B743", "B744", "B748", "B74S"].forEach(code => {
  t.eq(SimplifiedType.get(code), "747", `${code} -> 747`);
});
t.eq(SimplifiedType.get("B752"), "757", "B752 -> 757");
t.eq(SimplifiedType.get("B763"), "767", "B763 -> 767");
["B772", "B773", "B77L", "B77W", "B778", "B779"].forEach(code => {
  t.eq(SimplifiedType.get(code), "777", `${code} -> 777`);
});
["B788", "B789", "B78X"].forEach(code => {
  t.eq(SimplifiedType.get(code), "787", `${code} -> 787`);
});

// ---- Airbus A320 family: kept DISTINCT by series number, only the neo/
// ceo engine-generation suffix folds together — a deliberate asymmetry
// with the Boeing 737 treatment above, verified explicitly here so a
// future edit can't accidentally collapse these into one bucket without
// the change being obvious against this test. ----
t.eq(SimplifiedType.get("A318"), "A318", "A318 stays A318");
t.eq(SimplifiedType.get("A319"), "A319", "A319 stays A319");
t.eq(SimplifiedType.get("A19N"), "A319", "A19N (neo) folds into A319");
t.eq(SimplifiedType.get("A320"), "A320", "A320 stays A320");
t.eq(SimplifiedType.get("A20N"), "A320", "A20N (neo) folds into A320");
t.eq(SimplifiedType.get("A321"), "A321", "A321 stays A321");
t.eq(SimplifiedType.get("A21N"), "A321", "A21N (neo) folds into A321");
t.ok(SimplifiedType.get("A320") !== SimplifiedType.get("A321"),
  "A320 and A321 remain genuinely distinct buckets, not collapsed together");

// ---- Airbus widebodies: each a distinct, individually-named aircraft ----
t.eq(SimplifiedType.get("A332"), "A330", "A332 -> A330");
t.eq(SimplifiedType.get("A333"), "A330", "A333 -> A330");
t.eq(SimplifiedType.get("A346"), "A340", "A346 -> A340");
t.eq(SimplifiedType.get("A35K"), "A350", "A35K -> A350");
t.eq(SimplifiedType.get("A388"), "A380", "A388 -> A380");

// ---- Regional jets collapse to family ----
["CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX"].forEach(code => {
  t.eq(SimplifiedType.get(code), "CRJ", `${code} -> CRJ`);
});
["E170", "E190", "E195", "E75L"].forEach(code => {
  t.eq(SimplifiedType.get(code), "E-Jet", `${code} -> E-Jet`);
});

// ---- Turboprops: ATR42 vs ATR72 kept distinct (different aircraft,
// different names); Dash 8 -100/200/300 collapse, but the re-engined
// Q400 stays its own bucket. ----
t.eq(SimplifiedType.get("AT45"), "ATR 42", "AT45 -> ATR 42");
t.eq(SimplifiedType.get("AT76"), "ATR 72", "AT76 -> ATR 72");
t.ok(SimplifiedType.get("AT45") !== SimplifiedType.get("AT76"),
  "ATR 42 and ATR 72 remain distinct");
t.eq(SimplifiedType.get("DH8C"), "Dash 8", "DH8C -> Dash 8");
t.eq(SimplifiedType.get("DH8D"), "Q400", "DH8D (re-engined) stays its own Q400 bucket");

// ---- Unmapped codes (GA, helicopters, military, anything not in the
// starter table) pass through UNCHANGED — the safe fallback, never worse
// than showing the raw designator today. ----
t.eq(SimplifiedType.get("C172"), "C172", "unmapped GA type passes through unchanged");
t.eq(SimplifiedType.get("R44"), "R44", "unmapped helicopter type passes through unchanged");
t.eq(SimplifiedType.get("ZZZZ"), "ZZZZ", "unmapped placeholder code passes through unchanged");

// ---- Case-insensitive lookup, but unmapped output preserves original casing ----
t.eq(SimplifiedType.get("b738"), "737", "lookup is case-insensitive (lowercase input)");
t.eq(SimplifiedType.get("c172"), "c172", "unmapped code's original casing is preserved on passthrough");

t.done();
