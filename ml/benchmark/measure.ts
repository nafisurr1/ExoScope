// Step 3: run the website's own parsing and feature code on every file.
// Bundle and run from the repo root:
//   node_modules/.bin/esbuild ml/benchmark/measure.ts --bundle --platform=node --outfile=ml/benchmark/measure.cjs
//   node ml/benchmark/measure.cjs [fits folder]
import * as fs from 'fs';
import * as path from 'path';
import { parseFitsFile } from '../../utils/fitsParser';
import { extractFeatures } from '../../utils/exoplanetFeatures';

const HERE = __dirname;
const DIR = process.argv[2] || path.join(HERE, 'fits');
const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'sample.json'), 'utf8'));

(async () => {
  const out: object[] = [];
  let skipped = 0;
  for (const star of sample) {
    try {
      const buf = fs.readFileSync(path.join(DIR, String(star.kepid).padStart(9, '0') + '.fits'));
      const parsed = await parseFitsFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      const f = extractFeatures(parsed);
      if (!f) { skipped++; continue; }
      out.push({ kepid: star.kepid, label: star.label, features: f });
    } catch {
      skipped++;
    }
  }
  fs.writeFileSync(path.join(HERE, 'features.json'), JSON.stringify(out));
  console.log(`measured ${out.length} files, skipped ${skipped}; written to features.json`);
})();
