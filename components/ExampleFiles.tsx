import React from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { parseFitsFile } from '../utils/fitsParser';
import { ParsedFitsData } from '../types';

// Unedited Kepler long-cadence files (quarter 2) from NASA's MAST archive, served
// from public/examples/. Both include the star's temperature, size and gravity.
const EXAMPLES = {
  positive: 'kplr003115833-2009259160929_llc.fits',  // KOI-797.01, planet candidate
  negative: 'kplr011619964-2009259160929_llc.fits',  // KOI-7466.01, false positive (eclipsing binary)
};

interface ExampleFilesProps {
  onDataLoaded: (data: ParsedFitsData, fileName: string) => void;
}

const ExampleFiles: React.FC<ExampleFilesProps> = ({ onDataLoaded }) => {
  const [loading, setLoading] = React.useState<string | null>(null);

  const load = async (type: 'positive' | 'negative') => {
    const name = EXAMPLES[type];
    setLoading(type);
    try {
      const response = await fetch(`/examples/${name}`);
      if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status})`);
      const data = await parseFitsFile(await response.arrayBuffer());
      onDataLoaded(data, name);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <p className="text-center text-slate-500 text-xs mb-3 uppercase tracking-widest">or try an example file</p>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => load('positive')}
          disabled={!!loading}
          className="group flex flex-col items-center gap-2 p-4 bg-slate-900/60 border border-cyan-900/50 hover:border-cyan-500/60 hover:bg-slate-900 rounded-xl transition-all duration-200 disabled:opacity-50"
        >
          {loading === 'positive' ? (
            <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full" />
          ) : (
            <CheckCircle className="w-6 h-6 text-cyan-400 group-hover:scale-110 transition-transform" />
          )}
          <span className="text-slate-200 font-medium text-sm">Planet Candidate</span>
          <span className="text-slate-500 text-xs font-mono">KIC 3115833 · K00797.01</span>
        </button>

        <button
          onClick={() => load('negative')}
          disabled={!!loading}
          className="group flex flex-col items-center gap-2 p-4 bg-slate-900/60 border border-slate-700/50 hover:border-slate-500/60 hover:bg-slate-900 rounded-xl transition-all duration-200 disabled:opacity-50"
        >
          {loading === 'negative' ? (
            <div className="animate-spin w-6 h-6 border-2 border-slate-400 border-t-transparent rounded-full" />
          ) : (
            <XCircle className="w-6 h-6 text-slate-400 group-hover:scale-110 transition-transform" />
          )}
          <span className="text-slate-200 font-medium text-sm">False Positive</span>
          <span className="text-slate-500 text-xs font-mono">KIC 11619964 · K07466.01</span>
        </button>
      </div>
    </div>
  );
};

export default ExampleFiles;
