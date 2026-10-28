/**
 * ExoScope feature extraction.
 *
 * Pipeline:
 *   1. Load & clean flux (drop bad cadences, sort by time, normalise)
 *   2. Detrend with a 0.75-day sliding median (removes stellar variability)
 *   3. Phase-binned BLS on the detrended flux — see runBLS below
 *   4. Compute the 13 model features plus display values
 *
 * The Random Forest in exoplanetModel.ts makes the planet / not-a-planet call
 * from these features, and foldseRules.ts runs the FOLD-SE rules on them to
 * explain it.
 */

import { ParsedFitsData, FitsHeaderCard } from '../types';

export interface ExoplanetFeatures {
  period_days:          number;
  transit_depth_ppm:    number;
  transit_duration_hr:  number;
  stellar_teff_k:       number;
  stellar_logg:         number;
  stellar_radius_rsun:  number;
  depth_per_hr:         number;
  duty_cycle:           number;
  log_depth:            number;
  log_period:           number;
  log_duration:         number;
  depth_x_logg:         number;
  period_x_srad:        number;

  n_transits:               number;
  est_planet_radius_rearth: number;
  eq_temperature_k:         number;
  total_obs_days:           number;
  flux_std:                 number;
  bls_snr:                  number;

  /** Star values the file did not include, so the Sun's were used instead. */
  assumed_star_values: { temperature: boolean; gravity: boolean; radius: boolean };
}

function medianVal(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function headerNum(header: FitsHeaderCard[], ...keys: string[]): number | null {
  for (const key of keys) {
    const card = header.find(c => c.key.trim().toUpperCase() === key.toUpperCase());
    if (card && card.value !== null) {
      const n = Number(card.value);
      if (isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/**
 * Phase-binned Box Least Squares transit search.
 *
 * For each trial period the light curve is folded once into N_BINS phase bins,
 * then every (duration, epoch) combination is scored against those bins using
 * prefix sums — O(1) per trial instead of a full O(n) rescan. That makes 400
 * effective phase trials cheaper than the 20 this previously afforded.
 *
 * The earlier implementation swept 1000 x 12 x 20 combinations, rescanning all
 * n points each time (~9.6e8 operations for a 4000-point quarter, several
 * seconds of blocked main thread). Its 20 phase trials were spaced ~period/20
 * apart — 12 hours at P=10 d — while a transit lasts a few hours, so the search
 * routinely stepped straight over real signals. On KIC 3115833 it recovered
 * SNR 1.47 at the true 10.1816 d period where fine sampling gives 10.15.
 *
 * The scoring formula (depth * sqrt(inN) / std), DUR_FRACS, and the minimum
 * point counts are deliberately unchanged: combineSignals() in exoplanetModel.ts
 * hardcodes SNR 8 as marginal and 15 as strong, so the output must stay on the
 * same scale.
 */
function runBLS(
  time: number[],
  flux: number[],
  minPeriod: number,
  maxPeriod: number,
): { period: number; depthFrac: number; durationFrac: number; t0: number; snr: number } {

  const n   = time.length;
  const std = Math.sqrt(flux.reduce((s, f) => s + (f - 1) ** 2, 0) / n) + 1e-9;

  const N_PERIODS = 500;   // coarse scan; the refine pass now carries precision
  const N_BINS    = 400;   // phase resolution, replaces N_PHASES = 20
  const DUR_FRACS = [
    0.004, 0.007, 0.010, 0.014, 0.018, 0.023,
    0.029, 0.036, 0.044, 0.054, 0.065, 0.078,
  ];
  const MIN_IN = 3, MIN_OUT = 10;
  const REFINE_HALF_STEPS = 3;
  const N_FINE_MIN = 50, N_FINE_MAX = 400;

  const refT0 = time[0];

  // Scratch buffers, allocated once — evaluateAtPeriod runs ~900 times per call.
  const binSum = new Float64Array(N_BINS);
  const binCnt = new Int32Array(N_BINS);
  const preSum = new Float64Array(2 * N_BINS + 1);
  const preCnt = new Int32Array(2 * N_BINS + 1);

  let bestPow = -Infinity;
  let bestPeriod = (minPeriod + maxPeriod) / 2;
  let bestDepth = 0, bestStart = 0, bestWBins = 0, bestInN = 0;
  let found = false;

  /** Fold at `period`, then score every (duration, epoch) against the bins. */
  const evaluateAtPeriod = (period: number): void => {
    binSum.fill(0);
    binCnt.fill(0);

    for (let i = 0; i < n; i++) {
      const phase = ((time[i] - refT0) % period + period) % period;
      // Rounding can push phase/period to exactly 1.0; clamp to stay in bounds.
      let idx = Math.floor((phase / period) * N_BINS);
      if (idx >= N_BINS) idx = N_BINS - 1;
      binSum[idx] += flux[i];
      binCnt[idx] += 1;
    }

    // Prefix sums over the bins duplicated end-to-end, so a transit window that
    // wraps past phase 1.0 is still one contiguous slice — no branch in the
    // inner loop.
    preSum[0] = 0;
    preCnt[0] = 0;
    for (let k = 0; k < 2 * N_BINS; k++) {
      const j = k < N_BINS ? k : k - N_BINS;
      preSum[k + 1] = preSum[k] + binSum[j];
      preCnt[k + 1] = preCnt[k] + binCnt[j];
    }

    const totalSum = preSum[N_BINS];
    const totalCnt = preCnt[N_BINS];

    for (let di = 0; di < DUR_FRACS.length; di++) {
      const wBins = Math.max(1, Math.round(DUR_FRACS[di] * N_BINS));
      if (wBins >= N_BINS) continue;

      for (let start = 0; start < N_BINS; start++) {
        const inN = preCnt[start + wBins] - preCnt[start];
        if (inN < MIN_IN) continue;
        const outN = totalCnt - inN;
        if (outN < MIN_OUT) continue;

        const inSum  = preSum[start + wBins] - preSum[start];
        const outSum = totalSum - inSum;

        const depth = (outSum / outN) - (inSum / inN);
        if (depth <= 0) continue;

        const power = depth * Math.sqrt(inN) / std;
        if (power > bestPow) {
          bestPow = power; bestPeriod = period; bestDepth = depth;
          bestStart = start; bestWBins = wBins; bestInN = inN;
          found = true;
        }
      }
    }
  };

  const logMin = Math.log10(minPeriod);
  const logMax = Math.log10(maxPeriod);

  // ── Pass 1: coarse log-spaced scan ────────────────────────────────────────
  for (let pi = 0; pi < N_PERIODS; pi++) {
    evaluateAtPeriod(Math.pow(10, logMin + (pi / (N_PERIODS - 1)) * (logMax - logMin)));
  }

  if (!found) {
    return { period: bestPeriod, depthFrac: 0, durationFrac: 0.02, t0: time[0], snr: 0 };
  }

  const coarseStep = Math.pow(10, (logMax - logMin) / (N_PERIODS - 1));
  const bracket    = Math.pow(coarseStep, REFINE_HALF_STEPS);
  const baseline   = time[n - 1] - time[0];

  /**
   * Re-scan a narrow window around `center` finely enough that phase drift over
   * the whole baseline stays under 10% of one transit duration. `durDaysEst` is
   * an absolute duration in days, so it stays valid when probing a harmonic.
   */
  const scanFine = (center: number, durDaysEst: number): void => {
    const lo = Math.max(minPeriod, center / bracket);
    const hi = Math.min(maxPeriod, center * bracket);
    if (hi <= lo) return;

    const cycles   = Math.max(1, baseline / center);
    const fineStep = Math.max(1e-4, (0.1 * durDaysEst) / cycles);

    let nFine = Math.ceil((hi - lo) / fineStep);
    nFine = Math.min(N_FINE_MAX, Math.max(N_FINE_MIN, nFine));

    for (let fi = 0; fi < nFine; fi++) {
      evaluateAtPeriod(lo + (fi / (nFine - 1)) * (hi - lo));
    }
  };

  // ── Pass 2: local refinement ──────────────────────────────────────────────
  // The coarse grid only lands within ~1% of the true period, which still
  // smears transits: on KIC 3115833 a 0.0195 d offset accumulates to 1.16x the
  // transit duration across 8.7 orbits.
  const durDaysEst = (bestWBins / N_BINS) * bestPeriod;
  scanFine(bestPeriod, durDaysEst);

  // ── Pass 3: sub-harmonic check ────────────────────────────────────────────
  // A real transit at period P also produces power at 2P and 3P, because
  // folding at a multiple still stacks a subset of the transits coherently. A
  // coarse grid actively favours those aliases: longer periods fit fewer cycles
  // into the baseline, so grid error accumulates into less phase drift. Left
  // alone this reports 20.360 d for KIC 3115833, twice the true 10.1816 d.
  // Probe P/2 and P/3 at fine resolution and let the stronger signal win — a
  // genuinely long-period planet keeps its period, because no transits exist at
  // the halved spacing and the sub-harmonic simply scores worse.
  const refinedPeriod = bestPeriod;
  const refinedDurDays = (bestWBins / N_BINS) * bestPeriod;
  for (const divisor of [2, 3]) {
    const candidate = refinedPeriod / divisor;
    if (candidate < minPeriod) continue;
    scanFine(candidate, refinedDurDays);
  }

  // Report the transit centre, matching the old t0 convention — countTransits()
  // re-derives its windows as t0 +/- duration and depends on it.
  const centerFrac   = (bestStart + bestWBins / 2) / N_BINS;
  const t0           = refT0 + centerFrac * bestPeriod;
  const durationFrac = bestWBins / N_BINS;
  const snr          = bestInN > 0 ? bestDepth * Math.sqrt(bestInN) / std : 0;

  return { period: bestPeriod, depthFrac: Math.max(0, bestDepth),
           durationFrac, t0, snr };
}

function countTransits(
  time: number[], flux: number[],
  period: number, t0: number, durDays: number, threshold: number,
): number {
  if (period <= 0 || durDays <= 0) return 0;
  let count = 0;
  const tEnd = time[time.length - 1];
  for (let tTr = t0; tTr < tEnd + period; tTr += period) {
    const halfDur = durDays * 1.5;
    const pts = flux.filter((_, i) => time[i] >= tTr - halfDur && time[i] <= tTr + halfDur);
    if (pts.length >= 2 && Math.min(...pts) < threshold) count++;
  }
  return Math.min(count, 99);
}

export function extractFeatures(fitsData: ParsedFitsData): ExoplanetFeatures | null {
  const timeCol = fitsData.columns.find(c => c === 'TIME') ?? fitsData.columns[0];
  const fluxCol =
    fitsData.columns.find(c => c === 'PDCSAP_FLUX') ??
    fitsData.columns.find(c => c === 'SAP_FLUX') ??
    fitsData.columns.find(c => c === 'FLUX');

  if (!timeCol || !fluxCol) return null;

  const rawT: number[] = [], rawF: number[] = [];
  for (let i = 0; i < fitsData.rowCount; i++) {
    const t = fitsData.data[timeCol][i];
    const f = fitsData.data[fluxCol][i];
    if (t !== null && f !== null && isFinite(t) && isFinite(f) && f > 0) {
      rawT.push(t); rawF.push(f);
    }
  }
  if (rawT.length < 100) return null;

  const idx  = rawT.map((_, i) => i).sort((a, b) => rawT[a] - rawT[b]);
  const time = idx.map(i => rawT[i]);
  const flux = idx.map(i => rawF[i]);

  const allHdr        = [...fitsData.primaryHeader, ...fitsData.extensionHeader];
  const teffInFile    = headerNum(allHdr, 'TEFF',   'TEFF_KIC',   'TEFFKIC');
  const loggInFile    = headerNum(allHdr, 'LOGG',   'LOGG_KIC',   'LOGGKIC');
  const radiusInFile  = headerNum(allHdr, 'RADIUS', 'RADIUS_KIC', 'RADIUSKIC');
  const stellarTeff   = teffInFile   ?? 5778;
  const stellarLogg   = loggInFile   ?? 4.44;
  const stellarRadius = radiusInFile ?? 1.0;

  const totalDays = time[time.length - 1] - time[0];

  // Normalize
  const med = medianVal(flux);
  if (med === 0 || !isFinite(med)) return null;
  const normFlux = flux.map(v => v / med);
  const fmean = normFlux.reduce((a, b) => a + b, 0) / normFlux.length;
  const fstd  = Math.sqrt(normFlux.reduce((a, b) => a + (b - fmean) ** 2, 0) / normFlux.length);

  // Downsample to max 15000 points
  const MAX_PTS = 15000;
  const step = time.length > MAX_PTS ? Math.floor(time.length / MAX_PTS) : 1;
  const t = step > 1 ? time.filter((_, i) => i % step === 0) : time;
  const f = step > 1 ? normFlux.filter((_, i) => i % step === 0) : normFlux;

  // ── DETREND with sliding median ───────────────────────────────────────────
  // Window = 0.75 days: longer than any transit, shorter than stellar rotation
  const windowHalf = 0.75 / 2;
  const detrended  = new Array(t.length).fill(1.0);

  // For speed: use a sorted approach — precompute sorted time indices
  for (let i = 0; i < t.length; i++) {
    const local: number[] = [];
    // Binary search for window bounds
    let lo = i, hi = i;
    while (lo > 0 && t[i] - t[lo - 1] <= windowHalf) lo--;
    while (hi < t.length - 1 && t[hi + 1] - t[i] <= windowHalf) hi++;
    for (let j = lo; j <= hi; j++) local.push(f[j]);
    const localMed = medianVal(local);
    detrended[i] = localMed > 0 ? f[i] / localMed : 1.0;
  }

  // Clip >4σ outliers from detrended flux
  const dMean = detrended.reduce((a, b) => a + b, 0) / detrended.length;
  const dStd  = Math.sqrt(detrended.reduce((a, b) => a + (b - dMean) ** 2, 0) / detrended.length);
  const tBLS: number[] = [], fBLS: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (Math.abs(detrended[i] - 1.0) < 4 * dStd) {
      tBLS.push(t[i]); fBLS.push(detrended[i]);
    }
  }

  // ── BLS ──────────────────────────────────────────────────────────────────
  const minP = 0.3;
  const maxP = Math.min(totalDays * 0.49, 500);
  const bls  = runBLS(
    tBLS.length > 50 ? tBLS : t,
    fBLS.length > 50 ? fBLS : detrended,
    minP, maxP
  );

  const periodDays = bls.period;
  const depthFrac  = bls.depthFrac;
  const depthPpm   = depthFrac * 1e6;

  // Physics cap on duration
  const physMaxDurHr = 13 * Math.pow(stellarRadius, 1/3) * Math.pow(periodDays / 365.25, 1/3);
  const rawDurHr     = bls.durationFrac * periodDays * 24;
  const durationHr   = Math.min(rawDurHr, physMaxDurHr * 2.0);
  const durationDays = durationHr / 24;
  const dutyCycle    = durationHr / (periodDays * 24);

  const depthPerHr  = durationHr > 0 ? depthPpm / durationHr : 0;
  const logDepth    = Math.log10(Math.max(1, depthPpm));
  const logPeriod   = Math.log10(Math.max(0.1, periodDays));
  const logDuration = Math.log10(Math.max(0.01, durationHr));
  const depthXlogg  = depthPpm * stellarLogg;
  const periodXsrad = periodDays / Math.max(stellarRadius, 0.1);

  const tUI = tBLS.length > 50 ? tBLS : t;
  const fUI = fBLS.length > 50 ? fBLS : detrended;
  const nTransits = countTransits(tUI, fUI, periodDays, bls.t0, durationDays, 1 - depthFrac * 0.5);
  const rRatio    = Math.sqrt(Math.max(0, depthFrac));
  const estRadius = rRatio * stellarRadius * 109.076;
  const aAU       = Math.pow((periodDays / 365.25) ** 2, 1/3);
  const eqTemp    = stellarTeff * Math.pow(stellarRadius / (2 * aAU * 215.032), 0.5) *
                    Math.pow(0.7, 0.25);

  const feat: ExoplanetFeatures = {
    period_days:          periodDays,
    transit_depth_ppm:    depthPpm,
    transit_duration_hr:  durationHr,
    stellar_teff_k:       stellarTeff,
    stellar_logg:         stellarLogg,
    stellar_radius_rsun:  stellarRadius,
    depth_per_hr:         depthPerHr,
    duty_cycle:           dutyCycle,
    log_depth:            logDepth,
    log_period:           logPeriod,
    log_duration:         logDuration,
    depth_x_logg:         depthXlogg,
    period_x_srad:        periodXsrad,

    n_transits:               nTransits,
    est_planet_radius_rearth: isFinite(estRadius) ? Math.max(0, estRadius) : 0,
    eq_temperature_k:         isFinite(eqTemp)    ? Math.max(0, eqTemp)    : 0,
    total_obs_days:           totalDays,
    flux_std:                 fstd,
    bls_snr:                  bls.snr,

    assumed_star_values: {
      temperature: teffInFile   === null,
      gravity:     loggInFile   === null,
      radius:      radiusInFile === null,
    },
  };

  for (const k of Object.keys(feat) as (keyof ExoplanetFeatures)[]) {
    const v = feat[k];
    if (typeof v === 'number' && !isFinite(v)) (feat[k] as number) = 0;
  }

  return feat;
}

export function getPlanetType(r: number): string {
  if (r < 1.25) return 'Earth-like';
  if (r < 2.0)  return 'Super-Earth';
  if (r < 6.0)  return 'Neptune-like';
  return 'Gas Giant';
}
