"""
Step 2 - Train FOLD-SE and test it.

This is the ONLY step that uses the internet. fit() sends the training data
to FOLD-SE server. The client encrypts it and replaces the
column names and values with random codes first, so the server never sees
"depth_ppm" or your real numbers. The rules come back and are decoded here.

Prediction and explanations run on your computer. After this finishes once,
the rules are saved to rules.json and you never need the server again for
this data.
"""
from pathlib import Path

from foldse_client import Foldse, get_scores, save_model_to_file

HERE = Path(__file__).parent
FEATURES = [
    "period_days", "depth_ppm", "duration_hours", "star_temp_k",
    "star_gravity", "star_radius", "duty_cycle", "planet_radius",
]

# Stop before contacting the server if train.csv is from an older run.
with open(HERE / "train.csv") as f:
    header = f.readline().strip().split(",")
missing = [c for c in FEATURES if c not in header]
if missing:
    raise SystemExit(f"train.csv has no column {missing}. Run prepare_data.py first.")

model = Foldse(str_attrs=[], num_attrs=FEATURES, label="disposition", pos_val="planet")
train = model.load_data(HERE / "train.csv")
test = model.load_data(HERE / "test.csv")

print(f"Training on {len(train):,} objects...")
print("(the first run can take 30+ seconds while the server wakes up)\n")
model.fit(train, ratio=0.5, tail=0.005)

rules = model.asp()
print("LEARNED RULES:")
for rule in rules:
    print("  " + rule)

predictions = model.predict(test)
labels = [row["label"] for row in test]
acc, prec, rec, f1 = get_scores(predictions, labels)

print(f"\nTEST RESULTS on {len(test):,} objects it never saw:")
print(f"  accuracy   {acc:6.1%}")
print(f"  precision  {prec:6.1%}   of the ones it called planets, how many really were")
print(f"  recall     {rec:6.1%}   of the real planets, how many it found")
print(f"  rules      {len(rules):6d}")

save_model_to_file(model, HERE / "rules.json")
print("\nSaved to rules.json")

# Why did it decide what it decided? Show one real planet and one false positive.
print("\nWHY - explanations for two objects from the test set:")
for want in (True, False):
    row = next(r for r in test if r["label"] == want)
    guess = model.classify(row)
    print(f"\n--- actually a {'PLANET' if want else 'FALSE POSITIVE'}, "
          f"FOLD-SE said {'planet' if guess else 'not a planet'} ---")
    for line in model.proof_trees(row):
        print(line)