import fs from "node:fs";
// model-test-v2.mjs — the corrected conditional test for the span-start bias in
// model-test.mjs, plus the aggregate peak of the day-size curve.
//
// Why v2 exists (2026-11-06): every key's span begins at the first receipt that
// carries it, so position 0 of the span is a HIT BY SELECTION. model-test.mjs
// distributes all H hits uniformly over the N positions, which gives position 0 a
// H/N chance of being a hit when it is certain. That makes P_exact too small. The
// corrected null fixes position 0 and distributes the other H-1 hits uniformly
// over the remaining N-1 positions.
//
// It also prints the aggregate peak: the per-day peak 1-0.5^(1/n_d) is not a
// single number when the day sizes differ. A(p) = sum_d [q_d(1-q_{d+1}) +
// q_{d+1}(1-q_d)], with q_d = 1-(1-p)^{n_d}, is one curve for a fixed multiset of
// day sizes; p_agg is its maximizer on this corpus.
//
// usage:
//   node model-test-v2.mjs             receipt-day table
//   node model-test-v2.mjs --calendar  same test including empty calendar days
//   node model-test-v2.mjs --selftest  brute-force check of the fixed-first DP
//
// Input: receipts.jsonl (198 rows), the published archive. No sampling.

const rows = fs.readFileSync(new URL("./receipts.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map(JSON.parse);
rows.sort((a,b)=>a.response.created_at-b.response.created_at);
const dayOf = r => new Date(r.response.created_at).toISOString().slice(0,10);
const allDays = [...new Set(rows.map(dayOf))].sort();
const calendar = process.argv.includes("--calendar");

// Binomial coefficients. C(n,k) here is exact for the n <= 500 this file needs.
const C = (()=>{const N=500;const t=[];for(let n=0;n<=N;n++){t[n]=new Array(n+1).fill(0);t[n][0]=t[n][n]=1;for(let k=1;k<n;k++)t[n][k]=t[n-1][k-1]+t[n-1][k];}return (n,k)=>(k<0||k>n)?0:t[n][k];})();

function expectedAlts(ns,p){
  const qs = ns.map(n=>1-Math.pow(1-p,n));
  return qs.slice(0,-1).reduce((s,q,i)=>s+q*(1-qs[i+1])+(1-q)*qs[i+1],0);
}

// Conditional null with position 0 fixed as a hit. Day 0 loses its first position;
// the other H-1 hits are uniform over the remaining N-1 positions. Returns the
// exact distribution of day-flag alternations.
function condFixedFirst(ns,H){
  const N = ns.reduce((a,b)=>a+b,0);
  const sizes = ns.slice(); sizes[0] -= 1;
  let dp = new Map([["0,0,0",1]]);   // "hits_used,prev_day_present,alternations" -> assignments
  for (let d=0; d<sizes.length; d++){
    const sz = sizes[d], nd = new Map();
    for (const [k,w] of dp){
      const [h,prev,a] = k.split(",").map(Number);
      for (let x=0; x<=Math.min(sz,H-1-h); x++){
        const present = d===0 ? true : x>0;
        const na = d===0 ? 0 : a + (present !== (prev===1) ? 1 : 0);
        const kk = [h+x, present?1:0, na].join(",");
        nd.set(kk,(nd.get(kk)||0) + w*C(sz,x));
      }
    }
    dp = nd;
  }
  const norm = C(N-1,H-1), out = new Map();
  for (const [k,w] of dp){
    const [h,,a] = k.split(",").map(Number);
    if (h !== H-1) continue;
    out.set(a,(out.get(a)||0) + w/norm);
  }
  return out;
}

// The published null: all H hits uniform over the N positions (position 0 not fixed).
// Day-level DP over hypergeometric weights, so zero-size days are real boundaries.
function condUnfixed(ns,H){
  const N = ns.reduce((a,b)=>a+b,0);
  let dp = new Map([["0,0,0",1]]); // hits_used,prev_present,alternations -> assignments
  for (let d=0; d<ns.length; d++){
    const sz = ns[d], nd = new Map();
    for (const [k,w] of dp){
      const [h,prev,a] = k.split(",").map(Number);
      for (let x=0; x<=Math.min(sz,H-h); x++){
        const present = x>0;
        const na = d===0 ? 0 : a + (present !== (prev===1) ? 1 : 0);
        const kk=[h+x,present?1:0,na].join(",");
        nd.set(kk,(nd.get(kk)||0)+w*C(sz,x));
      }
    }
    dp = nd;
  }
  const norm = C(N,H), out = new Map();
  for (const [k,w] of dp){
    const [h,,a] = k.split(",").map(Number);
    if (h !== H) continue;
    out.set(a,(out.get(a)||0)+w/norm);
  }
  return out;
}

// Plug-in null: p fixed at the observed rate, days independent.
function altsDist(qs){
  const K=qs.length;
  let a0=new Array(K).fill(0), a1=new Array(K).fill(0);
  a0[0]=1-qs[0]; a1[0]=qs[0];
  for (let i=1;i<qs.length;i++){
    const q=qs[i], b0=new Array(K).fill(0), b1=new Array(K).fill(0);
    for (let k=0;k<K;k++){
      b0[k]+=a0[k]*(1-q);
      b1[k]+=a1[k]*q;
      if (k+1<K){ b0[k+1]+=a1[k]*(1-q); b1[k+1]+=a0[k]*q; }
    }
    a0=b0; a1=b1;
  }
  return a0.map((v,k)=>v+a1[k]);
}
const cdfLE = (dist,n)=>Array.isArray(dist)
  ? dist.slice(0,n+1).reduce((s,v)=>s+v,0)
  : [...Array(n+1).keys()].reduce((s,k)=>s+(dist.get(k)||0),0);

// Exact check of both conditional nulls against exhaustive subset enumeration on
// small inputs. The fixed-first cases include an empty day in the middle, which is
// the calendar-cut case; the unfixed cases check the null that produced P_old.
function selftest(){
  function brute(ns,H,fixed){
    const N = ns.reduce((a,b)=>a+b,0), day=[]; let d=0;
    for (const n of ns){ for (let i=0;i<n;i++) day.push(d); d++; }
    let tot=0; const out=new Map();
    (function rec(i,left,hits){
      if (i===N){
        if (left!==0) return;
        const flags=Array(ns.length).fill(false);
        if (fixed) flags[0]=true; // position 0 fixed
        for (const p of hits) flags[day[p]]=true;
        let a=0; for (let k=1;k<flags.length;k++) if (flags[k]!==flags[k-1]) a++;
        out.set(a,(out.get(a)||0)+1); tot++; return;
      }
      rec(i+1,left,hits);
      if (left>0){ hits.push(i); rec(i+1,left-1,hits); hits.pop(); }
    })(fixed?1:0, fixed?H-1:H, []);
    for (const [k,v] of out) out.set(k,v/tot);
    return out;
  }
  function check(label, distFn, cases, fixed){
    let fail=0;
    for (const [ns,H] of cases){
      const a=distFn(ns,H), b=brute(ns,H,fixed);
      const keys=[...new Set([...a.keys(),...b.keys()])].sort((x,y)=>x-y);
      for (const k of keys){
        if (Math.abs((a.get(k)||0)-(b.get(k)||0)) > 1e-12){
          console.log("FAIL", label, JSON.stringify(ns), H, k, a.get(k), b.get(k)); fail++;
        }
      }
    }
    return fail;
  }
  const fixedCases = [
    [[3,2,2],4], [[4,3,1],3], [[2,2,2],2], [[5,1,1],3], [[1,4,2,2],4], [[2,0,3],3]
  ];
  const unfixedCases = [
    [[3,2,2],4], [[2,0,3],3], [[1,4,2,2],4]
  ];
  const fail = check("fixed-first", condFixedFirst, fixedCases, true)
             + check("unfixed", condUnfixed, unfixedCases, false);
  console.log("selftest:", fixedCases.length, "fixed-first +", unfixedCases.length,
    "unfixed cases,", fail, "failed");
  process.exit(fail?1:0);
}
if (process.argv.includes("--selftest")) selftest();

// Day list. --calendar includes the empty days between the first hit and the last receipt.
function daysFor(spanRows){
  if (!calendar) return allDays.filter(d=>d>=dayOf(spanRows[0]));
  const a = dayOf(spanRows[0]), b = dayOf(rows[rows.length-1]);
  const days = [];
  for (let t=new Date(a+"T00:00:00Z"); t<=new Date(b+"T00:00:00Z"); t=new Date(t.getTime()+86400000))
    days.push(t.toISOString().slice(0,10));
  return days;
}

console.log("cut", calendar ? "calendar" : "receipt", "| receipts", rows.length,
  "| receipt-days", allDays.length);
console.log("\nkey\tspan\tpresent\tp\tdays\tmed_n\tpeak_med\tp_agg\talts\texp\tP_fixed0\tP_old\tP_plugin");
for (const key of ["reparented","payload_notices","mentions_unresolved_note"]){
  const flags = rows.map(r=>Object.hasOwn(r.response,key));
  const first = flags.indexOf(true);
  const spanRows = rows.slice(first), sf = flags.slice(first);
  const present = sf.filter(Boolean).length;
  const p = present/spanRows.length;
  const days = daysFor(spanRows);
  const ns = days.map(d=>spanRows.filter(r=>dayOf(r)===d).length);
  const dayFlags = days.map(d=>spanRows.some(r=>dayOf(r)===d&&Object.hasOwn(r.response,key)));
  let alts=0; for (let i=1;i<dayFlags.length;i++) if (dayFlags[i]!==dayFlags[i-1]) alts++;
  const exp = expectedAlts(ns,p);
  const pFixed = cdfLE(condFixedFirst(ns,present),alts);
  const pOld = cdfLE(condUnfixed(ns,present),alts);
  const qs = ns.map(n=>1-Math.pow(1-p,n));
  const pPlugin = cdfLE(altsDist(qs),alts);
  const medN = ns.slice().sort((a,b)=>a-b)[Math.floor(ns.length/2)];
  const peakMed = 1-Math.pow(0.5,1/medN);
  let best={p:0,v:-1};
  for (let i=1;i<100000;i++){const q=i/100000, v=expectedAlts(ns,q); if(v>best.v) best={p:q,v};}
  console.log([key,spanRows.length,present,(100*p).toFixed(3)+"%",days.length,medN,
    (100*peakMed).toFixed(2)+"%",(100*best.p).toFixed(3)+"%",alts,exp.toFixed(2),
    pFixed.toFixed(4),pOld.toFixed(4),pPlugin.toFixed(4)].join("\t"));
}
