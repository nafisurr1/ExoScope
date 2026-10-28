"""
Step 1 - Turn NASA's catalog into clean train/test files for FOLD-SE.

  * Keeps only objects NASA has decided on (CONFIRMED or FALSE POSITIVE).
  * Keeps 8 readable measurements. Leaves out log columns (a rule on
    log(depth) is the same rule as one on depth, just harder to read) and
    NASA's vetting flags (they basically ARE the answer).
  * Shuffles with a fixed seed, then splits 80/20 while keeping the same
    planet / false-positive mix in both halves. The catalog is sorted, so
    without shuffling the test set would be 99% false positives.

Runs entirely on your computer. Safe to re-run; you get the same files.
"""
import csv
import random
from pathlib import Path

HERE = Path(__file__).parent
SOURCE = HERE.parent / "koi_cumulative.csv"
SEED = 42

# column name -> number of decimals to keep (fewer decimals = easier rules)
FEATURES = {
    "period_days": 4,
    "depth_ppm": 1,
    "duration_hours": 3,
    "star_temp_k": 0,
    "star_gravity": 3,
    "star_radius": 3,
    "duty_cycle": 5,
    "planet_radius": 2,
}


def num(row, col):
    value = row[col].strip()
    return float(value) if value else None


rows = []
with open(SOURCE, newline="") as f:
    for r in csv.DictReader(f):
        if r["koi_disposition"] not in ("CONFIRMED", "FALSE POSITIVE"):
            continue
        period = num(r, "koi_period")
        depth = num(r, "koi_depth")
        dur = num(r, "koi_duration")
        rows.append({
            "period_days": period,
            "depth_ppm": depth,
            "duration_hours": dur,
            "star_temp_k": num(r, "koi_steff"),
            "star_gravity": num(r, "koi_slogg"),
            "star_radius": num(r, "koi_srad"),
            "duty_cycle": dur / (period * 24) if dur and period else None,
            # NASA's fitted size of the crossing object, in Earth radii
            "planet_radius": num(r, "koi_prad"),
            "disposition": "planet" if r["koi_disposition"] == "CONFIRMED" else "false_positive",
        })

# Split planets and false positives separately so both halves get the same mix.
random.seed(SEED)
planets = [r for r in rows if r["disposition"] == "planet"]
false_pos = [r for r in rows if r["disposition"] == "false_positive"]
random.shuffle(planets)
random.shuffle(false_pos)

cut_p = int(len(planets) * 0.8)
cut_f = int(len(false_pos) * 0.8)
train = planets[:cut_p] + false_pos[:cut_f]
test = planets[cut_p:] + false_pos[cut_f:]
random.shuffle(train)
random.shuffle(test)


def write(path, data):
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(list(FEATURES) + ["disposition"])
        for r in data:
            cells = ["" if r[c] is None else (round(r[c]) if d == 0 else round(r[c], d))
                     for c, d in FEATURES.items()]
            writer.writerow(cells + [r["disposition"]])


write(HERE / "train.csv", train)
write(HERE / "test.csv", test)


def pct_planets(data):
    return 100 * sum(r["disposition"] == "planet" for r in data) / len(data)


print(f"Kept {len(rows):,} objects ({len(planets):,} planets, {len(false_pos):,} false positives)")
print(f"train.csv: {len(train):,} rows, {pct_planets(train):.1f}% planets")
print(f"test.csv:  {len(test):,} rows, {pct_planets(test):.1f}% planets")