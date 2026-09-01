importScripts('occt-import-js.js');

onmessage = async function (ev) {
  try {
    let modulOverrides = {
      locateFile: function (path) {
        return path;
      },
      INITIAL_MEMORY: 1024 * 1024 * 1024,
      ALLOW_MEMORY_GROWTH: true
    };
    let occt = await occtimportjs(modulOverrides);
    let rawBuf = ev.data.buffer;
    let uint8 = (rawBuf instanceof Uint8Array) ? rawBuf : new Uint8Array(rawBuf);
    let params = ev.data.params || {};
    
    let result = null;
    try {
      result = occt.ReadStepFile(uint8, params);
    } catch (e) {
      console.warn("OCCT failed with params, retrying with default params:", e);
      try {
        result = occt.ReadStepFile(uint8, null);
      } catch (err2) {
        console.error("OCCT parsing failed completely:", err2);
      }
    }

    console.log("OCCT PARSE RESULT:", JSON.stringify({ 
      success: result ? result.success : false, 
      numMeshes: (result && result.meshes) ? result.meshes.length : 0 
    }));

    // If strict parameters caused meshing to fail, retry with default parameters!
    if (result && result.success && result.meshes && result.meshes.length === 0) {
      console.warn("OCCT returned 0 meshes with custom params. Retrying with default params...");
      try {
        result = occt.ReadStepFile(uint8, null);
      } catch (e) {
        console.warn("Default param retry failed:", e);
      }
    }

    if (!result || !result.success || !result.meshes) {
      postMessage({ type: 'error', error: "No se pudieron extraer las mallas con OpenCASCADE (posible límite de memoria alcanzado)." });
      return;
    }

    const CHUNK_SIZE = 20; 
    let currentChunk = [];
    let transferables = [];

    for (let i = 0; i < result.meshes.length; i++) {
      let m = result.meshes[i];
      if (!m.attributes || !m.attributes.position || !m.attributes.position.array) continue;

      let posRaw = m.attributes.position.array;
      let pos = posRaw instanceof Float32Array ? posRaw : new Float32Array(Array.from(posRaw));

      let norm = undefined;
      if (m.attributes.normal && m.attributes.normal.array) {
        let normRaw = m.attributes.normal.array;
        norm = normRaw instanceof Float32Array ? normRaw : new Float32Array(Array.from(normRaw));
      }

      let idx = undefined;
      if (m.index && m.index.array) {
        let idxRaw = m.index.array;
        idx = idxRaw instanceof Uint32Array ? idxRaw : new Uint32Array(Array.from(idxRaw));
      }

      if (pos.length > 0) {
        if (pos.buffer) transferables.push(pos.buffer);
        if (norm && norm.buffer) transferables.push(norm.buffer);
        if (idx && idx.buffer) transferables.push(idx.buffer);

        currentChunk.push({
          name: m.name || ('Pieza ' + (i + 1)),
          color: m.color ? [m.color[0], m.color[1], m.color[2]] : undefined,
          vertices: pos,
          normals: norm,
          indices: idx
        });
      }

      if (currentChunk.length >= CHUNK_SIZE) {
        postMessage({ type: 'chunk', meshes: currentChunk }, transferables);
        currentChunk = [];
        transferables = [];
      }
    }

    if (currentChunk.length > 0) {
      postMessage({ type: 'chunk', meshes: currentChunk }, transferables);
    }
    
    postMessage({ type: 'done' });
  } catch (err) {
    postMessage({ type: 'error', error: err.message });
  }
};
