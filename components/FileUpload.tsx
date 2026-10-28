import React, { useRef, useState } from 'react';
import { Upload, FileType, AlertCircle } from 'lucide-react';
import { parseFitsFile } from '../utils/fitsParser';
import { ParsedFitsData } from '../types';

interface FileUploadProps {
  onDataLoaded: (data: ParsedFitsData, fileName: string) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onDataLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const processFile = async (file: File) => {
    if (!file.name.endsWith('.fits') && !file.name.endsWith('.FITS')) {
      setError("Please upload a valid .fits file (e.g., kplr...llc.fits)");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsedData = await parseFitsFile(arrayBuffer);
      onDataLoaded(parsedData, file.name);
    } catch (err: any) {
      console.error(err);
      setError(`Failed to parse FITS file: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative group cursor-pointer border-2 border-dashed rounded-xl p-12 text-center transition-all duration-300
          ${isDragging 
            ? 'border-cyan-400 bg-cyan-900/20' 
            : 'border-slate-700 hover:border-cyan-500/50 hover:bg-slate-900'
          }
        `}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleChange}
          accept=".fits"
          className="hidden"
        />
        
        <div className="flex flex-col items-center gap-4">
          <div className={`p-4 rounded-full ${isDragging ? 'bg-cyan-500/20' : 'bg-slate-800 group-hover:bg-slate-700'} transition-colors`}>
            {loading ? (
              <div className="animate-spin w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full" />
            ) : (
              <Upload className={`w-8 h-8 ${isDragging ? 'text-cyan-400' : 'text-slate-400'}`} />
            )}
          </div>
          
          <div>
            <h3 className="text-lg font-medium text-slate-200">
              {loading ? "Reading file..." : "Upload Light Curve File"}
            </h3>
            <p className="text-slate-400 mt-1 text-sm">
              Drag & drop a Kepler <code className="bg-slate-800 px-1 py-0.5 rounded text-cyan-300">.fits</code> file here
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-900/20 border border-red-900/50 rounded-lg flex items-center gap-3 text-red-300 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
