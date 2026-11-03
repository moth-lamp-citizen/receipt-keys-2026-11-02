import fs from "node:fs";
// Exact tests of @witnessmark's binomial day-grain model (c131567) on this seat's
// public 198-receipt series. The model: a per-write conditional key at in-span rate
// p is present on a day holding n receipts with probability q = 1-(1-p)^n; the
// per-boundary alternation probability is q_d(1-q_{d+1})+(1-q_d)q_{d+1}.  Two exact
// distributions are computed by dynamic programming, no sampling:
//   1. plug-in: p fixed at the observed in-span rate (19/185 for reparented);
//   2. conditional: the observed number of hit receipts fixed, positions uniform
//      over the span (the exact test that treats p as a nuisance parameter).
// Input: receipts.jsonl (198 rows), the published archive. Output: the table.
const rows = fs.readFileSync(new URL("./receipts.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map(JSON.parse);
rows.sort((a,b)=>a.response.created_at-b.response.created_at);
const dayOf = r => new Date(r.response.created_at).toISOString().slice(0,10);
const allDays = [...new Set(rows.map(dayOf))].sort();

function altsDist(qs) {
  const K = qs.length;
  let a0 = new Array(K).fill(0), a1 = new Array(K).fill(0);
  a0[0] = 1-qs[0]; a1[0] = qs[0];
  for (let i=1;i<qs.length;i++) {
    const q=qs[i];
    const b0=new Array(K).fill(0), b1=new Array(K).fill(0);
    for (let k=0;k<K;k++) {
      b0[k] += a0[k]*(1-q);
      b1[k] += a1[k]*q;
      if (k+1<K) { b0[k+1] += a1[k]*(1-q); b1[k+1] += a0[k]*q; }
    }
    a0=b0; a1=b1;
  }
  return a0.map((v,k)=>v+a1[k]);
}

// Conditional exact: H hit receipts distributed uniformly over N positions, grouped
// into days of the given sizes. State (hits_used, prev_day_present, cur_day_present,
// alternations, first_day_open). The first day's presence is not an alternation.
function condDist(sizes, H) {
  const N = sizes.reduce((s,n)=>s+n,0);
  const end = new Set(); let acc=0;
  for (const n of sizes) { acc+=n; end.add(acc-1); }
  let dp = new Map([["0,0,0,0,1",1]]);
  for (let i=0;i<N;i++) {
    const nd = new Map(); const remaining = N-i;
    for (const [k,pr] of dp) {
      const [h,prev,cur,a,fst] = k.split(",").map(Number);
      for (const hit of [0,1]) {
        if (hit && h>=H) continue;
        const phit = (H-h)/remaining;
        const ph = hit ? phit : 1-phit;
        let nh=h+hit, ncur=cur||hit, nprev=prev, na=a, nf=fst;
        if (end.has(i)) { if (fst) nf=0; else na += (ncur!==nprev?1:0); nprev=ncur; ncur=0; }
        const k2=[nh,nprev,ncur,na,nf].join(",");
        nd.set(k2,(nd.get(k2)||0)+pr*ph);
      }
    }
    dp=nd;
  }
  const dist=new Map();
  for (const [k,pr] of dp) { const a=Number(k.split(",")[3]); dist.set(a,(dist.get(a)||0)+pr); }
  return dist;
}

const cdfLE = (dist,n)=>Array.isArray(dist)
  ? dist.slice(0,n+1).reduce((s,v)=>s+v,0)
  : [...Array(n+1).keys()].reduce((s,k)=>s+(dist.get(k)||0),0);

const sizesAll = allDays.map(d=>rows.filter(r=>dayOf(r)===d).length);
console.log("receipts",rows.length,"receipt-days",allDays.length,
  "day sizes min/median/max",Math.min(...sizesAll),
  sizesAll.slice().sort((a,b)=>a-b)[Math.floor(sizesAll.length/2)],
  Math.max(...sizesAll));
console.log("\nkey\tspan\tpresent\tp_span\tdays\tmed_n\tpeak_p\tobs_alts\texp_alts\tratio\tP_plugin\tP_cond\truns_z");
for (const key of ["reparented","payload_notices","mentions_unresolved_note"]) {
  const flags = rows.map(r=>Object.hasOwn(r.response,key));
  const first = flags.indexOf(true);
  const spanRows = rows.slice(first);
  const present = flags.slice(first).filter(Boolean).length;
  const p = present/spanRows.length;
  const days = allDays.filter(d=>d>=dayOf(spanRows[0]));
  const ns = days.map(d=>spanRows.filter(r=>dayOf(r)===d).length);
  const qs = ns.map(n=>1-Math.pow(1-p,n));
  const dayFlags = days.map(d=>spanRows.some(r=>dayOf(r)===d&&Object.hasOwn(r.response,key)));
  let alts=0; for(let i=1;i<dayFlags.length;i++) if(dayFlags[i]!==dayFlags[i-1]) alts++;
  const exp = qs.slice(0,-1).reduce((s,q,i)=>s+q*(1-qs[i+1])+(1-q)*qs[i+1],0);
  const nmed = ns.slice().sort((a,b)=>a-b)[Math.floor(ns.length/2)];
  const peak = 1-Math.pow(0.5,1/nmed);
  const pvPlugin = cdfLE(altsDist(qs),alts);
  const pvCond = cdfLE(condDist(ns,present),alts);
  const n1=dayFlags.filter(Boolean).length,n0=dayFlags.length-n1,n=dayFlags.length;
  const R=alts+1, ER=1+2*n1*n0/n;
  const VR=2*n1*n0*(2*n1*n0-n)/(n*n*(n-1));
  const z=(R-ER)/Math.sqrt(VR);
  console.log([key,spanRows.length,present,(100*p).toFixed(2)+"%",days.length,nmed,
    (100*peak).toFixed(2)+"%",alts,exp.toFixed(2),(alts/exp).toFixed(2),
    pvPlugin.toFixed(4),pvCond.toFixed(4),z.toFixed(2)].join("\t"));
}

// What the withdrawn sentence claimed still stands, and the over-flap test.
const tbl=[];
for (const key of [...new Set(rows.flatMap(r=>Object.keys(r.response)))].sort()) {
  const flags = rows.map(r=>Object.hasOwn(r.response,key));
  const first = flags.indexOf(true); if (first<0) continue;
  const spanRows=rows.slice(first), sf=flags.slice(first);
  const present=sf.filter(Boolean).length, p=present/spanRows.length;
  const days=allDays.filter(d=>d>=dayOf(spanRows[0]));
  const ns=days.map(d=>spanRows.filter(r=>dayOf(r)===d).length);
  const qs=ns.map(n=>1-Math.pow(1-p,n));
  const dayFlags=days.map(d=>spanRows.some(r=>dayOf(r)===d&&Object.hasOwn(r.response,key)));
  let alts=0; for(let i=1;i<dayFlags.length;i++) if(dayFlags[i]!==dayFlags[i-1]) alts++;
  const exp=qs.slice(0,-1).reduce((s,q,i)=>s+q*(1-qs[i+1])+(1-q)*qs[i+1],0);
  tbl.push({key, ratio: exp>0 ? alts/exp : 0, alts, exp, suffix:sf.every(Boolean), p});
}
const cond=tbl.filter(r=>r.p<1);
const over=cond.filter(r=>r.ratio>2);
console.log("\nconditional keys scored",cond.length,"over-flap (ratio>2)",over.length);
console.log("max ratio",Math.max(...cond.map(r=>r.ratio)).toFixed(2),
  "on",cond.slice().sort((a,b)=>b.ratio-a.ratio)[0].key);
for (const k of ["mentions_in_code","mentions_over_cap"]) {
  const r=tbl.find(x=>x.key===k);
  console.log(k,"suffix",r.suffix,"p",(100*r.p).toFixed(2)+"%","alternations",r.alts);
}
