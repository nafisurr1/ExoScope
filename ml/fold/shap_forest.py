"""
Step 4 - Ask SHAP which measurements the Random Forest leans on.

For each object, SHAP splits the forest's answer into one share per
measurement: "depth pushed this one 12 points toward planet, star
temperature pushed it 3 points away." Averaging the size of those shares
over every test object shows which measurements matter most overall.

Uses whatever columns are in train.csv, so it works before and after
prepare_data.py changes. Runs entirely on your computer.
"""
import csv
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # save pictures to files instead of opening windows
import matplotlib.pyplot as plt
import numpy as np
import shap
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer

HERE = Path(__file__).parent


def load(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        features = [c for c in reader.fieldnames if c != "disposition"]
        X, y = [], []
        for r in reader:
            X.append([float(r[c]) if r[c] else float("nan") for c in features])
            y.append(r["disposition"] == "planet")
    return features, np.array(X), np.array(y)


FEATURES, X_train, y_train = load(HERE / "train.csv")
_, X_test, y_test = load(HERE / "test.csv")

# Same model as compare_forest.py: fill blanks with the median, then 150 trees.
fill = SimpleImputer(strategy="median").fit(X_train)
X_train, X_test = fill.transform(X_train), fill.transform(X_test)
forest = RandomForestClassifier(n_estimators=150, random_state=42).fit(X_train, y_train)
print(f"Random Forest accuracy on {len(y_test):,} test objects: {forest.score(X_test, y_test):.1%}")

print("Working out SHAP values (about a minute)...")
values = shap.TreeExplainer(forest).shap_values(X_test)
# Keep the "planet" half. Older SHAP gives a list, newer gives one 3-D block.
values = values[1] if isinstance(values, list) else values[:, :, 1]

# Average size of each measurement's push, in percentage points of "planet".
strength = 100 * np.abs(values).mean(axis=0)
order = np.argsort(strength)[::-1]

print("\nHOW MUCH EACH MEASUREMENT MOVES THE FOREST'S ANSWER (average, in points):")
for rank, i in enumerate(order, 1):
    print(f"  {rank}. {FEATURES[i]:16s} {strength[i]:5.1f}  {'#' * round(strength[i] * 2)}")

shap.summary_plot(values, X_test, feature_names=FEATURES, plot_type="bar", show=False)
plt.tight_layout()
plt.savefig(HERE / "shap_importance.png", dpi=150)
plt.close()

shap.summary_plot(values, X_test, feature_names=FEATURES, show=False)
plt.tight_layout()
plt.savefig(HERE / "shap_detail.png", dpi=150)
plt.close()

print("\nSaved shap_importance.png and shap_detail.png")
