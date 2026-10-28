# Explainable rules: FOLD-SE, SHAP and s(CASP)

The website's Random Forest is accurate but has 74,299 decision points spread
over 150 trees, so nobody can read why it decided anything. This folder learns
a handful of readable rules from the same NASA data with
[FOLD-SE](https://arxiv.org/abs/2208.07912), checks which measurements the
forest relies on with [SHAP](https://github.com/shap/shap), and compares the
two. The website uses the rules (`rules.json`) to explain each result.

## The data

`prepare_data.py` reads NASA's KOI table (`../koi_cumulative.csv`), keeps the
7,586 objects NASA has decided on (2,747 confirmed planets, 4,839 false
positives), shuffles them with a fixed seed, and splits them 80/20 into
`train.csv` (6,068) and `test.csv` (1,518). Both halves are 36.2% planets. The
catalog is sorted, so without the shuffle the test set would be almost all
false positives.

Eight measurements per object:

| Measurement | Source |
|---|---|
| `period_days`, `depth_ppm`, `duration_hours` | NASA catalog (`koi_period`, `koi_depth`, `koi_duration`) |
| `star_temp_k`, `star_gravity`, `star_radius` | NASA catalog (`koi_steff`, `koi_slogg`, `koi_srad`) |
| `planet_radius` | NASA catalog (`koi_prad`), in Earth radii |
| `duty_cycle` | calculated: duration ÷ period, the share of the orbit spent in the dip |

NASA's vetting flags (`koi_fpflag_*`), score and disposition are left out:
they are NASA's verdict, and 98.0% of false positives carry at least one flag.

## The rules (current run)

```
disposition(X,'planet') :- planet_radius(X,N1), N1=<14.59,
    duty_cycle(X,N2), N2=<0.062, period_days(X,N3), N3=<234.636,
    not ab1(X,'True'), not ab2(X,'True').
ab1(X,'True') :- duty_cycle(X,N2), not(N2=<0.033), period_days(X,N3), N3=<10.501,
    depth_ppm(X,N4), N4=<189.5, duration_hours(X,N5), N5=<1.631.
ab2(X,'True') :- star_temp_k(X,N6), not(N6=<6214.0), duration_hours(X,N5), N5=<1.919.
```

In words: a signal is a planet if the object is at most 14.59 Earths wide, the
dip takes at most 6.2% of the orbit, and the orbit is at most 234.6 days,
unless it is a very shallow, very short dip on a tiny orbit (exception 1) or a
dip under 1.9 hours on a star hotter than 6214 K (exception 2).

## Results on the 1,518 test objects

| Model | Rules / decisions | Accuracy | Precision | Recall |
|---|---|---|---|---|
| FOLD-SE, with planet radius | 3 rules | 84.8% | 72.1% | 94.7% |
| FOLD-SE main rule alone | 1 rule | 83.3% | 69.7% | 95.3% |
| FOLD-SE, first run (no planet radius) | 2 rules | 83.2% | 74.1% | 82.4% |
| Random Forest, same split | 74,299 decisions | 91.0% | 87.3% | 87.8% |

Adding planet radius let one rule match the first run's two rules while missing
71 fewer real planets. A plain decision tree needs about 4 leaves to match the
3-rule set on these features (84.5%), so FOLD-SE's advantage is readability
with exceptions, not raw accuracy.

**SHAP** (TreeExplainer on the Random Forest, averaged over the test set)
ranks planet radius, duty cycle and period first, which are exactly the three
conditions of the main rule. See `shap_importance.png`.

**s(CASP).** The rules were run in the
[Ciao s(CASP) playground](https://ciao-lang.org/playground/scasp.html) with
English templates (`#pred`), which gives a justification for each yes and, with
`not disposition(...)`, each no. FOLD-SE writes "not at most" as
`not(N=<x)`; for s(CASP) this was written as `N > x`, which matches FOLD-SE
when the value is present. FOLD-SE counts a missing value as passing a
"not at most" check; the website's `utils/foldseRules.ts` does the same.

`run1/` keeps the first run (eight measurements with depth per hour instead of
planet radius), its rules and its SHAP plots.

## Running it

```bash
cd ml/fold
python3 -m venv .venv && source .venv/bin/activate
pip install "git+https://github.com/hwd404/foldse_client.git" scikit-learn shap matplotlib
python prepare_data.py     # rebuild train.csv / test.csv (local)
python compare_forest.py   # Random Forest on the same split (local)
python train_foldse.py     # learn the rules (sends the training data to the FOLD-SE server)
python shap_forest.py      # SHAP on the Random Forest (local)
```

`train_foldse.py` is the only step that uses the internet: FOLD-SE runs on a
remote service. Before sending, the client replaces column names with random
codes, rescales each column by a random factor and offset, and encrypts the
request. The rules come back, are decoded locally, and are saved to
`rules.json`.

After retraining, the website picks up the new `rules.json` on its next build.
Update the accuracy figures in `RULE_RESULTS` in `utils/foldseRules.ts`, and
rerun [`../benchmark/`](../benchmark/) for the website numbers.
