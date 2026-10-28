import React from 'react';
import { PredictionResult } from '../utils/exoplanetModel';
import { getPlanetType, getEquilibriumTemp } from '../utils/exoplanetFeatures';
import { AlertTriangle, CheckCircle, XCircle, Zap, Globe, Thermometer, Clock, Layers, FlaskConical } from 'lucide-react';

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
      <span className="text-xs text-slate-500 -mt-1">Confidence</span>
    </div>
  );
};

const ModelBar: React.FC<{ label: string; value: number; isExoplanet: boolean }> = ({ label, value, isExoplanet }) => {
  const pct = Math.round(value * 100);
  const color = isExoplanet ? 'bg-cyan-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-20 shrink-0">{label}</span>
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

/** Generate a set of specific, data-driven scientific reasoning bullets */
function buildReasoning(result: PredictionResult, teq: number): { text: string; positive: boolean }[] {
  const f = result.features;
  const reasons: { text: string; positive: boolean }[] = [];

  // ── BLS SNR ──────────────────────────────────────────────────────────────
  const snr = f.bls_snr ?? 0;
  if (snr >= 15) {
    reasons.push({
      text: `BLS periodogram SNR of ${snr.toFixed(1)}σ — a strong, phase-coherent flux decrement repeating at P = ${f.period_days.toFixed(3)} d, well above the detection floor of ~7σ used in NASA's TPS pipeline.`,
      positive: true,
    });
  } else if (snr >= 7) {
    reasons.push({
      text: `BLS periodogram SNR of ${snr.toFixed(1)}σ at P = ${f.period_days.toFixed(3)} d. Signal is above the nominal 7σ threshold but marginal; additional quarters are needed for definitive confirmation.`,
      positive: true,
    });
  } else if (snr > 0) {
    reasons.push({
      text: `BLS periodogram SNR of only ${snr.toFixed(1)}σ — below the 7σ detection floor. The periodic signal at P = ${f.period_days.toFixed(3)} d is statistically indistinguishable from stellar noise in this single quarter.`,
      positive: false,
    });
  }

  // ── Transit depth & planet radius ────────────────────────────────────────
  const depth = f.transit_depth_ppm;
  const rEarth = f.est_planet_radius_rearth;
  if (depth > 0) {
    if (depth > 5000) {
      reasons.push({
        text: `Transit depth of ${(depth / 1000).toFixed(2)} ppt (${depth.toFixed(0)} ppm) implies a radius ratio Rp/Rs ≈ ${Math.sqrt(depth / 1e6).toFixed(3)}, consistent with a gas giant (R ≈ ${rEarth.toFixed(1)} R⊕). Photometric contamination from a background EB cannot be excluded without centroid analysis.`,
        positive: true,
      });
    } else if (depth > 500) {
      reasons.push({
        text: `Transit depth of ${depth.toFixed(0)} ppm (Rp/Rs ≈ ${Math.sqrt(depth / 1e6).toFixed(4)}) points to a sub-Jupiter or Neptune-class body at R ≈ ${rEarth.toFixed(1)} R⊕. Depths in this range are well-detected by Kepler's 29.4-minute cadence photometry.`,
        positive: true,
      });
    } else if (depth > 50) {
      reasons.push({
        text: `Shallow transit depth of ${depth.toFixed(0)} ppm (R ≈ ${rEarth.toFixed(1)} R⊕, super-Earth regime). At this signal level, systematics from the Kepler PDC pipeline can introduce false periodic signals; the duty cycle and stellar properties must corroborate.`,
        positive: depth > 100,
      });
    } else {
      reasons.push({
        text: `Transit depth of ${depth.toFixed(1)} ppm is below Kepler's reliable single-quarter detection threshold (~100 ppm for quiet stars). The signal may be dominated by photometric noise or PDC detrending artifacts.`,
        positive: false,
      });
    }
  }

  // ── Duty cycle / duration consistency ────────────────────────────────────
  const duty = f.duty_cycle ?? 0;
  const dur = f.transit_duration_hr;
  const period = f.period_days;
  // Expected max duration from Winn 2010: T14 ≤ 13 * (Rs)^1/3 * (P/yr)^1/3 hr
  const Rs = f.stellar_radius_rsun ?? 1.0;
  const physMaxHr = 13 * Math.pow(Rs, 1 / 3) * Math.pow(period / 365.25, 1 / 3);
  if (dur > 0 && physMaxHr > 0) {
    const ratio = dur / physMaxHr;
    if (ratio <= 1.0) {
      reasons.push({
        text: `Transit duration of ${dur.toFixed(2)} hr is physically self-consistent: for a ${period.toFixed(2)}-day orbit around a ${Rs.toFixed(2)} R☉ star, the Winn (2010) maximum central-transit duration is ${physMaxHr.toFixed(2)} hr (observed / max = ${ratio.toFixed(2)}). Grazing geometries and inclination effects keep this within the expected range.`,
        positive: true,
      });
    } else {
      reasons.push({
        text: `Transit duration of ${dur.toFixed(2)} hr exceeds the Winn (2010) physical maximum of ${physMaxHr.toFixed(2)} hr for a ${period.toFixed(2)}-day orbit around a ${Rs.toFixed(2)} R☉ star (ratio = ${ratio.toFixed(2)}). This is a red flag: eclipsing binaries or stellar variability aliases commonly produce over-long BLS solutions.`,
        positive: false,
      });
    }
  }

  // ── Stellar variability ──────────────────────────────────────────────────
  const fluxStd = f.flux_std ?? 0;
  if (fluxStd > 0.005) {
    reasons.push({
      text: `Normalized flux standard deviation of ${(fluxStd * 1000).toFixed(2)}‰ indicates high intrinsic stellar variability — likely from spots, pulsations, or a late-type active star. Variability at this amplitude can create spurious BLS peaks that mimic transit morphology after detrending.`,
      positive: false,
    });
  } else if (fluxStd > 0.002) {
    reasons.push({
      text: `Flux RMS of ${(fluxStd * 1000).toFixed(2)}‰ is moderate; the sliding-median detrend effectively removed systematic trends, but residual correlated noise may inflate or suppress the measured transit depth by ~10–30%.`,
      positive: true,
    });
  } else if (fluxStd > 0) {
    reasons.push({
      text: `Low photometric scatter (flux RMS = ${(fluxStd * 1000).toFixed(2)}‰) after detrending indicates a photometrically quiet star — optimal conditions for reliable transit detection at the measured depth.`,
      positive: true,
    });
  }

  // ── Stellar context ──────────────────────────────────────────────────────
  const teff = f.stellar_teff_k ?? 5778;
  const logg = f.stellar_logg ?? 4.44;
  const starClass =
    teff > 7500 ? 'an A-type' : teff > 6000 ? 'an F-type' : teff > 5200 ? 'a G-type solar analog' : teff > 3900 ? 'a K-type' : 'an M-type';
  const evolved = logg < 3.8;
  if (evolved) {
    reasons.push({
      text: `log g = ${logg.toFixed(3)} places the host in the subgiant/giant branch (R ≈ ${Rs.toFixed(1)} R☉). Evolved hosts dilute transit depth relative to main-sequence assumptions and increase the false-positive rate from stellar companions.`,
      positive: false,
    });
  } else {
    reasons.push({
      text: `Host is ${starClass} main-sequence star (Teff = ${teff.toFixed(0)} K, log g = ${logg.toFixed(3)}, R = ${Rs.toFixed(2)} R☉). Main-sequence hosts have the lowest a priori false-positive rate and straightforward radius scaling relations.`,
      positive: true,
    });
  }

  // ── Equilibrium temperature / habitability ───────────────────────────────
  if (result.isExoplanet) {
    if (teq > 200 && teq < 320) {
      reasons.push({
        text: `Equilibrium temperature of ${teq.toFixed(0)} K (assuming Bond albedo A = 0.3) places the planet near the empirical habitable zone boundary. This is a necessary but not sufficient condition for liquid surface water — atmospheric composition and greenhouse forcing remain unconstrained.`,
        positive: true,
      });
    } else if (teq > 1000) {
      reasons.push({
        text: `Equilibrium temperature of ${teq.toFixed(0)} K — firmly in the ultra-hot regime. At this irradiation level, thermal dissociation of molecules (H₂O, TiO) and atmospheric escape are expected; the planet is unlikely to retain a substantial hydrogen envelope over Gyr timescales.`,
        positive: false,
      });
    } else if (teq > 500) {
      reasons.push({
        text: `Equilibrium temperature of ${teq.toFixed(0)} K — hot but below the thermal dissociation threshold. The planet is a plausible target for secondary eclipse or phase-curve observations to constrain atmospheric circulation.`,
        positive: true,
      });
    }
  }

  // ── n_transits ───────────────────────────────────────────────────────────
  const nTr = f.n_transits ?? 0;
  if (nTr >= 5) {
    reasons.push({
      text: `${nTr} individual transit events fold coherently at the detected period, providing phase coverage sufficient to confirm the periodicity is not a single-event artifact or systematics spike.`,
      positive: true,
    });
  } else if (nTr >= 2) {
    reasons.push({
      text: `Only ${nTr} transit events visible in this quarter. With so few events, the period solution has higher uncertainty and a single anomalous data segment could produce a comparable BLS peak. Multi-quarter data is essential for confirmation.`,
      positive: false,
    });
  } else if (nTr <= 1) {
    reasons.push({
      text: `Fewer than two complete transit events detected in this quarter — the period may exceed the observation baseline or the transit may have been missed due to data gaps. BLS is unreliable with ≤1 transit.`,
      positive: false,
    });
  }

  return reasons;
}

const ExoplanetResult: React.FC<ExoplanetResultProps> = ({ result }) => {
  const { isExoplanet, confidence, rfConfidence, gbConfidence, overridden, overrideReason, features } = result;
  const planetType = getPlanetType(features.est_planet_radius_rearth);
  const teq = getEquilibriumTemp(features.period_days);
  const habitable = teq > 200 && teq < 320;
  const reasoning = buildReasoning(result, teq);

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
              ML + Physics Analysis · {features.total_obs_days.toFixed(0)} days observed
            </p>
          </div>
        </div>
        <ConfidenceArc value={confidence} isExoplanet={isExoplanet} />
      </div>

      {/* Physics override banner */}
      {overridden && (
        <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-800/50 rounded-lg px-4 py-3 mb-5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Physics Override Active</span>
            <p className="text-xs text-amber-300/80 mt-0.5">{overrideReason}</p>
          </div>
        </div>
      )}

      {/* Model breakdown */}
      <div className="bg-slate-950/40 border border-slate-800/50 rounded-lg p-4 mb-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Model Breakdown</p>
        <div className="space-y-2.5">
          <ModelBar label="BLS + Physics" value={rfConfidence} isExoplanet={isExoplanet} />
          <ModelBar label="ML Score" value={gbConfidence} isExoplanet={isExoplanet} />
          <ModelBar label="Ensemble" value={confidence} isExoplanet={isExoplanet} />
        </div>
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

      {/* ── Scientific Reasoning ─────────────────────────────────────────── */}
      <div className="bg-slate-950/60 border border-slate-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <FlaskConical className="w-4 h-4 text-violet-400" />
          <span className="text-xs font-semibold text-violet-400 uppercase tracking-widest">
            Scientific Reasoning
          </span>
        </div>
        <div className="space-y-3">
          {reasoning.map((r, i) => (
            <div key={i} className="flex gap-3">
              <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${r.positive ? 'bg-cyan-400' : 'bg-red-400'}`} />
              <p className={`text-xs leading-relaxed font-mono ${r.positive ? 'text-slate-300' : 'text-slate-400'}`}>
                {r.text}
              </p>
            </div>
          ))}
          {reasoning.length === 0 && (
            <p className="text-xs text-slate-500 font-mono">Insufficient photometric data to generate a detailed analysis.</p>
          )}
        </div>
        <p className="text-xs text-slate-600 mt-4 pt-3 border-t border-slate-800">
          Analysis based on Box Least-Squares periodogram (detrended flux), Winn (2010) transit geometry, and a Random Forest classifier trained on 7,586 Kepler Object of Interest dispositions from the NASA Exoplanet Archive.
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
