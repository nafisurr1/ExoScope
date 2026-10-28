// Step 2: download one long-cadence quarter per star from NASA's MAST archive.
// MAST no longer lists directories, so this checks the standard quarter file
// names in time order and takes the second one that exists (usually Q2).
// Usage: node fetch.cjs [output folder, default ./fits]
const fs = require('fs');
const https = require('https');
const path = require('path');

const OUT = process.argv[2] || path.join(__dirname, 'fits');
fs.mkdirSync(OUT, { recursive: true });
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample.json'), 'utf8'));
const QUARTERS = [
  '2009131105131', '2009166043257', '2009259160929', '2009350155506', '2010078095331', '2010174085026',
  '2010265121752', '2010355172524', '2011073133259', '2011177032512', '2011271113734', '2012004120508',
  '2012088054726', '2012179063303', '2012277125453', '2013011073258', '2013098041711', '2013131215648',
];

function request(url, method) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, timeout: 90000 }, res => {
      if (method === 'HEAD') { res.resume(); return resolve({ status: res.statusCode }); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: 200, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

let done = 0, ok = 0, failed = 0;
async function one(star) {
  const id9 = String(star.kepid).padStart(9, '0');
  const out = path.join(OUT, id9 + '.fits');
  const base = `https://mast.stsci.edu/api/v0.1/Download/file?uri=mast:Kepler/url/missions/kepler/lightcurves/${id9.slice(0, 4)}/${id9}/kplr${id9}-`;
  try {
    if (!(fs.existsSync(out) && fs.statSync(out).size > 50000)) {
      const found = [];
      for (const q of QUARTERS) {
        if ((await request(base + q + '_llc.fits', 'HEAD')).status === 200) found.push(q);
        if (found.length === 2) break;
      }
      if (!found.length) throw new Error('no light curve files');
      const { body } = await request(base + found[Math.min(1, found.length - 1)] + '_llc.fits', 'GET');
      fs.writeFileSync(out, body);
    }
    ok++;
  } catch (e) {
    failed++;
    console.error(`KIC ${star.kepid}: ${e.message}`);
  }
  if (++done % 34 === 0) console.log(`  ${done}/${sample.length}`);
}

(async () => {
  const queue = [...sample];
  await Promise.all(Array.from({ length: 5 }, async () => { while (queue.length) await one(queue.shift()); }));
  console.log(`done: ${ok} files, ${failed} failed`);
})();
