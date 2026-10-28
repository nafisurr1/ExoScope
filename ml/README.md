# ExoScope — model training

Also in this folder:

- [`fold/`](fold/) — readable rules learned with FOLD-SE, a SHAP analysis, and a
  Random Forest comparison. The website reads `fold/rules.json` to explain results.
- [`benchmark/`](benchmark/) — the website's accuracy on 170 real Kepler light curves.

## `train_model.py` does not reproduce the shipped model

This is the most important thing to know before touching anything here.

`../public/model/exoscope_model.onnx` — the model the app actually loads — was
**not** produced by the `train_model.py` in this directory. They disagree on
both the algorithm and the feature count:

| | `train_model.py` | shipped `.onnx` |
|---|---|---|
| Algorithm | `GradientBoostingClassifier` | **RandomForest** |
| Estimators | 400 | **150** |
| Features | 10 | **13** |
| Clips `duty_cycle` at 0.12 | yes | no |

Evidence for the shipped model's identity, from parsing the ONNX graph:

- Graph is `Imputer → Scaler → TreeEnsembleClassifier`, exported by skl2onnx 1.20.0
- `post_transform = NONE` and every leaf weight is a multiple of `1/150` —
  that is a 150-tree RandomForest averaging votes. Gradient boosting would
  export with `post_transform = LOGISTIC` and signed log-odds leaves.
- The input tensor is `[None, 13]`.

The script that produced the shipped model is not in this repository.
**Running `train_model.py` now will produce a model the app cannot load** — the
app sends 13 features (`utils/exoplanetModel.ts:41`) and the new one would
expect 10, so `session.run` throws a shape error.

`feature_config.json` describes the *shipped* model (v3.4.1, 13 features), not
what the script produces. Note also that **nothing reads this file at runtime** —
its `threshold: 0.25` has no effect. The live cutoff is `0.5`, set as
`PLANET_CUTOFF` in `utils/exoplanetModel.ts`.

---

## The 13 features the app actually sends

Order matters and must match exactly. From `utils/exoplanetModel.ts:41`:

```
 0  period_days             from BLS
 1  transit_depth_ppm       from BLS
 2  transit_duration_hr     from BLS (duration fraction × period × 24)
 3  stellar_teff_k          FITS header TEFF,   default 5778
 4  stellar_logg            FITS header LOGG,   default 4.44
 5  stellar_radius_rsun     FITS header RADIUS, default 1.0
 6  depth_per_hr            depth_ppm / duration_hr
 7  duty_cycle              duration_hr / (period_days × 24)
 8  log_depth               log10(max(depth_ppm, 1))
 9  log_period              log10(max(period_days, 0.1))
10  log_duration            log10(max(duration_hr, 0.01))
11  depth_x_logg            depth_ppm × logg
12  period_x_srad           period_days / max(stellar_radius, 0.1)
```

The corresponding KOI catalog columns for training are `koi_period`,
`koi_depth`, `koi_duration`, `koi_steff`, `koi_slogg`, `koi_srad`, with the
remaining seven derived from those.

---

## Training set

`koi_cumulative.csv` holds 9,564 rows. The shipped model used the **7,586**
dispositioned `CONFIRMED` (2,747) or `FALSE POSITIVE` (4,839); `CANDIDATE`
rows (1,978) were excluded.

This was confirmed by comparing the ONNX `Scaler` node's offsets — which are the
training-set means — against means computed directly from this CSV:

| Feature | Scaler offset | CSV mean |
|---|---|---|
| `period_days` | 51.65589 | 51.65589 |
| `transit_duration_hr` | 5.71288 | 5.71288 |
| `duty_cycle` | 0.04789 | 0.04789 |
| `log_period` | 0.98020 | 0.98020 |

Matching to five decimals across independent computations confirms both the
feature ordering and the row selection.

---

## To reproduce the model

`train_model.py` needs, at minimum:

1. `GradientBoostingClassifier(n_estimators=400, ...)` → `RandomForestClassifier(n_estimators=150, ...)`
2. Three more derived features added: `log_duration`, `depth_x_logg`, `period_x_srad`
3. The `duty_cycle` clip at 0.12 removed (`np.minimum(..., 0.12)`)

The remaining hyperparameters (`max_depth`, `min_samples_leaf`, `random_state`)
are unknown and would have to be re-chosen. The result will not be bit-identical
to the shipped model, so re-validate before replacing it.

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python train_model.py
cp exoscope_model.onnx feature_config.json ../public/model/
```

`training_report.txt` is also stale — it reports the 10-feature gradient
boosting run (accuracy 0.8867), not the shipped model.

---

## A deeper problem worth fixing

The model is trained on NASA's **catalog** values, which were measured from the
full multi-year mission with the Kepler pipeline. At inference it receives
**BLS estimates from a single ~90-day quarter**. These are not the same
distribution.

The clearest symptom: `duty_cycle` was the highest-importance feature in
training, where it is continuous. At inference it can only take the 12 values in
`DUR_FRACS` (`utils/exoplanetFeatures.ts:69`), because duration is always a
fixed fraction of the period. The most important feature arrives quantized to a
12-point grid.

Related: every training example was already a KOI, meaning it had passed NASA's
detection pipeline. The model has never seen "a star with no transit at all", so
that input is outside its training distribution entirely. The website used to
blend in the BLS signal-to-noise ratio for that reason, but on 170 real Kepler
quarters it made the verdict worse (59.4% with the blend, 73.5% with the forest
alone), so the forest now decides by itself. See [`benchmark/`](benchmark/).

**The principled fix** is to train on BLS-derived features instead of catalog
values: run this project's own BLS over a few hundred labelled Kepler quarters
and train on those outputs. That removes the skew and would let the classifier
carry more of the decision.

---

## Deployment note

`onnxruntime-web` wants its WASM served with the right headers. If self-hosting
the runtime instead of using a CDN, add a `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*).wasm",
      "headers": [
        { "key": "Content-Type", "value": "application/wasm" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

The COEP/COOP pair is required for multi-threaded WASM. The app currently loads
the runtime from a **version-pinned** CDN URL
(`utils/exoplanetModel.ts:7`) — keep that pin in sync with the
`onnxruntime-web` version in `package.json`. An unpinned URL previously caused
the classifier to return `[-p, +p]` instead of `[p0, p1]`.
