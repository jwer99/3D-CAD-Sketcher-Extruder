// server/production_server.ts
import express from "express";
import path4 from "path";
import fs4 from "fs";
import http from "http";
import dotenv2 from "dotenv";

// server/commerce.ts
function commerceConfig(env = process.env) {
  const email = (env.SALES_EMAIL ?? "juandedofeliz@gmail.com").trim();
  let supportUrl = null;
  try {
    const url = new URL(env.SUPPORT_PAYMENT_URL ?? "https://www.paypal.me/jwer99");
    if (url.protocol === "https:" && !url.username && !url.password && ["buy.stripe.com", "donate.stripe.com", "www.paypal.com", "paypal.me", "www.paypal.me", "ko-fi.com", "www.buymeacoffee.com"].includes(url.hostname)) {
      supportUrl = url.href;
    }
  } catch {
  }
  return {
    salesEmail: /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email) ? email : null,
    supportUrl
  };
}
function handleCommerce(req, res, env = process.env) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.writeHead(405);
    res.end(JSON.stringify({ error: "M\xE9todo no permitido" }));
    return;
  }
  res.end(JSON.stringify(commerceConfig(env)));
}

// server/project_storage.ts
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var STORAGE_DIR = path.join(__dirname, "saved_models");
var ASSETS_DIR = path.join(STORAGE_DIR, "assets");
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}
function isPrivateHost(hostname) {
  if (!hostname) return true;
  const cleanHost = hostname.split(":")[0].toLowerCase();
  return cleanHost === "localhost" || cleanHost === "127.0.0.1" || cleanHost === "::1" || cleanHost.startsWith("192.168.") || cleanHost.startsWith("10.") || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanHost);
}
function resolvePublicOrigin(req, fallbackPort = 3e3) {
  const envUrl = process.env.RENDER_EXTERNAL_URL || process.env.VITE_PUBLIC_APP_URL || process.env.APP_URL;
  if (envUrl && envUrl.trim().startsWith("http")) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    return `https://${process.env.RENDER_EXTERNAL_HOSTNAME.trim().replace(/\/+$/, "")}`;
  }
  const forwardedProto = req?.headers?.["x-forwarded-proto"] || "http";
  const forwardedHost = req?.headers?.["x-forwarded-host"] || req?.headers?.["host"];
  const originHeader = req?.headers?.["origin"];
  if (originHeader && originHeader.startsWith("http")) {
    try {
      const url = new URL(originHeader);
      if (!isPrivateHost(url.hostname)) {
        return originHeader.replace(/\/+$/, "");
      }
    } catch {
    }
  }
  if (forwardedHost) {
    const hostWithoutPort = forwardedHost.split(":")[0];
    if (!isPrivateHost(hostWithoutPort)) {
      return `${forwardedProto}://${forwardedHost}`;
    }
  }
  const host = req?.headers?.["host"] || `localhost:${fallbackPort}`;
  return `http://${host}`;
}
function saveAssetBuffer(buffer) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const assetPath = path.join(ASSETS_DIR, `${hash}.bin`);
  const existed = fs.existsSync(assetPath);
  if (!existed) {
    fs.writeFileSync(assetPath, buffer);
  }
  return { hash, sizeBytes: buffer.length, existed };
}
function getAssetBuffer(hash) {
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
    return null;
  }
  const assetPath = path.join(ASSETS_DIR, `${hash}.bin`);
  if (!fs.existsSync(assetPath)) {
    return null;
  }
  try {
    return fs.readFileSync(assetPath);
  } catch (err) {
    console.error(`[AssetStorage] Error reading asset ${hash}:`, err);
    return null;
  }
}
function saveProject(payload, req, reqPort = 3e3) {
  const id = payload.id && /^[a-zA-Z0-9_-]+$/.test(payload.id) ? payload.id : `cad_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const name = payload.name?.trim() || `Proyecto CAD (${(/* @__PURE__ */ new Date()).toLocaleDateString()})`;
  const importedModels = payload.importedModels || [];
  const importedBodies = payload.importedBodies || [];
  const totalParts = importedBodies.length > 0 ? importedBodies.length : payload.meta?.totalParts || 0;
  const totalModels = importedModels.length > 0 ? importedModels.length : payload.meta?.totalModels || 0;
  let totalSizeBytes = payload.meta?.totalSizeBytes || 0;
  if (!totalSizeBytes && importedModels.length > 0) {
    totalSizeBytes = importedModels.reduce((acc, m) => acc + (m.byteLength || m.sizeBytes || m.fileSize || 0), 0);
  }
  const record = {
    schemaVersion: payload.schemaVersion || 2,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    sketches: payload.sketches || {},
    operations: payload.operations || [],
    activeSketchId: payload.activeSketchId || "sketch-xy",
    activePlane: payload.activePlane || "XY",
    material: payload.material,
    importedModels,
    importedBodies,
    theme: payload.theme || "dark",
    meta: {
      totalParts,
      totalModels,
      totalSizeBytes
    }
  };
  const filePath = path.join(STORAGE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
  const publicOrigin = resolvePublicOrigin(req, reqPort);
  const publicUrl = `${publicOrigin}/?project=${id}`;
  const sharePath = `/?project=${id}`;
  return {
    success: true,
    id,
    name,
    createdAt: now,
    schemaVersion: record.schemaVersion,
    publicUrl,
    sharePath,
    totalParts,
    totalModels,
    totalSizeBytes
  };
}
function getProject(id) {
  if (!id || typeof id !== "string") {
    return null;
  }
  const cleanId = id.trim();
  const filePath = path.join(STORAGE_DIR, `${cleanId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const project = JSON.parse(raw);
      if (!project.schemaVersion) project.schemaVersion = 1;
      if (!project.meta) {
        project.meta = {
          totalParts: project.importedBodies?.length || 0,
          totalModels: project.importedModels?.length || 0,
          totalSizeBytes: 0
        };
      }
      return project;
    } catch (err) {
      console.error(`[ProjectStorage] Error reading project ${cleanId}:`, err);
      return null;
    }
  }
  if (fs.existsSync(STORAGE_DIR)) {
    try {
      const files = fs.readdirSync(STORAGE_DIR).filter((f) => f.endsWith(".json"));
      const targetSlug = cleanId.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(STORAGE_DIR, file), "utf-8");
          const project = JSON.parse(raw);
          const projName = (project.name || "").trim();
          const projSlug = projName.toLowerCase().replace(/[^a-z0-9]/g, "");
          const fileBase = file.replace(/\.json$/, "");
          if (project.id === cleanId || fileBase === cleanId || projName.toLowerCase() === cleanId.toLowerCase() || targetSlug.length >= 3 && projSlug === targetSlug) {
            if (!project.schemaVersion) project.schemaVersion = 1;
            if (!project.meta) {
              project.meta = {
                totalParts: project.importedBodies?.length || 0,
                totalModels: project.importedModels?.length || 0,
                totalSizeBytes: 0
              };
            }
            return project;
          }
        } catch {
        }
      }
    } catch (err) {
      console.error("[ProjectStorage] Error during fallback project search:", err);
    }
  }
  return null;
}
function listProjects(req, reqPort = 3e3) {
  if (!fs.existsSync(STORAGE_DIR)) return [];
  const files = fs.readdirSync(STORAGE_DIR).filter((f) => f.endsWith(".json"));
  const publicOrigin = resolvePublicOrigin(req, reqPort);
  const projects = files.map((file) => {
    try {
      const id = file.replace(".json", "");
      const raw = fs.readFileSync(path.join(STORAGE_DIR, file), "utf-8");
      const data = JSON.parse(raw);
      const totalParts = data.importedBodies?.length || data.meta?.totalParts || 0;
      const totalModels = data.importedModels?.length || data.meta?.totalModels || 0;
      const totalSizeBytes = data.meta?.totalSizeBytes || (data.importedModels || []).reduce((acc, m) => acc + (m.byteLength || m.sizeBytes || m.fileSize || 0), 0);
      return {
        id,
        name: data.name || id,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
        schemaVersion: data.schemaVersion || 1,
        sketchesCount: Object.keys(data.sketches || {}).length,
        operationsCount: (data.operations || []).length,
        totalParts,
        totalModels,
        importedModelsCount: totalModels,
        totalSizeBytes,
        publicUrl: `${publicOrigin}/?project=${id}`,
        sharePath: `/?project=${id}`
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
  projects.sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });
  return projects;
}
async function handleProjectsApi(req, res, pathname) {
  const hostHeader = req.headers["host"] || "localhost:3000";
  const portMatch = hostHeader.match(/:(\d+)$/);
  const port = portMatch ? parseInt(portMatch[1], 10) : 3e3;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Asset-Hash, X-File-Name");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && pathname.startsWith("/api/projects/assets/")) {
    const hash = pathname.replace("/api/projects/assets/", "").trim();
    const assetBuf = getAssetBuffer(hash);
    if (!assetBuf) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Artefacto 3D con hash "${hash}" no encontrado en el servidor.` }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": assetBuf.length,
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    res.end(assetBuf);
    return;
  }
  if (req.method === "POST" && (pathname === "/api/projects/assets" || pathname === "/api/projects/assets/")) {
    const processBuffer = (buf) => {
      try {
        if (!buf || buf.length === 0) {
          throw new Error("El buffer de asset est\xE1 vac\xEDo.");
        }
        const result = saveAssetBuffer(buf);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Error guardando asset binario: " + err.message }));
      }
    };
    if (Buffer.isBuffer(req.body)) {
      processBuffer(req.body);
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      const fullBuffer = Buffer.concat(chunks);
      processBuffer(fullBuffer);
    });
    return;
  }
  if (req.method === "GET" && (pathname === "/api/projects" || pathname === "/api/projects/")) {
    const list = listProjects(req, port);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, projects: list, localIp: getLocalIpAddress() }));
    return;
  }
  if (req.method === "GET" && pathname.startsWith("/api/projects/")) {
    const rawId = pathname.replace("/api/projects/", "").trim();
    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {
    }
    const project = getProject(id);
    if (!project) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Proyecto con ID "${id}" no encontrado en el servidor.` }));
      return;
    }
    const publicOrigin = resolvePublicOrigin(req, port);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      project,
      publicUrl: `${publicOrigin}/?project=${id}`,
      sharePath: `/?project=${id}`
    }));
    return;
  }
  if (req.method === "POST" && (pathname === "/api/projects" || pathname === "/api/projects/")) {
    const processPayload = (payload) => {
      try {
        const result = saveProject(payload, req, port);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload JSON inv\xE1lido: " + err.message }));
      }
    };
    if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
      processPayload(req.body);
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        processPayload(payload);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload JSON inv\xE1lido: " + err.message }));
      }
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Ruta no encontrada" }));
}

// server/step-converter.ts
import * as fs2 from "fs";
import * as path2 from "path";
import * as os2 from "os";
import { execFile } from "child_process";

// src/ImporterParser.ts
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import occtimportjs from "occt-import-js";
function mergeBufferGeometries(geometries) {
  if (geometries.length === 0) return new THREE.BufferGeometry();
  if (geometries.length === 1) return geometries[0];
  try {
    const merged = mergeGeometries(geometries, false);
    if (merged) return merged;
  } catch (e) {
    console.warn("mergeGeometries failed, falling back to manual merge:", e);
  }
  return geometries[0];
}
var occtPromise = null;
async function getOCCT() {
  if (!occtPromise) {
    occtPromise = occtimportjs({
      locateFile: (name) => {
        if (name.endsWith(".wasm")) {
          if (typeof window === "undefined" && typeof process !== "undefined") {
            return process.cwd() + "/public/occt-import-js.wasm";
          }
          return "/occt-import-js.wasm";
        }
        return name;
      }
    });
  }
  return occtPromise;
}
async function parseSTEPWithOCCT(buffer, params = {}) {
  const uint8Buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    const occt = await getOCCT();
    const fileSizeMB = uint8Buffer.byteLength / (1024 * 1024);
    const defaultLinearDeflection = fileSizeMB > 40 ? 0.015 : fileSizeMB > 15 ? 6e-3 : 3e-3;
    const defaultAngularDeflection = fileSizeMB > 40 ? 0.9 : 0.6;
    const finalParams = {
      linearUnit: params.linearUnit || "millimeter",
      linearDeflectionType: params.linearDeflectionType || "bounding_box_ratio",
      linearDeflection: params.linearDeflection || defaultLinearDeflection,
      angularDeflection: params.angularDeflection || defaultAngularDeflection,
      ...params
    };
    let result = occt.ReadStepFile(uint8Buffer, finalParams);
    if (result && result.success && result.meshes && result.meshes.length === 0) {
      console.warn("OCCT returned 0 meshes with custom params. Retrying with default params...");
      result = occt.ReadStepFile(uint8Buffer, null);
    }
    if (result && result.success && result.meshes && result.meshes.length > 0) {
      const meshesList = [];
      const geometries = [];
      for (let i = 0; i < result.meshes.length; i++) {
        const m = result.meshes[i];
        if (!m.attributes || !m.attributes.position || !m.attributes.position.array) continue;
        const posArray = new Float32Array(m.attributes.position.array);
        if (posArray.length === 0) continue;
        const normArray = m.attributes.normal && m.attributes.normal.array ? new Float32Array(m.attributes.normal.array) : void 0;
        const indexArray = m.index && m.index.array ? new Uint32Array(m.index.array) : void 0;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
        if (normArray) {
          geom.setAttribute("normal", new THREE.BufferAttribute(normArray, 3));
        } else {
          geom.computeVertexNormals();
        }
        if (indexArray) {
          geom.setIndex(new THREE.BufferAttribute(indexArray, 1));
        }
        geometries.push(geom);
        meshesList.push({
          name: m.name || `Pieza ${i + 1}`,
          color: m.color ? [m.color[0], m.color[1], m.color[2]] : void 0,
          vertices: posArray,
          normals: normArray,
          indices: indexArray
        });
      }
      if (geometries.length > 0) {
        const combinedGeometry = mergeBufferGeometries(geometries);
        return { combinedGeometry, meshes: meshesList };
      }
    }
  } catch (occtErr) {
    console.error("OCCT WASM parser failed:", occtErr);
    throw new Error("No se pudieron extraer las mallas 3D del archivo STEP (excepci\xF3n OCCT).");
  }
  throw new Error("El archivo STEP no produjo mallas v\xE1lidas.");
}

// server/step-converter.ts
var PYTHON_CONVERTER_SCRIPT = `
import sys
import json
import os

def convert_step(input_path, output_json_path, deflection=0.003):
    print(f"[NATIVE-OCCT] Starting conversion of {input_path}")
    
    # Method 1: Pure OpenCASCADE XCAF Document & Color Tool Architecture (100% True STEP Colors)
    try:
        from OCP.STEPCAFControl import STEPCAFControl_Reader
        from OCP.TDocStd import TDocStd_Document
        from OCP.TCollection import TCollection_ExtendedString
        from OCP.XCAFApp import XCAFApp_Application
        from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorSurf, XCAFDoc_ColorGen, XCAFDoc_ColorCurv
        from OCP.TDF import TDF_LabelSequence, TDF_Label
        from OCP.Quantity import Quantity_ColorRGBA
        from OCP.TopoDS import TopoDS
        from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE
        from OCP.TopExp import TopExp_Explorer
        from OCP.TDataStd import TDataStd_Name
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        from OCP.BRep import BRep_Tool
        from OCP.TopLoc import TopLoc_Location

        fmt = TCollection_ExtendedString('BinXCAF')
        doc = TDocStd_Document(fmt)
        app = XCAFApp_Application.GetApplication_s()
        app.NewDocument(fmt, doc)

        reader = STEPCAFControl_Reader()
        reader.SetColorMode(True)
        reader.SetNameMode(True)
        reader.SetLayerMode(False)
        reader.SetPropsMode(False)
        
        status = reader.ReadFile(input_path)
        reader.Transfer(doc)

        shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
        color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())

        labels = TDF_LabelSequence()
        shape_tool.GetFreeShapes(labels)
        if labels.Length() == 0:
            shape_tool.GetShapes(labels)

        meshes = []
        mesh_deflection = max(0.002, float(deflection))

        def process_node(lbl, inherited_color=None):
            # If assembly, traverse its components
            if shape_tool.IsAssembly_s(lbl):
                comps = TDF_LabelSequence()
                shape_tool.GetComponents_s(lbl, comps)
                
                # Check assembly-level color
                sh = shape_tool.GetShape_s(lbl)
                col_rgba = Quantity_ColorRGBA()
                cur_col = inherited_color
                if not sh.IsNull():
                    if color_tool.GetColor(sh, XCAFDoc_ColorSurf, col_rgba) or color_tool.GetColor(sh, XCAFDoc_ColorGen, col_rgba):
                        c = col_rgba.GetRGB()
                        cur_col = [float(c.Red()), float(c.Green()), float(c.Blue())]
                        
                for j in range(1, comps.Length() + 1):
                    process_node(comps.Value(j), cur_col)
                return

            # Direct shape with true world assembly coordinates baked in
            comp_shape = shape_tool.GetShape_s(lbl)
            if comp_shape.IsNull():
                return

            # Extract component name
            name_attr = TDataStd_Name()
            name = f"Pieza {len(meshes) + 1}"
            if lbl.FindAttribute(TDataStd_Name.GetID_s(), name_attr):
                try:
                    name_raw = name_attr.Get()
                    name_str = str(name_raw.ToExtString()) if hasattr(name_raw, 'ToExtString') else str(name_raw)
                    if name_str and 'OCP.' not in name_str:
                        name = name_str
                except Exception:
                    pass

            # Extract true color from STEP
            col_rgba = Quantity_ColorRGBA()
            part_col = inherited_color
            if color_tool.GetColor(comp_shape, XCAFDoc_ColorSurf, col_rgba) or color_tool.GetColor(comp_shape, XCAFDoc_ColorGen, col_rgba):
                c = col_rgba.GetRGB()
                part_col = [float(c.Red()), float(c.Green()), float(c.Blue())]

            solids_to_mesh = []
            exp = TopExp_Explorer(comp_shape, TopAbs_SOLID)
            while exp.More():
                solids_to_mesh.append(TopoDS.Solid_s(exp.Current()))
                exp.Next()

            if len(solids_to_mesh) == 0:
                solids_to_mesh = [comp_shape]

            for s_idx, s in enumerate(solids_to_mesh):
                solid_color = part_col
                if solid_color is None:
                    if color_tool.GetColor(s, XCAFDoc_ColorSurf, col_rgba) or color_tool.GetColor(s, XCAFDoc_ColorGen, col_rgba):
                        c = col_rgba.GetRGB()
                        solid_color = [float(c.Red()), float(c.Green()), float(c.Blue())]

                BRepMesh_IncrementalMesh(s, mesh_deflection, False, 0.15, True).Perform()

                exp_f = TopExp_Explorer(s, TopAbs_FACE)
                vertices = []
                normals = []
                indices = []
                v_offset = 0

                while exp_f.More():
                    face = TopoDS.Face_s(exp_f.Current())
                    face_loc = TopLoc_Location()
                    tri = BRep_Tool.Triangulation_s(face, face_loc)
                    if tri is not None:
                        nb_nodes = tri.NbNodes()
                        nb_triangles = tri.NbTriangles()
                        trsf = face_loc.Transformation()

                        face_verts = []
                        for k in range(1, nb_nodes + 1):
                            p = tri.Node(k).Transformed(trsf)
                            face_verts.append((round(p.X(), 3), round(p.Y(), 3), round(p.Z(), 3)))

                        has_curved_normals = tri.HasNormals()
                        if has_curved_normals:
                            for k in range(1, nb_nodes + 1):
                                n = tri.Normal(k).Transformed(trsf)
                                fn = [round(n.X(), 3), round(n.Y(), 3), round(n.Z(), 3)]
                                if face.Orientation() == 1:
                                    fn = [-fn[0], -fn[1], -fn[2]]
                                vertices.extend(face_verts[k-1])
                                normals.extend(fn)
                        else:
                            fn = [0.0, 1.0, 0.0]
                            if nb_triangles > 0:
                                t1 = tri.Triangle(1)
                                i1, i2, i3 = t1.Get()
                                p1, p2, p3 = face_verts[i1-1], face_verts[i2-1], face_verts[i3-1]
                                ax, ay, az = p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]
                                bx, by, bz = p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]
                                nx = ay*bz - az*by
                                ny = az*bx - ax*bz
                                nz = ax*by - ay*bx
                                l = (nx*nx + ny*ny + nz*nz)**0.5
                                if l > 1e-9:
                                    fn = [round(nx/l, 3), round(ny/l, 3), round(nz/l, 3)]
                                    if face.Orientation() == 1:
                                        fn = [-fn[0], -fn[1], -fn[2]]
                            for v in face_verts:
                                vertices.extend(v)
                                normals.extend(fn)

                        for k in range(1, nb_triangles + 1):
                            t = tri.Triangle(k)
                            n1, n2, n3 = t.Get()
                            if face.Orientation() == 1:
                                indices.extend([v_offset + n1 - 1, v_offset + n3 - 1, v_offset + n2 - 1])
                            else:
                                indices.extend([v_offset + n1 - 1, v_offset + n2 - 1, v_offset + n3 - 1])

                        v_offset += nb_nodes
                    exp_f.Next()

                if len(vertices) > 0 and len(indices) > 0:
                    part_title = name if len(solids_to_mesh) == 1 else f"{name} ({s_idx + 1})"
                    meshes.append({
                        "name": part_title,
                        "color": solid_color or [0.72, 0.76, 0.82],
                        "vertices": vertices,
                        "normals": normals,
                        "indices": indices
                    })

        for i in range(1, labels.Length() + 1):
            process_node(labels.Value(i))

        if len(meshes) > 0:
            total_triangles = sum(len(m["indices"])//3 for m in meshes)
            print(f"[NATIVE-OCCT] OpenCASCADE XCAF extracted {len(meshes)} solids with REAL STEP colors ({total_triangles} triangles). Packing binary stream...")
            
            import struct
            with open(output_json_path, "wb") as f:
                # Magic header
                f.write(b"CADBIN01")
                f.write(struct.pack("<I", len(meshes)))
                
                for m in meshes:
                    name_bytes = m["name"].encode("utf-8")
                    f.write(struct.pack("<H", len(name_bytes)))
                    f.write(name_bytes)
                    
                    c = m.get("color", [0.72, 0.76, 0.82])
                    f.write(struct.pack("<3f", float(c[0]), float(c[1]), float(c[2])))
                    
                    verts = m["vertices"]
                    norms = m.get("normals", [])
                    inds = m["indices"]
                    
                    f.write(struct.pack("<III", len(verts), len(norms), len(inds)))
                    
                    if len(verts) > 0:
                        f.write(struct.pack(f"<{len(verts)}f", *verts))
                    if len(norms) > 0:
                        f.write(struct.pack(f"<{len(norms)}f", *norms))
                    if len(inds) > 0:
                        f.write(struct.pack(f"<{len(inds)}I", *inds))
                        
            print(f"[NATIVE-OCCT] Binary CAD stream written successfully: {output_json_path}")
            os._exit(0)
    except Exception as xcaf_err:
        print(f"[NATIVE-OCCT] XCAF method note ({xcaf_err}), trying CadQuery engine...", file=sys.stderr)

    # Method 2: CadQuery Native Fallback
    try:
        import cadquery as cq
        from OCP.TopoDS import TopoDS
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        from OCP.BRep import BRep_Tool
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED, TopAbs_SOLID
        from OCP.TopLoc import TopLoc_Location
        
        shape_wp = cq.importers.importStep(input_path)
        compound_val = shape_wp.val() if hasattr(shape_wp, "val") else shape_wp
        solids_list = compound_val.Solids() if hasattr(compound_val, "Solids") else [compound_val]

        meshes = []
        for idx, s in enumerate(solids_list):
            raw_shape = s.wrapped if hasattr(s, "wrapped") else s
            BRepMesh_IncrementalMesh(raw_shape, deflection, False, 0.2, True).Perform()
            exp = TopExp_Explorer(raw_shape, TopAbs_FACE)
            vertices, normals, indices = [], [], []
            v_offset = 0

            while exp.More():
                face = TopoDS.Face_s(exp.Current())
                loc = TopLoc_Location()
                tri = BRep_Tool.Triangulation_s(face, loc)
                if tri is not None:
                    nb_nodes = tri.NbNodes()
                    nb_triangles = tri.NbTriangles()
                    trsf = loc.Transformation()

                    face_verts = []
                    for i in range(1, nb_nodes + 1):
                        p = tri.Node(i).Transformed(trsf)
                        face_verts.append((p.X(), p.Y(), p.Z()))

                    has_curved_normals = tri.HasNormals()
                    if has_curved_normals:
                        for i in range(1, nb_nodes + 1):
                            n = tri.Normal(i).Transformed(trsf)
                            fn = [n.X(), n.Y(), n.Z()]
                            if face.Orientation() == 1:
                                fn = [-fn[0], -fn[1], -fn[2]]
                            vertices.extend(face_verts[i-1])
                            normals.extend(fn)
                    else:
                        fn = [0.0, 1.0, 0.0]
                        if nb_triangles > 0:
                            t1 = tri.Triangle(1)
                            i1, i2, i3 = t1.Get()
                            p1, p2, p3 = face_verts[i1-1], face_verts[i2-1], face_verts[i3-1]
                            ax, ay, az = p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]
                            bx, by, bz = p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]
                            nx = ay*bz - az*by
                            ny = az*bx - ax*bz
                            nz = ax*by - ay*bx
                            l = (nx*nx + ny*ny + nz*nz)**0.5
                            if l > 1e-9:
                                fn = [nx/l, ny/l, nz/l]
                                if face.Orientation() == 1:
                                    fn = [-fn[0], -fn[1], -fn[2]]
                        for v in face_verts:
                            vertices.extend(v)
                            normals.extend(fn)

                    for i in range(1, nb_triangles + 1):
                        t = tri.Triangle(i)
                        n1, n2, n3 = t.Get()
                        if face.Orientation() == 1:
                            indices.extend([v_offset + n1 - 1, v_offset + n3 - 1, v_offset + n2 - 1])
                        else:
                            indices.extend([v_offset + n1 - 1, v_offset + n2 - 1, v_offset + n3 - 1])

                    v_offset += nb_nodes
                exp.Next()

            if len(vertices) > 0 and len(indices) > 0:
                meshes.append({
                    "name": f"Pieza {idx + 1}",
                    "color": [0.72, 0.76, 0.82],
                    "vertices": vertices,
                    "normals": normals,
                    "indices": indices
                })

        if len(meshes) > 0:
            import struct
            with open(output_json_path, "wb") as f:
                f.write(b"CADBIN01")
                f.write(struct.pack("<I", len(meshes)))
                for m in meshes:
                    name_bytes = m["name"].encode("utf-8")
                    f.write(struct.pack("<H", len(name_bytes)))
                    f.write(name_bytes)
                    c = m.get("color", [0.72, 0.76, 0.82])
                    f.write(struct.pack("<3f", float(c[0]), float(c[1]), float(c[2])))
                    verts, norms, inds = m["vertices"], m.get("normals", []), m["indices"]
                    f.write(struct.pack("<III", len(verts), len(norms), len(inds)))
                    if len(verts) > 0: f.write(struct.pack(f"<{len(verts)}f", *verts))
                    if len(norms) > 0: f.write(struct.pack(f"<{len(norms)}f", *norms))
                    if len(inds) > 0: f.write(struct.pack(f"<{len(inds)}I", *inds))
            print(f"[NATIVE-OCCT] CadQuery extracted {len(meshes)} solids into binary stream.")
            os._exit(0)
    except Exception as cq_err:
        print(f"[NATIVE-OCCT] CadQuery error: {cq_err}", file=sys.stderr)

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump({"success": False, "error": "All 64-bit native CAD parsers failed to read file"}, f)
    os._exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        os._exit(1)
    in_f = sys.argv[1]
    out_f = sys.argv[2]
    defl = float(sys.argv[3]) if len(sys.argv) > 3 else 0.003
    convert_step(in_f, out_f, defl)
`;
async function handleStepConversion(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "M\xE9todo no permitido. Use POST." }));
    return;
  }
  console.log(`[STEP-CONVERTER] Started 64-bit native conversion.`);
  const chunks = [];
  req.on("data", (chunk) => {
    chunks.push(chunk);
  });
  req.on("end", async () => {
    const buffer = Buffer.concat(chunks);
    chunks.length = 0;
    const fileSizeMB = buffer.length / (1024 * 1024);
    console.log(`[STEP-CONVERTER] File received: ${fileSizeMB.toFixed(2)} MB`);
    const tmpDir = os2.tmpdir();
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const stepFile = path2.join(tmpDir, `input_${uniqueId}.step`);
    const binFile = path2.join(tmpDir, `output_${uniqueId}.bin`);
    const pyScript = path2.join(tmpDir, `step_worker_${uniqueId}.py`);
    try {
      await fs2.promises.writeFile(stepFile, buffer);
      await fs2.promises.writeFile(pyScript, PYTHON_CONVERTER_SCRIPT);
      let deflection = 5e-3;
      if (fileSizeMB > 250) deflection = 0.08;
      else if (fileSizeMB > 150) deflection = 0.035;
      else if (fileSizeMB > 70) deflection = 0.015;
      else if (fileSizeMB > 35) deflection = 8e-3;
      console.log(`[STEP-CONVERTER] Executing 64-bit OpenCASCADE engine (high-fidelity deflection: ${deflection})...`);
      await new Promise((resolve3, reject) => {
        execFile("python", [pyScript, stepFile, binFile, String(deflection)], { maxBuffer: 1024 * 1024 * 500 }, (err, stdout, stderr) => {
          if (stdout) console.log(`[STEP-CONVERTER-PY] ${stdout.trim()}`);
          if (stderr) console.warn(`[STEP-CONVERTER-PY-WARN] ${stderr.trim()}`);
          if (fs2.existsSync(binFile)) {
            return resolve3();
          }
          if (err) {
            return reject(new Error(stderr || err.message));
          }
          resolve3();
        });
      });
      if (!fs2.existsSync(binFile)) {
        throw new Error("El conversor nativo 64-bit no gener\xF3 el archivo binario de resultado.");
      }
      const stats = await fs2.promises.stat(binFile);
      console.log(`[STEP-CONVERTER] Conversion successful! Streaming binary CAD stream (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": stats.size
      });
      const readStream = fs2.createReadStream(binFile);
      readStream.pipe(res);
      await new Promise((resolveStream, rejectStream) => {
        readStream.on("end", () => resolveStream());
        readStream.on("error", (err) => rejectStream(err));
      });
    } catch (err) {
      console.warn(`[STEP-CONVERTER] Python 64-bit engine failed (${err.message}). Trying OCCT in-memory fallback...`);
      try {
        const { meshes } = await parseSTEPWithOCCT(buffer, {
          linearUnit: "millimeter",
          linearDeflectionType: "bounding_box_ratio",
          linearDeflection: 0.02,
          angularDeflection: 0.8
        });
        if (!meshes || meshes.length === 0) {
          throw new Error("No se encontraron mallas v\xE1lidas.");
        }
        const responseData = JSON.stringify({
          success: true,
          meshes: meshes.map((m) => ({
            name: m.name,
            vertices: Array.from(m.vertices),
            indices: m.indices ? Array.from(m.indices) : void 0
          }))
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(responseData);
      } catch (fallbackErr) {
        console.error(`[STEP-CONVERTER] All conversion methods failed:`, fallbackErr);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || fallbackErr.message || "Error al procesar el archivo STEP." }));
      }
    } finally {
      fs2.promises.unlink(stepFile).catch(() => {
      });
      fs2.promises.unlink(binFile).catch(() => {
      });
      fs2.promises.unlink(pyScript).catch(() => {
      });
    }
  });
}
async function handleStepExport(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "M\xE9todo no permitido. Use POST." }));
    return;
  }
  let bodyStr = "";
  req.on("data", (chunk) => {
    bodyStr += chunk;
  });
  req.on("end", async () => {
    const tempId = `export_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tempIn = path2.join(os2.tmpdir(), `${tempId}.json`);
    const tempOut = path2.join(os2.tmpdir(), `${tempId}.step`);
    const coreScript = path2.resolve(process.cwd(), "server", "step_exporter_core.py");
    try {
      const payload = JSON.parse(bodyStr || "{}");
      if (!payload.parts || !Array.isArray(payload.parts) || payload.parts.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No se proporcionaron piezas para exportar." }));
        return;
      }
      await fs2.promises.writeFile(tempIn, JSON.stringify(payload), "utf-8");
      const exportOutput = await new Promise((resolve3, reject) => {
        execFile("python", [coreScript, tempIn, tempOut], { windowsHide: true, maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            console.error("[STEP-EXPORTER] Python error:", stderr || err.message);
            reject(new Error(stderr || err.message));
          } else {
            resolve3(stdout);
          }
        });
      });
      if (!fs2.existsSync(tempOut)) {
        throw new Error("El motor OpenCASCADE no gener\xF3 el archivo STEP de salida.");
      }
      const stepData = await fs2.promises.readFile(tempOut);
      const outName = payload.filename || "modelo_solido.step";
      const summary = exportOutput.match(/STEP_EXPORT_RESULT=(\{[^\r\n]+\})/);
      const meshParts = summary ? JSON.parse(summary[1]).meshParts : payload.parts.length;
      res.writeHead(200, {
        "Content-Type": "application/step;charset=utf-8",
        "X-STEP-Mesh-Parts": String(meshParts),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(outName)}"`,
        "Content-Length": stepData.length
      });
      res.end(stepData);
    } catch (err) {
      console.error("[STEP-EXPORTER] Export failed:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "Error al exportar s\xF3lidos STEP." }));
    } finally {
      fs2.promises.unlink(tempIn).catch(() => {
      });
      fs2.promises.unlink(tempOut).catch(() => {
      });
    }
  });
}

// server/step_splitter_api.ts
import * as fs3 from "fs";
import * as path3 from "path";
import * as os3 from "os";
import { spawn } from "child_process";
var PYTHON_CORE_SCRIPT = path3.resolve(process.cwd(), "server", "step_splitter_core.py");
async function handleStepSplitterApi(req, res, pathname) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (pathname === "/api/step-split/start" && req.method === "POST") {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", async () => {
      try {
        const body = JSON.parse(rawBody || "{}");
        const rawInput = (body.inputPath || "").trim();
        const inputPath = rawInput.replace(/^["']+|["']+$/g, "").trim();
        const rawOutput = (body.outputDir || "").trim();
        let outputDir = rawOutput.replace(/^["']+|["']+$/g, "").trim();
        const maxChunkMb = parseFloat(body.maxChunkMb) || 95;
        const splitMode = body.splitMode || "size";
        const preserveColors = body.preserveColors !== false;
        if (!inputPath || !fs3.existsSync(inputPath)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `El archivo de entrada no existe: ${inputPath || "no especificado"}` }));
          return;
        }
        if (!outputDir) {
          const dir = path3.dirname(inputPath);
          const baseName = path3.basename(inputPath, path3.extname(inputPath));
          outputDir = path3.join(dir, `${baseName}_partes`);
        }
        if (!fs3.existsSync(outputDir)) {
          fs3.mkdirSync(outputDir, { recursive: true });
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });
        const sendSse = (data) => {
          res.write(`data: ${JSON.stringify(data)}

`);
        };
        sendSse({ type: "init", message: "Iniciando particionador CAD...", outputDir });
        const pyArgs = [
          PYTHON_CORE_SCRIPT,
          inputPath,
          "--output-dir",
          outputDir,
          "--max-mb",
          String(maxChunkMb),
          "--mode",
          splitMode
        ];
        if (!preserveColors) pyArgs.push("--no-color");
        console.log(`[STEP-SPLITTER] Spawning: python ${pyArgs.join(" ")}`);
        const pyProc = spawn("python", pyArgs, { windowsHide: true });
        pyProc.on("error", (err) => {
          console.error(`[STEP-SPLITTER] Spawn error:`, err);
          sendSse({ type: "error", message: `Error al iniciar Python: ${err.message}` });
        });
        let lineBuffer = "";
        pyProc.stdout.on("data", (chunk) => {
          lineBuffer += chunk.toString();
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("__STEP_EVENT__")) {
              try {
                const eventJson = JSON.parse(trimmed.replace("__STEP_EVENT__", ""));
                sendSse(eventJson);
              } catch (e) {
              }
            } else if (trimmed) {
              sendSse({ type: "log", message: trimmed });
            }
          }
        });
        pyProc.stderr.on("data", (chunk) => {
          const errText = chunk.toString().trim();
          if (errText) {
            sendSse({ type: "warning", message: errText });
          }
        });
        pyProc.on("close", (code) => {
          if (lineBuffer.trim().startsWith("__STEP_EVENT__")) {
            try {
              const eventJson = JSON.parse(lineBuffer.trim().replace("__STEP_EVENT__", ""));
              sendSse(eventJson);
            } catch (e) {
            }
          }
          if (code === 0) {
            sendSse({ type: "finished", success: true, message: "Proceso completado exitosamente." });
          } else {
            sendSse({ type: "error", success: false, message: `El proceso de particionado termin\xF3 con c\xF3digo de error ${code}` });
          }
          res.end();
        });
        res.on("close", () => {
          if (!res.writableEnded && !pyProc.killed) {
            try {
              pyProc.kill();
            } catch (e) {
            }
          }
        });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  if (pathname === "/api/step-split/upload" && req.method === "POST") {
    const filenameHeader = req.headers["x-filename"] ? decodeURIComponent(req.headers["x-filename"]) : `upload_${Date.now()}.step`;
    const tempDir = os3.tmpdir();
    const tempFilePath = path3.join(tempDir, filenameHeader);
    const writeStream = fs3.createWriteStream(tempFilePath);
    req.pipe(writeStream);
    writeStream.on("finish", () => {
      const stats = fs3.statSync(tempFilePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        filePath: tempFilePath,
        fileName: filenameHeader,
        sizeMb: (stats.size / (1024 * 1024)).toFixed(2)
      }));
    });
    writeStream.on("error", (err) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }
  if (pathname === "/api/step-split/open-folder" && req.method === "POST") {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(rawBody || "{}");
        const folderPath = body.folderPath;
        if (!folderPath || !fs3.existsSync(folderPath)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Carpeta no encontrada" }));
          return;
        }
        spawn("explorer.exe", [path3.resolve(folderPath)], { detached: true, stdio: "ignore" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Explorador de Windows abierto." }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  if ((pathname === "/api/step-split/download" || pathname.startsWith("/api/step-split/download/")) && (req.method === "GET" || req.method === "HEAD")) {
    const urlObj = new URL(req.url || "", `http://localhost:3000`);
    const rawPath = urlObj.searchParams.get("path") || "";
    const cleanPath = rawPath.trim().replace(/^["']+|["']+$/g, "").trim();
    const filePath = path3.isAbsolute(cleanPath) ? cleanPath : path3.resolve(process.cwd(), cleanPath);
    if (!filePath || !fs3.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Archivo no encontrado: ${filePath || "no especificado"}` }));
      return;
    }
    const stats = fs3.statSync(filePath);
    let fileName = path3.basename(filePath);
    if (!fileName.toLowerCase().endsWith(".step") && !fileName.toLowerCase().endsWith(".stp")) {
      fileName += ".step";
    }
    res.writeHead(200, {
      "Content-Type": "model/step",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": stats.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs3.createReadStream(filePath);
    stream.pipe(res);
    stream.on("error", (err) => {
      console.error("[STEP-DOWNLOAD] Stream error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  if (pathname === "/api/step-split/defaults" && req.method === "GET") {
    const cwd = process.cwd();
    const defaultOutputDir = path3.join(cwd, "partes_step");
    let existingFiles = [];
    if (fs3.existsSync(defaultOutputDir)) {
      try {
        const list = fs3.readdirSync(defaultOutputDir).filter((f) => f.toLowerCase().endsWith(".step") || f.toLowerCase().endsWith(".stp"));
        existingFiles = list.map((f, idx) => {
          const p = path3.join(defaultOutputDir, f);
          const st = fs3.statSync(p);
          const mb = Number((st.size / (1024 * 1024)).toFixed(2));
          return {
            part_number: idx + 1,
            filename: f,
            path: path3.resolve(p),
            size_bytes: st.size,
            size_mb: mb,
            solids_count: 1,
            component_names: [f.replace(/\.(step|stp)$/i, "")]
          };
        });
      } catch (e) {
      }
    }
    const suggestedInputFiles = [];
    const searchDirs = [
      cwd,
      path3.join(cwd, "scratch"),
      path3.join(cwd, "temp"),
      path3.join(os3.homedir(), "Downloads")
    ];
    for (const sDir of searchDirs) {
      if (fs3.existsSync(sDir)) {
        try {
          const entries = fs3.readdirSync(sDir);
          for (const entry of entries) {
            if (entry.toLowerCase().endsWith(".step") || entry.toLowerCase().endsWith(".stp")) {
              const fullP = path3.join(sDir, entry);
              const st = fs3.statSync(fullP);
              if (st.isFile()) {
                suggestedInputFiles.push({
                  name: entry,
                  path: path3.resolve(fullP),
                  sizeMb: (st.size / (1024 * 1024)).toFixed(2),
                  rawBytes: st.size
                });
              }
            }
          }
        } catch (e) {
        }
      }
    }
    suggestedInputFiles.sort((a, b) => b.rawBytes - a.rawBytes);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      workspaceDir: cwd,
      defaultOutputDir,
      existingParts: existingFiles,
      suggestedInputFiles: suggestedInputFiles.slice(0, 15)
    }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Endpoint no encontrado" }));
}

// server/reconstruct.ts
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { Jimp } from "jimp";
dotenv.config();
function getSqSegDist(p, p1, p2) {
  let x = p1.x, y = p1.y, dx = p2.x - x, dy = p2.y - y;
  if (dx !== 0 || dy !== 0) {
    let t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x;
      y = p2.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
}
function simplifyDPStep(points, first, last, sqTolerance, simplified) {
  let maxSqDist = sqTolerance, index = -1;
  for (let i = first + 1; i < last; i++) {
    const sqDist = getSqSegDist(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }
  if (index !== -1) {
    simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}
function simplifyDouglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;
  const sqTolerance = tolerance * tolerance;
  const simplified = [points[0]];
  simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
  simplified.push(points[points.length - 1]);
  return simplified;
}
function marchingSquares(binaryGrid, width, height) {
  const segments = [];
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const v00 = binaryGrid[y * width + x] === 255;
      const v10 = binaryGrid[y * width + (x + 1)] === 255;
      const v11 = binaryGrid[(y + 1) * width + (x + 1)] === 255;
      const v01 = binaryGrid[(y + 1) * width + x] === 255;
      const idx = (v00 ? 8 : 0) | (v10 ? 4 : 0) | (v11 ? 2 : 0) | (v01 ? 1 : 0);
      const pT = { x: x + 0.5, y };
      const pR = { x: x + 1, y: y + 0.5 };
      const pB = { x: x + 0.5, y: y + 1 };
      const pL = { x, y: y + 0.5 };
      switch (idx) {
        case 1:
          segments.push({ a: pL, b: pB });
          break;
        case 2:
          segments.push({ a: pB, b: pR });
          break;
        case 3:
          segments.push({ a: pL, b: pR });
          break;
        case 4:
          segments.push({ a: pT, b: pR });
          break;
        case 5:
          segments.push({ a: pL, b: pT });
          segments.push({ a: pB, b: pR });
          break;
        case 6:
          segments.push({ a: pT, b: pB });
          break;
        case 7:
          segments.push({ a: pL, b: pT });
          break;
        case 8:
          segments.push({ a: pL, b: pT });
          break;
        case 9:
          segments.push({ a: pT, b: pB });
          break;
        case 10:
          segments.push({ a: pL, b: pB });
          segments.push({ a: pT, b: pR });
          break;
        case 11:
          segments.push({ a: pT, b: pR });
          break;
        case 12:
          segments.push({ a: pL, b: pR });
          break;
        case 13:
          segments.push({ a: pB, b: pR });
          break;
        case 14:
          segments.push({ a: pL, b: pB });
          break;
        default:
          break;
      }
    }
  }
  return segments;
}
function assembleLoops(segments) {
  const loops = [];
  const used = new Uint8Array(segments.length);
  const ptMap = /* @__PURE__ */ new Map();
  segments.forEach((seg, idx) => {
    const keyA = `${seg.a.x.toFixed(1)},${seg.a.y.toFixed(1)}`;
    if (!ptMap.has(keyA)) ptMap.set(keyA, []);
    ptMap.get(keyA).push({ idx, isStart: true });
    const keyB = `${seg.b.x.toFixed(1)},${seg.b.y.toFixed(1)}`;
    if (!ptMap.has(keyB)) ptMap.set(keyB, []);
    ptMap.get(keyB).push({ idx, isStart: false });
  });
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const currentLoop = [segments[i].a, segments[i].b];
    used[i] = 1;
    let currentPt = segments[i].b;
    let done = false;
    while (!done) {
      const key = `${currentPt.x.toFixed(1)},${currentPt.y.toFixed(1)}`;
      const candidates = ptMap.get(key) || [];
      let foundNext = false;
      for (const cand of candidates) {
        if (!used[cand.idx]) {
          used[cand.idx] = 1;
          const nextSeg = segments[cand.idx];
          currentPt = cand.isStart ? nextSeg.b : nextSeg.a;
          currentLoop.push(currentPt);
          foundNext = true;
          break;
        }
      }
      if (!foundNext) {
        done = true;
      } else {
        const dx = currentPt.x - currentLoop[0].x;
        const dy = currentPt.y - currentLoop[0].y;
        if (dx * dx + dy * dy < 0.1) {
          done = true;
        }
      }
    }
    if (currentLoop.length > 25) {
      loops.push(currentLoop);
    }
  }
  return loops;
}
function getPolygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area) / 2;
}
function getPolygonPerimeter(points) {
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    perimeter += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }
  return perimeter;
}
function dilate(src, width, height, radius) {
  const dst = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (src[y * width + x] === 1) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              dst[ny * width + nx] = 1;
            }
          }
        }
      }
    }
  }
  return dst;
}
function erode(src, width, height, radius) {
  const dst = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allOn = true;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (src[ny * width + nx] !== 1) {
              allOn = false;
              break;
            }
          } else {
            allOn = false;
            break;
          }
        }
        if (!allOn) break;
      }
      dst[y * width + x] = allOn ? 1 : 0;
    }
  }
  return dst;
}
function crossProduct(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
  if (pts.length <= 1) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
var UnionFind = class {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i) {
    if (this.parent[i] === i) return i;
    this.parent[i] = this.find(this.parent[i]);
    return this.parent[i];
  }
  union(i, j) {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      this.parent[rootI] = rootJ;
    }
  }
};
function getPrincipalAngle(points) {
  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;
  let covXX = 0, covYY = 0, covXY = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    covXX += dx * dx;
    covYY += dy * dy;
    covXY += dx * dy;
  }
  return 0.5 * Math.atan2(2 * covXY, covXX - covYY);
}
function rotatePoints(pts, angle, cx, cy) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return pts.map((p) => ({
    x: (p.x - cx) * cos - (p.y - cy) * sin + cx,
    y: (p.x - cx) * sin + (p.y - cy) * cos + cy
  }));
}
function orthogonalizePolygon(pts) {
  const n = pts.length;
  if (n < 3) return pts;
  let sumX = 0, sumY = 0;
  for (const p of pts) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / n;
  const cy = sumY / n;
  const theta = getPrincipalAngle(pts);
  const angleDeg = theta * 180 / Math.PI;
  const normAngle = (angleDeg % 90 + 90) % 90;
  let snapToAxis = false;
  let snapAngle = theta;
  if (normAngle < 15) {
    snapToAxis = true;
    snapAngle = (angleDeg - normAngle) * Math.PI / 180;
  } else if (normAngle > 75) {
    snapToAxis = true;
    snapAngle = (angleDeg + (90 - normAngle)) * Math.PI / 180;
  }
  const alignedPts = rotatePoints(pts, -theta, cx, cy);
  const ufX = new UnionFind(n);
  const ufY = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const p1 = alignedPts[i];
    const p2 = alignedPts[next];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    let angle = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;
    if (angle > 90) angle = 180 - angle;
    if (angle < 22.5) {
      ufY.union(i, next);
    } else if (angle > 67.5) {
      ufX.union(i, next);
    }
  }
  const xGroups = /* @__PURE__ */ new Map();
  const yGroups = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const rootX = ufX.find(i);
    if (!xGroups.has(rootX)) xGroups.set(rootX, []);
    xGroups.get(rootX).push(alignedPts[i].x);
    const rootY = ufY.find(i);
    if (!yGroups.has(rootY)) yGroups.set(rootY, []);
    yGroups.get(rootY).push(alignedPts[i].y);
  }
  const xAverages = /* @__PURE__ */ new Map();
  const yAverages = /* @__PURE__ */ new Map();
  xGroups.forEach((val, key) => {
    const avg = val.reduce((a, b) => a + b, 0) / val.length;
    xAverages.set(key, avg);
  });
  yGroups.forEach((val, key) => {
    const avg = val.reduce((a, b) => a + b, 0) / val.length;
    yAverages.set(key, avg);
  });
  const orthoPts = alignedPts.map((p, i) => ({
    x: xAverages.get(ufX.find(i)),
    y: yAverages.get(ufY.find(i))
  }));
  const angleToRotateBack = snapToAxis ? snapAngle : theta;
  return rotatePoints(orthoPts, angleToRotateBack, cx, cy);
}
function detectLocalCornerStyles(denseLoop, orthoPoints, scale) {
  const cornerStyles = {};
  const n = orthoPoints.length;
  if (n < 3) return cornerStyles;
  for (let i = 0; i < n; i++) {
    const prevPt = orthoPoints[(i - 1 + n) % n];
    const currPt = orthoPoints[i];
    const nextPt = orthoPoints[(i + 1) % n];
    const v1 = { x: prevPt.x - currPt.x, y: prevPt.y - currPt.y };
    const v2 = { x: nextPt.x - currPt.x, y: nextPt.y - currPt.y };
    const L1 = Math.hypot(v1.x, v1.y);
    const L2 = Math.hypot(v2.x, v2.y);
    if (L1 < 1e-4 || L2 < 1e-4) continue;
    const u1 = { x: v1.x / L1, y: v1.y / L1 };
    const u2 = { x: v2.x / L2, y: v2.y / L2 };
    const dot = u1.x * u2.x + u1.y * u2.y;
    const clampedDot = Math.max(-1, Math.min(1, dot));
    const theta = Math.acos(clampedDot);
    if (theta < 0.01 || theta > Math.PI - 0.01) continue;
    const halfTheta = theta / 2;
    let dMin = Infinity;
    let closestIdx = -1;
    for (let j = 0; j < denseLoop.length; j++) {
      const p = denseLoop[j];
      const d = Math.hypot(p.x - currPt.x, p.y - currPt.y);
      if (d < dMin) {
        dMin = d;
        closestIdx = j;
      }
    }
    if (closestIdx === -1) continue;
    if (dMin < 2) continue;
    const midPrev = { x: (prevPt.x + currPt.x) / 2, y: (prevPt.y + currPt.y) / 2 };
    const midNext = { x: (nextPt.x + currPt.x) / 2, y: (nextPt.y + currPt.y) / 2 };
    let idxPrev = -1;
    let idxNext = -1;
    let minDPrev = Infinity;
    let minDNext = Infinity;
    for (let j = 0; j < denseLoop.length; j++) {
      const p = denseLoop[j];
      const distPrev = Math.hypot(p.x - midPrev.x, p.y - midPrev.y);
      const distNext = Math.hypot(p.x - midNext.x, p.y - midNext.y);
      if (distPrev < minDPrev) {
        minDPrev = distPrev;
        idxPrev = j;
      }
      if (distNext < minDNext) {
        minDNext = distNext;
        idxNext = j;
      }
    }
    if (idxPrev === -1 || idxNext === -1) continue;
    const transitionPoints = [];
    let idx = idxPrev;
    const maxIterations = denseLoop.length;
    let count = 0;
    while (idx !== idxNext && count < maxIterations) {
      transitionPoints.push(denseLoop[idx]);
      idx = (idx + 1) % denseLoop.length;
      count++;
    }
    transitionPoints.push(denseLoop[idxNext]);
    const T_chamfer = dMin / Math.cos(halfTheta);
    const R_fillet = dMin / (1 / Math.sin(halfTheta) - 1);
    const T_fillet = R_fillet / Math.tan(halfTheta);
    const getDistToSegment = (pt, p1, p2) => {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(pt.x - p1.x, pt.y - p1.y);
      let t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(pt.x - (p1.x + t * dx), pt.y - (p1.y + t * dy));
    };
    const C1 = { x: currPt.x + T_chamfer * u1.x, y: currPt.y + T_chamfer * u1.y };
    const C2 = { x: currPt.x + T_chamfer * u2.x, y: currPt.y + T_chamfer * u2.y };
    const getDistToChamferPath = (pt) => {
      const d1 = getDistToSegment(pt, prevPt, C1);
      const d2 = getDistToSegment(pt, C1, C2);
      const d3 = getDistToSegment(pt, C2, nextPt);
      return Math.min(d1, d2, d3);
    };
    let errChamferSum = 0;
    for (const p of transitionPoints) {
      errChamferSum += getDistToChamferPath(p);
    }
    const maeChamfer = errChamferSum / transitionPoints.length;
    const F1 = { x: currPt.x + T_fillet * u1.x, y: currPt.y + T_fillet * u1.y };
    const F2 = { x: currPt.x + T_fillet * u2.x, y: currPt.y + T_fillet * u2.y };
    const bisector = { x: u1.x + u2.x, y: u1.y + u2.y };
    const bisectorLen = Math.hypot(bisector.x, bisector.y);
    const uB = bisectorLen > 1e-4 ? { x: bisector.x / bisectorLen, y: bisector.y / bisectorLen } : { x: 0, y: 0 };
    const D = R_fillet / Math.sin(halfTheta);
    const center = { x: currPt.x + D * uB.x, y: currPt.y + D * uB.y };
    const uArcBisector = { x: -uB.x, y: -uB.y };
    const sectorHalfAngle = (Math.PI - theta) / 2;
    const cosSectorLimit = Math.cos(sectorHalfAngle);
    const getDistToFilletPath = (pt) => {
      const d1 = getDistToSegment(pt, prevPt, F1);
      const d2 = getDistToSegment(pt, F2, nextPt);
      const dx = pt.x - center.x;
      const dy = pt.y - center.y;
      const distToCenter = Math.hypot(dx, dy);
      let dArc = Infinity;
      if (distToCenter > 1e-4) {
        const w = { x: dx / distToCenter, y: dy / distToCenter };
        const cosAlpha = w.x * uArcBisector.x + w.y * uArcBisector.y;
        if (cosAlpha >= cosSectorLimit) {
          dArc = Math.abs(distToCenter - R_fillet);
        } else {
          dArc = Math.min(Math.hypot(pt.x - F1.x, pt.y - F1.y), Math.hypot(pt.x - F2.x, pt.y - F2.y));
        }
      } else {
        dArc = R_fillet;
      }
      return Math.min(d1, d2, dArc);
    };
    let errFilletSum = 0;
    for (const p of transitionPoints) {
      errFilletSum += getDistToFilletPath(p);
    }
    const maeFillet = errFilletSum / transitionPoints.length;
    if (maeFillet < maeChamfer) {
      cornerStyles[i] = { type: "fillet", size: parseFloat((R_fillet * scale).toFixed(1)) };
    } else {
      cornerStyles[i] = { type: "chamfer", size: parseFloat((T_chamfer * scale).toFixed(1)) };
    }
  }
  return cornerStyles;
}
function regularizeSketchLoop(loop, scale, centerX, centerY, isOuter = false) {
  if (loop.length < 3) return { type: "polygon", points: [] };
  let sumX = 0, sumY = 0;
  for (const p of loop) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / loop.length;
  const cy = sumY / loop.length;
  const dists = loop.map((p) => Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
  const R = dists.reduce((a, b) => a + b, 0) / loop.length;
  const variance = dists.reduce((sum, d) => sum + (d - R) ** 2, 0) / loop.length;
  const stdDev = Math.sqrt(variance);
  const relStdDev = stdDev / R;
  const area = getPolygonArea(loop);
  const perimeter = getPolygonPerimeter(loop);
  const circularity = perimeter > 0 ? 4 * Math.PI * area / (perimeter * perimeter) : 0;
  console.log(`-- Loop Analysis (isOuter=${isOuter}): size/ptsCount=${loop.length}, area=${area.toFixed(1)}, peri=${perimeter.toFixed(1)}, circ=${circularity.toFixed(3)}, relStdDev=${relStdDev.toFixed(4)}`);
  const circleCircularityThresh = isOuter ? 0.6 : 0.45;
  const circleStdDevThresh = isOuter ? 0.28 : 0.38;
  if (circularity > circleCircularityThresh && relStdDev < circleStdDevThresh) {
    const points2 = [];
    for (let i = 0; i < 32; i++) {
      const theta = i / 32 * Math.PI * 2;
      const px = cx + R * Math.cos(theta);
      const py = cy + R * Math.sin(theta);
      points2.push({
        x: parseFloat(((px - centerX) * scale).toFixed(2)),
        y: parseFloat((-(py - centerY) * scale).toFixed(2))
      });
    }
    const scaledCenterX = parseFloat(((cx - centerX) * scale).toFixed(2));
    const scaledCenterY = parseFloat((-(cy - centerY) * scale).toFixed(2));
    const scaledRadius = parseFloat((R * scale).toFixed(2));
    return {
      type: "circle",
      points: points2,
      center: { x: scaledCenterX, y: scaledCenterY },
      radius: scaledRadius
    };
  }
  const dpTolerance = isOuter && loop.length > 1e3 ? 4.5 : 2.5;
  let simplified = simplifyDouglasPeucker(loop, dpTolerance);
  if (simplified.length > 2) {
    const pFirst = simplified[0];
    const pLast = simplified[simplified.length - 1];
    const distSq = (pFirst.x - pLast.x) ** 2 + (pFirst.y - pLast.y) ** 2;
    if (distSq < 0.1) {
      simplified = simplified.slice(0, -1);
    }
  }
  console.log(`-- DP Simplification: simplifiedPtsCount=${simplified.length}`);
  if (simplified.length > 6 || simplified.length !== 3 && simplified.length !== 4 && simplified.length !== 6) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of loop) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    simplified = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];
    console.log(`-- Forced to Bounding Rectangle (4 pts)`);
  }
  if (simplified.length < 3) {
    const points2 = loop.map((p) => ({
      x: parseFloat(((p.x - centerX) * scale).toFixed(2)),
      y: parseFloat((-(p.y - centerY) * scale).toFixed(2))
    }));
    return { type: "polygon", points: points2 };
  }
  const orthoPts = orthogonalizePolygon(simplified);
  const cornerStyles = detectLocalCornerStyles(loop, orthoPts, scale);
  const points = orthoPts.map((p) => ({
    x: parseFloat(((p.x - centerX) * scale).toFixed(2)),
    y: parseFloat((-(p.y - centerY) * scale).toFixed(2))
  }));
  return {
    type: "polygon",
    points,
    cornerStyles
  };
}
function findMaxAreaTriangle(points) {
  let maxArea = 0;
  let bestPoints = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = points[i];
        const b = points[j];
        const c = points[k];
        const area = getPolygonArea([a, b, c]);
        if (area > maxArea) {
          maxArea = area;
          bestPoints = [a, b, c];
        }
      }
    }
  }
  return { maxArea, bestPoints };
}
function findMaxAreaQuad(points) {
  let maxArea = 0;
  let bestPoints = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        for (let l = k + 1; l < n; l++) {
          const a = points[i];
          const b = points[j];
          const c = points[k];
          const d = points[l];
          const area = getPolygonArea([a, b, c, d]);
          if (area > maxArea) {
            maxArea = area;
            bestPoints = [a, b, c, d];
          }
        }
      }
    }
  }
  return { maxArea, bestPoints };
}
function createPrimitiveSketch(shape, centerX, centerY, scale, maxDim) {
  const physicalDim = maxDim * scale;
  const radius = parseFloat((physicalDim / 2).toFixed(2));
  if (shape === "sphere") {
    const points2 = [];
    points2.push({ x: 0, y: -radius });
    for (let i = 0; i <= 16; i++) {
      const theta = -Math.PI / 2 + i / 16 * Math.PI;
      points2.push({
        x: parseFloat((radius * Math.cos(theta)).toFixed(2)),
        y: parseFloat((radius * Math.sin(theta)).toFixed(2))
      });
    }
    points2.push({ x: 0, y: radius });
    points2.push({ x: 0, y: -radius });
    return {
      name: "Esfera Reconstruida",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: "polygon",
        points: points2,
        isClosed: true
      }],
      operation: {
        type: "revolve",
        angle: 360,
        taperScale: 0
      }
    };
  }
  if (shape === "cylinder") {
    const points2 = [];
    for (let i = 0; i < 32; i++) {
      const theta = i / 32 * Math.PI * 2;
      points2.push({
        x: parseFloat((radius * Math.cos(theta)).toFixed(2)),
        y: parseFloat((radius * Math.sin(theta)).toFixed(2))
      });
    }
    return {
      name: "Cilindro Reconstruido",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: "polygon",
        points: points2,
        isClosed: true
      }],
      operation: {
        type: "extrude",
        height: parseFloat(physicalDim.toFixed(2)),
        taperScale: 1
      }
    };
  }
  if (shape === "cone") {
    const points2 = [];
    for (let i = 0; i < 32; i++) {
      const theta = i / 32 * Math.PI * 2;
      points2.push({
        x: parseFloat((radius * Math.cos(theta)).toFixed(2)),
        y: parseFloat((radius * Math.sin(theta)).toFixed(2))
      });
    }
    return {
      name: "Cono Reconstruido",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: "polygon",
        points: points2,
        isClosed: true
      }],
      operation: {
        type: "extrude",
        height: parseFloat(physicalDim.toFixed(2)),
        taperScale: 0
      }
    };
  }
  if (shape === "tetrahedron") {
    const size2 = physicalDim;
    const h = size2 * Math.sqrt(3) / 2;
    const points2 = [
      { x: 0, y: parseFloat((2 * h / 3).toFixed(2)) },
      { x: parseFloat((size2 / 2).toFixed(2)), y: parseFloat((-h / 3).toFixed(2)) },
      { x: parseFloat((-size2 / 2).toFixed(2)), y: parseFloat((-h / 3).toFixed(2)) }
    ];
    return {
      name: "Tetraedro Reconstruido",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: "polygon",
        points: points2,
        isClosed: true
      }],
      operation: {
        type: "extrude",
        height: parseFloat(physicalDim.toFixed(2)),
        taperScale: 0
      }
    };
  }
  const size = radius;
  const points = [
    { x: -size, y: -size },
    { x: size, y: -size },
    { x: size, y: size },
    { x: -size, y: size }
  ];
  return {
    name: "Cubo Reconstruido",
    plane: "XY",
    offset: 0,
    profiles: [{
      type: "polygon",
      points,
      isClosed: true
    }],
    operation: {
      type: "extrude",
      height: parseFloat(physicalDim.toFixed(2)),
      taperScale: 1
    }
  };
}
function regularizeSketch(sketch) {
  if (!sketch || !sketch.profiles) return sketch;
  const regularizedProfiles = sketch.profiles.map((prof) => {
    if (prof.type === "circle" && prof.center && prof.radius !== void 0) {
      const pts = [];
      const cx = prof.center.x;
      const cy = prof.center.y;
      const r = prof.radius;
      for (let i = 0; i < 32; i++) {
        const theta = i / 32 * Math.PI * 2;
        pts.push({
          x: parseFloat((cx + r * Math.cos(theta)).toFixed(2)),
          y: parseFloat((cy + r * Math.sin(theta)).toFixed(2))
        });
      }
      return {
        type: "circle",
        points: pts,
        center: prof.center,
        radius: r,
        isClosed: true
      };
    }
    if ((prof.type === "polygon" || prof.type === "rectangle" || prof.type === "triangle" || prof.type === "hexagon") && prof.points && prof.points.length >= 3) {
      let pts = prof.points;
      if (prof.type === "polygon" && pts.length !== 3 && pts.length !== 4 && pts.length !== 6) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of pts) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        pts = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY }
        ];
        prof.type = "rectangle";
      }
      if (prof.type === "rectangle" || prof.type === "polygon" && pts.length === 4) {
        let orthoPts = orthogonalizePolygon(pts);
        pts = orthoPts.map((p) => ({
          x: parseFloat(p.x.toFixed(2)),
          y: parseFloat(p.y.toFixed(2))
        }));
      } else {
        pts = pts.map((p) => ({
          x: parseFloat(p.x.toFixed(2)),
          y: parseFloat(p.y.toFixed(2))
        }));
      }
      let finalType = prof.type;
      if (finalType === "polygon") {
        if (pts.length === 3) finalType = "triangle";
        else if (pts.length === 4) finalType = "rectangle";
        else if (pts.length === 6) finalType = "hexagon";
      }
      return {
        type: finalType,
        points: pts,
        isClosed: prof.isClosed !== void 0 ? prof.isClosed : true,
        cornerStyles: prof.cornerStyles || {}
      };
    }
    return prof;
  });
  return {
    name: sketch.name || "Boceto Reconstruido",
    plane: sketch.plane || "XY",
    offset: sketch.offset !== void 0 ? sketch.offset : 0,
    profiles: regularizedProfiles,
    operation: {
      type: sketch.operation?.type || "extrude",
      height: sketch.operation?.height !== void 0 ? sketch.operation.height : 20,
      taperScale: sketch.operation?.taperScale !== void 0 ? sketch.operation.taperScale : 1,
      booleanOp: sketch.operation?.booleanOp || "new-body",
      axis: sketch.operation?.axis || "Y"
    }
  };
}
async function analyzeImageContours(base64Data) {
  const buffer = Buffer.from(base64Data, "base64");
  const image = await Jimp.read(buffer);
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      gray[y * width + x] = 0.299 * image.bitmap.data[idx] + 0.587 * image.bitmap.data[idx + 1] + 0.114 * image.bitmap.data[idx + 2];
    }
  }
  const magnitude = new Float32Array(width * height);
  let maxMag = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const val = (dx, dy) => gray[(y + dy) * width + (x + dx)];
      const gx = -1 * val(-1, -1) + 1 * val(1, -1) - 2 * val(-1, 0) + 2 * val(1, 0) - 1 * val(-1, 1) + 1 * val(1, 1);
      const gy = -1 * val(-1, -1) - 2 * val(0, -1) - 1 * val(1, -1) + 1 * val(-1, 1) + 2 * val(0, 1) + 1 * val(1, 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      magnitude[y * width + x] = mag;
      if (mag > maxMag) maxMag = mag;
    }
  }
  const edgeThreshold = 30;
  const closingRadius = 3;
  const edgeMap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const norm = maxMag > 0 ? magnitude[i] / maxMag * 255 : 0;
    edgeMap[i] = norm > edgeThreshold ? 1 : 0;
  }
  const closed = erode(dilate(edgeMap, width, height, closingRadius), width, height, closingRadius);
  const labels = new Int32Array(width * height).fill(-1);
  let currentLabel = 0;
  const componentStats = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (closed[idx] === 1 || labels[idx] !== -1) continue;
      const q = [idx];
      labels[idx] = currentLabel;
      let size = 0;
      let touchesBorder = false;
      let head = 0;
      while (head < q.length) {
        const curr = q[head++];
        size++;
        const cx = curr % width;
        const cy = Math.floor(curr / width);
        if (cx <= closingRadius + 1 || cx >= width - 1 - closingRadius - 1 || cy <= closingRadius + 1 || cy >= height - 1 - closingRadius - 1) {
          touchesBorder = true;
        }
        const neighbors = [
          { nx: cx + 1, ny: cy },
          { nx: cx - 1, ny: cy },
          { nx: cx, ny: cy + 1 },
          { nx: cx, ny: cy - 1 }
        ];
        for (const n of neighbors) {
          if (n.nx >= 0 && n.nx < width && n.ny >= 0 && n.ny < height) {
            const nidx = n.ny * width + n.nx;
            if (closed[nidx] === 0 && labels[nidx] === -1) {
              labels[nidx] = currentLabel;
              q.push(nidx);
            }
          }
        }
      }
      componentStats.push({ label: currentLabel, size, touchesBorder });
      currentLabel++;
    }
  }
  const backgroundLabels = new Set(
    componentStats.filter((c) => c.touchesBorder).map((c) => c.label)
  );
  const nonBgComps = componentStats.filter((c) => !backgroundLabels.has(c.label));
  if (nonBgComps.length === 0) {
    throw new Error("No se pudo distinguir la pieza del fondo. Verifique la iluminaci\xF3n y el fondo de la imagen.");
  }
  nonBgComps.sort((a, b) => b.size - a.size);
  const objectBodyLabel = nonBgComps[0].label;
  const outerGrid = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    outerGrid[i] = !backgroundLabels.has(labels[i]) ? 255 : 0;
  }
  const outerSegments = marchingSquares(outerGrid, width, height);
  const outerLoops = assembleLoops(outerSegments);
  if (outerLoops.length === 0) {
    throw new Error("No se pudo encontrar el contorno exterior de la pieza.");
  }
  outerLoops.sort((a, b) => b.length - a.length);
  const outerLoop = outerLoops[0];
  const simplifiedOuter = simplifyDouglasPeucker(outerLoop, 2.5);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of simplifiedOuter) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const maxDim = Math.max(maxX - minX, maxY - minY);
  const targetSize = 80;
  const scale = targetSize / maxDim;
  return {
    centerX,
    centerY,
    scale,
    maxDim,
    outerLoop,
    simplifiedOuter,
    outerGrid,
    nonBgComps,
    labels,
    width,
    height,
    objectBodyLabel
  };
}
function findMaximalRectangle(grid, width, height) {
  const heights = new Int32Array(width).fill(0);
  let maxArea = 0;
  let bestRect = null;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r * width + c] !== 0) {
        heights[c]++;
      } else {
        heights[c] = 0;
      }
    }
    const stack = [];
    for (let c = 0; c <= width; c++) {
      const h = c === width ? 0 : heights[c];
      while (stack.length > 0 && h < heights[stack[stack.length - 1]]) {
        const heightIdx = stack.pop();
        const currHeight = heights[heightIdx];
        const widthStart = stack.length === 0 ? -1 : stack[stack.length - 1];
        const currWidth = c - widthStart - 1;
        const area = currHeight * currWidth;
        if (area > maxArea) {
          maxArea = area;
          bestRect = {
            x: widthStart + 1,
            y: r - currHeight + 1,
            w: currWidth,
            h: currHeight,
            area
          };
        }
      }
      stack.push(c);
    }
  }
  return bestRect;
}
function extractMathematicalContoursFromAnalysis(analysis) {
  const {
    centerX,
    centerY,
    scale,
    maxDim,
    outerLoop,
    simplifiedOuter,
    outerGrid,
    nonBgComps,
    labels,
    width,
    height,
    objectBodyLabel
  } = analysis;
  const area = getPolygonArea(outerLoop);
  const perimeter = getPolygonPerimeter(outerLoop);
  const circularity = perimeter > 0 ? 4 * Math.PI * area / (perimeter * perimeter) : 0;
  const hull = convexHull(outerLoop);
  const hullArea = getPolygonArea(hull);
  const solidity = hullArea > 0 ? area / hullArea : 0;
  if (solidity > 0.95) {
    if (circularity > 0.82) {
      if (circularity > 0.88) {
        return [createPrimitiveSketch("sphere", centerX, centerY, scale, maxDim)];
      } else {
        return [createPrimitiveSketch("cylinder", centerX, centerY, scale, maxDim)];
      }
    } else {
      const simplified8 = simplifyDouglasPeucker(outerLoop, 8).slice(0, -1);
      const triResult = findMaxAreaTriangle(simplified8);
      const triRatio = triResult.maxArea / area;
      if (triRatio > 0.9) {
        return [createPrimitiveSketch("tetrahedron", centerX, centerY, scale, maxDim)];
      } else {
        const quadResult = findMaxAreaQuad(simplified8);
        const quadRatio = quadResult.maxArea / area;
        if (quadRatio > 0.72 && circularity > 0.65) {
          return [createPrimitiveSketch("cube", centerX, centerY, scale, maxDim)];
        }
      }
    }
  }
  const sketches = [];
  const grid = new Uint8Array(outerGrid.length);
  grid.set(outerGrid);
  let initialArea = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > 0) initialArea++;
  }
  let remainingArea = initialArea;
  const areaThreshold = initialArea * 0.03;
  let isFirst = true;
  while (remainingArea > areaThreshold) {
    const maxRect = findMaximalRectangle(grid, width, height);
    if (!maxRect || maxRect.area < areaThreshold) break;
    const cxRect = maxRect.x + maxRect.w / 2;
    const cyRect = maxRect.y + maxRect.h / 2;
    const scaledCx = parseFloat(((cxRect - centerX) * scale).toFixed(2));
    const scaledCy = parseFloat((-(cyRect - centerY) * scale).toFixed(2));
    const scaledW = parseFloat((maxRect.w * scale).toFixed(2));
    const scaledH = parseFloat((maxRect.h * scale).toFixed(2));
    const w2 = scaledW / 2;
    const h2 = scaledH / 2;
    const profile = {
      type: "rectangle",
      points: [
        { x: parseFloat((scaledCx - w2).toFixed(2)), y: parseFloat((scaledCy - h2).toFixed(2)) },
        { x: parseFloat((scaledCx + w2).toFixed(2)), y: parseFloat((scaledCy - h2).toFixed(2)) },
        { x: parseFloat((scaledCx + w2).toFixed(2)), y: parseFloat((scaledCy + h2).toFixed(2)) },
        { x: parseFloat((scaledCx - w2).toFixed(2)), y: parseFloat((scaledCy + h2).toFixed(2)) }
      ],
      isClosed: true,
      cornerStyles: {}
    };
    sketches.push({
      name: isFirst ? "Cuerpo Principal" : "Bloque Anexo",
      plane: "XY",
      offset: 0,
      profiles: [profile],
      operation: {
        type: "extrude",
        height: 20,
        taperScale: 1,
        booleanOp: isFirst ? "new-body" : "join"
      }
    });
    isFirst = false;
    for (let y = maxRect.y; y < maxRect.y + maxRect.h; y++) {
      for (let x = maxRect.x; x < maxRect.x + maxRect.w; x++) {
        if (grid[y * width + x] > 0) {
          grid[y * width + x] = 0;
          remainingArea--;
        }
      }
    }
  }
  if (sketches.length === 0) {
    const outerReg = regularizeSketchLoop(outerLoop, scale, centerX, centerY, true);
    sketches.push({
      name: "Cuerpo Principal (Aproximaci\xF3n)",
      plane: "XY",
      offset: 0,
      profiles: [{
        type: outerReg.type,
        points: outerReg.points,
        center: outerReg.center,
        radius: outerReg.radius,
        isClosed: true,
        cornerStyles: outerReg.cornerStyles
      }],
      operation: {
        type: "extrude",
        height: 20,
        taperScale: 1,
        booleanOp: "new-body"
      }
    });
  }
  const cavities = nonBgComps.filter((c) => c.label !== objectBodyLabel && c.size > 25);
  cavities.forEach((cav, idx) => {
    const cavGrid = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      cavGrid[i] = labels[i] === cav.label ? 255 : 0;
    }
    const cavSegments = marchingSquares(cavGrid, width, height);
    const cavLoops = assembleLoops(cavSegments);
    if (cavLoops.length > 0) {
      cavLoops.sort((a, b) => b.length - a.length);
      const cavReg = regularizeSketchLoop(cavLoops[0], scale, centerX, centerY, false);
      if (cavReg.points && cavReg.points.length >= 3 || cavReg.type === "circle") {
        sketches.push({
          name: `Agujero o Vaciado ${idx + 1}`,
          plane: "XY",
          offset: 0,
          profiles: [{
            type: cavReg.type,
            points: cavReg.points,
            center: cavReg.center,
            radius: cavReg.radius,
            isClosed: true,
            cornerStyles: cavReg.cornerStyles
          }],
          operation: {
            type: "extrude",
            height: 20,
            taperScale: 1,
            booleanOp: "cut"
          }
        });
      }
    }
  });
  return sketches;
}
async function generateContentWithFallback(ai, options) {
  const fallbackModels = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest"
  ];
  let lastError = null;
  for (const model of fallbackModels) {
    try {
      console.log(`Attempting reconstruction with model: ${model}`);
      const response = await ai.models.generateContent({
        model,
        contents: options.contents
      });
      console.log(`SUCCESS with model: ${model}`);
      return response;
    } catch (err) {
      console.warn(`FAILED with model ${model}:`, err.message || err);
      lastError = err;
    }
  }
  throw lastError || new Error("All models failed to generate content.");
}
async function handleReconstruction(req, res) {
  try {
    const { image, images, textPrompt, mode, apiKey } = req.body;
    if (!textPrompt && !image && (!images || !Array.isArray(images) || images.length === 0)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Falta la imagen, el conjunto de im\xE1genes o un texto descriptivo." }));
      return;
    }
    const geminiKey = apiKey || process.env.GEMINI_API_KEY;
    const primaryImage = images && Array.isArray(images) && images.length > 0 ? images[0] : image;
    let mimeType = "image/png";
    let base64Data = "";
    if (primaryImage) {
      const matches = primaryImage.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
      base64Data = primaryImage;
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    }
    if (mode === "mesh") {
      if (!geminiKey) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Falta la GEMINI_API_KEY. Configure la clave API en el archivo .env o en los ajustes." }));
        return;
      }
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const prompt = `Analiza la imagen o las im\xE1genes adjuntas de esta pieza f\xEDsica y genera un modelo 3D en formato Wavefront OBJ de este objeto.
Sigue estrictamente estas reglas:
1. Si el objeto es un tetraedro (pir\xE1mide triangular), genera exactamente 4 v\xE9rtices y 4 caras triangulares.
2. Si el objeto es una pir\xE1mide, cilindro, esfera, soporte L u otra forma geom\xE9trica o mec\xE1nica compleja, aprox\xEDmala con una malla limpia de v\xE9rtices (l\xEDneas 'v x y z') y caras triangulares (l\xEDneas 'f v1 v2 v3').
3. Aseg\xFArate de que las caras est\xE9n correctamente trianguladas y que los \xEDndices de los v\xE9rtices en las caras sean correctos (empezando desde 1 y apuntando a los v\xE9rtices v\xE1lidos del archivo).
4. El modelo debe estar centrado alrededor del origen (0,0,0) y tener dimensiones realistas en mil\xEDmetros (coordenadas de v\xE9rtices en el rango de -50 a 50).
5. Aseg\xFArate de que la malla sea completamente cerrada (watertight/estanca), sin agujeros ni aristas sueltas, y que las normales apunten hacia afuera (ordenando los v\xE9rtices de las caras en sentido antihorario).
6. Devuelve \xDANICAMENTE el contenido del archivo OBJ. NO envuelvas la respuesta en bloques de c\xF3digo markdown (\`\`\`obj o similares) ni agregues ning\xFAn texto explicativo, comentarios ni encabezados adicionales.`;
      const parts = [{ text: prompt }];
      if (images && Array.isArray(images) && images.length > 0) {
        for (const img of images) {
          const imgMatches = img.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
          let mType = "image/png";
          let bData = img;
          if (imgMatches && imgMatches.length === 3) {
            mType = imgMatches[1];
            bData = imgMatches[2];
          }
          parts.push({
            inlineData: {
              mimeType: mType,
              data: bData
            }
          });
        }
      } else {
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data
          }
        });
      }
      const response = await generateContentWithFallback(ai, {
        contents: [
          {
            role: "user",
            parts
          }
        ]
      });
      let objText = response.text || "";
      objText = objText.replace(/```[a-zA-Z0-9]*\n/g, "").replace(/```/g, "").trim();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ mode: "mesh", objText }));
    } else {
      console.log("Starting hybrid CAD mode reconstruction...");
      let analysis = null;
      let sketches = [];
      if (base64Data) {
        analysis = await analyzeImageContours(base64Data);
      }
      if (geminiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey: geminiKey });
          let prompt = "";
          const commonPromptSteps = `
Paso 1: Identificaci\xF3n del Cuerpo Principal.
- Identifica la forma principal o base de la pieza. Este ser\xE1 el primer boceto de la l\xEDnea de tiempo que establece el volumen inicial.
- Asigna obligatoriamente \`"booleanOp": "new-body"\`.

Paso 2: Inventario de Formas Secundarias.
- Identifica TODAS las formas secundarias que componen la pieza (agujeros, salientes, nervios, cajeras, etc.). Cu\xE9ntalas.
- Para cada forma secundaria, determina:
  a. Posici\xF3n en la pieza: \xBFD\xF3nde est\xE1 ubicada respecto al cuerpo principal? \xBFRequiere un plano desplazado ("offset")?
  b. Simetr\xEDas: \xBFHay formas repetidas en patr\xF3n o sim\xE9tricas?
  c. Forma y Tipo de Operaci\xF3n: \xBFEs un vaciado sobre el cuerpo principal ("booleanOp": "cut") o es un s\xF3lido que hay que a\xF1adir ("booleanOp": "join")?

Paso 3: Rango Apropiado de Extrusi\xF3n o Revoluci\xF3n.
- Analiza la profundidad, grosor o \xE1ngulo del objeto tridimensional visible en la foto.
- Calcula la altura de extrusi\xF3n ("height") o \xE1ngulo de revoluci\xF3n de manera rigurosa y proporcional al tama\xF1o de tus coordenadas 2D.
- Por ejemplo, si el ancho de la base 2D en tu boceto es de 60 mm y en la foto el grosor es un tercio de esa anchura, la extrusi\xF3n resultante debe ser de unos 20 mm.
- No uses valores por defecto (como 20 o 25) arbitrariamente; adapta el rango de extrusi\xF3n al espesor real visible de la pieza f\xEDsica.

Paso 4: Identificar Redondeos (Fillets) y Chaflanes (Chamfers) de Esquinas.
1. En las esquinas de los perfiles 2D (v\xE9rtices del pol\xEDgono): Identifica transiciones curvas (redondeos/fillets) o cortes diagonales planos (biseles/chaflanes/chamfers) y estima su radio/distancia en mm (ej. 2.0mm, 5.0mm).
2. En las caras 3D de extrusi\xF3n global: Identifica si los bordes de la cara superior o inferior tienen redondeados o chaflanes de transici\xF3n 3D (biselado superior/inferior).

Paso 5: Planificaci\xF3n de la L\xEDnea de Tiempo CAD Paso a Paso.
- Descomp\xF3n la pieza en una serie ordenada de bocetos y operaciones.
- Haz CADA FORMA POR SEPARADO. Primero el cuerpo principal, y luego un boceto secundario para cada forma secundaria inventariada en el Paso 2.
- Aseg\xFArate de asignar el plano y "offset" correctos para la posici\xF3n de la forma, y el "booleanOp" correcto (cut o join).

Paso 6: Bucle de Validaci\xF3n y Verificaci\xF3n (Iterativo).
- Realiza pasos de identificaci\xF3n de lo que te falta por a\xF1adir, comprobando minuciosa e iterativamente contra la foto original.
- \xBFFaltan agujeros secundarios, biseles, cajeras internas o redondeos? Si es as\xED, a\xF1ade los bocetos necesarios.
- Repite este proceso de verificaci\xF3n hasta que compruebes que no falta absolutamente nada por a\xF1adir y sea un trabajo preciso de ingenier\xEDa.

Paso 7: Trazar los perfiles 2D usando EXCLUSIVAMENTE formas predeterminadas.
- La inteligencia artificial debe identificar l\xF3gicamente la cara principal sobre la que hay que extruir o trabajar.
- Las piezas pueden tener muchos detalles, pero a nivel geom\xE9trico todos son simples.
- Usa SOLO combinaciones de formas predeterminadas ("circle", "rectangle", "triangle", "hexagon"). NO uses "polygon" para dibujar formas complejas v\xE9rtice a v\xE9rtice.
- Para construir figuras complejas, div\xEDdelas mentalmente en estas primitivas simples y posici\xF3nalas correctamente con las dimensiones adecuadas ("radius" o calculando los "points" exactos). El truco es posicionarlos bien y con el tama\xF1o adecuado.
- En la propiedad "cornerStyles", define un objeto JSON cuyas claves sean los \xEDndices (0-based) de los v\xE9rtices que tienen redondeos o chaflanes y el valor sea \`{ "type": "fillet" | "chamfer", "size": n\xFAmero_en_mm }\`.

Responde \xDANICAMENTE con un objeto JSON v\xE1lido con la siguiente estructura, sin bloques de c\xF3digo markdown ni texto explicativo:
{
  "isSimple": true o false (true si es cubo, esfera, cilindro, cono o tetraedro est\xE1ndar),
  "shape": "cube" | "sphere" | "cylinder" | "cone" | "tetrahedron" | "none",
  "isExtrusion": true o false,
  "hasPerspectiveVolume": true o false,
  "verificationChecklist": [
    "Identificaci\xF3n de la cara principal a extruir (ej: Cara Frontal)",
    "Identificaci\xF3n del cuerpo principal (ej: Base rectangular extrudida 30mm)",
    "Inventario de formas secundarias simples (ej: 4 c\xEDrculos en las esquinas, 1 rect\xE1ngulo central)",
    "Confirmaci\xF3n de que TODO est\xE1 hecho con rect\xE1ngulos, c\xEDrculos, tri\xE1ngulos o hex\xE1gonos con su centro y tama\xF1o perfectos"
  ],
  "sketches": [
    {
      "name": "Nombre descriptivo de la operaci\xF3n (ej. Base Rectangular, Agujero Circular)",
      "plane": "XY" | "XZ" | "YZ",
      "offset": n\xFAmero_desplazamiento_plano_en_mm,
      "profiles": [
        {
          "type": "circle" | "rectangle" | "triangle" | "hexagon",
          "points": [{"x": x_val, "y": y_val}, ...],
          "isClosed": true,
          "center": {"x": cx_val, "y": cy_val},
          "radius": r_val,
          "cornerStyles": {
            "0": { "type": "fillet", "size": 3.0 },
            "2": { "type": "chamfer", "size": 1.5 }
          }
        }
      ],
      "operation": {
        "type": "extrude" | "revolve",
        "height": n\xFAmero_altura_estimada,
        "booleanOp": "new-body" | "join" | "cut",
        "axis": "X" | "Y",
        "bevelType": "none" | "fillet" | "chamfer",
        "bevelSize": n\xFAmero_tama\xF1o_bisel_en_mm
      }
    }
  ]
}

Si isSimple es true, pon "sketches": [], y en verificationChecklist pon ["Pieza simple clasificada"].`;
          if (textPrompt && (!images || images.length === 0) && !base64Data) {
            prompt = `Act\xFAa como un Ingeniero de CAD experto. Tu tarea es generar la estructura param\xE9trica exacta de una pieza bas\xE1ndote PURA Y EXCLUSIVAMENTE en la siguiente descripci\xF3n de texto del usuario: "${textPrompt}".
No vas a analizar ninguna imagen, debes "imaginar" la pieza e instanciarla paso a paso usando geometr\xEDa param\xE9trica estricta.

${commonPromptSteps}`;
          } else if (textPrompt) {
            prompt = `El usuario ha proporcionado la siguiente descripci\xF3n textual de la pieza: "${textPrompt}".
Analiza la(s) imagen(es) adjunta(s) de esta pieza f\xEDsica considerando esta descripci\xF3n y clasif\xEDcala/reconstr\xFAyela siguiendo estrictamente esta estrategia bien estructurada para piezas complejas, asegurando un trabajo preciso de ingenier\xEDa:

${commonPromptSteps}`;
          } else if (images && Array.isArray(images) && images.length > 1) {
            prompt = `Analiza las ${images.length} im\xE1genes adjuntas del mismo objeto f\xEDsico tomadas desde diferentes \xE1ngulos de c\xE1mara (inspirado en motores como Kiri Engine para mejorar el escaneo de fotos a un archivo STEP) y clasif\xEDcala/reconstr\xFAyela siguiendo estrictamente esta estrategia bien estructurada para piezas complejas, asegurando un trabajo preciso de ingenier\xEDa:

${commonPromptSteps}`;
          } else {
            prompt = `Analiza la imagen adjunta de esta pieza f\xEDsica (inspirado en motores como Kiri Engine para mejorar el escaneo de fotos a un archivo STEP) y clasif\xEDcala/reconstr\xFAyela siguiendo estrictamente esta estrategia bien estructurada para piezas complejas, asegurando un trabajo preciso de ingenier\xEDa:

${commonPromptSteps}`;
          }
          const parts = [{ text: prompt }];
          if (images && Array.isArray(images) && images.length > 0) {
            for (const img of images) {
              const imgMatches = img.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
              let mType = "image/png";
              let bData = img;
              if (imgMatches && imgMatches.length === 3) {
                mType = imgMatches[1];
                bData = imgMatches[2];
              }
              parts.push({
                inlineData: {
                  mimeType: mType,
                  data: bData
                }
              });
            }
          } else if (base64Data) {
            parts.push({
              inlineData: {
                mimeType,
                data: base64Data
              }
            });
          }
          const response = await generateContentWithFallback(ai, {
            contents: [
              {
                role: "user",
                parts
              }
            ]
          });
          const text = response.text || "";
          const jsonStr = text.replace(/```[a-zA-Z0-9]*\n/g, "").replace(/```/g, "").trim();
          console.log("Gemini reconstruction response:", jsonStr);
          const parsed = JSON.parse(jsonStr);
          if (parsed) {
            console.log(`Step 1: Is Extrusion? ${parsed.isExtrusion}`);
            console.log(`Step 2: Has Perspective/Volume? ${parsed.hasPerspectiveVolume}`);
            if (parsed.isSimple && parsed.shape !== "none" && analysis) {
              console.log(`Gemini classified primitive: ${parsed.shape}. Generating mathematical primitive sketch...`);
              const primSketch = createPrimitiveSketch(parsed.shape, analysis.centerX, analysis.centerY, analysis.scale, analysis.maxDim);
              sketches = [primSketch];
            } else if (parsed.sketches && parsed.sketches.length > 0) {
              console.log(`Gemini returned ${parsed.sketches.length} custom sketches. Regularizing coordinates locally...`);
              sketches = parsed.sketches.map((sk) => regularizeSketch(sk));
            } else if (parsed.sketch) {
              console.log("Gemini returned single custom projected sketch. Regularizing coordinates locally...");
              sketches = [regularizeSketch(parsed.sketch)];
            }
          }
        } catch (err) {
          console.warn("Gemini reconstruction failed or timed out. Falling back to local classifier:", err.message || err);
        }
      }
      if (sketches.length === 0) {
        if (!analysis) {
          throw new Error("No se pudo generar la pieza desde el texto. Intenta proporcionar m\xE1s detalles geom\xE9tricos o medidas en tu descripci\xF3n.");
        }
        console.log("Running local mathematical primitive classifier / contour-tracer...");
        const fallbackSketches = extractMathematicalContoursFromAnalysis(analysis);
        sketches = fallbackSketches;
      }
      console.log("CAD Mode reconstruction completed. Returning sketches count:", sketches.length);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        mode: "cad",
        sketches
      }));
    }
  } catch (error) {
    console.error("Error in reconstruction backend:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message || "Error interno del servidor." }));
  }
}

// server/production_server.ts
dotenv2.config();
var app = express();
var PORT = parseInt(process.env.PORT || "3000", 10);
var DIST_DIR = path4.resolve(process.cwd(), "dist");
app.all("/api/commerce", (req, res) => handleCommerce(req, res));
var SAVED_MODELS_DIR = path4.resolve(process.cwd(), "server", "saved_models");
if (!fs4.existsSync(SAVED_MODELS_DIR)) {
  fs4.mkdirSync(SAVED_MODELS_DIR, { recursive: true });
}
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
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.all("/api/convert-step*", async (req, res) => {
  try {
    await handleStepConversion(req, res);
  } catch (err) {
    console.error("[PRODUCTION-SERVER] Error in /api/convert-step:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error al procesar archivo STEP" });
    }
  }
});
app.all("/api/export-step*", async (req, res) => {
  try {
    await handleStepExport(req, res);
  } catch (err) {
    console.error("[PRODUCTION-SERVER] Error in /api/export-step:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error al exportar archivo STEP" });
    }
  }
});
app.all("/api/projects*", async (req, res) => {
  try {
    const pathname = req.path;
    await handleProjectsApi(req, res, pathname);
  } catch (err) {
    console.error("[PRODUCTION-SERVER] Error in /api/projects:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error en API de proyectos" });
    }
  }
});
app.all("/api/step-split*", async (req, res) => {
  try {
    const pathname = req.path;
    await handleStepSplitterApi(req, res, pathname);
  } catch (err) {
    console.error("[PRODUCTION-SERVER] Error in /api/step-split:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error en divisor STEP" });
    }
  }
});
var jsonParser = express.json({ limit: "50mb" });
app.post("/api/reconstruct", jsonParser, async (req, res) => {
  try {
    await handleReconstruction(req, res);
  } catch (err) {
    console.error("[PRODUCTION-SERVER] Error in /api/reconstruct:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Error en reconstrucci\xF3n IA" });
    }
  }
});
if (fs4.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, {
    maxAge: "1d",
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (filePath.endsWith(".wasm")) {
        res.setHeader("Content-Type", "application/wasm");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.(js|css|webp|png|jpg|svg)$/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    }
  }));
  app.get("/splitter", (req, res) => {
    const splitterHtml = path4.join(DIST_DIR, "splitter.html");
    if (fs4.existsSync(splitterHtml)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(splitterHtml);
    } else {
      res.redirect("/");
    }
  });
  app.get("/google:code.html", (req, res) => {
    const filename = `google${req.params.code}.html`;
    const inDist = path4.join(DIST_DIR, filename);
    const inPublic = path4.join(process.cwd(), "public", filename);
    if (fs4.existsSync(inDist)) {
      return res.sendFile(inDist);
    }
    if (fs4.existsSync(inPublic)) {
      return res.sendFile(inPublic);
    }
    res.status(404).type("text/plain").send("Google verification file not found");
  });
  app.get("*", (req, res) => {
    if (/\.[a-zA-Z0-9]+$/.test(req.path) && req.path !== "/index.html" && req.path !== "/splitter.html") {
      res.status(404).type("text/plain").send("Resource not found");
      return;
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path4.join(DIST_DIR, "index.html"));
  });
} else {
  console.warn("[PRODUCTION-SERVER] Warning: dist/ directory not found. Please run 'npm run build' first.");
  app.get("*", (req, res) => {
    res.status(503).send("La aplicaci\xF3n est\xE1 compilando o no se ha generado la carpeta dist/. Ejecute 'npm run build'.");
  });
}
var server = http.createServer(app);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`=======================================================`);
  console.log(`  \u{1F680} VOXEL3D CAD - Servidor de Producci\xF3n Activo`);
  console.log(`  \u{1F310} Escuchando en: http://0.0.0.0:${PORT}`);
  console.log(`  \u{1F4C1} Directorio est\xE1tico: ${DIST_DIR}`);
  console.log(`=======================================================`);
});
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
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
