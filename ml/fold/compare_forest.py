"""
Step 3 - Train a Random Forest (the kind of model the ExoScope app uses) on
the SAME train/test files, so the comparison with FOLD-SE is fair.

Runs entirely on your computer.
"""
import csv
from pathlib import Path

from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, precision_score, recall_score
from sklearn.pipeline import Pipeline

HERE = Path(__file__).parent
FEATURES = [
    "period_days", "depth_ppm", "duration_hours", "star_temp_k",
    "star_gravity", "star_radius", "duty_cycle", "planet_radius",
]


def load(path):
    X, y = [], []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            X.append([float(r[c]) if r[c] else float("nan") for c in FEATURES])
            y.append(r["disposition"] == "planet")
    return X, y


X_train, y_train = load(HERE / "train.csv")
X_test, y_test = load(HERE / "test.csv")

forest = Pipeline([
    ("fill_missing", SimpleImputer(strategy="median")),
    ("forest", RandomForestClassifier(n_estimators=150, random_state=42)),
])
forest.fit(X_train, y_train)
pred = forest.predict(X_test)

trees = forest.named_steps["forest"].estimators_
decisions = sum(t.tree_.node_count - t.tree_.n_leaves for t in trees)

print(f"RANDOM FOREST on the same {len(y_test):,} test objects:")
print(f"  accuracy   {accuracy_score(y_test, pred):6.1%}")
print(f"  precision  {precision_score(y_test, pred):6.1%}")
print(f"  recall     {recall_score(y_test, pred):6.1%}")
print(f"  decisions  {decisions:6,}   (across {len(trees)} trees)")