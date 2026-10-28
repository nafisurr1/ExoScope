import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Download, Zap, Star, AlertCircle, Loader, X } from 'lucide-react';
import { parseFitsFile } from '../utils/fitsParser';
import { ParsedFitsData } from '../types';

interface Props {
  onDataLoaded: (data: ParsedFitsData, name: string) => void;
}
interface KOITarget {
  kepid: number;
  name: string;
  disposition: 'CONFIRMED' | 'FALSE POSITIVE';
  period: number;
  radiusEarth: number;
  type: string;
  description: string;
}
interface SearchResult {
  kepid: number;
  kepler_name: string | null;
  koi_disposition: string;
  koi_period: number;
  koi_prad: number;
  koi_steff: number;
}

// Every ID, period and radius below is taken from NASA's KOI cumulative table
// (ml/koi_cumulative.csv). The false positives are described by the reason
// NASA's vetting flagged them for.
const CURATED: KOITarget[] = [
  { kepid: 5780885,  name: 'Kepler-7b',   disposition: 'CONFIRMED',     period: 4.89,  radiusEarth: 16.7, type: 'Hot Jupiter',  description: 'One of the least dense exoplanets known — very deep, clean transits.' },
  { kepid: 6922244,  name: 'Kepler-8b',   disposition: 'CONFIRMED',     period: 3.52,  radiusEarth: 14.6, type: 'Hot Jupiter',  description: 'A hot Jupiter around an F-type star with a misaligned orbit.' },
  { kepid: 11904151, name: 'Kepler-10b',  disposition: 'CONFIRMED',     period: 0.84,  radiusEarth: 1.43, type: 'Rocky',        description: 'First confirmed rocky exoplanet found by Kepler — ultra short period.' },
  { kepid: 11804465, name: 'Kepler-12b',  disposition: 'CONFIRMED',     period: 4.44,  radiusEarth: 18.1, type: 'Hot Jupiter',  description: 'Extremely inflated hot Jupiter — one of the largest known exoplanets.' },
  { kepid: 10593626, name: 'Kepler-22b',  disposition: 'CONFIRMED',     period: 289.9, radiusEarth: 2.34, type: 'Super-Earth',  description: 'First confirmed Kepler planet in the habitable zone of a Sun-like star.' },
  { kepid: 8120608,  name: 'Kepler-186f', disposition: 'CONFIRMED',     period: 129.9, radiusEarth: 1.18, type: 'Earth-sized',  description: 'First Earth-sized planet confirmed in the habitable zone of another star.' },
  { kepid: 11442793, name: 'Kepler-90g',  disposition: 'CONFIRMED',     period: 210.6, radiusEarth: 7.70, type: 'Gas Giant',    description: 'Part of the 8-planet Kepler-90 system — matching our solar system count.' },
  { kepid: 6541920,  name: 'Kepler-11b',  disposition: 'CONFIRMED',     period: 10.3,  radiusEarth: 1.84, type: 'Super-Earth',  description: 'Innermost of the six planets packed close around Kepler-11.' },
  { kepid: 11853905, name: 'Kepler-4b',   disposition: 'CONFIRMED',     period: 3.21,  radiusEarth: 4.13, type: 'Hot Neptune',  description: "One of Kepler's first five announced planets — a hot Neptune." },
  { kepid: 10874614, name: 'Kepler-6b',   disposition: 'CONFIRMED',     period: 3.23,  radiusEarth: 13.1, type: 'Hot Jupiter',  description: "Hot Jupiter around a metal-rich star; one of Kepler's first five announced planets." },
  { kepid: 2445129,  name: 'KIC 2445129', disposition: 'FALSE POSITIVE', period: 10.32, radiusEarth: 0,   type: 'False Positive', description: 'NASA found a second, shallower eclipse and a shifted light center: two stars, not a planet.' },
  { kepid: 9071386,  name: 'KIC 9071386', disposition: 'FALSE POSITIVE', period: 4.69,  radiusEarth: 0,   type: 'False Positive', description: 'NASA found a second, shallower eclipse between the main dips — the mark of two stars orbiting each other.' },
  { kepid: 6631721,  name: 'KIC 6631721', disposition: 'FALSE POSITIVE', period: 13.74, radiusEarth: 0,   type: 'False Positive', description: 'The light center moves during each dip, so NASA traced the dip to a different star nearby.' },
  { kepid: 8162790,  name: 'KIC 8162790', disposition: 'FALSE POSITIVE', period: 10.16, radiusEarth: 0,   type: 'False Positive', description: "Its dips line up in time with another known star's, so NASA ruled it light leaking from that star." },
];

// All known Kepler quarter timestamps, ordered by most common coverage
const QUARTER_TIMESTAMPS = [
  '2009259160929', // Q2 — most stars have this
  '2009350155506', // Q3
  '2010078095331', // Q5
  '2010174085026', // Q6
  '2010265121752', // Q7
  '2009166044711', // Q1 — shorter, some stars missing
  '2011024051157', // Q8
  '2011073133259', // Q9
  '2011177032512', // Q10
  '2011271113734', // Q11
  '2012004120508', // Q12
  '2012088054726', // Q13
  '2012179063303', // Q14
  '2012277125453', // Q15
  '2013011073430', // Q16
  '2013098041711', // Q17
  '2010009091648', // Q4
];

/**
 * Where to download a MAST file from. The deployed site goes through the Vercel
 * function in api/mast.ts; `npm run dev` cannot run that function, so it uses
 * the /mast-proxy route defined in vite.config.ts instead.
 */
function mastDownloadUrl(uri: string): string {
  return import.meta.env.DEV
    ? `/mast-proxy/api/v0.1/Download/file?uri=${encodeURIComponent(uri)}`
    : `/api/mast?uri=${encodeURIComponent(uri)}`;
}

/**
 * Probe a URL to check if it exists WITHOUT downloading the body and WITHOUT
 * Range headers (MAST blocks byte-range requests from browsers without auth).
 *
 * How it works:
 *   1. Start a plain GET fetch.
 *   2. As soon as the response headers arrive, read r.ok.
 *   3. Immediately abort — the body never downloads.
 *   4. Return whether the file exists.
 */
async function probeUrl(url: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return r.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}
/**
 * Query the MAST CAOM API (POST, x-www-form-urlencoded — MAST requires this).
 * Returns the first matching obsid string, or null.
 */
async function queryMastCaom(kepid: number): Promise<string | null> {
  const id9 = kepid.toString().padStart(9, '0');
  const targetName = `kplr${id9}`;

  const requestBody = JSON.stringify({
    service: 'Mast.Caom.Filtered',
    params: {
      filters: [
        { paramName: 'obs_collection',   values: ['Kepler'] },
        { paramName: 'target_name',      values: [targetName] },
        { paramName: 'dataproduct_type', values: ['timeseries'] },
      ],
    },
    format: 'json',
    pagesize: 10,
    page: 1,
  });

  const res = await fetch('https://mast.stsci.edu/api/v0.1/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `request=${encodeURIComponent(requestBody)}`,
  });

  if (!res.ok) return null;
  const data = await res.json();
  const rows: any[] = data?.data ?? [];
  if (!rows.length) return null;
  // Prefer rows that have obsid; fall back to obs_id
  for (const row of rows) {
    const id = row.obsid ?? row.obs_id;
    if (id != null) return id.toString();
  }
  return null;
}

/**
 * Given an obsid, fetch the product list and find an LLC FITS file URL.
 */
async function getMastProductUrl(obsid: string): Promise<string | null> {
  const requestBody = JSON.stringify({
    service: 'Mast.Caom.Products',
    params: { obsid },
    format: 'json',
  });

  const res = await fetch('https://mast.stsci.edu/api/v0.1/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `request=${encodeURIComponent(requestBody)}`,
  });

  if (!res.ok) return null;
  const data = await res.json();
  const products: any[] = data?.data ?? [];

  // Match on filename suffix OR on the productSubGroupDescription field
  const llc = products.find((p: any) => {
    const fn: string = p.productFilename ?? p.filename ?? '';
    const sg: string = p.productSubGroupDescription ?? p.productSubGroupDesc ?? '';
    return (
      (fn.endsWith('_llc.fits') || sg === 'LLC') &&
      (p.productType === 'SCIENCE' || !p.productType)
    );
  });

  if (!llc) return null;
  const uri: string = llc.dataURI ?? llc.dataUri ?? llc.uri ?? '';
  if (!uri) return null;
  return mastDownloadUrl(uri);
}

/**
 * Build direct MAST LLC URLs for all quarters and probe them in parallel
 * batches of 4 until one responds with HTTP 200.
 *
 * Key fix: NO Range headers — MAST blocks byte-range requests from browsers
 * without an auth token.  Instead we use AbortController (see probeUrl) to
 * avoid actually downloading the full FITS body during the probe phase.
 */
async function bruteForceQuarter(kepid: number): Promise<string | null> {
  const id9 = kepid.toString().padStart(9, '0');
  const id4 = id9.slice(0, 4);

  const allUrls = QUARTER_TIMESTAMPS.map((ts) => {
    const uri = `mast:Kepler/url/missions/kepler/lightcurves/${id4}/${id9}/kplr${id9}-${ts}_llc.fits`;
    return mastDownloadUrl(uri);
  });

  // Check in batches of 4 (concurrent) → fast but not hammering MAST
  const BATCH = 4;
  for (let i = 0; i < allUrls.length; i += BATCH) {
    const batch = allUrls.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const ok = await probeUrl(url);
        if (!ok) throw new Error('not found');
        return url;
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') return r.value;
    }
  }
  return null;
}

/**
 * Main entry: CAOM API first, then brute-force quarter scan.
 */
async function getMastLCUrl(kepid: number): Promise<string | null> {
  // CAOM API is deprecated — go straight to brute-force quarter scan
  return bruteForceQuarter(kepid);
}

async function searchArchive(query: string): Promise<SearchResult[]> {
  const q = query.trim().replace(/'/g, '');
  const qLower = q.toLowerCase();
  if (!q) return [];

  const isKIC      = /^\d{4,}$/.test(q);
  const isKOI      = /^koi/i.test(qLower);
  const isKeplerNum = /^kepler[-\s]?\d+/.test(qLower) && /\d/.test(q);

  let whereClause: string;

  if (isKIC) {
    whereClause = `kepid+eq+${encodeURIComponent(q)}`;
  } else if (isKOI) {
    whereClause = `kepoi_name+like+'%25${encodeURIComponent(q)}%25'`;
  } else if (isKeplerNum) {
    const num = q.replace(/kepler[-\s]?/i, '').trim();
    whereClause =
      `kepler_name+like+'Kepler-${encodeURIComponent(num)}+%25'` +
      `+OR+kepler_name+like+'Kepler-${encodeURIComponent(num)}+b'` +
      `+OR+kepler_name+like+'Kepler-${encodeURIComponent(num)}+c'` +
      `+OR+kepler_name+like+'Kepler-${encodeURIComponent(num)}+d'`;
  } else {
    whereClause = `kepler_name+like+'%25${encodeURIComponent(q)}%25'+OR+kepler_name+like+'%25${encodeURIComponent(q.charAt(0).toUpperCase()+q.slice(1))}%25'`;
  }

  const url =
    `https://exoplanetarchive.ipac.caltech.edu/cgi-bin/nstedAPI/nph-nstedAPI?` +
    `table=cumulative` +
    `&select=kepid,kepler_name,koi_disposition,koi_period,koi_prad,koi_steff` +
    `&where=${whereClause}` +
    `&format=json&order=koi_period`;

const controller2 = new AbortController();
const t2 = setTimeout(() => controller2.abort(), 30000);
const res = await fetch(url, { signal: controller2.signal });
clearTimeout(t2);
  if (!res.ok) throw new Error(`Archive returned ${res.status}`);
  const data = await res.json();

  return (Array.isArray(data) ? data : [])
    .filter((r: any) =>
      r.koi_disposition === 'CONFIRMED' || r.koi_disposition === 'FALSE POSITIVE'
    )
    .slice(0, 12);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const dispositionColor = (d: string) =>
  d === 'CONFIRMED'
    ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800'
    : 'bg-red-900/30 text-red-400 border-red-900';

const typeColor = (t: string) => {
  if (t === 'Hot Jupiter' || t === 'Gas Giant') return 'text-orange-400';
  if (t === 'Super-Earth' || t === 'Rocky')     return 'text-cyan-400';
  if (t === 'Earth-sized')                       return 'text-green-400';
  if (t === 'Hot Neptune')                       return 'text-blue-400';
  return 'text-slate-400';
};

interface CardProps extends KOITarget {
  onAnalyze:  (kepid: number, name: string) => void;
  onDownload: (kepid: number, name: string) => void;
  loadingId:  number | null;
}

const TargetCard: React.FC<CardProps> = ({
  kepid, name, disposition, period, radiusEarth, type, description,
  onAnalyze, onDownload, loadingId,
}) => {
  const loading = loadingId === kepid;
  return (
    <div className="flex flex-col gap-3 bg-slate-900/60 border border-slate-800 hover:border-slate-600 rounded-xl p-4 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-slate-100 text-sm font-semibold leading-tight">{name}</p>
          <p className="text-slate-500 text-xs mt-0.5">KIC {kepid}</p>
        </div>
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${dispositionColor(disposition)}`}>
          {disposition === 'CONFIRMED' ? 'Planet' : 'False +'}
        </span>
      </div>

      <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">{description}</p>

      <div className="flex gap-3 text-xs text-slate-500">
        <span>P = {period.toFixed(2)}d</span>
        {radiusEarth > 0 && <span>R = {radiusEarth.toFixed(1)} R⊕</span>}
        <span className={typeColor(type)}>{type}</span>
      </div>

      <div className="flex gap-2 mt-auto">
        <button
          onClick={() => onAnalyze(kepid, name)}
          disabled={!!loadingId}
          className="flex-1 flex items-center justify-center gap-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium py-1.5 rounded-lg transition-colors"
        >
          {loading
            ? <><Loader className="w-3 h-3 animate-spin" />Fetching…</>
            : <><Zap className="w-3 h-3" />Analyze</>}
        </button>
        <button
          onClick={() => onDownload(kepid, name)}
          disabled={!!loadingId}
          className="flex items-center justify-center gap-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          <Download className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

const ArchiveSearch: React.FC<Props> = ({ onDataLoaded }) => {
  const [query,         setQuery]         = useState('');
  const [suggestions,   setSuggestions]   = useState<KOITarget[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching,     setSearching]     = useState(false);
  const [loadingId,     setLoadingId]     = useState<number | null>(null);
  const [error,         setError]         = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setSuggestions(shuffle(CURATED).slice(0, 6)); }, []);

  const fetchAndProcess = useCallback(
    async (kepid: number, displayName: string, download: boolean) => {
      setLoadingId(kepid);
      setError('');
      try {
        const url = await getMastLCUrl(kepid);
        if (!url) {
          throw new Error(
            `No light curve found for KIC ${kepid} on MAST. ` +
            `This star may not have Kepler long-cadence data, or the file is restricted.`
          );
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`MAST returned HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();

        if (download) {
          const blob = new Blob([buffer], { type: 'application/octet-stream' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${displayName.replace(/\s+/g, '_')}_lc.fits`;
          a.click();
          URL.revokeObjectURL(a.href);
        } else {
          const parsed = await parseFitsFile(buffer);
          onDataLoaded(parsed, `${displayName} (KIC ${kepid})`);
        }
      } catch (e: any) {
        setError(e.message || 'Failed to fetch from MAST.');
      } finally {
        setLoadingId(null);
      }
    },
    [onDataLoaded]
  );

  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setError('');
      try {
        const results = await searchArchive(query);
        setSearchResults(results);
      } catch (e: any) {
        setError('Search failed — check your connection.');
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 600);
  }, [query]);

  const toCard = (r: SearchResult) => {
    const prad = r.koi_prad ?? 0;
    const type =
      prad > 10 ? 'Hot Jupiter' :
      prad > 4  ? 'Sub-Neptune' :
      prad > 1.5 ? 'Super-Earth' :
      prad > 0  ? 'Earth-sized' : 'Unknown';

    return (
      <TargetCard
        key={r.kepid}
        kepid={r.kepid}
        name={r.kepler_name || `KIC ${r.kepid}`}
        disposition={r.koi_disposition as 'CONFIRMED' | 'FALSE POSITIVE'}
        period={r.koi_period ?? 0}
        radiusEarth={prad}
        type={type}
        description={
          r.koi_disposition === 'CONFIRMED'
            ? `Confirmed planet — ${r.koi_period?.toFixed(2)}-day orbit, ${prad.toFixed(1)} R⊕.`
            : `False positive — orbital period ${r.koi_period?.toFixed(2)} days.`
        }
        onAnalyze={(id, name) => fetchAndProcess(id, name, false)}
        onDownload={(id, name) => fetchAndProcess(id, name, true)}
        loadingId={loadingId}
      />
    );
  };

  return (
    <div className="mt-8 space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Search NASA archive — try "Kepler-22" or a KIC number…'
          className="w-full bg-slate-900/70 border border-slate-700 rounded-xl pl-10 pr-10 py-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-600 transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-red-950/40 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Searching indicator */}
      {searching && (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader className="w-4 h-4 animate-spin" />
          Searching NASA Exoplanet Archive…
        </div>
      )}

      {/* Search results */}
      {searchResults !== null && !searching && (
        <>
          <p className="text-slate-400 text-xs">
            {searchResults.length > 0
              ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} from NASA Exoplanet Archive`
              : 'No results. Try "Kepler-22" or a KIC number like "10593626".'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchResults.map(toCard)}
          </div>
        </>
      )}

      {/* Suggested targets */}
      {searchResults === null && !searching && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Star className="w-4 h-4" />
              Suggested targets
            </div>
            <button
              onClick={() => setSuggestions(shuffle(CURATED).slice(0, 6))}
              className="text-xs text-slate-500 hover:text-cyan-400 transition-colors"
            >
              Shuffle ↺
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {suggestions.map(t => (
              <TargetCard
                key={t.kepid}
                {...t}
                onAnalyze={(id, name) => fetchAndProcess(id, name, false)}
                onDownload={(id, name) => fetchAndProcess(id, name, true)}
                loadingId={loadingId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ArchiveSearch;
