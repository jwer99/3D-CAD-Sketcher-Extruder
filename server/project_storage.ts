import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.join(__dirname, 'saved_models');
const ASSETS_DIR = path.join(STORAGE_DIR, 'assets');

// Ensure storage directories exist
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

export function isPrivateHost(hostname: string): boolean {
  if (!hostname) return true;
  const cleanHost = hostname.split(':')[0].toLowerCase();
  return (
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    cleanHost === '::1' ||
    cleanHost.startsWith('192.168.') ||
    cleanHost.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanHost)
  );
}

export function resolvePublicOrigin(req: any, fallbackPort = 3000): string {
  // 1. Check explicit environment variables (Render, Railway, VPS, Cloudflare)
  const envUrl = process.env.RENDER_EXTERNAL_URL || process.env.VITE_PUBLIC_APP_URL || process.env.APP_URL;
  if (envUrl && envUrl.trim().startsWith('http')) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    return `https://${process.env.RENDER_EXTERNAL_HOSTNAME.trim().replace(/\/+$/, '')}`;
  }

  // 2. Check HTTP Request headers (Reverse Proxy / Cloudflare / Render)
  const forwardedProto = req?.headers?.['x-forwarded-proto'] || 'http';
  const forwardedHost = req?.headers?.['x-forwarded-host'] || req?.headers?.['host'];
  const originHeader = req?.headers?.['origin'];

  if (originHeader && originHeader.startsWith('http')) {
    try {
      const url = new URL(originHeader);
      // In production or when accessed publicly, respect the origin
      if (!isPrivateHost(url.hostname)) {
        return originHeader.replace(/\/+$/, '');
      }
    } catch {}
  }

  if (forwardedHost) {
    const hostWithoutPort = forwardedHost.split(':')[0];
    if (!isPrivateHost(hostWithoutPort)) {
      return `${forwardedProto}://${forwardedHost}`;
    }
  }

  // 3. Fallback to standard request host or local IP
  const host = req?.headers?.['host'] || `localhost:${fallbackPort}`;
  return `http://${host}`;
}

// ---------------------------------------------------------------------------
// Binary 3D Asset Storage (Deduplicated by SHA-256)
// ---------------------------------------------------------------------------

export function saveAssetBuffer(buffer: Buffer): { hash: string; sizeBytes: number; existed: boolean } {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const assetPath = path.join(ASSETS_DIR, `${hash}.bin`);
  const existed = fs.existsSync(assetPath);

  if (!existed) {
    fs.writeFileSync(assetPath, buffer);
  }

  return { hash, sizeBytes: buffer.length, existed };
}

export function getAssetBuffer(hash: string): Buffer | null {
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

// ---------------------------------------------------------------------------
// Project Persistence (Schema Version 2 with Full STEP & Transformation Data)
// ---------------------------------------------------------------------------

export interface ProjectSavePayload {
  schemaVersion?: number;
  id?: string;
  name?: string;
  sketches: Record<string, any>;
  operations: any[];
  activeSketchId?: string;
  activePlane?: string;
  material?: any;
  importedModels?: any[];
  importedBodies?: any[];
  theme?: string;
  meta?: {
    totalParts?: number;
    totalModels?: number;
    totalSizeBytes?: number;
  };
}

export function saveProject(payload: ProjectSavePayload, req: any, reqPort = 3000) {
  const id = payload.id && /^[a-zA-Z0-9_-]+$/.test(payload.id)
    ? payload.id
    : `cad_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const now = new Date().toISOString();
  const name = payload.name?.trim() || `Proyecto CAD (${new Date().toLocaleDateString()})`;

  const importedModels = payload.importedModels || [];
  const importedBodies = payload.importedBodies || [];

  // Compute summary metadata
  const totalParts = importedBodies.length > 0 ? importedBodies.length : (payload.meta?.totalParts || 0);
  const totalModels = importedModels.length > 0 ? importedModels.length : (payload.meta?.totalModels || 0);
  let totalSizeBytes = payload.meta?.totalSizeBytes || 0;
  if (!totalSizeBytes && importedModels.length > 0) {
    totalSizeBytes = importedModels.reduce((acc: number, m: any) => acc + (m.byteLength || m.sizeBytes || m.fileSize || 0), 0);
  }

  const record = {
    schemaVersion: payload.schemaVersion || 2,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    sketches: payload.sketches || {},
    operations: payload.operations || [],
    activeSketchId: payload.activeSketchId || 'sketch-xy',
    activePlane: payload.activePlane || 'XY',
    material: payload.material,
    importedModels,
    importedBodies,
    theme: payload.theme || 'dark',
    meta: {
      totalParts,
      totalModels,
      totalSizeBytes
    }
  };

  const filePath = path.join(STORAGE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

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

export function getProject(id: string) {
  if (!id || typeof id !== 'string') {
    return null;
  }

  const cleanId = id.trim();
  const filePath = path.join(STORAGE_DIR, `${cleanId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
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

  // Fallback: search by exact project name or sanitized slug
  if (fs.existsSync(STORAGE_DIR)) {
    try {
      const files = fs.readdirSync(STORAGE_DIR).filter(f => f.endsWith('.json'));
      const targetSlug = cleanId.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(STORAGE_DIR, file), 'utf-8');
          const project = JSON.parse(raw);
          const projName = (project.name || '').trim();
          const projSlug = projName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const fileBase = file.replace(/\.json$/, '');

          if (
            project.id === cleanId ||
            fileBase === cleanId ||
            projName.toLowerCase() === cleanId.toLowerCase() ||
            (targetSlug.length >= 3 && projSlug === targetSlug)
          ) {
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
        } catch {}
      }
    } catch (err) {
      console.error('[ProjectStorage] Error during fallback project search:', err);
    }
  }

  return null;
}

export function listProjects(req: any, reqPort = 3000) {
  if (!fs.existsSync(STORAGE_DIR)) return [];

  const files = fs.readdirSync(STORAGE_DIR).filter(f => f.endsWith('.json'));
  const publicOrigin = resolvePublicOrigin(req, reqPort);

  const projects = files.map(file => {
    try {
      const id = file.replace('.json', '');
      const raw = fs.readFileSync(path.join(STORAGE_DIR, file), 'utf-8');
      const data = JSON.parse(raw);
      
      const totalParts = data.importedBodies?.length || data.meta?.totalParts || 0;
      const totalModels = data.importedModels?.length || data.meta?.totalModels || 0;
      const totalSizeBytes = data.meta?.totalSizeBytes || (data.importedModels || []).reduce((acc: number, m: any) => acc + (m.byteLength || m.sizeBytes || m.fileSize || 0), 0);

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

  // Sort newest first
  projects.sort((a: any, b: any) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });

  return projects;
}

// ---------------------------------------------------------------------------
// HTTP Request Handler for /api/projects* and /api/projects/assets*
// ---------------------------------------------------------------------------

export async function handleProjectsApi(req: any, res: any, pathname: string) {
  const hostHeader = req.headers['host'] || 'localhost:3000';
  const portMatch = hostHeader.match(/:(\d+)$/);
  const port = portMatch ? parseInt(portMatch[1], 10) : 3000;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Asset-Hash, X-File-Name');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. GET /api/projects/assets/:hash -> Download 3D binary asset
  if (req.method === 'GET' && pathname.startsWith('/api/projects/assets/')) {
    const hash = pathname.replace('/api/projects/assets/', '').trim();
    const assetBuf = getAssetBuffer(hash);
    if (!assetBuf) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Artefacto 3D con hash "${hash}" no encontrado en el servidor.` }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': assetBuf.length,
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
    res.end(assetBuf);
    return;
  }

  // 2. POST /api/projects/assets -> Upload 3D binary asset
  if (req.method === 'POST' && (pathname === '/api/projects/assets' || pathname === '/api/projects/assets/')) {
    const processBuffer = (buf: Buffer) => {
      try {
        if (!buf || buf.length === 0) {
          throw new Error('El buffer de asset está vacío.');
        }
        const result = saveAssetBuffer(buf);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error guardando asset binario: ' + err.message }));
      }
    };

    if (Buffer.isBuffer(req.body)) {
      processBuffer(req.body);
      return;
    }

    // Accumulate raw binary chunks
    const chunks: Buffer[] = [];
    req.on('data', (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      const fullBuffer = Buffer.concat(chunks);
      processBuffer(fullBuffer);
    });
    return;
  }

  // 3. GET /api/projects -> List all projects
  if (req.method === 'GET' && (pathname === '/api/projects' || pathname === '/api/projects/')) {
    const list = listProjects(req, port);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, projects: list, localIp: getLocalIpAddress() }));
    return;
  }

  // 4. GET /api/projects/:id -> Get single project
  if (req.method === 'GET' && pathname.startsWith('/api/projects/')) {
    const rawId = pathname.replace('/api/projects/', '').trim();
    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {}
    const project = getProject(id);
    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Proyecto con ID "${id}" no encontrado en el servidor.` }));
      return;
    }

    const publicOrigin = resolvePublicOrigin(req, port);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      project,
      publicUrl: `${publicOrigin}/?project=${id}`,
      sharePath: `/?project=${id}`
    }));
    return;
  }

  // 5. POST /api/projects -> Save project
  if (req.method === 'POST' && (pathname === '/api/projects' || pathname === '/api/projects/')) {
    const processPayload = (payload: any) => {
      try {
        const result = saveProject(payload, req, port);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload JSON inválido: ' + err.message }));
      }
    };

    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      processPayload(req.body);
      return;
    }

    let body = '';
    req.on('data', (chunk: any) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        processPayload(payload);
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload JSON inválido: ' + err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
}
