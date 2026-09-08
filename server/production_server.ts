import express from "express";
import path from "path";
import fs from "fs";
import http from "http";
import dotenv from "dotenv";
import { handleCommerce } from './commerce.js';
import { handleProjectsApi } from "./project_storage.js";
import { handleStepConversion, handleStepExport } from "./step-converter.js";
import { handleStepSplitterApi } from "./step_splitter_api.js";
import { handleReconstruction } from "./reconstruct.js";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const DIST_DIR = path.resolve(process.cwd(), "dist");
app.all('/api/commerce', (req, res) => handleCommerce(req, res));
const SAVED_MODELS_DIR = path.resolve(process.cwd(), "server", "saved_models");

// Ensure saved_models directory exists for persistent project storage
if (!fs.existsSync(SAVED_MODELS_DIR)) {
  fs.mkdirSync(SAVED_MODELS_DIR, { recursive: true });
}

// Global CORS headers for cross-device compatibility
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
});

// Health check endpoint for cloud load balancers (Render, Railway, Fly.io, Kubernetes)
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// 1. STEP Converter API (Upload & Streaming)
app.all("/api/convert-step*", async (req, res) => {
  try {
    await handleStepConversion(req, res);
  } catch (err: any) {
    console.error("[PRODUCTION-SERVER] Error in /api/convert-step:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error al procesar archivo STEP" });
    }
  }
});

// 2. STEP Solid Exporter API (OpenCASCADE 64-bit true watertight solids)
app.all("/api/export-step*", async (req, res) => {
  try {
    await handleStepExport(req, res);
  } catch (err: any) {
    console.error("[PRODUCTION-SERVER] Error in /api/export-step:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error al exportar archivo STEP" });
    }
  }
});

// 3. Project Cloud Storage & Share API
app.all("/api/projects*", async (req, res) => {
  try {
    const pathname = req.path;
    await handleProjectsApi(req, res, pathname);
  } catch (err: any) {
    console.error("[PRODUCTION-SERVER] Error in /api/projects:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error en API de proyectos" });
    }
  }
});

// 3. STEP Splitter API (SSE and Chunk processing)
app.all("/api/step-split*", async (req, res) => {
  try {
    const pathname = req.path;
    await handleStepSplitterApi(req, res, pathname);
  } catch (err: any) {
    console.error("[PRODUCTION-SERVER] Error in /api/step-split:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error en divisor STEP" });
    }
  }
});

// 4. AI Reconstruction API (JSON Body Parser enabled)
const jsonParser = express.json({ limit: "50mb" });
app.post("/api/reconstruct", jsonParser, async (req, res) => {
  try {
    await handleReconstruction(req, res);
  } catch (err: any) {
    console.error("[PRODUCTION-SERVER] Error in /api/reconstruct:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error en reconstrucción IA" });
    }
  }
});

// Serve compiled static assets from dist/
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, {
    maxAge: "1d",
    setHeaders: (res, filePath) => {
      // Correct MIME type and cache header for WebAssembly
      if (filePath.endsWith(".wasm")) {
        res.setHeader("Content-Type", "application/wasm");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    }
  }));

  // Dedicated route for STEP Splitter UI
  app.get("/splitter", (req, res) => {
    const splitterHtml = path.join(DIST_DIR, "splitter.html");
    if (fs.existsSync(splitterHtml)) {
      res.sendFile(splitterHtml);
    } else {
      res.redirect("/");
    }
  });

  // Google Search Console Verification Handler (Strict matching for real verification file)
  app.get("/google:code.html", (req, res) => {
    const filename = `google${req.params.code}.html`;
    const inDist = path.join(DIST_DIR, filename);
    const inPublic = path.join(process.cwd(), "public", filename);
    if (fs.existsSync(inDist)) {
      return res.sendFile(inDist);
    }
    if (fs.existsSync(inPublic)) {
      return res.sendFile(inPublic);
    }
    // Return true 404 for any fake Google verification probe
    res.status(404).type("text/plain").send("Google verification file not found");
  });

  // SPA Catch-All fallback: deliver index.html ONLY for application routes, NOT for missing static files
  app.get("*", (req, res) => {
    // If request asks for a missing file with an extension, return true 404 to avoid soft 404s
    if (/\.[a-zA-Z0-9]+$/.test(req.path) && req.path !== "/index.html" && req.path !== "/splitter.html") {
      res.status(404).type("text/plain").send("Resource not found");
      return;
    }
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
} else {
  console.warn("[PRODUCTION-SERVER] Warning: dist/ directory not found. Please run 'npm run build' first.");
  app.get("*", (req, res) => {
    res.status(503).send("La aplicación está compilando o no se ha generado la carpeta dist/. Ejecute 'npm run build'.");
  });
}

// Start HTTP Server
const server = http.createServer(app);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`=======================================================`);
  console.log(`  🚀 VOXEL3D CAD - Servidor de Producción Activo`);
  console.log(`  🌐 Escuchando en: http://0.0.0.0:${PORT}`);
  console.log(`  📁 Directorio estático: ${DIST_DIR}`);
  console.log(`=======================================================`);
});

// Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("[PRODUCTION-SERVER] SIGTERM recibido. Cerrando conexiones...");
  server.close(() => {
    console.log("[PRODUCTION-SERVER] Servidor detenido limpiamente.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("[PRODUCTION-SERVER] SIGINT recibido. Cerrando servidor...");
  server.close(() => {
    process.exit(0);
  });
});
