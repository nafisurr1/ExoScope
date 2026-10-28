# ExoScope

A browser-based tool for exploring NASA Kepler light curve data. Load a `.fits`
file to plot the light curve, search it for a repeating transit dip, and get a
classifier's read on whether it looks like a planet, along with the readable
rules behind that call. Nothing is uploaded: the file is parsed and analysed
entirely in your browser.

Live at **<https://exoscope-rho.vercel.app>**.

**Built by Shuban Langadi & Nafisur Rahman** — ISTA Period 4

For how the code works internally, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## What it does

- Parses Kepler `.fits` binary tables in the browser, with no backend
- Displays FITS header metadata — object, telescope, instrument, observation date
- Plots flux vs. time, LTTB-downsampled to 3,000 points, with a zoom brush
- Toggles PDCSAP (corrected) vs. SAP (raw) flux, normalized vs. raw counts
- Runs a **Box Least Squares** search for a repeating transit dip
- Gives a planet / not-a-planet verdict and a chance of planet from a
  **Random Forest** trained on NASA KOI data
- Runs a **rule check** with three readable rules learned by
  [FOLD-SE](ml/fold/), and lists every condition with the measured value, the
  cutoff, and whether it holds
- Says when the two disagree, and when the file lacked the star's temperature,
  size or gravity so the Sun's values were assumed

---

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 19 + TypeScript |
| Build | Vite 6 |
| Charts | Recharts |
| Icons | Lucide React |
| Styling | Tailwind (via CDN) |
| ML inference | onnxruntime-web (WASM) |
| Model training | scikit-learn → ONNX via skl2onnx |
| Explainable rules | FOLD-SE (rule learning), s(CASP) (justifications), SHAP (feature attribution) |

---

## Running locally

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Two example files are on the home page — a planet candidate (KIC 3115833,
KOI-797.01) and a false positive (KIC 11619964, KOI-7466.01, an eclipsing
binary) — so you can try it without downloading anything. Both are unedited
quarter-2 files from MAST, in `public/examples/`.

> **Note:** the NASA archive search on the home page calls `/api/mast`, which is
> a Vercel serverless function, so it only works on the deployed site. Under
> `npm run dev` it returns HTTP 500. Use the example buttons or a local file
> instead. See [ARCHITECTURE.md](ARCHITECTURE.md#known-issues).

### Production build

```bash
npm run build
```

Output goes to `dist/`.

---

## Getting your own `.fits` files

Kepler light curves are free from NASA's MAST archive:

1. Go to [archive.stsci.edu/kepler/data_search](https://archive.stsci.edu/kepler/data_search/search.php)
2. Search a KIC ID (e.g. `2306756`, the Kepler-18 host)
3. Download a file ending in `llc.fits` (long cadence)
4. Drag it into ExoScope

Or fetch directly through MAST's download service:

```bash
curl -o kplr002445129-2009259160929_llc.fits "https://mast.stsci.edu/api/v0.1/Download/file?uri=mast:Kepler/url/missions/kepler/lightcurves/0024/002445129/kplr002445129-2009259160929_llc.fits"
```

Files follow the pattern `kplr{9-digit KIC}-{timestamp}_llc.fits`.

---

## How the detection works

1. The FITS binary table is parsed for the `TIME` and `PDCSAP_FLUX` columns.
2. Flux is normalized and **detrended** with a 0.75-day sliding median, which
   removes slow stellar variability while preserving a sharp transit dip.
3. **BLS** searches for a repeating dip. Each candidate period folds the light
   curve into 400 phase bins once, then every duration and epoch is scored
   against those bins via prefix sums. A coarse scan of 500 periods locates the
   neighbourhood, a fine pass pins the period down, and a sub-harmonic check
   rejects 2:1 and 3:1 aliases. Yields period, depth, duration and a
   signal-to-noise ratio in ~100 ms.
4. Thirteen features — the BLS results, stellar parameters from the FITS header,
   and derived ratios — are fed to a 150-tree RandomForest exported to ONNX.
   A chance of planet of 50% or more is a planet.
5. The **rule check** runs the FOLD-SE rules in
   [`ml/fold/rules.json`](ml/fold/rules.json) on the same measurements and
   records every condition, which the result page lists.

**Training data:** 7,586 Kepler Objects of Interest from the NASA KOI Cumulative
Catalog — 2,747 `CONFIRMED` and 4,839 `FALSE POSITIVE`. `CANDIDATE` entries are
excluded.

---

## How accurate it is

Measured on 170 real Kepler light curves (85 confirmed planets, 85 false
positives, one quarter each), run through the website's own code. The scripts
are in [`ml/benchmark/`](ml/benchmark/).

| Decision | Accuracy |
|---|---|
| Website: Random Forest, cut at 50% | **73.5%** |
| Earlier website: 0.6 × signal strength + 0.4 × forest | 59.4% |
| FOLD-SE rules on the website's measurements | 65.9% |

On NASA's own catalog values the same approaches do much better: a forest
built like the website's (same 13 features, 150 trees) scores 87.7% in 5-fold
cross-validation, and the three FOLD-SE rules score 84.8% on 1,518 held-out
objects (see [`ml/fold/`](ml/fold/)). The gap comes from measuring one 90-day
quarter in the browser instead of using NASA's full-mission values.

---

## Status and limitations

This is a student project with known, documented problems. Be skeptical of its
output.

- **About one file in four is called wrong.** See the accuracy table above.
- **Some false positives look like planets to everything the site measures.**
  For KIC 2445129 the site finds NASA's 10.32-day dip, and both the forest
  (92%) and the rules call it a planet. NASA rejected it for a secondary
  eclipse and a shifted light centre, which the site does not check.
- **The classifier is applied outside its training distribution.** It learned
  from NASA catalog values measured across the full mission; it receives
  single-quarter BLS estimates. It also only ever saw objects that had already
  passed NASA's detection pipeline. The same is true of the rules.
- **Analysis blocks the tab for ~180 ms.** Short enough not to notice, but the
  search still runs on the main thread rather than in a Web Worker.
- Only tested on Kepler long-cadence (`llc`) files. TESS may work; untested.
- Single-quarter data cannot show planets whose orbital period exceeds the
  ~90-day observation window.

---

## References

- FITS standard — [fits.gsfc.nasa.gov](https://fits.gsfc.nasa.gov/fits_documentation.html)
- Kepler mission data — [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/docs/KeplerMission.html)
- MAST Kepler archive — [archive.stsci.edu](https://archive.stsci.edu/pub/kepler/lightcurves)
- Kovács, Zucker & Mazeh (2002) — *A box-fitting algorithm in the search for periodic transits*, A&A 391, 369
- Winn (2010) — *Transits and Occultations*, in *Exoplanets* (transit duration relation)
- Steinarsson (2013) — *Downsampling Time Series for Visual Representation*, University of Iceland (LTTB)
- Pedregosa et al. (2011) — *Scikit-learn: Machine Learning in Python*, JMLR 12, 2825–2830
- Wang & Gupta — *FOLD-SE: An Efficient Rule-Based Machine Learning Algorithm with Scalable Explainability*, PADL 2024 ([arXiv:2208.07912](https://arxiv.org/abs/2208.07912))
- Arias, Carro, Salazar, Marple & Gupta (2018) — *Constraint Answer Set Programming without Grounding*, TPLP 18 (s(CASP))
- Lundberg & Lee (2017) — *A Unified Approach to Interpreting Model Predictions*, NeurIPS (SHAP)
- Thompson et al. (2018) — *Planetary Candidates Observed by Kepler. VIII*, ApJS 235, 38 (Kepler DR25 catalog)
- Christiansen et al. (2025) — *The NASA Exoplanet Archive and Exoplanet Follow-up Observing Program: Data, Tools, and Usage*, PSJ 6, 186

---

## Acknowledgments

This research has made use of the NASA Exoplanet Archive, which is operated by
the California Institute of Technology, under contract with the National
Aeronautics and Space Administration under the Exoplanet Exploration Program.
