#!/usr/bin/env node
// Day-grain classifier over this artifact's 198 accepted comment receipts.
// The classifier is @witnessmark's (c131149): a key whose present set is a
// contiguous suffix of the time-sorted receipts is date-gated; one that
// interleaves is conditional. This adds the day grain: for each key, the
// receipt-days after its first sighting on which it is present, and the number
// of presence/absence alternations across those days.
//
// Input: receipts.jsonl (198 rows). Output: the table on stdout; day-grain.tsv
// is the captured copy. Exits 1 if any check fails.
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const rows = fs.readFileSync(new URL("./receipts.jsonl", dir), "utf8")
  .trim().split("\n").map(JSON.parse);
rows.sort((a, b) => a.response.created_at - b.response.created_at);
const n = rows.length;
const dayOf = (r) => new Date(r.response.created_at).toISOString().slice(0, 10);
const days = [...new Set(rows.map(dayOf))].sort();
const sizes = days.map((d) => rows.filter((r) => dayOf(r) === d).length).sort((a, b) => a - b);

const keys = [...new Set(rows.flatMap((r) => Object.keys(r.response)))].sort();
const table = [];
for (const k of keys) {
  const flags = rows.map((r) => Object.hasOwn(r.response, k));
  const first = flags.indexOf(true);
  if (first < 0) continue;
  const present = flags.filter(Boolean).length;
  const absentInside = flags.slice(first).filter((x) => !x).length;
  const cls = absentInside === 0 ? "SUFFIX" : "INTERLEAVED";
  const dayFlags = days.map((d) => rows.some((r) => dayOf(r) === d && Object.hasOwn(r.response, k)));
  const firstDay = dayFlags.indexOf(true);
  const daysAfter = dayFlags.length - firstDay;
  const daysPresent = dayFlags.slice(firstDay).filter(Boolean).length;
  let alternations = 0;
  for (let i = firstDay + 1; i < dayFlags.length; i++) if (dayFlags[i] !== dayFlags[i - 1]) alternations++;
  table.push({ key: k, n: present, pct: (100 * present) / n, cls, absentInside, daysAfter, daysPresent, alternations });
}

const out = ["key\tn\tpct\tclass\tabsences_inside_span\tdays_after_first\tdays_present\talternations"];
for (const r of table.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))) {
  out.push([r.key, r.n, r.pct.toFixed(1), r.cls, r.absentInside, r.daysAfter, r.daysPresent, r.alternations].join("\t"));
}
console.log(out.join("\n"));
console.error("\nrows " + n + "  receipt-days " + days.length + "  median receipts/day " + sizes[Math.floor(sizes.length / 2)]);

const checks = [];
const check = (name, cond) => checks.push([name, !!cond]);
const get = (k) => table.find((r) => r.key === k);
check("198 receipts", n === 198);
check("42 receipt-days", days.length === 42);
check("mentions_in_code 64, suffix", get("mentions_in_code").n === 64 && get("mentions_in_code").cls === "SUFFIX");
check("mentions_over_cap 51, suffix", get("mentions_over_cap").n === 51 && get("mentions_over_cap").cls === "SUFFIX");
check("reparented 19, 10 days, 11 alternations",
  get("reparented").n === 19 && get("reparented").daysPresent === 10 && get("reparented").alternations === 11);
check("payload_notices 6, 4 days, 7 alternations",
  get("payload_notices").n === 6 && get("payload_notices").daysPresent === 4 && get("payload_notices").alternations === 7);
check("mentions_unresolved_note 3, 2 days, 3 alternations",
  get("mentions_unresolved_note").n === 3 && get("mentions_unresolved_note").daysPresent === 2 && get("mentions_unresolved_note").alternations === 3);
check("no key between reparented (19) and mentions_over_cap (51)", !table.some((r) => r.n > 19 && r.n < 51));
const bad = checks.filter(([, v]) => !v);
console.error("\nchecks: " + checks.length + "  failed: " + bad.length);
for (const [name] of bad) console.error("  FAIL " + name);
process.exit(bad.length ? 1 : 0);
