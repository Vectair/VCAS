/**
 * Real-execution checks for src/logic/metarWx.js — the present-weather/
 * cloud/visibility decoding helpers behind the Weather screen (2026-09-23).
 * See that file's own header comment and CLAUDE.md's dated entry for the
 * full design writeup.
 */
const { createSuite } = require("../support/assert");
const { loadLogic } = require("../support/loadLogic");

const { MetarWx } = loadLogic();
const t = createSuite("metarWx.js");

// ---- decode(): degenerate/empty input ----
t.eq(JSON.stringify(MetarWx.decode(null)), "[]", "null wxString decodes to an empty array");
t.eq(JSON.stringify(MetarWx.decode("")), "[]", "empty wxString decodes to an empty array");
t.eq(JSON.stringify(MetarWx.decode(undefined)), "[]", "undefined wxString decodes to an empty array");

// ---- decodeToken(): plain phenomenon, no intensity/descriptor ----
t.eq(MetarWx.decodeToken("RA").label, "Rain", "bare RA -> Rain (moderate, unlabelled)");
t.eq(MetarWx.decodeToken("SN").label, "Snow", "bare SN -> Snow");
t.eq(MetarWx.decodeToken("FG").label, "Fog", "bare FG -> Fog");
t.eq(MetarWx.decodeToken("BR").label, "Mist", "bare BR -> Mist");
t.ok(MetarWx.decodeToken("RA").recognised, "RA is marked recognised");

// ---- intensity prefixes ----
t.eq(MetarWx.decodeToken("-RA").label, "Light rain", "-RA -> Light rain");
t.eq(MetarWx.decodeToken("+RA").label, "Heavy rain", "+RA -> Heavy rain");
t.eq(MetarWx.decodeToken("-SN").label, "Light snow", "-SN -> Light snow");

// ---- descriptor + phenomenon combinations ----
t.eq(MetarWx.decodeToken("TSRA").label, "Thunderstorm with rain", "TSRA -> Thunderstorm with rain");
t.eq(MetarWx.decodeToken("+TSRA").label, "Heavy thunderstorm with rain", "+TSRA -> Heavy thunderstorm with rain");
t.eq(MetarWx.decodeToken("SHRA").label, "Showers of rain", "SHRA -> Showers of rain");
t.eq(MetarWx.decodeToken("-SHRA").label, "Light showers of rain", "-SHRA -> Light showers of rain");
t.eq(MetarWx.decodeToken("FZRA").label, "Freezing rain", "FZRA -> Freezing rain");
t.eq(MetarWx.decodeToken("MIFG").label, "Shallow fog", "MIFG -> Shallow fog");
t.eq(MetarWx.decodeToken("BCFG").label, "Patches of fog", "BCFG -> Patches of fog");
t.eq(MetarWx.decodeToken("BLSN").label, "Blowing snow", "BLSN -> Blowing snow");
t.eq(MetarWx.decodeToken("DRSN").label, "Low drifting snow", "DRSN -> Low drifting snow");

// ---- multi-phenomenon (two 2-letter phenomenon codes concatenated) ----
t.eq(MetarWx.decodeToken("RASN").label, "Rain and snow", "RASN -> Rain and snow");

// ---- vicinity (VC) prefix ----
t.eq(MetarWx.decodeToken("VCFG").label, "Fog in the vicinity", "VCFG -> Fog in the vicinity");
t.eq(MetarWx.decodeToken("VCTS").label, "Thunderstorm in the vicinity", "VCTS (standalone descriptor) -> Thunderstorm in the vicinity");

// ---- standalone descriptor (no trailing phenomenon code), a real METAR grammar quirk ----
t.eq(MetarWx.decodeToken("TS").label, "Thunderstorm", "bare TS -> Thunderstorm");

// ---- NSW special case ----
t.eq(MetarWx.decodeToken("NSW").label, "No significant weather", "NSW -> No significant weather");

// ---- unrecognised token passes through as its own raw code, never dropped/crashed ----
const unknown = MetarWx.decodeToken("ZZQQ");
t.eq(unknown.label, "ZZQQ", "an unrecognised token's label falls back to the raw code");
t.ok(unknown.recognised === false, "an unrecognised token is marked NOT recognised");

// ---- decode() on a real multi-token wxString ----
const multi = MetarWx.decode("-RA BR");
t.eq(multi.length, 2, "a two-token wxString decodes to two entries");
t.eq(multi[0].label, "Light rain", "first token of '-RA BR' decodes correctly");
t.eq(multi[1].label, "Mist", "second token of '-RA BR' decodes correctly");

// ---- case-insensitivity ----
t.eq(MetarWx.decodeToken("ra").label, "Rain", "decodeToken is case-insensitive");

// ---- cloudLabel() ----
t.eq(MetarWx.cloudLabel("BKN"), "Broken", "BKN -> Broken");
t.eq(MetarWx.cloudLabel("OVC"), "Overcast", "OVC -> Overcast");
t.eq(MetarWx.cloudLabel("FEW"), "Few", "FEW -> Few");
t.eq(MetarWx.cloudLabel("SCT"), "Scattered", "SCT -> Scattered");
t.eq(MetarWx.cloudLabel("SKC"), "Sky clear", "SKC -> Sky clear");
t.eq(MetarWx.cloudLabel("CLR"), "Clear", "CLR -> Clear");
t.eq(MetarWx.cloudLabel("VV"), "Sky obscured", "VV -> Sky obscured");
t.eq(MetarWx.cloudLabel("bkn"), "Broken", "cloudLabel is case-insensitive");
t.eq(MetarWx.cloudLabel("XYZ"), "XYZ", "an unrecognised cover code passes through unchanged");

// ---- summariseSky() ----
t.eq(MetarWx.summariseSky([]), "No cloud reported", "empty clouds array -> 'No cloud reported'");
t.eq(MetarWx.summariseSky(null), "No cloud reported", "null clouds -> 'No cloud reported'");
t.eq(
  MetarWx.summariseSky([{ cover: "FEW", baseFt: 25000 }, { cover: "BKN", baseFt: 3000 }, { cover: "OVC", baseFt: 8000 }]),
  "Broken at 3,000ft",
  "the LOWEST ceiling-forming layer (BKN/OVC/VV) wins, even with a higher FEW layer present"
);
t.eq(
  MetarWx.summariseSky([{ cover: "SKC", baseFt: null }]),
  "Sky clear",
  "an all-clear report with no ceiling layer reads as the clear-sky label"
);
t.eq(
  MetarWx.summariseSky([{ cover: "FEW", baseFt: 2000 }, { cover: "SCT", baseFt: 5000 }]),
  "Scattered at 5,000ft",
  "with only FEW/SCT present (no real ceiling), the HIGHEST layer is reported"
);

// ---- formatVisibility() ----
t.eq(MetarWx.formatVisibility(null), null, "null visibility -> null (caller decides how to phrase 'unknown')");
t.eq(MetarWx.formatVisibility(10).label, "10+ mi (16+ km)", "10sm (the API's own 'at least' cap) -> 10+ mi (16+ km)");
t.eq(MetarWx.formatVisibility(15).label, "10+ mi (16+ km)", "beyond the cap also reads as 10+");
t.eq(MetarWx.formatVisibility(5).label, "5 mi (8.0 km)", "5sm -> 5 mi (8.0 km)");
t.eq(MetarWx.formatVisibility(0.5).label, "0.5 mi (0.8 km)", "0.5sm -> 0.5 mi (0.8 km)");
t.approx(MetarWx.formatVisibility(5).km, 8.0467, 0.01, "the raw km figure is a real sm->km conversion, not a rounded guess");

t.done();
