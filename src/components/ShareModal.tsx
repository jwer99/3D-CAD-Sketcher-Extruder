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
  Layers,
  Box,
  Globe
} from "lucide-react";
import { getPublicShareUrl, copyTextToClipboard, isPrivateHost } from "../utils/url";
import { encodeCadBinary, computeSha256Hex } from "../utils/cadBinary";
import { bodyGeometryCache } from "../App";

interface SavedProjectItem {
  id: string;
  name: string;
  createdAt: string | null;
  sketchesCount: number;
  operationsCount: number;
  importedModelsCount?: number;
  totalParts?: number;
  totalSizeBytes?: number;
  localUrl: string;
  networkUrl: string;
  publicUrl?: string;
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
    publicUrl: string;
    sharePath: string;
  } | null>(null);

  const [copiedType, setCopiedType] = useState<string | null>(null);

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
      let importedModels: any[] = [];
      let sanitizedBodies: any[] = [];
      let totalSizeBytes = 0;

      if (currentModelData.importedBodies && currentModelData.importedBodies.length > 0) {
        onShowToast(`Processing ${currentModelData.importedBodies.length} 3D parts for cloud storage...`, "info");

        const meshesToEncode = currentModelData.importedBodies.map((b, idx) => {
          const cached = bodyGeometryCache.get(b.id);
          const verts = (cached && (cached.vertices as any).length > 0) ? cached.vertices : b.vertices;
          const norms = cached?.normals || b.normals;
          const inds = cached?.indices || b.indices;
          return {
            name: b.name || `Part_${idx + 1}`,
            color: b.color,
            vertices: verts,
            normals: norms,
            indices: inds
          };
        });

        const binaryBlob = encodeCadBinary(meshesToEncode);
        totalSizeBytes = binaryBlob.byteLength;
        const assetHash = await computeSha256Hex(binaryBlob);

        onShowToast(`Subiendo artefacto 3D (${(totalSizeBytes / 1024 / 1024).toFixed(1)} MB)...`, "info");

        const uploadRes = await fetch("/api/projects/assets", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: binaryBlob
        });

        if (!uploadRes.ok) {
          const errText = await uploadRes.text().catch(() => "");
          throw new Error(`Error al almacenar artefacto 3D (${uploadRes.status}) ${errText}`);
        }

        const modelSourceId = `model-${Date.now()}`;
        importedModels = [{
          id: modelSourceId,
          filename: `${(projectName.trim() || "Modelo").replace(/\.step$/i, "")}.step`,
          assetHash,
          totalParts: currentModelData.importedBodies.length,
          totalVertices: meshesToEncode.reduce((acc, m) => acc + (m.vertices.length / 3), 0),
          byteLength: totalSizeBytes
        }];

        sanitizedBodies = currentModelData.importedBodies.map((b, idx) => ({
          id: b.id || `imported-${modelSourceId}-${idx}`,
          name: b.name || `Pieza_${idx + 1}`,
          sourceId: modelSourceId,
          partIndex: idx,
          transformMatrix: b.transformMatrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          groupTransformMatrix: b.groupTransformMatrix,
          visible: b.visible !== false,
          color: b.color,
          material: b.material,
          vertices: [], // Excluded from JSON payload to prevent memory overflow
          position: b.position || [0, 0, 0],
          rotation: b.rotation || [0, 0, 0],
          scale: b.scale || [1, 1, 1]
        }));
      }

      const payload = {
        schemaVersion: 2,
        name: projectName.trim() || "Untitled CAD Model",
        sketches: currentModelData.sketches,
        operations: currentModelData.operations,
        activeSketchId: currentModelData.activeSketchId,
        activePlane: currentModelData.activePlane,
        material: currentModelData.material,
        importedModels,
        importedBodies: sanitizedBodies,
        theme: currentModelData.theme,
        meta: {
          totalParts: sanitizedBodies.length,
          totalModels: importedModels.length,
          totalSizeBytes
        }
      };

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || "Error saving project to server");
      }

      const result = await res.json();
      const publicUrl = getPublicShareUrl(result.id);
      setSavedResult({
        id: result.id,
        name: result.name,
        localUrl: result.localUrl || `${window.location.origin}/?project=${result.id}`,
        networkUrl: result.networkUrl || publicUrl,
        publicUrl,
        sharePath: result.sharePath || `/?project=${result.id}`
      });

      onShowToast(`✓ Project "${result.name}" saved and ready to share`, "success");
      fetchSavedProjects();
    } catch (err: any) {
      console.error("[ShareModal] Error saving project:", err);
      onShowToast(`Error: ${err.message}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = async (text: string, type: string) => {
    const success = await copyTextToClipboard(text);
    if (success) {
      setCopiedType(type);
      onShowToast("✓ Link copied to clipboard!", "success");
      setTimeout(() => setCopiedType(null), 2500);
    } else {
      onShowToast("Could not copy link to clipboard.", "error");
    }
  };

  const handleDownloadBackupJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(
      JSON.stringify(currentModelData, null, 2)
    );
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${(projectName || "cad_model").replace(/\s+/g, "_")}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    onShowToast("JSON backup downloaded", "info");
  };

  const handleLoadSavedProject = async (item: SavedProjectItem) => {
    try {
      const res = await fetch(`/api/projects/${item.id}`);
      if (!res.ok) throw new Error("Could not load project");
      const json = await res.json();
      if (json.project) {
        onLoadProject(json.project);
        onShowToast(`✓ Model "${json.project.name || item.id}" loaded`, "success");
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
                Save & Share Online
              </span>
              <span className="text-[11px] text-text-muted">
                Generate a shareable web link accessible from any computer or mobile device
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-white p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            title="Close modal"
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
            <span>Save & Get Link</span>
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
            <span>Saved Models ({savedProjects.length})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[70vh] custom-scrollbar">
          {activeTab === "share" && (
            <div className="flex flex-col gap-4">
              {/* Project Name Input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-text-muted flex items-center gap-1.5">
                  <span>Model / Part Name:</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. Sensor_Enclosure_V2"
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
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} />
                        <span>Save & Generate Link</span>
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
                      <span>Model successfully saved to web server!</span>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                      ID: {savedResult.id}
                    </span>
                  </div>

                  {/* Primary Public Share Link */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
                        <Globe size={13} className="text-cyan-400" />
                        <span>Public Shareable Link (Any device):</span>
                      </span>
                      <span className="text-[9.5px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Recommended</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={savedResult.publicUrl}
                        className="flex-1 bg-black/80 border border-cyan-500/30 text-cyan-200 text-xs px-3 py-2 rounded-lg font-mono outline-none"
                      />
                      <button
                        onClick={() => copyToClipboard(savedResult.publicUrl, "public")}
                        className={`px-3 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                          copiedType === "public"
                            ? "bg-emerald-600 text-white shadow-md"
                            : "bg-surface hover:bg-zinc-700 text-text-main border border-border-subtle"
                        }`}
                        title="Copy public link"
                      >
                        {copiedType === "public" ? (
                          <>
                            <Check size={13} />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={13} />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      💡 This link automatically loads the full geometry with all parts and transforms without requiring re-importing STEP files.
                    </p>
                  </div>

                  {/* Secondary Link for local network / dev (Only shown on local host / dev environments) */}
                  {isPrivateHost(window.location.hostname) && savedResult.networkUrl !== savedResult.publicUrl && (
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-text-muted flex items-center gap-1.5">
                          <Wifi size={13} className="text-cyan-400" />
                          <span>Local Network / Wi-Fi:</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={savedResult.networkUrl}
                          className="flex-1 bg-black/60 border border-white/10 text-text-muted text-xs px-3 py-1.5 rounded-lg font-mono outline-none"
                        />
                        <button
                          onClick={() => copyToClipboard(savedResult.networkUrl, "network")}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shrink-0 bg-surface hover:bg-zinc-700 text-text-muted hover:text-white border border-border-subtle"
                        >
                          <Copy size={12} />
                          <span>Copy</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Offline Backup Option */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/5 mt-1">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-text-main">Offline Backup (JSON)</span>
                  <span className="text-[10px] text-text-muted">Download a .json file with all sketches and operations of this model</span>
                </div>
                <button
                  onClick={handleDownloadBackupJson}
                  className="px-3 py-1.5 bg-surface hover:bg-zinc-700 text-text-main border border-border-subtle rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Download size={13} />
                  <span>Download .JSON</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === "list" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>Saved models on this server:</span>
                <button
                  onClick={fetchSavedProjects}
                  className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer text-[11px]"
                >
                  <RefreshCw size={11} className={isLoadingProjects ? "animate-spin" : ""} />
                  <span>Refresh list</span>
                </button>
              </div>

              {savedProjects.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-xs bg-black/20 rounded-xl border border-white/5">
                  No saved projects yet. Save the current one under the "Save & Get Link" tab.
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
                        <div className="flex flex-wrap items-center gap-3 text-[10px] text-text-muted font-mono">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {p.createdAt ? new Date(p.createdAt).toLocaleString() : "Recent"}
                          </span>
                          <span className="flex items-center gap-1 text-cyan-400">
                            <Layers size={10} />
                            {p.sketchesCount} sketches, {p.operationsCount} op.
                          </span>
                          {(p.totalParts !== undefined && p.totalParts > 0) && (
                            <span className="flex items-center gap-1 text-blue-400 font-bold">
                              <Box size={10} />
                              {p.importedModelsCount ? `${p.importedModelsCount} mod., ` : ""}{p.totalParts} parts
                            </span>
                          )}
                          {(p.totalSizeBytes !== undefined && p.totalSizeBytes > 0) && (
                            <span className="text-zinc-400">
                              {p.totalSizeBytes > 1024 * 1024
                                ? `${(p.totalSizeBytes / (1024 * 1024)).toFixed(1)} MB`
                                : `${(p.totalSizeBytes / 1024).toFixed(0)} KB`}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => copyToClipboard(getPublicShareUrl(p.id), p.id)}
                          className={`px-2.5 py-1 text-[11px] rounded border transition-colors cursor-pointer flex items-center gap-1 ${
                            copiedType === p.id
                              ? "bg-emerald-600/30 border-emerald-500/50 text-emerald-300"
                              : "bg-surface hover:bg-zinc-700 text-text-muted hover:text-white border-border-subtle"
                          }`}
                          title="Copy share link"
                        >
                          {copiedType === p.id ? <Check size={11} /> : <Copy size={11} />}
                          <span>{copiedType === p.id ? "Copied!" : "Link"}</span>
                        </button>
                        <button
                          onClick={() => handleLoadSavedProject(p)}
                          className="px-3 py-1 text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded shadow transition-all cursor-pointer"
                          title="Load this model into viewport"
                        >
                          Load
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
            Data is securely synchronized and preserved on the server.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface hover:bg-zinc-700 text-text-main font-semibold rounded-lg border border-border-subtle transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
