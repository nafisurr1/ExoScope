"""
Step 4: score the website's decision, the old decision, and the FOLD-SE rules
against NASA's labels. Needs numpy and onnxruntime.
"""
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
D = json.load(open(HERE / "features.json"))
y = np.array([d["label"] for d in D])
F = [d["features"] for d in D]

# Same 13 inputs, same order, as buildFeatureVector in utils/exoplanetModel.ts
X = np.array([[f["period_days"], f["transit_depth_ppm"], f["transit_duration_hr"], f["stellar_teff_k"],
               f["stellar_logg"], f["stellar_radius_rsun"], f["depth_per_hr"], f["duty_cycle"],
               f["log_depth"], f["log_period"], np.log10(max(f["transit_duration_hr"], 0.01)),
               f["transit_depth_ppm"] * f["stellar_logg"], f["period_days"] / max(f["stellar_radius_rsun"], 0.1)]
              for f in F], dtype=np.float32)
session = ort.InferenceSession(str(ROOT / "public" / "model" / "exoscope_model.onnx"))
prob = session.run(None, {session.get_inputs()[0].name: X})[1][:, 1]
snr = np.array([f["bls_snr"] for f in F])

# FOLD-SE rules, with the same logic as utils/foldseRules.ts
RULES = {r["head"][0]: r for r in json.load(open(ROOT / "ml" / "fold" / "rules.json"))["flat_rules"]}
SITE_NAME = {"period_days": "period_days", "depth_ppm": "transit_depth_ppm", "duration_hours": "transit_duration_hr",
             "star_temp_k": "stellar_teff_k", "star_gravity": "stellar_logg", "star_radius": "stellar_radius_rsun",
             "duty_cycle": "duty_cycle", "planet_radius": "est_planet_radius_rearth", "depth_per_hour": "depth_per_hr"}

def holds(f, item):
    name, op, cutoff = item
    v = f.get(SITE_NAME[name])
    if op == "=<":
        return v is not None and v <= cutoff
    if op == ">":
        return v is not None and v > cutoff
    return v is None or v > cutoff  # "!=<", not at most

def proves(head, f):
    r = RULES[head]
    return all(holds(f, i) for i in r["main_items"]) and not any(proves(a[0], f) for a in r["ab_items"])

rules = np.array([1 if proves("disposition", f) else 0 for f in F])

def report(name, pred):
    tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum())
    print(f"  {name:46s} {(pred == y).mean():6.1%}   planets found {tp}/{int(y.sum())}"
          f"   false alarms {fp}/{int((1 - y).sum())}")

print(f"{len(y)} Kepler quarters: {int(y.sum())} confirmed planets, {int((1 - y).sum())} false positives\n")
report("website: Random Forest, cut at 50%", (prob >= 0.5).astype(int))
old = 0.6 / (1 + np.exp(-(snr - 8) / 2)) + 0.4 * prob
report("before: 0.6 x signal strength + 0.4 x forest", (old >= 0.45).astype(int))
report("FOLD-SE rules on the website's measurements", rules)
disagree = (prob >= 0.5).astype(int) != rules
print(f"\n  forest and rules disagree on {disagree.sum()} files; the forest is right on "
      f"{int(((prob >= 0.5).astype(int) == y)[disagree].sum())} of them")
