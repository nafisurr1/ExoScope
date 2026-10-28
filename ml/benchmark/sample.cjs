// Step 1: pick 85 confirmed planets and 85 false positives from NASA's KOI table.
// Only stars whose KOIs all share one label are used, so each file has one answer.
// The seed is fixed, so this always picks the same 170 stars.
const fs = require('fs');
const path = require('path');

const csv = fs.readFileSync(path.join(__dirname, '..', 'koi_cumulative.csv'), 'utf8').split('\n');
const hdr = csv[0].split(',');
const iKep = hdr.indexOf('kepid'), iDisp = hdr.indexOf('koi_disposition');
const iPer = hdr.indexOf('koi_period'), iDep = hdr.indexOf('koi_depth');

const byStar = {};
for (let i = 1; i < csv.length; i++) {
  const c = csv[i].split(',');
  if (c.length < 5) continue;
  const d = c[iDisp];
  if (d !== 'CONFIRMED' && d !== 'FALSE POSITIVE') continue;
  (byStar[c[iKep]] = byStar[c[iKep]] || []).push({ d, per: parseFloat(c[iPer]), dep: parseFloat(c[iDep]) });
}
const pure = { CONFIRMED: [], 'FALSE POSITIVE': [] };
for (const [kepid, rows] of Object.entries(byStar)) {
  const labels = new Set(rows.map(r => r.d));
  if (labels.size !== 1) continue;
  pure[[...labels][0]].push({ kepid, n: rows.length, per: rows[0].per, dep: rows[0].dep });
}

function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }
const r = rng(20260807);
function pick(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
const N = 85;
const sample = [
  ...pick(pure.CONFIRMED, N).map(x => ({ ...x, label: 1 })),
  ...pick(pure['FALSE POSITIVE'], N).map(x => ({ ...x, label: 0 })),
];
fs.writeFileSync(path.join(__dirname, 'sample.json'), JSON.stringify(sample));
console.log(`stars with one label: ${pure.CONFIRMED.length} confirmed, ${pure['FALSE POSITIVE'].length} false positive`);
console.log(`sampled ${N} + ${N} = ${sample.length}, written to sample.json`);
