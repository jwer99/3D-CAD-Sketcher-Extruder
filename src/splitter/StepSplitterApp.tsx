import React, { useState, useEffect, useRef } from 'react';
import {
  Scissors,
  FileCode,
  Folder,
  FolderOpen,
  HardDrive,
  Play,
  CheckCircle2,
  AlertTriangle,
  Download,
  ExternalLink,
  RefreshCw,
  Layers,
  Cpu,
  Sparkles,
  Box,
  Terminal,
  Clock,
  ShieldCheck,
  ArrowRight,
  UploadCloud,
  ChevronRight,
  FileText
} from 'lucide-react';

interface PartFile {
  part_number: number;
  filename: string;
  path: string;
  size_bytes: number;
  size_mb: number;
  solids_count: number;
  component_names: string[];
}

interface LogEntry {
  id: string;
  time: string;
  type: 'info' | 'progress' | 'success' | 'warning' | 'error';
  message: string;
}

export default function StepSplitterApp() {
  // Input mode: 'path' for 750MB fast disk access, 'upload' for drag & drop
  const [inputMode, setInputMode] = useState<'path' | 'upload'>('path');
  const [localFilePath, setLocalFilePath] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [maxChunkMb, setMaxChunkMb] = useState(95);
  const [splitMode, setSplitMode] = useState<'size' | 'assembly' | 'individual'>('size');
  const [preserveColors, setPreserveColors] = useState(true);

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<{ name: string; sizeMb: string; path: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [generatedFiles, setGeneratedFiles] = useState<PartFile[]>([]);
  const [analysisInfo, setAnalysisInfo] = useState<{ total_items?: number; total_faces?: number; file_size_mb?: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Timer interval ref
  const timerRef = useRef<any>(null);

  // Suggested files detected in workspace
  const [suggestedFiles, setSuggestedFiles] = useState<{ name: string; path: string; sizeMb: string }[]>([]);

  // Load defaults from server
  useEffect(() => {
    fetch('/api/step-split/defaults')
      .then(res => res.json())
      .then(data => {
        if (data.defaultOutputDir) {
          setOutputDir(data.defaultOutputDir);
        }
        if (data.existingParts && data.existingParts.length > 0) {
          addLog('info', `Detectados ${data.existingParts.length} archivos STEP previamente particionados en '${data.defaultOutputDir}'.`);
          setGeneratedFiles(data.existingParts);
        }
        if (data.suggestedInputFiles && data.suggestedInputFiles.length > 0) {
          setSuggestedFiles(data.suggestedInputFiles);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Timer effect during run
  useEffect(() => {
    if (isRunning) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  const addLog = (type: LogEntry['type'], message: string) => {
    const timeStr = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-200), { id: `${Date.now()}_${Math.random()}`, time: timeStr, type, message }]);
  };

  // Handle Drag & Drop Upload
  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadProgress(0);
    addLog('info', `Subiendo archivo '${file.name}' (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/step-split/upload');
      xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(pct);
        }
      };

      xhr.onload = () => {
        setIsUploading(false);
        if (xhr.status === 200) {
          const res = JSON.parse(xhr.responseText);
          setUploadedFile({ name: file.name, sizeMb: res.sizeMb, path: res.filePath });
          addLog('success', `Archivo subido temporalmente a: ${res.filePath}`);
        } else {
          addLog('error', `Error al subir archivo: ${xhr.statusText}`);
        }
      };

      xhr.onerror = () => {
        setIsUploading(false);
        addLog('error', 'Error de red durante la subida.');
      };

      xhr.send(file);
    } catch (e: any) {
      setIsUploading(false);
      addLog('error', `Fallo al procesar archivo: ${e.message}`);
    }
  };

  // Start Splitting
  const handleStartSplit = async () => {
    const rawTarget = inputMode === 'path' ? localFilePath : uploadedFile?.path;
    const targetInput = (rawTarget || '').trim().replace(/^["']+|["']+$/g, '').trim();
    if (!targetInput) {
      setErrorMessage(inputMode === 'path' ? 'Ingresa la ruta del archivo STEP en tu equipo.' : 'Selecciona o sube un archivo STEP.');
      return;
    }

    setErrorMessage(null);
    setIsRunning(true);
    setIsSuccess(false);
    setProgress(2);
    setGeneratedFiles([]);
    setAnalysisInfo(null);
    setCurrentStage('Conectando con el motor OpenCASCADE 64-bit...');
    addLog('info', `Iniciando particionado de: ${targetInput}`);
    addLog('info', `Límite por parte: <= ${maxChunkMb} MB | Modo: ${splitMode}`);

    try {
      const response = await fetch('/api/step-split/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputPath: targetInput,
          outputDir: outputDir.trim(),
          maxChunkMb,
          splitMode,
          preserveColors
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Error del servidor (${response.status})`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      if (!reader) throw new Error('No se pudo establecer el canal de datos en vivo.');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const dataLine = block.split('\n').find(l => l.startsWith('data: '));
          if (!dataLine) continue;

          try {
            const data = JSON.parse(dataLine.replace('data: ', ''));

            if (data.type === 'progress') {
              setProgress(data.percent || 0);
              setCurrentStage(data.message || '');
              addLog('progress', data.message);
            } else if (data.type === 'analyzed') {
              setAnalysisInfo(data);
              addLog('info', `[ANÁLISIS] Sólidos: ${data.total_items} | Caras: ${data.total_faces?.toLocaleString()} | Tamaño: ${data.file_size_mb?.toFixed(1)} MB`);
            } else if (data.type === 'part_created') {
              setGeneratedFiles(prev => [...prev, data]);
              addLog('success', `✔ Generado: ${data.filename} (${data.size_mb} MB) [${data.solids_count} sólidos]`);
            } else if (data.type === 'completed') {
              setProgress(100);
              setIsSuccess(true);
              setCurrentStage(data.message);
              addLog('success', data.message);
            } else if (data.type === 'log') {
              addLog('info', data.message);
            } else if (data.type === 'warning') {
              addLog('warning', data.message);
            } else if (data.type === 'error') {
              setErrorMessage(data.message);
              addLog('error', data.message);
            }
          } catch (e) {}
        }
      }

    } catch (err: any) {
      setErrorMessage(err.message || 'Error inesperado durante la ejecución.');
      addLog('error', `Error: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  // Open output folder in Windows Explorer
  const handleOpenFolder = async (folderToOpen?: string) => {
    const target = folderToOpen || outputDir;
    try {
      const res = await fetch('/api/step-split/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: target })
      });
      if (res.ok) {
        addLog('success', `Abriendo Explorador de Windows en: ${target}`);
      } else {
        const j = await res.json();
        addLog('error', `No se pudo abrir la carpeta: ${j.error}`);
      }
    } catch (e: any) {
      addLog('error', `Error al abrir carpeta: ${e.message}`);
    }
  };

  // Open a specific part in 3D CAD Sketcher
  const handleOpenInSketcher = (file: PartFile) => {
    // Save to localStorage for instant picking by 3D CAD Sketcher
    localStorage.setItem('cad_pending_import_path', file.path);
    localStorage.setItem('cad_pending_import_name', file.filename);
    addLog('info', `Cargando '${file.filename}' en el visor 3D CAD Sketcher...`);
    
    // Open main app in new tab or navigate
    window.open(`/?importPath=${encodeURIComponent(file.path)}&name=${encodeURIComponent(file.filename)}`, '_blank');
  };

  // Open ALL parts together in 3D CAD Sketcher as a multi-body assembly
  const handleOpenAllInSketcher = () => {
    if (generatedFiles.length === 0) return;
    const payload = generatedFiles.map(f => ({ path: f.path, name: f.filename }));
    localStorage.setItem('cad_pending_import_paths', JSON.stringify(payload));
    addLog('info', `Enviando ${generatedFiles.length} partes a 3D CAD Sketcher para cargar ensamblaje completo...`);
    window.open(`/?importAll=${generatedFiles.length}`, '_blank');
  };

  // Trigger direct browser download of a part file
  const handleDownloadFile = (file: PartFile) => {
    const safeName = file.filename.toLowerCase().endsWith('.step') || file.filename.toLowerCase().endsWith('.stp')
      ? file.filename
      : `${file.filename}.step`;
    const downloadUrl = `/api/step-split/download/${encodeURIComponent(safeName)}?path=${encodeURIComponent(file.path)}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    addLog('info', `Iniciando descarga directa de: ${safeName} (${file.size_mb} MB)`);
  };

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-[#0d1322]/90 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400/30">
            <Scissors className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                STEP Partitioner Pro
                <span className="text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold">
                  v2.0 CAD
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              Divisor de Archivos CAD STEP Masivos en Partes Configurables (≤ 50, 100, 150, 200 MB)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>OpenCASCADE 64-bit Activo</span>
          </div>

          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 transition-all active:scale-95"
          >
            <Box className="w-4 h-4" />
            <span>Abrir 3D CAD Sketcher</span>
            <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
          </a>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Banner Alert for 750 MB Files */}
        <div className="bg-gradient-to-r from-blue-950/40 via-cyan-950/20 to-slate-900/40 border border-cyan-500/30 rounded-2xl p-4 flex items-start sm:items-center justify-between gap-4 shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-cyan-200">
                Optimizado para Archivos STEP Masivos (ej. 750 MB a 2 GB)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                El motor OpenCASCADE agrupa matemáticamente sólidos y ensamblajes en archivos independientes de <strong className="text-white">≤ {maxChunkMb} MB</strong> conservando las <strong className="text-cyan-300">coordenadas 3D globales</strong> y los colores originales.
              </p>
            </div>
          </div>
          <button
            onClick={() => handleOpenFolder()}
            className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Ver Carpeta de Salida</span>
          </button>
        </div>

        {/* Grid Setup: Left Configuration & Right Progress/Results */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column (Controls): 5 cols */}
          <div className="lg:col-span-5 space-y-5">
            
            {/* 1. Input Selection Card */}
            <div className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-cyan-400" />
                  <span>1. Archivo STEP de Entrada</span>
                </label>

                {/* Input Mode Selector */}
                <div className="flex bg-slate-900/90 p-0.5 rounded-lg border border-slate-800 text-[11px] font-medium">
                  <button
                    onClick={() => setInputMode('path')}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      inputMode === 'path'
                        ? 'bg-cyan-600 text-white shadow-sm font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Ruta Local (Directa)
                  </button>
                  <button
                    onClick={() => setInputMode('upload')}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      inputMode === 'upload'
                        ? 'bg-cyan-600 text-white shadow-sm font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Arrastrar / Explorar
                  </button>
                </div>
              </div>

              {inputMode === 'path' ? (
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      value={localFilePath}
                      onChange={(e) => {
                        const val = e.target.value.replace(/^["']+|["']+$/g, '');
                        setLocalFilePath(val);
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const text = e.clipboardData.getData('text');
                        const cleaned = text.trim().replace(/^["']+|["']+$/g, '').trim();
                        setLocalFilePath(cleaned);
                      }}
                      placeholder="C:\Users\...\tu_archivo_750mb.step"
                      className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 leading-tight">
                    💡 <strong>Recomendado para 750 MB:</strong> Escribe o pega la ruta completa del archivo en tu PC para procesarlo de disco a disco sin esperas de subida.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 hover:border-cyan-500/60 rounded-xl p-5 text-center cursor-pointer bg-slate-900/40 hover:bg-slate-900/70 transition-all flex flex-col items-center justify-center gap-2"
                  >
                    <UploadCloud className="w-8 h-8 text-cyan-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Haz clic para seleccionar o arrastra aquí tu archivo .step / .stp
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Soporta archivos grandes (el navegador puede tardar en cargar archivos de 700MB+)
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".step,.stp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileUpload(f);
                      }}
                    />
                  </div>

                  {isUploading && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>Subiendo archivo al servidor local...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-cyan-500 h-full transition-all duration-200"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {uploadedFile && (
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-500/30 text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span className="font-medium text-slate-200 truncate">{uploadedFile.name}</span>
                      </div>
                      <span className="text-cyan-400 font-mono text-[11px] shrink-0 font-semibold">{uploadedFile.sizeMb} MB</span>
                    </div>
                  )}
                </div>
              )}

              {/* Quick file selector for detected STEP files */}
              {suggestedFiles.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Archivos STEP detectados en el proyecto:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                    {suggestedFiles.map((sf) => (
                      <button
                        key={sf.path}
                        type="button"
                        onClick={() => {
                          setLocalFilePath(sf.path);
                          setInputMode('path');
                          addLog('info', `Seleccionado archivo: ${sf.name} (${sf.sizeMb} MB)`);
                        }}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] transition-all flex items-center gap-1.5 font-mono ${
                          localFilePath === sf.path
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 ring-1 ring-cyan-500'
                            : 'bg-slate-900/80 border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-200'
                        }`}
                        title={sf.path}
                      >
                        <FileCode className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span className="truncate max-w-[130px]">{sf.name}</span>
                        <span className="text-[10px] text-slate-500 font-sans">({sf.sizeMb} MB)</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Target Output Folder Card */}
            <div className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Folder className="w-4 h-4 text-blue-400" />
                  <span>2. Carpeta de Destino en Disco</span>
                </label>
                <button
                  onClick={() => handleOpenFolder()}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Abrir en Windows</span>
                </button>
              </div>

              <input
                type="text"
                value={outputDir}
                onChange={(e) => {
                  const val = e.target.value.replace(/^["']+|["']+$/g, '');
                  setOutputDir(val);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData('text');
                  const cleaned = text.trim().replace(/^["']+|["']+$/g, '').trim();
                  setOutputDir(cleaned);
                }}
                placeholder="C:\...\partes_step"
                className="w-full bg-[#080d1a] border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
              />
              <p className="text-[11px] text-slate-400">
                Los archivos resultantes (ej: <code>_parte_01.step</code>) se guardarán aquí automáticamente.
              </p>
            </div>

            {/* 3. Chunk Size & Strategy */}
            <div className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>3. Configuración del Tamaño de Trozo</span>
              </label>

              {/* Slider & Presets */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-300 font-medium">Tamaño máximo por archivo:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={maxChunkMb}
                      onChange={(e) => setMaxChunkMb(Math.max(10, Math.min(500, Number(e.target.value))))}
                      className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-center font-mono font-bold text-emerald-400 focus:outline-none focus:border-emerald-500"
                    />
                    <span className="text-xs text-slate-400 font-mono font-bold">MB</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="20"
                  max="300"
                  step="5"
                  value={maxChunkMb}
                  onChange={(e) => setMaxChunkMb(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />

                <div className="flex flex-wrap gap-1.5">
                  {[50, 95, 100, 150, 200].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setMaxChunkMb(preset)}
                      className={`flex-1 min-w-[50px] py-1.5 rounded-lg text-xs font-mono font-semibold transition-all border ${
                        maxChunkMb === preset
                          ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 shadow-sm ring-1 ring-emerald-500'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {preset} MB
                    </button>
                  ))}
                </div>
              </div>

              {/* Split Strategy */}
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <span className="text-xs text-slate-300 font-medium">Estrategia de división:</span>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <button
                    onClick={() => setSplitMode('size')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                      splitMode === 'size'
                        ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300 font-semibold'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Cpu className="w-4 h-4" />
                    <span className="text-[11px] leading-tight">Por Tamaño (≤ {maxChunkMb}MB)</span>
                  </button>

                  <button
                    onClick={() => setSplitMode('assembly')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                      splitMode === 'assembly'
                        ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300 font-semibold'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Box className="w-4 h-4" />
                    <span className="text-[11px] leading-tight">Sub-ensamblaje</span>
                  </button>

                  <button
                    onClick={() => setSplitMode('individual')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                      splitMode === 'individual'
                        ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300 font-semibold'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span className="text-[11px] leading-tight">Pieza Individual</span>
                  </button>
                </div>
              </div>

              {/* Color preservation */}
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={preserveColors}
                  onChange={(e) => setPreserveColors(e.target.checked)}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 bg-slate-900 w-4 h-4"
                />
                <span className="text-xs text-slate-300">
                  Preservar colores originales y metadatos B-Rep (OpenCASCADE XCAF)
                </span>
              </label>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-red-300 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Main Action Button */}
            <button
              onClick={handleStartSplit}
              disabled={isRunning || isUploading}
              className={`w-full py-3.5 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 shadow-xl transition-all ${
                isRunning
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700'
                  : 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-cyan-500/25 active:scale-[0.99]'
              }`}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Dividiendo STEP con OpenCASCADE...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current text-white" />
                  <span>Dividir STEP en Partes (≤ {maxChunkMb} MB)</span>
                </>
              )}
            </button>
          </div>

          {/* Right Column (Live Monitor & Results): 7 cols */}
          <div className="lg:col-span-7 space-y-5">
            
            {/* Progress Monitor Card */}
            <div className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Monitor de Proceso en Vivo
                  </span>
                </div>
                {isRunning && (
                  <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
                    <Clock className="w-3.5 h-3.5 animate-pulse" />
                    <span>{Math.floor(elapsedTime / 60)}m {elapsedTime % 60}s</span>
                  </div>
                )}
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-slate-300 truncate max-w-[80%]">
                    {currentStage || 'Listo para iniciar particionado.'}
                  </span>
                  <span className="font-mono font-bold text-cyan-400">{progress}%</span>
                </div>
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Large File Processing Helper */}
              {isRunning && progress < 40 && (
                <div className="p-3 bg-blue-950/40 border border-blue-500/30 rounded-xl flex items-center gap-3 text-xs text-blue-200 animate-in fade-in duration-300">
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                  <div className="space-y-0.5">
                    <div className="font-semibold text-cyan-300">Construyendo topología B-Rep 3D en memoria de 64 bits...</div>
                    <div className="text-[11px] text-slate-400">
                      Para archivos masivos de más de 500 MB, OpenCASCADE reconstruye millones de curvas y caras analíticas. El proceso está completamente activo.
                    </div>
                  </div>
                </div>
              )}

              {/* Analysis badge info */}
              {analysisInfo && (
                <div className="grid grid-cols-3 gap-2 p-3 bg-slate-900/70 border border-slate-800 rounded-xl text-center">
                  <div>
                    <div className="text-[10px] uppercase text-slate-400 font-semibold">Sólidos Detectados</div>
                    <div className="text-sm font-mono font-bold text-cyan-300">{analysisInfo.total_items}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400 font-semibold">Caras Topológicas</div>
                    <div className="text-sm font-mono font-bold text-blue-300">{analysisInfo.total_faces?.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400 font-semibold">Tamaño Original</div>
                    <div className="text-sm font-mono font-bold text-emerald-300">{analysisInfo.file_size_mb?.toFixed(1)} MB</div>
                  </div>
                </div>
              )}
            </div>

            {/* Generated Parts Results Table / Grid */}
            <div className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Box className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Archivos Generados ({generatedFiles.length})
                  </span>
                </div>

                {generatedFiles.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleOpenAllInSketcher}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all active:scale-95"
                      title="Cargar todas las partes a la vez en 3D CAD Sketcher como un ensamblaje multicuerpo"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Cargar Todo el Ensamblaje ({generatedFiles.length})</span>
                    </button>

                    <button
                      onClick={() => handleOpenFolder()}
                      className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold transition-colors px-2 py-1"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Ver en Windows</span>
                    </button>
                  </div>
                )}
              </div>

              {generatedFiles.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl bg-slate-900/30 text-slate-500 text-xs">
                  Aún no se han generado partes. Inicia la división para ver los archivos STEP resultantes listos para abrir en 3D CAD Sketcher.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                  {generatedFiles.map((file) => (
                    <div
                      key={file.filename}
                      className="p-3 bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/40 rounded-xl flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-cyan-400" />
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-semibold text-slate-200 truncate">
                            {file.filename}
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                            <span>{file.solids_count} sólidos</span>
                            <span>•</span>
                            <span className="font-mono text-emerald-400 font-semibold">{file.size_mb} MB</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* 1-Click Open in 3D CAD Sketcher */}
                        <button
                          onClick={() => handleOpenInSketcher(file)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-xs font-medium flex items-center gap-1.5 transition-colors active:scale-95"
                          title="Abrir directamente en la app 3D CAD Sketcher"
                        >
                          <Box className="w-3.5 h-3.5 text-blue-400" />
                          <span>Abrir en Sketcher</span>
                        </button>

                        {/* Download button */}
                        <button
                          onClick={() => handleDownloadFile(file)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-cyan-600/30 hover:text-cyan-300 text-slate-300 transition-colors border border-transparent hover:border-cyan-500/40"
                          title="Descargar archivo STEP al equipo"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Live CAD Console / Terminal */}
            <div className="bg-[#080d1a] border border-slate-800 rounded-2xl p-4 shadow-xl space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/80 pb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="font-mono font-semibold">Terminal del Motor CAD (OpenCASCADE)</span>
                </div>
                <button
                  onClick={() => setLogs([])}
                  className="text-[10px] text-slate-500 hover:text-slate-300 font-mono"
                >
                  Limpiar
                </button>
              </div>

              <div className="h-44 overflow-y-auto font-mono text-[11px] space-y-1 pr-1 select-text">
                {logs.length === 0 ? (
                  <span className="text-slate-600 italic">Esperando órdenes de particionado...</span>
                ) : (
                  logs.map((l) => (
                    <div key={l.id} className="flex items-start gap-2 leading-tight">
                      <span className="text-slate-600 shrink-0">[{l.time}]</span>
                      <span
                        className={
                          l.type === 'error'
                            ? 'text-red-400'
                            : l.type === 'warning'
                            ? 'text-amber-400'
                            : l.type === 'success'
                            ? 'text-emerald-400'
                            : l.type === 'progress'
                            ? 'text-cyan-300'
                            : 'text-slate-300'
                        }
                      >
                        {l.message}
                      </span>
                    </div>
                  ))
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>

          </div>

        </div>
      </main>
    </div>
  );
}
