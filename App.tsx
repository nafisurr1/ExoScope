import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Telescope, FileQuestion, Zap } from 'lucide-react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import FileUpload from './components/FileUpload';
import MetadataViewer from './components/MetadataViewer';
import LightCurveChart from './components/LightCurveChart';
import { ParsedFitsData } from './types';

// =============================================================================
// DEMO LIGHT CURVE
// Self-contained component. Zero props. Zero external data dependencies.
// Generates physically-motivated synthetic light curves and streams them
// onto the chart via a requestAnimationFrame loop.
// =============================================================================

// ── Types ────────────────────────────────────────────────────────────────────
type ScenarioId = 'hot_jupiter' | 'earth_analog' | 'variable_star';

interface DemoPoint {
  time: number;   // BJD offset (arbitrary, starts at 0)
  flux: number;   // normalised flux (quiet = 1.0)
}

interface Scenario {
  id:           ScenarioId;
  label:        string;
  description:  string;
  hasTransit:   boolean;
  transitDepth: number;   // fractional (e.g. 0.02 = 2 %)
  transitDepthPpm: number;
}

// ── Scenario catalogue ───────────────────────────────────────────────────────
const SCENARIOS: Scenario[] = [
  {
    id:              'hot_jupiter',
    label:           'Hot Jupiter',
    description:     'Gas giant 10× Jupiter mass, 3-day orbit',
    hasTransit:      true,
    transitDepth:    0.021,
    transitDepthPpm: 21000,
  },
  {
    id:              'earth_analog',
    label:           'Earth Analog',
    description:     'Rocky planet, 365-day orbit around a Sun-like star',
    hasTransit:      true,
    transitDepth:    0.00084,
    transitDepthPpm: 840,
  },
  {
    id:              'variable_star',
    label:           'Variable Star',
    description:     'Rotating starspots — no transiting planet',
    hasTransit:      false,
    transitDepth:    0,
    transitDepthPpm: 0,
  },
];

// ── Gaussian noise via Box-Muller transform ──────────────────────────────────
// Returns a single normally-distributed random value with mean=0, std=1.
function gaussianNoise(): number {
  // Box-Muller: two uniform samples → one Gaussian sample
  let u = 0, v = 0;
  while (u === 0) u = Math.random(); // avoid log(0)
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ── Trapezoidal transit model ────────────────────────────────────────────────
// Returns the fractional flux drop [0, depth] at phase φ (0 = mid-transit).
// ingress/egress are each `tau` wide in phase units.
// totalDuration is the full flat-bottom + ingress + egress span in phase.
function transitProfile(phi: number, depth: number, totalDuration: number, tau: number): number {
  const halfDur = totalDuration / 2;
  if (Math.abs(phi) > halfDur) return 0;                        // out of transit
  const halfFlat = halfDur - tau;
  if (Math.abs(phi) <= halfFlat) return depth;                  // flat bottom
  // ingress / egress ramp
  const ramp = (halfDur - Math.abs(phi)) / tau;
  return depth * Math.max(0, Math.min(1, ramp));
}

// ── Synthetic light-curve generator ─────────────────────────────────────────
// N_POINTS: number of cadences to generate (mirrors Kepler LC quarter length)
const N_POINTS = 420;

function generateScenario(id: ScenarioId): DemoPoint[] {
  const points: DemoPoint[] = [];

  // ── Common parameters ──
  const dt = 0.049;   // ~30-min cadence in days (Kepler long-cadence ≈ 0.0208 d,
                       // we use a slightly coarser step so the demo spans ~20 days)

  // ── Per-scenario parameters ──
  let noiseStd        = 0.0010;  // photon + read noise as fraction of flux
  let varAmp          = 0.0000;  // stellar variability amplitude
  let varPeriod       = 10.0;    // stellar rotation period (days)
  let varPhaseOffset  = 0.0;
  let transitDepth    = 0.0;
  let transitPeriod   = 3.5;     // orbital period (days)
  let transitDuration = 0.12;    // total transit duration (days)
  let transitTau      = 0.025;   // ingress/egress duration (days)
  let transitEpoch    = 2.0;     // time of first mid-transit (days)
  let trendSlope      = 0.0;     // long-term instrumental drift

  switch (id) {
    case 'hot_jupiter':
      noiseStd        = 0.00065;
      varAmp          = 0.0018;
      varPeriod       = 12.0;
      transitDepth    = 0.021;
      transitPeriod   = 3.52;
      transitDuration = 0.14;
      transitTau      = 0.028;
      transitEpoch    = 1.8;
      trendSlope      = 0.000003;
      break;

    case 'earth_analog':
      // Earth-like: very shallow transit, more noise, longer period
      // We compress time so 1 transit is visible in the demo window
      noiseStd        = 0.00120;
      varAmp          = 0.00090;
      varPeriod       = 25.0;
      transitDepth    = 0.00084;
      transitPeriod   = 18.0;   // compressed from 365d to fit demo window
      transitDuration = 0.20;
      transitTau      = 0.040;
      transitEpoch    = 9.0;
      trendSlope      = -0.000002;
      break;

    case 'variable_star':
      noiseStd        = 0.00080;
      varAmp          = 0.0140;   // large starspot amplitude
      varPeriod       = 8.3;
      varPhaseOffset  = 1.2;
      transitDepth    = 0;
      trendSlope      = 0.000004;
      break;
  }

  // ── Generate cadences ──
  for (let i = 0; i < N_POINTS; i++) {
    const t = i * dt;

    // 1. Long-term trend (instrumental drift)
    const trend = 1.0 + trendSlope * t;

    // 2. Stellar variability (rotation modulation)
    const variability = varAmp * Math.sin(
      (2 * Math.PI * t) / varPeriod + varPhaseOffset
    );

    // 3. Transit signal
    // Phase-fold: φ = (t − t0) mod P,  wrapped to [−P/2, P/2]
    let transitDrop = 0;
    if (transitDepth > 0) {
      let phi = ((t - transitEpoch) % transitPeriod + transitPeriod) % transitPeriod;
      if (phi > transitPeriod / 2) phi -= transitPeriod;
      transitDrop = transitProfile(phi, transitDepth, transitDuration, transitTau);
    }

    // 4. Gaussian noise
    const noise = noiseStd * gaussianNoise();

    // 5. Compose: multiply transit (physically correct — it's a fractional occlusion)
    const flux = (trend + variability + noise) * (1.0 - transitDrop);

    points.push({ time: t, flux });
  }

  return points;
}

// ── Animation constants ──────────────────────────────────────────────────────
const POINTS_PER_FRAME = 7;     // cadences revealed per RAF tick (~60 fps → ~0.9s to fill)
const HOLD_MS          = 3200;  // ms to hold the completed curve before cycling

// ── DemoLightCurve component ─────────────────────────────────────────────────
const DemoLightCurve: React.FC = () => {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [visibleCount,  setVisibleCount]  = useState(0);
  const [showAnnotation, setShowAnnotation] = useState(false);

  // Full dataset for the current scenario — stored in a ref so RAF closure
  // always sees the latest version without needing it as a dependency.
  const allPoints = useRef<DemoPoint[]>([]);
  const rafId     = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scenario = SCENARIOS[scenarioIndex];

  // ── Advance to the next scenario ──
  const advanceScenario = useCallback(() => {
    setShowAnnotation(false);
    setScenarioIndex(prev => (prev + 1) % SCENARIOS.length);
    setVisibleCount(0);
  }, []);

  // ── Re-generate data whenever the scenario changes ──
  useEffect(() => {
    allPoints.current = generateScenario(scenario.id);
  }, [scenario.id]);

  // ── RAF animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    // Cancel any previous animation / hold timer on scenario change
    if (rafId.current   !== null) cancelAnimationFrame(rafId.current);
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    setShowAnnotation(false);

    const total = allPoints.current.length;
    let current = 0;

    const tick = () => {
      current = Math.min(current + POINTS_PER_FRAME, total);
      setVisibleCount(current);

      if (current < total) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        // Animation complete — show annotation, then hold, then cycle
        if (scenario.hasTransit) {
          setShowAnnotation(true);
        }
        holdTimer.current = setTimeout(advanceScenario, HOLD_MS);
      }
    };

    rafId.current = requestAnimationFrame(tick);

    // Cleanup on unmount or before next effect run
    return () => {
      if (rafId.current   !== null) cancelAnimationFrame(rafId.current);
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    };
  }, [scenario.id, advanceScenario]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: advanceScenario is stable (useCallback with no deps that change).

  // ── Slice to currently visible points ──
  const chartData = allPoints.current.slice(0, visibleCount);
  const animationComplete = visibleCount >= allPoints.current.length;

  return (
    <div className="w-full mb-10">
      {/* Outer card — mirrors LightCurveChart's card exactly */}
      <div className="relative bg-slate-900/50 border border-slate-800 rounded-xl p-6 backdrop-blur-sm overflow-hidden">

        {/* ── DEMO badge (top-left) ── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 bg-cyan-950 border border-cyan-800 text-cyan-400 text-xs font-semibold px-3 py-1 rounded-full">
              <Zap className="w-3 h-3" />
              LIVE DEMO
            </span>
            <span className="text-slate-400 text-sm">
              {scenario.description}
            </span>
          </div>

          {/* Scenario indicator dots */}
          <div className="flex items-center gap-1.5">
            {SCENARIOS.map((s, i) => (
              <div
                key={s.id}
                className={`w-2 h-2 rounded-full transition-all duration-500 ${
                  i === scenarioIndex
                    ? 'bg-cyan-400 scale-125'
                    : 'bg-slate-700'
                }`}
              />
            ))}
          </div>
        </div>

        {/* ── Chart ── */}
        <div className="relative h-64 w-full">

          {/* Transit annotation — fades in when animation completes */}
          {scenario.hasTransit && (
            <div
              className="absolute top-2 right-2 z-10 transition-opacity duration-700"
              style={{ opacity: showAnnotation ? 1 : 0 }}
            >
              <div className="bg-slate-950/90 border border-violet-700/60 rounded-lg px-3 py-2 text-xs">
                <div className="flex items-center gap-1.5 text-violet-400 font-semibold mb-0.5">
                  <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse inline-block" />
                  Transit detected
                </div>
                <div className="text-slate-400">
                  Depth: <span className="text-slate-200 font-mono">
                    {scenario.transitDepthPpm.toLocaleString()} ppm
                  </span>
                </div>
              </div>
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 8, right: 16, left: 8, bottom: 24 }}
            >
              {/* Exact same grid/axis tokens as LightCurveChart */}
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                type="number"
                domain={[0, allPoints.current.length > 0
                  ? allPoints.current[allPoints.current.length - 1].time
                  : 20]}
                tickFormatter={(v: number) => v.toFixed(0)}
                stroke="#64748b"
                tick={{ fontSize: 11, fill: '#64748b' }}
                label={{
                  value: 'Time (days)',
                  position: 'insideBottom',
                  offset: -12,
                  fill: '#64748b',
                  fontSize: 11,
                }}
              />
              <YAxis
                domain={['auto', 'auto']}
                stroke="#64748b"
                tickFormatter={(v: number) => v.toFixed(4)}
                tick={{ fontSize: 11, fill: '#64748b' }}
                width={72}
                label={{
                  value: 'Normalized Flux',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#64748b',
                  fontSize: 11,
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#334155',
                  color: '#f1f5f9',
                  fontSize: 12,
                }}
                itemStyle={{ color: '#22d3ee' }}
                formatter={(value: number) => [value.toFixed(6), 'Flux']}
                labelFormatter={(label: number) => `Day ${Number(label).toFixed(2)}`}
              />
              {/* Reference line at 1.0 — same as LightCurveChart */}
              <ReferenceLine y={1} stroke="#334155" strokeDasharray="4 4" />
              {/* The light curve — same stroke/width as LightCurveChart */}
              <Line
                type="monotone"
                dataKey="flux"
                stroke="#22d3ee"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: '#fff' }}
                isAnimationActive={false}   // RAF handles animation, not Recharts
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ── Bottom bar: scenario label + progress ── */}
        <div className="flex items-center justify-between mt-3">
          {/* Scenario name pill */}
          <span className="text-xs font-medium text-cyan-400 bg-cyan-950/60 border border-cyan-900/50 px-2.5 py-1 rounded-full">
            {scenario.label}
          </span>

          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="w-32 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 rounded-full transition-none"
                style={{
                  width: `${allPoints.current.length > 0
                    ? (visibleCount / allPoints.current.length) * 100
                    : 0}%`,
                }}
              />
            </div>
            {animationComplete && (
              <span className="text-xs text-slate-500">
                next in {(HOLD_MS / 1000).toFixed(0)}s…
              </span>
            )}
          </div>
        </div>

        {/* Subtle vignette overlay so it reads as a background preview, not the main UI */}
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 60%, rgba(2,6,23,0.45) 100%)',
          }}
        />
      </div>
    </div>
  );
};

// =============================================================================
// APP
// Only change from original: DemoLightCurve injected between the <p> and
// the <FileUpload> in the hero section. Everything else is identical.
// =============================================================================
function App() {
  const [fitsData, setFitsData] = useState<ParsedFitsData | null>(null);
  const [fileName, setFileName] = useState<string>('');

  const handleDataLoaded = (data: ParsedFitsData, name: string) => {
    setFitsData(data);
    setFileName(name);
  };

  const handleReset = () => {
    setFitsData(null);
    setFileName('');
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]">
      {/* Navigation Bar — unchanged */}
      <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-2 rounded-lg">
                <Telescope className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
                ExoScope
              </span>
            </div>
            <div className="flex items-center gap-4">
              {/* Removed subtitle */}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Intro / Header — unchanged except DemoLightCurve inserted below <p> */}
        {!fitsData && (
          <div className="text-center py-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight mb-6">
              Explore the <span className="text-cyan-400">Universe</span> in Binary.
            </h1>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10">
              A purely client-side FITS parser for NASA Kepler &amp; TESS data.
              Upload a standard <code className="text-cyan-300">.fits</code> light
              curve file to instantly extract metadata and visualize photometric
              flux without sending data to a server.
            </p>

            {/* ── DEMO: inserted here, above FileUpload ── */}
            <DemoLightCurve />
          </div>
        )}

        {/* Upload Area — unchanged */}
        {!fitsData ? (
          <FileUpload onDataLoaded={handleDataLoaded} />
        ) : (
          <div className="animate-in fade-in zoom-in-95 duration-500">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <FileQuestion className="text-cyan-400" />
                <h2 className="text-xl font-semibold text-white">{fileName}</h2>
              </div>
              <button
                onClick={handleReset}
                className="text-slate-400 hover:text-white hover:bg-slate-800 px-4 py-2 rounded-lg transition-colors text-sm"
              >
                Go Back
              </button>
            </div>

            {/* Analysis Grid */}
            <div className="space-y-6">
              <MetadataViewer
                primaryHeader={fitsData.primaryHeader}
                extensionHeader={fitsData.extensionHeader}
              />
              <LightCurveChart data={fitsData} />
            </div>
          </div>
        )}

      </main>

      <footer className="border-t border-slate-900 mt-20 py-8 text-center text-slate-600 text-sm">
        <p>ExoScope © {new Date().getFullYear()} • Built for Astrophysics</p>
      </footer>
    </div>
  );
}

export default App;
