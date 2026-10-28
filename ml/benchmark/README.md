# Real-file benchmark

How well does the website do on real Kepler data, measured the same way it
runs in the browser? These scripts answer that on a fixed set of 170 stars:
85 confirmed planets and 85 false positives from NASA's KOI table, one
long-cadence quarter (about 90 days) of data each.

## Results

| Decision | Accuracy | Planets found | False alarms |
|---|---|---|---|
| **Website now:** Random Forest, cut at 50% | **73.5%** | 67 / 85 | 27 / 85 |
| Website before: 0.6 × signal strength + 0.4 × forest, cut at 0.45 | 59.4% | 65 / 85 | 49 / 85 |
| FOLD-SE rules on the website's measurements | 65.9% | 77 / 85 | 50 / 85 |

The forest and the rules disagree on 43 of the 170 files. The forest is right
on 28 of those, which is why the website shows the forest's answer and uses
the rules to explain it.

Signal strength (BLS SNR) separates planets from false positives worse than a
coin flip (AUC 0.413, against 0.813 for the forest): eclipsing binaries make
deeper dips than planets, so they score as stronger signals.

The rules are less accurate here than on NASA's catalog values (84.8%, see
[`../fold/`](../fold/)). The website measures one quarter of data; NASA's
catalog combines the whole mission.

## Running it

From the repository root, with Node 18+ and Python 3 (`numpy`, `onnxruntime`):

```bash
node ml/benchmark/sample.cjs
node ml/benchmark/fetch.cjs
node_modules/.bin/esbuild ml/benchmark/measure.ts --bundle --platform=node --outfile=ml/benchmark/measure.cjs
node ml/benchmark/measure.cjs
python3 ml/benchmark/score.py
```

| Step | What it does |
|---|---|
| `sample.cjs` | Picks the 170 stars from `ml/koi_cumulative.csv`. Only stars whose KOIs all share one label are eligible. The seed is fixed, so the pick is always the same; it is saved in `sample.json`. |
| `fetch.cjs` | Downloads one quarter per star from NASA's MAST archive (about 67 MB) into `fits/`. It takes the second quarter on file, usually Q2. Already-downloaded files are skipped. |
| `measure.ts` | Runs the website's own `parseFitsFile` and `extractFeatures` on each file. |
| `score.py` | Runs the shipped ONNX model and the rules in `ml/fold/rules.json`, then prints the table above. |

`fits/`, `features.json` and `measure.cjs` are not committed.
