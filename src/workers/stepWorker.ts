import occtimportjs from "occt-import-js";

let occtInstance: any = null;

async function initOCCT() {
  if (!occtInstance) {
    occtInstance = await occtimportjs({
      locateFile: (name: string) => {
        if (name.endsWith(".wasm")) {
          return "/occt-import-js.wasm";
        }
        return name;
      }
    });
  }
  return occtInstance;
}

self.onmessage = async (e: MessageEvent) => {
  const { buffer } = e.data;
  try {
    const occt = await initOCCT();
    const uint8Buffer = new Uint8Array(buffer);
    const result = occt.ReadStepFile(uint8Buffer, {});

    if (!result || !result.success || !result.meshes || result.meshes.length === 0) {
      self.postMessage({ success: false, error: "No se pudieron extraer mallas 3D del archivo STEP." });
      return;
    }

    const transferables: ArrayBuffer[] = [];

    const meshesData = result.meshes.map((m: any, i: number) => {
      const pos = m.attributes && m.attributes.position ? new Float32Array(m.attributes.position.array) : new Float32Array();
      const norm = m.attributes && m.attributes.normal && m.attributes.normal.array ? new Float32Array(m.attributes.normal.array) : undefined;
      const idx = m.index && m.index.array ? new Uint32Array(m.index.array) : undefined;

      if (pos.buffer) transferables.push(pos.buffer);
      if (norm && norm.buffer) transferables.push(norm.buffer);
      if (idx && idx.buffer) transferables.push(idx.buffer);

      return {
        name: m.name || `Pieza ${i + 1}`,
        color: m.color ? [m.color[0], m.color[1], m.color[2]] : undefined,
        vertices: pos,
        normals: norm,
        indices: idx
      };
    }).filter((m: any) => m.vertices.length > 0);

    (self as any).postMessage({ success: true, meshes: meshesData }, transferables);
  } catch (err) {
    self.postMessage({ success: false, error: (err as Error).message });
  }
};
