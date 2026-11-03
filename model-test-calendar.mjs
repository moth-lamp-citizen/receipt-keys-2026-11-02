import fs from "node:fs";
// Calendar-day version of model-test.mjs: a nightly key-set diff counts days with no
// receipts as absent, so this run includes them (q_d = 0) instead of dropping them.
// Input: receipts.jsonl. Output: observed vs expected alternations and the exact
// conditional p-value, for the same three conditional keys.
const rows = fs.readFileSync(new URL("./receipts.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map(JSON.parse);
rows.sort((a,b)=>a.response.created_at-b.response.created_at);
const dayOf = r => new Date(r.response.created_at).toISOString().slice(0,10);
const allDays = [...new Set(rows.map(dayOf))].sort();
const firstDay = allDays[0], lastDay = allDays[allDays.length-1];
const calDays = [];
for (let d = new Date(firstDay+"T00:00:00Z"); d <= new Date(lastDay+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+1))
  calDays.push(d.toISOString().slice(0,10));
console.log("receipt-days",allDays.length,"calendar days",calDays.length,
  "empty",calDays.filter(d=>!allDays.includes(d)).join(","));

function comb(n,k){ if(k<0||k>n) return 0; let r=1; for(let i=0;i<k;i++) r=r*(n-i)/(i+1); return r; }

for (const key of ["reparented","payload_notices","mentions_unresolved_note"]) {
  const flags = rows.map(r=>Object.hasOwn(r.response,key));
  const first = flags.indexOf(true);
  const spanRows = rows.slice(first);
  const firstSpanDay = dayOf(spanRows[0]);
  const present = flags.slice(first).filter(Boolean).length;
  const p = present/spanRows.length;
  const days = calDays.filter(d=>d>=firstSpanDay);
  const ns = days.map(d=>spanRows.filter(r=>dayOf(r)===d).length);
  const qs = ns.map(n=>1-Math.pow(1-p,n));
  const presentDay = days.map(d=>spanRows.some(r=>dayOf(r)===d&&Object.hasOwn(r.response,key)));
  let alts=0; for(let i=1;i<presentDay.length;i++) if(presentDay[i]!==presentDay[i-1]) alts++;
  const exp = qs.slice(0,-1).reduce((s,q,i)=>s+q*(1-qs[i+1])+(1-q)*qs[i+1],0);
  const H=present, N=spanRows.length;
  // exact conditional: H hits uniform over the N receipt positions, grouped by calendar day.
  let dp = new Map([["0,0,0,1",1]]); // hits, prev_present, alts, first_day
  let rem=N;
  for (let di=0; di<ns.length; di++) {
    const n=ns[di]; const nd=new Map();
    for (const [k,pr] of dp) {
      const [h,prev,a,fst]=k.split(",").map(Number);
      for (let hit=0; hit<=Math.min(n,H-h); hit++) {
        const prob = comb(n,hit)*comb(rem-n,H-h-hit)/comb(rem,H-h);
        if (!isFinite(prob) || prob===0) continue;
        const pres = hit>0?1:0;
        let na=a, nf=fst;
        if (fst) nf=0; else na += (pres!==prev?1:0);
        const k2=[h+hit,pres,na,nf].join(",");
        nd.set(k2,(nd.get(k2)||0)+pr*prob);
      }
    }
    dp=nd; rem-=n;
  }
  const dist=new Map();
  for (const [k,pr] of dp) { const a=Number(k.split(",")[2]); dist.set(a,(dist.get(a)||0)+pr); }
  let cdf=0; for(let a=0;a<=alts;a++) cdf+=dist.get(a)||0;
  const mean=[...dist].reduce((s,[a,pr])=>s+a*pr,0);
  console.log([key,"cal_days",days.length,"empty_in_span",ns.filter(n=>n===0).length,
    "p_span",(100*p).toFixed(2)+"%","alts",alts,"exp",exp.toFixed(2),
    "cond_mean",mean.toFixed(2),"P_exact",cdf.toFixed(4)].join("\t"));
}
