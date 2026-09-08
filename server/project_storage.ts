import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.join(__dirname, 'saved_models');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netList = interfaces[name];
    if (!netList) continue;
    for (const net of netList) {
      // Find non-internal IPv4
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

export interface ProjectSavePayload {
  id?: string;
  name?: string;
  sketches: Record<string, any>;
  operations: any[];
  activeSketchId?: string;
  activePlane?: string;
  material?: any;
  importedBodies?: any[];
  theme?: string;
}

export function saveProject(payload: ProjectSavePayload, reqPort = 3000) {
  const id = payload.id && /^[a-zA-Z0-9_-]+$/.test(payload.id)
    ? payload.id
    : `cad_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const now = new Date().toISOString();
  const name = payload.name?.trim() || `Proyecto CAD (${new Date().toLocaleDateString()})`;

  const record = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    sketches: payload.sketches || {},
    operations: payload.operations || [],
    activeSketchId: payload.activeSketchId || 'sketch-xy',
    activePlane: payload.activePlane || 'XY',
    material: payload.material,
    importedBodies: payload.importedBodies || [],
    theme: payload.theme || 'dark'
  };

  const filePath = path.join(STORAGE_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');

  const localIp = getLocalIpAddress();
  const localUrl = `http://localhost:${reqPort}/?project=${id}`;
  const networkUrl = `http://${localIp}:${reqPort}/?project=${id}`;
  const sharePath = `/?project=${id}`;

  return {
    success: true,
    id,
    name,
    createdAt: now,
    localUrl,
    networkUrl,
    sharePath
  };
}

export function getProject(id: string) {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return null;
  }

  const filePath = path.join(STORAGE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[ProjectStorage] Error reading project ${id}:`, err);
    return null;
  }
}

export function listProjects(reqPort = 3000) {
  if (!fs.existsSync(STORAGE_DIR)) return [];

  const files = fs.readdirSync(STORAGE_DIR).filter(f => f.endsWith('.json'));
  const localIp = getLocalIpAddress();

  const projects = files.map(file => {
    try {
      const id = file.replace('.json', '');
      const raw = fs.readFileSync(path.join(STORAGE_DIR, file), 'utf-8');
      const data = JSON.parse(raw);
      return {
        id,
        name: data.name || id,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
        sketchesCount: Object.keys(data.sketches || {}).length,
        operationsCount: (data.operations || []).length,
        localUrl: `http://localhost:${reqPort}/?project=${id}`,
        networkUrl: `http://${localIp}:${reqPort}/?project=${id}`,
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

export async function handleProjectsApi(req: any, res: any, pathname: string) {
  const hostHeader = req.headers['host'] || 'localhost:3000';
  const portMatch = hostHeader.match(/:(\d+)$/);
  const port = portMatch ? parseInt(portMatch[1], 10) : 3000;

  // Enable CORS headers so it can be called cleanly from any device
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/projects -> list all
  if (req.method === 'GET' && (pathname === '/api/projects' || pathname === '/api/projects/')) {
    const list = listProjects(port);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, projects: list, localIp: getLocalIpAddress() }));
    return;
  }

  // GET /api/projects/:id -> get single project
  if (req.method === 'GET' && pathname.startsWith('/api/projects/')) {
    const id = pathname.replace('/api/projects/', '').trim();
    const project = getProject(id);
    if (!project) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Proyecto con ID "${id}" no encontrado.` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, project, localIp: getLocalIpAddress() }));
    return;
  }

  // POST /api/projects -> save project
  if (req.method === 'POST' && (pathname === '/api/projects' || pathname === '/api/projects/')) {
    const processPayload = (payload: any) => {
      try {
        const result = saveProject(payload, port);
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
