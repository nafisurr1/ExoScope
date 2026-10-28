import * as ort from 'onnxruntime-web';
import { ExoplanetFeatures } from './exoplanetFeatures';

// Pin the WASM runtime to the exact version of the JS glue in package.json.
// The unpinned URL resolves to jsDelivr's "latest", which drifted to 1.27.0 while
// the bundled glue was 1.24.3. That mismatch made the classifier emit [-p, +p]
// instead of [p0, p1] — the sum was 0 and class 0 was negative. Nothing threw;
// results were only still correct because extractProbPlanet reads index [1].
// Keep this string in sync with the onnxruntime-web version in package.json.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

export interface PredictionResult {
  isExoplanet:       boolean;
  /** Random Forest probability (0-1) that the signal is a planet. */
  planetProbability: number;
  features:          ExoplanetFeatures;
}

/**
 * The Random Forest alone decides. Signal strength (BLS SNR) used to carry 60%
 * of the vote, but on 170 real Kepler quarters (85 confirmed planets, 85 false
 * positives) it ranked false positives above planets (AUC 0.413), because
 * eclipsing binaries make deeper, stronger dips. The blend got 59.4% right;
 * the forest alone at a 50% cutoff got 73.5%.
 */
const PLANET_CUTOFF = 0.5;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create('/model/exoscope_model.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }
  return sessionPromise;
}

/** Must match FEATURE_SPEC in train_model.py exactly — 13 features */
function buildFeatureVector(f: ExoplanetFeatures): Float32Array {
  const logDur      = Math.log10(Math.max(f.transit_duration_hr, 0.01));
  const depthXlogg  = f.transit_depth_ppm * f.stellar_logg;
  const periodXsrad = f.period_days / Math.max(f.stellar_radius_rsun, 0.1);
  return new Float32Array([
    f.period_days,
    f.transit_depth_ppm,
    f.transit_duration_hr,
    f.stellar_teff_k,
    f.stellar_logg,
    f.stellar_radius_rsun,
    f.depth_per_hr,
    f.duty_cycle,
    f.log_depth,
    f.log_period,
    logDur,
    depthXlogg,
    periodXsrad,
  ]);
}

function extractProbPlanet(output: ort.InferenceSession.OnnxValueMapType): number {
  const keys = Object.keys(output);
  for (const key of keys) {
    const val = output[key];
    if (val instanceof ort.Tensor) {
      const data = val.data as Float32Array | Int32Array | BigInt64Array;
      if (val.dims.length === 2 && val.dims[1] === 2) return Number(data[1]);
      if (val.dims.length === 1 || (val.dims.length === 2 && val.dims[1] === 1)) {
        const v = Number(data[0]);
        if (v !== 0 && v !== 1) return v;
      }
    }
  }
  for (const key of keys) {
    const val = output[key];
    if (val instanceof ort.Tensor) {
      const v = Number((val.data as any)[0]);
      if (v === 0 || v === 1) return v === 1 ? 0.75 : 0.25;
    }
  }
  return 0.5;
}

export async function runPrediction(features: ExoplanetFeatures): Promise<PredictionResult> {
  const session = await getSession();

  const vec    = buildFeatureVector(features);
  const tensor = new ort.Tensor('float32', vec, [1, 13]);
  const feeds  = { [session.inputNames[0]]: tensor };

  console.log('[ExoScope] Feature vector:', {
    period_days:         features.period_days,
    transit_depth_ppm:   features.transit_depth_ppm,
    transit_duration_hr: features.transit_duration_hr,
    duty_cycle:          features.duty_cycle,
    bls_snr:             features.bls_snr,
    stellar_teff_k:      features.stellar_teff_k,
    stellar_radius_rsun: features.stellar_radius_rsun,
  });

  let output: ort.InferenceSession.OnnxValueMapType;
  try {
    output = await session.run(feeds);
  } catch (e: any) {
    throw new Error('Model format incompatible — please retrain. ' + e.message);
  }

  const probTensor = output['probabilities'];
  if (probTensor instanceof ort.Tensor) {
    const d = probTensor.data as Float32Array;
    console.log('[ExoScope] Raw probs: class0=', d[0], ' class1=', d[1]);
  }

  const planetProbability = extractProbPlanet(output);
  console.log('[ExoScope] Planet probability:', planetProbability.toFixed(3));

  return {
    isExoplanet: planetProbability >= PLANET_CUTOFF,
    planetProbability,
    features,
  };
}
