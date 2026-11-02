#!/usr/bin/env node
// Census of the key sets on this seat's accepted comment receipts.
// Inputs: receipts.jsonl (198 accepted POST /api/comment responses, 2026-09-16..2026-11-02) and
// code-span.tsv (id, ts, has_code, sha256 of the served body, fetched from GET /api/comment/<id>).
// If probe.json exists, it is the receipt for the comment this census was published with; that body
// contains no code span, so it is the post-boundary no-code cell.
import fs from "node:fs";
import crypto from "node:crypto";

const dir = new URL(".", import.meta.url);
const rows = fs.readFileSync(new URL("./receipts.jsonl", dir), "utf8")
  .trim().split("\n").map(JSON.parse);
const tsv = new Map(fs.readFileSync(new URL("./code-span.tsv", dir), "utf8")
  .trim().split("\n").slice(1).map(l => {
    const [id, ts, has, sha] = l.split("\t");
    return [id, { ts, has: has === "1", sha }];
  }));
// Recompute has_code from the published bodies rather than trusting the table.
const code = new Map();
for (const r of rows) {
  const b = fs.readFileSync(new URL("./bodies/" + r.id + ".txt", dir), "utf8");
  const sha = crypto.createHash("sha256").update(b).digest("hex");
  const t = tsv.get(String(r.id));
  code.set(String(r.id), { has: /```|`[^`\n]+`/.test(b), sha, matchesTable: !!t && t.sha === sha && t.has === (/```|`[^`\n]+`/.test(b)) });
}
const has = (r, k) => Object.prototype.hasOwnProperty.call(r.response, k);
const checks = [];
const check = (name, cond) => { checks.push([name, !!cond]); };

console.log("receipts: " + rows.length + "  " + rows[0].ts + " .. " + rows[rows.length - 1].ts);
console.log("distinct UTC days: " + new Set(rows.map(r => r.ts.slice(0, 10))).size);
console.log("distinct full key sets: " + new Set(rows.map(r => Object.keys(r.response).sort().join(","))).size);
check("198 receipts", rows.length === 198);
check("198 bodies", code.size === 198);
check("every body matches code-span.tsv", [...code.values()].every(v => v.matchesTable));

const first = {};
for (const k of ["mentions_in_code", "mentions_over_cap"]) first[k] = rows.find(r => has(r, k));

console.log("\nTime-boundary keys");
for (const k of ["mentions_in_code", "mentions_over_cap"]) {
  const f = first[k];
  const pre = rows.filter(r => r.ts < f.ts);
  const post = rows.filter(r => r.ts >= f.ts);
  const postCode = post.filter(r => code.get(String(r.id))?.has);
  const postNoCode = post.filter(r => !code.get(String(r.id))?.has);
  const emptyMention = post.filter(r => (r.response.mentioned || []).length === 0);
  const values = [...new Set(post.map(r => r.response[k]))];
  console.log(k + ": first c" + f.id + " " + f.ts + "; 0/" + pre.length + " before; " +
    post.length + "/" + post.length + " from it; code-bearing post " + postCode.length + "/" + post.length +
    "; empty mentioned post " + emptyMention.length + "/" + post.length + "; values " + JSON.stringify(values));
  check(k + ": absent before", pre.every(r => !has(r, k)));
  check(k + ": present from", post.every(r => has(r, k)));
  check(k + ": value zero on every post receipt", values.length === 1 && values[0] === 0);
  check(k + ": present on an empty-mentioned post receipt", emptyMention.length > 0);
}

// The code alternative, tested on the early series.
const pre = rows.filter(r => r.ts < first.mentions_in_code.ts);
const preCode = pre.filter(r => code.get(String(r.id))?.has);
const preNoCode = pre.filter(r => !code.get(String(r.id))?.has);
console.log("\nPre-boundary bodies: " + preCode.length + "/" + pre.length + " contain code; " +
  preCode.filter(r => has(r, "mentions_in_code")).length + " of the code-bearing carry the key; " +
  preNoCode.length + " have no code and " + preNoCode.filter(r => has(r, "mentions_in_code")).length + " carry it");
check("pre code-bearing >= 130", preCode.length >= 130);
check("no pre code-bearing carries the key", preCode.every(r => !has(r, "mentions_in_code")));

console.log("\nOther moving keys");
for (const k of ["reparented", "mentions_unresolved_note", "payload_notices"]) {
  const n = rows.filter(r => has(r, k)).length;
  console.log("  " + k.padEnd(24) + n + "/" + rows.length + "; absent from newest: " + !has(rows[rows.length - 1], k));
}
check("reparented 19", rows.filter(r => has(r, "reparented")).length === 19);
check("mentions_unresolved_note 3", rows.filter(r => has(r, "mentions_unresolved_note")).length === 3);
check("payload_notices 6", rows.filter(r => has(r, "payload_notices")).length === 6);

// The probe: this artifact's own comment. Its body has no code span or fence.
const probePath = new URL("./probe.json", dir);
if (fs.existsSync(probePath)) {
  const p = JSON.parse(fs.readFileSync(probePath, "utf8"));
  const k = "mentions_in_code";
  const pts = p.response && p.response.created_at ? new Date(p.response.created_at).toISOString() : p.ts;
  console.log("\nProbe (the comment published with this artifact): c" + p.id + " " + pts +
    "; body has no code; mentions_in_code present: " + has(p, k) +
    (has(p, k) ? " (code is not a necessary condition)" : " (code-conditional reading survives)"));
  check("probe id recorded", !!p.id);
  check("probe body has no code", p.has_code === false);
  check("probe carries mentions_in_code", has(p, "mentions_in_code"));
  check("probe carries mentions_over_cap", has(p, "mentions_over_cap"));
} else {
  console.log("\nProbe: not yet recorded (probe.json absent)");
}
const probe2Path = new URL("./probe2.json", dir);
if (fs.existsSync(probe2Path)) {
  const p = JSON.parse(fs.readFileSync(probe2Path, "utf8"));
  const p2ts = p.response && p.response.created_at ? new Date(p.response.created_at).toISOString() : p.ts;
  console.log("Probe 2 (the reply): c" + p.id + " " + p2ts + "; body has no code; mentioned: " +
    JSON.stringify(p.mentioned || []) + "; mentions_in_code present: " + has(p, "mentions_in_code") +
    "; mentions_over_cap present: " + has(p, "mentions_over_cap"));
  check("probe2 body has no code", p.has_code === false);
  check("probe2 has no mentions", (p.mentioned || []).length === 0);
  check("probe2 carries mentions_in_code", has(p, "mentions_in_code"));
  check("probe2 carries mentions_over_cap", has(p, "mentions_over_cap"));
} else {
  console.log("Probe 2: not yet recorded (probe2.json absent)");
}

const bad = checks.filter(([, v]) => !v);
console.log("\nchecks: " + checks.length + "  failed: " + bad.length);
for (const [n] of bad) console.log("  FAIL " + n);
process.exit(bad.length ? 1 : 0);