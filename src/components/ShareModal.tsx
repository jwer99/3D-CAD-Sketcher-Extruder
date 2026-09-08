import React, { useState, useEffect } from "react";
import { 
  Cloud, 
  Share2, 
  Copy, 
  Check, 
  ExternalLink, 
  Download, 
  FolderOpen, 
  X, 
  Sparkles, 
  Laptop, 
  Wifi, 
  RefreshCw,
  Clock,
  Layers
} from "lucide-react";

interface SavedProjectItem {
  id: string;
  name: string;
  createdAt: string | null;
  sketchesCount: number;
  operationsCount: number;
  localUrl: string;
  networkUrl: string;
  sharePath: string;
}

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModelData: {
    name?: string;
    sketches: Record<string, any>;
    operations: any[];
    activeSketchId?: string;
    activePlane?: string;
    material?: any;
    importedBodies?: any[];
    theme?: string;
  };
  onLoadProject: (projectData: any) => void;
  onShowToast: (message: string, type?: "success" | "info" | "error") => void;
}

export default function ShareModal({
  isOpen,
  onClose,
  currentModelData,
  onLoadProject,
  onShowToast
}: ShareModalProps) {
  const [activeTab, setActiveTab] = useState<"share" | "list">("share");
  const [projectName, setProjectName] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedResult, setSavedResult] = useState<{
    id: string;
    name: string;
    localUrl: string;
    networkUrl: string;
    sharePath: string;
  } | null>(null);

  const [copiedType, setCopiedType] = useState<"network" | "local" | null>(null);

  const [savedProjects, setSavedProjects] = useState<SavedProjectItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState<boolean>(false);

  // Initialize or reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      if (!projectName) {
        setProjectName(currentModelData.name || `Pieza_${new Date().toLocaleDateString().replace(/\//g, "-")}`);
      }
      fetchSavedProjects();
    }
  }, [isOpen]);

  const fetchSavedProjects = async () => {
    setIsLoadingProjects(true);
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const json = await res.json();
        if (json.projects) {
          setSavedProjects(json.projects);
        }
      }
    } catch (err) {
      console.error("Error fetching projects:", err);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const handleSaveAndShare = async () => {
    setIsSaving(true);
    try {
      const payload = {
        name: projectName.trim() || "Modelo CAD Sin Título",
        sketches: currentModelData.sketches,
        operations: currentModelData.operations,
        activeSketchId: currentModelData.activeSketchId,
        activePlane: currentModelData.activePlane,
        material: currentModelData.material,
        importedBodies: currentModelData.importedBodies,
        theme: currentModelData.theme
      };

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error("Error al guardar en el servidor");
      }

      const result = await res.json();
      setSavedResult(result);
      onShowToast(`✓ Modelo "${result.name}" guardado en la web`, "success");
      fetchSavedProjects();
    } catch (err: any) {
      onShowToast(`Error: ${err.message}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = async (text: string, type: "network" | "local") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      onShowToast("¡Enlace copiado al portapapeles!", "success");
      setTimeout(() => setCopiedType(null), 2500);
    } catch {
      // Fallback
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedType(type);
      onShowToast("¡Enlace copiado al portapapeles!", "success");
      setTimeout(() => setCopiedType(null), 2500);
    }
  };

  const handleDownloadBackupJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(
      JSON.stringify(currentModelData, null, 2)
    );
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${(projectName || "modelo_cad").replace(/\s+/g, "_")}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    onShowToast("Copia de seguridad descargada en JSON", "info");
  };

  const handleLoadSavedProject = async (item: SavedProjectItem) => {
    try {
      const res = await fetch(`/api/projects/${item.id}`);
      if (!res.ok) throw new Error("No se pudo cargar el proyecto");
      const json = await res.json();
      if (json.project) {
        onLoadProject(json.project);
        onShowToast(`✓ Modelo "${json.project.name || item.id}" cargado`, "success");
        onClose();
      }
    } catch (err: any) {
      onShowToast(`Error: ${err.message}`, "error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn select-none">
      <div 
        className="w-full max-w-xl bg-[#121215] border border-cyan-500/40 rounded-2xl shadow-[0_15px_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 px-6 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-cyan-950/40 via-black/40 to-blue-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 rounded-xl">
              <Cloud size={20} className="animate-pulse" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white flex items-center gap-1.5">
                Guardar y Compartir en la Web
              </span>
              <span className="text-[11px] text-text-muted">
                Genera un enlace web accesible desde cualquier otro ordenador o dispositivo
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-white p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            title="Cerrar modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 bg-black/30 px-6 pt-2">
          <button
            onClick={() => setActiveTab("share")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "share"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            <Share2 size={13} />
            <span>Guardar y Obtener Enlace</span>
          </button>
          <button
            onClick={() => setActiveTab("list")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "list"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            <FolderOpen size={13} />
            <span>Modelos Guardados ({savedProjects.length})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[70vh] custom-scrollbar">
          {activeTab === "share" && (
            <div className="flex flex-col gap-4">
              {/* Project Name Input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-text-muted flex items-center gap-1.5">
                  <span>Nombre del Modelo / Pieza:</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Ej: Carcasa_Sensor_V2"
                    className="flex-1 bg-black/60 border border-white/15 focus:border-cyan-400 text-white text-xs px-3 py-2 rounded-lg outline-none font-mono transition-colors"
                  />
                  <button
                    onClick={handleSaveAndShare}
                    disabled={isSaving}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-600/30 text-white font-bold text-xs rounded-lg transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center gap-1.5 cursor-pointer active:scale-95 shrink-0"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Guardando...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} />
                        <span>Guardar y Generar Enlace</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Link Presentation when saved */}
              {savedResult && (
                <div className="bg-black/50 border border-cyan-500/30 rounded-xl p-4 flex flex-col gap-3.5 animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                      <Check size={14} />
                      <span>¡Modelo guardado correctamente en el servidor web!</span>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                      ID: {savedResult.id}
                    </span>
                  </div>

                  {/* Primary Link for another computer (Local Network Wi-Fi / Ethernet) */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
                        <Wifi size={13} className="text-cyan-400" />
                        <span>Para abrir desde otro ordenador (misma red Wi-Fi / cable):</span>
                      </span>
                      <span className="text-[9.5px] text-text-muted font-mono">Recomendado</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={savedResult.networkUrl}
                        className="flex-1 bg-black/80 border border-cyan-500/30 text-cyan-200 text-xs px-3 py-2 rounded-lg font-mono outline-none"
                      />
                      <button
                        onClick={() => copyToClipboard(savedResult.networkUrl, "network")}
                        className={`px-3 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                          copiedType === "network"
                            ? "bg-emerald-600 text-white shadow-md"
                            : "bg-surface hover:bg-zinc-700 text-text-main border border-border-subtle"
                        }`}
                        title="Copiar enlace de red para otro PC"
                      >
                        {copiedType === "network" ? (
                          <>
                            <Check size={13} />
                            <span>¡Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={13} />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      💡 Abre este enlace en el navegador de cualquier otro ordenador o portátil conectado a tu red para ver y editar exactamente este modelo.
                    </p>
                  </div>

                  {/* Secondary Link for this computer (Localhost) */}
                  <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
                    <span className="text-[11px] font-bold text-text-muted flex items-center gap-1.5">
                      <Laptop size={13} />
                      <span>Para este mismo ordenador:</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={savedResult.localUrl}
                        className="flex-1 bg-black/60 border border-white/10 text-text-muted text-xs px-3 py-1.5 rounded-lg font-mono outline-none"
                      />
                      <button
                        onClick={() => copyToClipboard(savedResult.localUrl, "local")}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                          copiedType === "local"
                            ? "bg-emerald-600 text-white"
                            : "bg-surface hover:bg-zinc-700 text-text-muted hover:text-white border border-border-subtle"
                        }`}
                        title="Copiar enlace local"
                      >
                        {copiedType === "local" ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedType === "local" ? "Copiado" : "Copiar"}</span>
                      </button>
                      <a
                        href={savedResult.localUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 bg-surface hover:bg-zinc-700 text-text-muted hover:text-white rounded-lg border border-border-subtle transition-colors"
                        title="Probar en una nueva pestaña"
                      >
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Offline Backup Option */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5 mt-1">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-text-main">Copia de Seguridad Offline (JSON)</span>
                  <span className="text-[10px] text-text-muted">Descarga un archivo .json con todos los bocetos y operaciones de esta pieza</span>
                </div>
                <button
                  onClick={handleDownloadBackupJson}
                  className="px-3 py-1.5 bg-surface hover:bg-zinc-700 text-text-main border border-border-subtle rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Download size={13} />
                  <span>Descargar .JSON</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === "list" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>Modelos guardados en este servidor:</span>
                <button
                  onClick={fetchSavedProjects}
                  className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer text-[11px]"
                >
                  <RefreshCw size={11} className={isLoadingProjects ? "animate-spin" : ""} />
                  <span>Actualizar lista</span>
                </button>
              </div>

              {savedProjects.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-xs bg-black/20 rounded-xl border border-white/5">
                  No hay proyectos guardados todavía. Guarda el actual en la pestaña "Guardar y Obtener Enlace".
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {savedProjects.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-black/40 hover:bg-black/60 border border-white/10 transition-all"
                    >
                      <div className="flex flex-col gap-0.5 overflow-hidden">
                        <span className="text-xs font-bold text-white truncate max-w-[260px]">
                          {p.name}
                        </span>
                        <div className="flex items-center gap-3 text-[10px] text-text-muted font-mono">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {p.createdAt ? new Date(p.createdAt).toLocaleString() : "Reciente"}
                          </span>
                          <span className="flex items-center gap-1 text-cyan-400">
                            <Layers size={10} />
                            {p.sketchesCount} bocetos, {p.operationsCount} op.
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => copyToClipboard(p.networkUrl, "network")}
                          className="px-2.5 py-1 text-[11px] bg-surface hover:bg-zinc-700 text-text-muted hover:text-white rounded border border-border-subtle flex items-center gap-1 transition-colors cursor-pointer"
                          title="Copiar enlace para otro ordenador"
                        >
                          <Copy size={11} />
                          <span>Enlace</span>
                        </button>
                        <button
                          onClick={() => handleLoadSavedProject(p)}
                          className="px-3 py-1 text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded shadow transition-all cursor-pointer"
                          title="Cargar este modelo en el visor"
                        >
                          Cargar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 px-6 border-t border-white/10 bg-black/40 flex items-center justify-between text-xs">
          <span className="text-[10px] text-text-muted">
            Los datos se sincronizan y persisten de forma segura en el servidor.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface hover:bg-zinc-700 text-text-main font-semibold rounded-lg border border-border-subtle transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
