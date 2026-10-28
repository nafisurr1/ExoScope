import React from 'react';
import { PredictionResult } from '../utils/exoplanetModel';
import { ExoplanetFeatures, getPlanetType } from '../utils/exoplanetFeatures';
import { checkRules, ConditionCheck, RuleCheck, MEASUREMENT, RULE_RESULTS } from '../utils/foldseRules';
import { AlertTriangle, Check, CheckCircle, ListChecks, X, XCircle, Zap, Globe, Thermometer, Clock, Layers } from 'lucide-react';

interface ExoplanetResultProps {
  result: PredictionResult;
}

const ConfidenceArc: React.FC<{ value: number; isExoplanet: boolean }> = ({ value, isExoplanet }) => {
  const pct = Math.round(value * 100);
  const r = 54;
  const circumference = Math.PI * r;
  const dash = (pct / 100) * circumference;
  const color = isExoplanet
    ? (pct > 80 ? '#22d3ee' : '#f59e0b')
    : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="80" viewBox="0 0 140 80">
        <path d="M 16 70 A 54 54 0 0 1 124 70" fill="none" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        <path
          d="M 16 70 A 54 54 0 0 1 124 70"
          fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
        <text x="70" y="68" textAnchor="middle" fill={color} fontSize="22" fontWeight="bold" fontFamily="monospace">
          {pct}%
        </text>
      </svg>
      <span className="text-xs text-slate-500 -mt-1">Chance of planet</span>
    </div>
  );
};

const ModelBar: React.FC<{ label: string; value: number; isExoplanet: boolean }> = ({ label, value, isExoplanet }) => {
  const pct = Math.round(value * 100);
  const color = isExoplanet ? 'bg-cyan-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-24 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-400 w-10 text-right">{pct}%</span>
    </div>
  );
};

const StatPill: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
    <span className="text-cyan-500">{icon}</span>
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-mono text-slate-200">{value}</div>
    </div>
  </div>
);

const ASSUMED: { key: keyof ExoplanetFeatures['assumed_star_values']; name: string; sun: string }[] = [
  { key: 'temperature', name: 'temperature',     sun: '5778 K' },
  { key: 'radius',      name: 'size',            sun: '1.0 solar radius' },
  { key: 'gravity',     name: 'surface gravity', sun: 'log g 4.44' },
];

function joinWords(words: string[], last: string): string {
  if (words.length < 2) return words.join('');
  if (words.length === 2) return `${words[0]} ${last} ${words[1]}`;
  return `${words.slice(0, -1).join(', ')}, ${last} ${words[words.length - 1]}`;
}

/** One check: the measured value, the cutoff, and whether it holds. */
const ConditionRow: React.FC<{ c: ConditionCheck; inException: boolean }> = ({ c, inException }) => {
  const m = MEASUREMENT[c.measurement] ?? { label: c.measurement, show: (v: number) => String(v) };
  const yes = inException ? 'text-amber-400' : 'text-cyan-400';
  const no  = inException ? 'text-slate-500' : 'text-red-400';
  return (
    <li className="flex items-start gap-2">
      {c.holds
        ? <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${yes}`} aria-hidden="true" />
        : <X className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${no}`} aria-hidden="true" />}
      <span className="text-xs text-slate-300 leading-relaxed">
        <span className="text-slate-400">{m.label}:</span>{' '}
        <span className="font-mono">{c.value === null ? 'not measured' : m.show(c.value)}</span>{' '}
        <span className="text-slate-500">(needs {c.op === '=<' ? 'at most' : 'more than'} {m.show(c.threshold)})</span>
        <span className="sr-only">{c.holds ? ', holds' : ', does not hold'}</span>
      </span>
    </li>
  );
};

const ExceptionBlock: React.FC<{ e: RuleCheck; n: string }> = ({ e, n }) => (
  <div className={`border-l-2 pl-3 ${e.holds ? 'border-amber-500/60' : 'border-slate-700'}`}>
    <p className={`text-xs mb-1.5 ${e.holds ? 'text-amber-300' : 'text-slate-400'}`}>
      Exception {n} {e.holds ? 'applies' : 'does not apply'}. It applies only when all of these hold:
    </p>
    <ul className="space-y-1.5">
      {e.conditions.map((c, i) => <ConditionRow key={i} c={c} inException />)}
    </ul>
    {e.exceptions.map((sub, i) => <div key={i} className="mt-2"><ExceptionBlock e={sub} n={`${n}.${i + 1}`} /></div>)}
  </div>
);

/** One sentence on why the rules landed where they did. */
function ruleSummary(r: RuleCheck): string {
  const failed = r.conditions.filter(c => !c.holds).map(c => MEASUREMENT[c.measurement]?.label ?? c.measurement);
  if (failed.length) {
    return `${joinWords(failed, 'and')} ${failed.length === 1 ? 'is' : 'are'} outside the range the rules allow for a planet.`;
  }
  const applied = r.exceptions.flatMap((e, i) => (e.holds ? [String(i + 1)] : []));
  if (applied.length) return `Every check passes, but exception ${joinWords(applied, 'and')} applies.`;
  return 'Every check passes and no exception applies.';
}

const ExoplanetResult: React.FC<ExoplanetResultProps> = ({ result }) => {
  const { isExoplanet, planetProbability, features } = result;
  const planetType = getPlanetType(features.est_planet_radius_rearth);
  const teq = features.eq_temperature_k;
  const habitable = teq > 200 && teq < 320;
  const ruleCheck = checkRules(features);
  const rulesSayPlanet = ruleCheck.holds;
  const assumed = ASSUMED.filter(a => features.assumed_star_values[a.key]);

  return (
    <div className={`
      border rounded-xl p-6 mb-6 backdrop-blur-sm transition-all
      ${isExoplanet ? 'bg-cyan-950/20 border-cyan-800/50' : 'bg-slate-900/50 border-slate-800'}
    `}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {isExoplanet
            ? <CheckCircle className="w-7 h-7 text-cyan-400" />
            : <XCircle className="w-7 h-7 text-red-400" />}
          <div>
            <h2 className={`text-xl font-bold ${isExoplanet ? 'text-cyan-300' : 'text-slate-300'}`}>
              {isExoplanet ? 'Exoplanet Candidate Detected' : 'No Exoplanet Detected'}
            </h2>
            <p className="text-slate-500 text-sm mt-0.5">
              Random Forest + rule check · {features.total_obs_days.toFixed(0)} days observed
            </p>
          </div>
        </div>
        <ConfidenceArc value={planetProbability} isExoplanet={isExoplanet} />
      </div>

      {/* Star values the file did not include */}
      {assumed.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-800/50 rounded-lg px-4 py-3 mb-5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/90 leading-relaxed">
            This light curve file doesn't include the star's {joinWords(assumed.map(a => a.name), 'or')}, so ExoScope
            assumed the Sun's ({joinWords(assumed.map(a => a.sun), 'and')}). Numbers that depend on the
            star, like planet size, planet temperature, and the rule check, may be off.
          </p>
        </div>
      )}

      {/* The two models */}
      <div className="bg-slate-950/40 border border-slate-800/50 rounded-lg p-4 mb-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Two Models</p>
        <div className="space-y-2.5">
          <ModelBar label="Random Forest" value={planetProbability} isExoplanet={isExoplanet} />
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 w-24 shrink-0">Rule check</span>
            <span className={`text-xs font-mono ${rulesSayPlanet ? 'text-cyan-300' : 'text-red-300'}`}>
              {rulesSayPlanet ? 'Planet' : 'Not a planet'}
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-3 leading-relaxed">
          {rulesSayPlanet === isExoplanet
            ? 'Both models agree.'
            : `The two models disagree. On 170 real Kepler files, the Random Forest was right more often when they disagreed (${RULE_RESULTS.forestRightWhenDisagree} times), so its answer is the one shown above.`}
        </p>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <StatPill icon={<Zap className="w-4 h-4" />} label="Transit Depth" value={`${features.transit_depth_ppm.toFixed(0)} ppm`} />
        <StatPill icon={<Clock className="w-4 h-4" />} label="Orbital Period" value={`${features.period_days.toFixed(3)} d`} />
        <StatPill icon={<Globe className="w-4 h-4" />} label="Est. Radius" value={`${features.est_planet_radius_rearth.toFixed(2)} R⊕`} />
        <StatPill icon={<Layers className="w-4 h-4" />} label="Transits Found" value={`${features.n_transits}`} />
        <StatPill icon={<Thermometer className="w-4 h-4" />} label="Equil. Temp" value={`${teq.toFixed(0)} K`} />
        <StatPill
          icon={<Globe className="w-4 h-4" />}
          label={isExoplanet ? 'Planet Type' : 'Signal Type'}
          value={isExoplanet ? planetType : 'No candidate'}
        />
      </div>

      {/* Why the rule check landed where it did */}
      <div className="bg-slate-950/60 border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <ListChecks className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-semibold text-violet-400 uppercase tracking-widest">
            Why the rule check says {rulesSayPlanet ? 'planet' : 'not a planet'}
          </span>
        </div>
        <p className="text-xs text-slate-300 mb-4">{ruleSummary(ruleCheck)}</p>

        <p className="text-xs text-slate-500 mb-2">A signal counts as a planet when all of these hold:</p>
        <ul className="space-y-1.5 mb-4">
          {ruleCheck.conditions.map((c, i) => <ConditionRow key={i} c={c} inException={false} />)}
        </ul>

        {ruleCheck.exceptions.length > 0 && (
          <>
            <p className="text-xs text-slate-500 mb-2">unless one of these exceptions applies:</p>
            <div className="space-y-3">
              {ruleCheck.exceptions.map((e, i) => <ExceptionBlock key={i} e={e} n={String(i + 1)} />)}
            </div>
          </>
        )}

        <p className="text-xs text-slate-600 mt-4 pt-3 border-t border-slate-800 leading-relaxed">
          Rules learned with FOLD-SE from {RULE_RESULTS.trainedOn.toLocaleString()} objects in NASA's Kepler
          catalog. On NASA's own measurements of objects they had not seen, they were {RULE_RESULTS.catalogAccuracy} accurate.
          The numbers above are measured from this one file, where the rules are less reliable:{' '}
          {RULE_RESULTS.siteAccuracy} on 170 real Kepler files.
        </p>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          Transit search: Box Least-Squares on the detrended light curve. Random Forest: trained on 7,586
          NASA Kepler objects.
        </p>
      </div>

      {/* Flags */}
      <div className="space-y-1.5 mt-4">
        {features.n_transits === 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-400/80">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            No clear transit dips detected in this light curve quarter
          </div>
        )}
        {features.flux_std > 0.003 && (
          <div className="flex items-center gap-2 text-xs text-amber-400/80">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            High stellar variability — may mask or mimic transit signals
          </div>
        )}
        {habitable && isExoplanet && (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            Equilibrium temperature within habitable zone range (200–320 K)
          </div>
        )}
      </div>
    </div>
  );
};

export default ExoplanetResult;
