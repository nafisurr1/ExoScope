/**
 * Runs the rules FOLD-SE learned (ml/fold/rules.json) on the website's own
 * measurements and records every check, so the result page can show why the
 * rules said planet or not a planet.
 *
 * The logic is FOLD-SE's: a signal is a planet when every condition of the
 * main rule holds and none of its exceptions apply. A missing value fails an
 * "at most" or "more than" check but passes a "not at most" check, which is
 * how FOLD-SE itself treats missing values.
 *
 * After retraining, the site picks up the new ml/fold/rules.json on the next
 * build. Update RULE_RESULTS below with the new test numbers.
 */

import rules from '../ml/fold/rules.json';
import { ExoplanetFeatures } from './exoplanetFeatures';

type Op = '=<' | '>' | '!=<';

interface FlatRule {
  head:       [string, string, string];
  main_items: [string, Op, number][];
  ab_items:   [string, string, string][];
}

export interface ConditionCheck {
  measurement: string;
  op:          Op;
  threshold:   number;
  value:       number | null;
  holds:       boolean;
}

export interface RuleCheck {
  conditions: ConditionCheck[];
  exceptions: RuleCheck[];
  holds:      boolean;
}

/** Measured results for the current rules.json. Update these after retraining. */
export const RULE_RESULTS = {
  trainedOn:        rules.training_metrics.row_count,
  catalogAccuracy:  '84.8%',  // NASA's catalog values, 1,518 held-out objects
  siteAccuracy:     '65.9%',  // this site's measurements, 170 real Kepler quarters
  forestRightWhenDisagree: '28 of 43',  // same 170 quarters, Random Forest cut at 50%
};

const VALUE_OF: Record<string, (f: ExoplanetFeatures) => number> = {
  period_days:    f => f.period_days,
  depth_ppm:      f => f.transit_depth_ppm,
  duration_hours: f => f.transit_duration_hr,
  star_temp_k:    f => f.stellar_teff_k,
  star_gravity:   f => f.stellar_logg,
  star_radius:    f => f.stellar_radius_rsun,
  duty_cycle:     f => f.duty_cycle,
  planet_radius:  f => f.est_planet_radius_rearth,
  depth_per_hour: f => f.depth_per_hr,
};

/** How each measurement is named and printed on the result page. */
export const MEASUREMENT: Record<string, { label: string; show: (v: number) => string }> = {
  planet_radius:  { label: 'Planet size',               show: v => `${v.toFixed(2)} Earths` },
  duty_cycle:     { label: 'Share of orbit in the dip', show: v => `${(v * 100).toFixed(2)}%` },
  period_days:    { label: 'Orbit',                     show: v => `${v.toFixed(2)} days` },
  depth_ppm:      { label: 'Dip depth',                 show: v => `${v.toFixed(1)} ppm` },
  duration_hours: { label: 'Dip length',                show: v => `${v.toFixed(3)} hours` },
  star_temp_k:    { label: 'Star temperature',          show: v => `${v.toFixed(0)} K` },
  star_radius:    { label: 'Star size',                 show: v => `${v.toFixed(2)} Suns` },
  star_gravity:   { label: 'Star surface gravity',      show: v => `log g ${v.toFixed(2)}` },
  depth_per_hour: { label: 'Dip depth per hour',        show: v => `${v.toFixed(1)} ppm/hour` },
};

const byHead = new Map(
  (rules.flat_rules as unknown as FlatRule[]).map(r => [r.head[0], r]),
);

function check(head: string, f: ExoplanetFeatures): RuleCheck {
  const rule = byHead.get(head);
  if (!rule) throw new Error(`rules.json has no rule named ${head}`);

  const conditions = rule.main_items.map(([measurement, op, threshold]) => {
    const get = VALUE_OF[measurement];
    if (!get) throw new Error(`rules.json uses ${measurement}, which the website does not measure`);
    const raw = get(f);
    const value = Number.isFinite(raw) ? raw : null;
    const holds =
      op === '=<' ? value !== null && value <= threshold :
      op === '>'  ? value !== null && value > threshold :
                    value === null || value > threshold;  // '!=<' is "not at most"
    return { measurement, op, threshold, value, holds };
  });

  const exceptions = rule.ab_items.map(([name]) => check(name, f));
  const holds = conditions.every(c => c.holds) && !exceptions.some(e => e.holds);
  return { conditions, exceptions, holds };
}

/** Checks the main rule ("is a planet") and every exception under it. */
export function checkRules(f: ExoplanetFeatures): RuleCheck {
  return check(rules.label, f);
}
