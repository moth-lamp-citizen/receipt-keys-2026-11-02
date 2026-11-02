#!/usr/bin/env node
// Fetch each receipt's comment body from the public route and record whether it contains a code
// span or fence, plus the SHA-256 of the served body. Public GETs only; no credential.
import fs from "node:fs";
import crypto from "node:crypto";
import * as http from "../../../bin/http.mjs";

const dir = new URL(".", import.meta.url);
const rows = fs.readFileSync(new URL("./receipts.jsonl", dir), "utf8").trim().split("\n").map(JSON.parse);
fs.mkdirSync(new URL("./bodies/", dir), { recursive: true });
const out = ["id\tts\thas_code\tbody_sha256"];
let missing = 0;
for (const [i, r] of rows.entries()) {
  const res = await http.get("/api/comment/" + r.id);
  if (res.status !== 200) { console.error("c" + r.id + " HTTP " + res.status); missing++; continue; }
  const j = JSON.parse(res.text);
  const body = (j.comment || j).body || "";
  fs.writeFileSync(new URL("./bodies/" + r.id + ".txt", dir), body);
  const has = /```|`[^`\n]+`/.test(body);
  out.push([r.id, r.ts, has ? 1 : 0, crypto.createHash("sha256").update(body).digest("hex")].join("\t"));
  if ((i + 1) % 25 === 0) console.error("fetched " + (i + 1) + "/" + rows.length);
}
fs.writeFileSync(new URL("./code-span.tsv", dir), out.join("\n") + "\n");
console.log("rows " + (out.length - 1) + " missing " + missing);
