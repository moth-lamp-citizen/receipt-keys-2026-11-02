#!/usr/bin/env node
// Follow-up census, 2026-11-02: the two receipt keys are unconditional and date-gated, and the
// read path serves both for rows older than either commit.
//
// Inputs: receipts.jsonl (the same 198 accepted POST /api/comment responses), read-path.tsv (nine
// served comment objects, fetched 2026-11-02T12:2xZ), and the public commit metadata in
// source-commits.txt (kept as constants here; a reader can check them with git log in the public
// repo). Exits 1 on a failed check.
import fs from "node:fs";

const dir = new URL(".", import.meta.url);
const rows = fs.readFileSync(new URL("./receipts.jsonl", dir), "utf8")
  .trim().split("\n").map(JSON.parse)
  .map(r => ({ ...r, created: r.response && r.response.created_at }));
const readPath = fs.readFileSync(new URL("./read-path.tsv", dir), "utf8")
  .trim().split("\n").slice(1).map(l => {
    const [id, created_at, author, mod_state, keys, mic, moc, has_mic, has_moc] = l.split("\t");
    return { id: Number(id), created_at, author, mod_state, keys: Number(keys),
      mic, moc, has_mic: has_mic === "true", has_moc: has_moc === "true" };
  });

const MIC = Date.parse("2026-10-11T01:03:55Z");   // 96dc8b43d committer
const MOC = Date.parse("2026-10-13T13:30:18Z");   // a6d35c146 committer
const has = (r, k) => Object.prototype.hasOwnProperty.call(r.response, k);
const checks = [];
const check = (name, cond) => { checks.push([name, !!cond]); };

console.log("receipts: " + rows.length);
const micPre = rows.filter(r => r.created < MIC), micPost = rows.filter(r => r.created >= MIC);
const mocPre = rows.filter(r => r.created < MOC), mocPost = rows.filter(r => r.created >= MOC);
console.log("mentions_in_code:  " + micPre.length + " before 96dc8b43d, " +
  micPre.filter(r => has(r, "mentions_in_code")).length + " with it; " + micPost.length + " after, " +
  micPost.filter(r => has(r, "mentions_in_code")).length + " with it");
console.log("mentions_over_cap: " + mocPre.length + " before a6d35c146, " +
  mocPre.filter(r => has(r, "mentions_over_cap")).length + " with it; " + mocPost.length + " after, " +
  mocPost.filter(r => has(r, "mentions_over_cap")).length + " with it");
const emptyMention = micPost.filter(r => (r.response.mentioned || []).length === 0);
console.log("late receipts with mentioned: []: " + emptyMention.length + ", carrying mentions_in_code: " +
  emptyMention.filter(r => has(r, "mentions_in_code")).length);
const gapA = rows.find(r => r.id === 104789), gapB = rows.find(r => r.id === 113731);
const between = rows.filter(r => r.created > gapA.created && r.created < gapB.created);
console.log("gap c104789..c113731: " + ((gapB.created - gapA.created) / 3600000).toFixed(3) + " h, " +
  between.length + " receipts inside");
for (const k of ["mentions_in_code", "mentions_over_cap"]) {
  const vals = [...new Set(rows.filter(r => has(r, k)).map(r => r.response[k]))];
  check(k + ": value 0 on every receipt that carries it", vals.length === 1 && vals[0] === 0);
}
check("164 receipts split at 96dc8b43d", micPre.length === 134 && micPost.length === 64);
check("no pre-96dc8b43d receipt carries mentions_in_code", micPre.every(r => !has(r, "mentions_in_code")));
check("every post-96dc8b43d receipt carries mentions_in_code", micPost.every(r => has(r, "mentions_in_code")));
check("198 receipts split at a6d35c146", mocPre.length === 147 && mocPost.length === 51);
check("no pre-a6d35c146 receipt carries mentions_over_cap", mocPre.every(r => !has(r, "mentions_over_cap")));
check("every post-a6d35c146 receipt carries mentions_over_cap", mocPost.every(r => has(r, "mentions_over_cap")));
check("22 late receipts have mentioned: []", emptyMention.length === 22);
check("all 22 carry mentions_in_code", emptyMention.every(r => has(r, "mentions_in_code")));
check("no receipt in the 2026-10-13..10-19 gap", between.length === 0);

console.log("read path: " + readPath.length + " rows, " +
  readPath[0].created_at + " .. " + readPath[readPath.length - 1].created_at);
for (const r of readPath) {
  console.log("  c" + r.id + " " + r.created_at + " keys=" + r.keys + " mic=" + r.mic + " moc=" + r.moc +
    (r.mod_state ? " mod_state=" + r.mod_state : ""));
}
check("9 read-path rows", readPath.length === 9);
check("every read-path row has 22 keys", readPath.every(r => r.keys === 22));
check("every read-path row carries both keys", readPath.every(r => r.has_mic && r.has_moc));
check("every read-path row counts 0/0", readPath.every(r => r.mic === "0" && r.moc === "0"));
check("every read-path row is unredacted", readPath.every(r => r.mod_state === ""));
check("oldest read-path row predates 96dc8b43d", Date.parse(readPath[0].created_at) < MIC);
check("newest read-path row is c130824", readPath[readPath.length - 1].id === 130824);

const bad = checks.filter(([, v]) => !v);
console.log("\nchecks: " + checks.length + "  failed: " + bad.length);
for (const [n] of bad) console.log("  FAIL " + n);
process.exit(bad.length ? 1 : 0);
