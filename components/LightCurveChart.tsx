import React, { useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
  ReferenceLine,
} from 'recharts';
import { ParsedFitsData, DataPoint } from '../types';
import { Activity, AlertTriangle } from 'lucide-react';

interface LightCurveChartProps {
  data: ParsedFitsData;
}

// ---------------------------------------------------------------------------
// Largest-Triangle-Three-Buckets (LTTB) downsampling
// Preserves the visual shape of the curve while reducing point count.
// Reference: Sveinn Steinarsson, 2013.
// ---------------------------------------------------------------------------
function lttbDownsample(points: DataPoint[], threshold: number): DataPoint[] {
  const n = points.length;
  if (n <= threshold) return points;

  const sampled: DataPoint[] = [points[0]];
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0; // index of last selected point

  for (let i = 0; i < threshold - 2; i++) {
    // Bucket boundaries
    const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const bucketEnd   = Math.min(Math.floor((i + 2) * bucketSize) + 1, n - 1);

    // Average of NEXT bucket (used as the "far" point for triangle area)
    const nextBucketStart = bucketEnd;
    const nextBucketEnd   = Math.min(Math.floor((i + 3) * bucketSize) + 1, n - 1);
    let avgTime = 0, avgFlux = 0, nextCount = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgTime += points[j].time;
      avgFlux += points[j].flux;
      nextCount++;
    }
    if (nextCount > 0) { avgTime /= nextCount; avgFlux /= nextCount; }

    // Point A (last selected)
    const aPoint = points[a];
    let maxArea = -1, maxIdx = bucketStart;

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (aPoint.time - avgTime) * (points[j].flux - aPoint.flux) -
        (aPoint.time - points[j].time) * (avgFlux - aPoint.flux)
      ) * 0.5;
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }

    sampled.push(points[maxIdx]);
    a = maxIdx;
  }

  sampled.push(points[n - 1]);
  return sampled;
}

// Median of an array (fast, non-mutating)
function median(arr: number[]): number {
  if (arr.length === 0) return 1;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const MAX_DISPLAY_POINTS = 3000;

const LightCurveChart: React.FC<LightCurveChartProps> = ({ data }) => {
  const [useRawFlux, setUseRawFlux]       = useState(false);
  const [normalized, setNormalized]       = useState(true);

  // --- FIX: read BJD reference epoch from header (Kepler=2454833, TESS=2457000) ---
  const bjdRef = useMemo(() => {
    const allCards = [...data.primaryHeader, ...data.extensionHeader];
    const bjdrefi = allCards.find(c => c.key === 'BJDREFI');
    const bjdreff = allCards.find(c => c.key === 'BJDREFF');
    if (bjdrefi !== undefined && bjdrefi.value !== null) {
      const intPart  = Number(bjdrefi.value);
      const fracPart = bjdreff ? Number(bjdreff.value) : 0;
      return intPart + fracPart;
    }
    // Fallback: try TSTART keyword's context or default to Kepler epoch
    return 2454833;
  }, [data]);

  // --- FIX: flux normalization + downsampling ---
  const { chartData, wasDownsampled, originalCount } = useMemo(() => {
    const timeCol = data.columns.find(c => c.includes('TIME'));
    const fluxCol = useRawFlux
      ? data.columns.find(c => c === 'SAP_FLUX')
      : (data.columns.find(c => c === 'PDCSAP_FLUX') || data.columns.find(c => c === 'SAP_FLUX'));

    const finalTimeCol = timeCol || data.columns[0];
    const finalFluxCol = fluxCol  || data.columns[1];

    if (!finalTimeCol || !finalFluxCol) {
      return { chartData: [], wasDownsampled: false, originalCount: 0 };
    }

    const times  = data.data[finalTimeCol];
    const fluxes = data.data[finalFluxCol];
    const raw: DataPoint[] = [];
    const validFluxes: number[] = [];

    for (let i = 0; i < data.rowCount; i++) {
      const t = times[i];
      const f = fluxes[i];
      if (t !== null && f !== null && isFinite(f)) {
        raw.push({ time: t, flux: f });
        validFluxes.push(f);
      }
    }

    raw.sort((a, b) => a.time - b.time);

    // Normalize: divide by median so quiet level ≈ 1.0
    // This makes transit dips visually obvious as drops below 1.0.
    let points = raw;
    if (normalized && validFluxes.length > 0) {
      const med = median(validFluxes);
      if (med !== 0) {
        points = raw.map(p => ({ ...p, flux: p.flux / med }));
      }
    }

    const originalCount = points.length;
    const chartData = lttbDownsample(points, MAX_DISPLAY_POINTS);
    return { chartData, wasDownsampled: chartData.length < originalCount, originalCount };
  }, [data, useRawFlux, normalized]);

  if (chartData.length === 0) {
    return (
      <div className="p-12 text-center border border-slate-800 rounded-xl bg-slate-900/30">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h3 className="text-xl text-slate-300">No Valid Light Curve Data Found</h3>
        <p className="text-slate-500 mt-2">Could not identify TIME and FLUX columns in the FITS table.</p>
        <div className="mt-4 text-xs text-left max-h-32 overflow-auto bg-slate-950 p-2 rounded border border-slate-800">
          Available columns: {data.columns.join(', ')}
        </div>
      </div>
    );
  }

  const fluxLabel    = useRawFlux ? 'Raw Flux (SAP)' : 'Processed Flux (PDCSAP)';
  const yAxisLabel   = normalized ? 'Normalized Flux' : 'Flux (e⁻/s)';
  const yTickFormat  = normalized
    ? (v: number) => v.toFixed(4)
    : (v: number) => v.toExponential(2);
  const tooltipFluxFmt = normalized
    ? (v: number) => [v.toFixed(6), fluxLabel]
    : (v: number) => [v.toExponential(4), fluxLabel];

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 backdrop-blur-sm">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-6 h-6 text-cyan-400" />
            Light Curve Visualization
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {wasDownsampled
              ? `Showing ${chartData.length.toLocaleString()} of ${originalCount.toLocaleString()} points (LTTB downsampled). `
              : `Displaying ${chartData.length.toLocaleString()} data points. `}
            Time axis: BJD − {bjdRef.toLocaleString()}
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Normalization toggle */}
          <div className="flex items-center bg-slate-950 rounded-lg p-1 border border-slate-800">
            <button
              onClick={() => setNormalized(true)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${normalized ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              Normalized
            </button>
            <button
              onClick={() => setNormalized(false)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${!normalized ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              Raw counts
            </button>
          </div>

          {/* Flux type toggle */}
          <div className="flex items-center bg-slate-950 rounded-lg p-1 border border-slate-800">
            <button
              onClick={() => setUseRawFlux(false)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${!useRawFlux ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/50' : 'text-slate-400 hover:text-white'}`}
            >
              Clean (PDCSAP)
            </button>
            <button
              onClick={() => setUseRawFlux(true)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${useRawFlux ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/50' : 'text-slate-400 hover:text-white'}`}
            >
              Raw (SAP)
            </button>
          </div>
        </div>
      </div>

      <div className="h-[500px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="time"
              type="number"
              domain={['auto', 'auto']}
              tickFormatter={(v) => v.toFixed(1)}
              stroke="#64748b"
              label={{ value: `Time (BJD − ${bjdRef.toLocaleString()})`, position: 'insideBottom', offset: -20, fill: '#64748b' }}
            />
            <YAxis
              domain={['auto', 'auto']}
              stroke="#64748b"
              tickFormatter={yTickFormat}
              width={90}
              label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#64748b' }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
              itemStyle={{ color: '#22d3ee' }}
              formatter={(value: number) => tooltipFluxFmt(value)}
              labelFormatter={(label) => `Time: ${Number(label).toFixed(4)}`}
            />
            {/* Reference line at 1.0 when normalized — shows where transit floor is */}
            {normalized && (
              <ReferenceLine y={1} stroke="#334155" strokeDasharray="4 4" />
            )}
            <Line
              type="monotone"
              dataKey="flux"
              stroke="#22d3ee"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, fill: '#fff' }}
              animationDuration={800}
            />
            <Brush
              dataKey="time"
              height={30}
              stroke="#22d3ee"
              fill="#0f172a"
              tickFormatter={() => ''}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default LightCurveChart;
