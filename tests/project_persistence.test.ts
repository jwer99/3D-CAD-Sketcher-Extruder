import assert from 'assert';
import * as THREE from 'three';
import { encodeCadBinary, decodeCadBinary, computeSha256Hex } from '../src/utils/cadBinary.js';
import { isPrivateHost, getPublicShareUrl } from '../src/utils/url.js';
import {
  saveAssetBuffer,
  getAssetBuffer,
  saveProject,
  getProject,
  listProjects,
  resolvePublicOrigin
} from '../server/project_storage.js';

console.log('====================================================');
console.log('🧪 RUNNING COMPREHENSIVE PROJECT PERSISTENCE TEST');
console.log('====================================================\n');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function it(name: string, fn: () => void | Promise<void>) {
    return (async () => {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
      } catch (err: any) {
        console.error(`  ✗ ${name}`);
        console.error(`    Error: ${err.message}`);
        failed++;
      }
    })();
  }

  // -------------------------------------------------------------------------
  // 1. URL & Origin Public Verification
  // -------------------------------------------------------------------------
  console.log('1. URL Sanitization & Public Origin Verification:');

  await it('should correctly identify localhost and private IP addresses', () => {
    assert.strictEqual(isPrivateHost('localhost'), true);
    assert.strictEqual(isPrivateHost('localhost:3000'), true);
    assert.strictEqual(isPrivateHost('127.0.0.1'), true);
    assert.strictEqual(isPrivateHost('127.0.0.1:8080'), true);
    assert.strictEqual(isPrivateHost('192.168.1.105'), true);
    assert.strictEqual(isPrivateHost('10.0.0.1'), true);
    assert.strictEqual(isPrivateHost('172.16.0.1'), true);
    assert.strictEqual(isPrivateHost('172.31.255.255'), true);

    // Public hostnames should be false
    assert.strictEqual(isPrivateHost('cad-voxel.render.com'), false);
    assert.strictEqual(isPrivateHost('cad.empresa.es'), false);
    assert.strictEqual(isPrivateHost('8.8.8.8'), false);
  });

  await it('should generate clean share URL without private IPs in production', () => {
    // When window is mocked in test environment
    const testProjectId = 'cad_test_12345';
    const publicUrl = getPublicShareUrl(testProjectId);
    assert.ok(publicUrl.includes(`?project=${testProjectId}`), 'Share URL must contain ?project= query parameter');
    assert.ok(!publicUrl.includes('192.168.'), 'Share URL must not expose private 192.168.x.x addresses');
    assert.ok(!publicUrl.includes('10.0.'), 'Share URL must not expose private 10.x.x.x addresses');
  });

  await it('should resolve public origin from x-forwarded headers in server', () => {
    const mockReq = {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'cad-app.production.com'
      }
    };
    const origin = resolvePublicOrigin(mockReq);
    assert.strictEqual(origin, 'https://cad-app.production.com');
  });

  // -------------------------------------------------------------------------
  // 2. Binary CADBIN01 Serialization with 562 Parts
  // -------------------------------------------------------------------------
  console.log('\n2. CADBIN01 High-Performance Serialization (562 Parts Fixture):');

  const TOTAL_PIECES = 562;
  const mockPieces: Array<{
    name: string;
    color: [number, number, number];
    vertices: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
  }> = [];

  for (let i = 0; i < TOTAL_PIECES; i++) {
    // Simple cube-like geometry per piece (8 vertices, 36 indices)
    const verts = new Float32Array([
      -5, -5, -5,  5, -5, -5,  5,  5, -5, -5,  5, -5,
      -5, -5,  5,  5, -5,  5,  5,  5,  5, -5,  5,  5
    ]);
    const norms = new Float32Array(verts.length).fill(0);
    const inds = new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
      0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5
    ]);
    mockPieces.push({
      name: `Conjunto_Parte_${(i + 1).toString().padStart(3, '0')}`,
      color: [0.3 + (i % 10) * 0.05, 0.4, 0.7],
      vertices: verts,
      normals: norms,
      indices: inds
    });
  }

  let encodedBinary: Uint8Array;
  let computedHash: string;

  await it(`should encode ${TOTAL_PIECES} assembly pieces into CADBIN01 binary format`, async () => {
    encodedBinary = encodeCadBinary(mockPieces);
    assert.ok(encodedBinary.byteLength > 0, 'Binary buffer must not be empty');
    
    // Check CADBIN01 magic header
    const headerStr = new TextDecoder().decode(encodedBinary.slice(0, 8));
    assert.strictEqual(headerStr, 'CADBIN01', 'Buffer must start with CADBIN01 magic bytes');

    computedHash = await computeSha256Hex(encodedBinary);
    assert.strictEqual(computedHash.length, 64, 'SHA-256 hash must be 64 hex characters');
  });

  await it(`should decode CADBIN01 and restore all ${TOTAL_PIECES} pieces losslessly`, () => {
    const decoded = decodeCadBinary(encodedBinary);
    assert.strictEqual(decoded.length, TOTAL_PIECES, `Decoded array must contain exactly ${TOTAL_PIECES} pieces`);

    // Verify first, middle, and last piece
    [0, Math.floor(TOTAL_PIECES / 2), TOTAL_PIECES - 1].forEach(idx => {
      const orig = mockPieces[idx];
      const dec = decoded[idx];
      assert.strictEqual(dec.name, orig.name, `Piece ${idx} name mismatch`);
      assert.strictEqual(dec.vertices.length, orig.vertices.length, `Piece ${idx} vertex count mismatch`);
      assert.strictEqual(dec.indices?.length, orig.indices.length, `Piece ${idx} index count mismatch`);
      assert.deepStrictEqual(Array.from(dec.vertices), Array.from(orig.vertices), `Piece ${idx} vertex buffer data mismatch`);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Asset & Project Persistence on Server (Schema V2)
  // -------------------------------------------------------------------------
  console.log('\n3. Cloud Storage Persistence & Transformation Math:');

  await it('should store binary asset by SHA-256 and retrieve it accurately', () => {
    const saveResult = saveAssetBuffer(Buffer.from(encodedBinary));
    assert.strictEqual(saveResult.hash, computedHash);
    assert.strictEqual(saveResult.sizeBytes, encodedBinary.byteLength);

    const retrievedBuffer = getAssetBuffer(computedHash);
    assert.ok(retrievedBuffer !== null, 'Retrieved buffer must exist');
    assert.strictEqual(retrievedBuffer!.length, encodedBinary.byteLength);
  });

  // Simulate group movement: move assembly by [50, 0, 100]
  const groupMat = new THREE.Matrix4().makeTranslation(50, 0, 100);

  // Simulate individual movement on piece 42: rotate 45 deg Z and translate [0, 25, 0]
  const pieceLocalMat = new THREE.Matrix4().makeRotationZ(Math.PI / 4).multiply(new THREE.Matrix4().makeTranslation(0, 25, 0));
  const piece42CumulativeMat = groupMat.clone().multiply(pieceLocalMat);

  const modelSourceId = `model-fixture-${Date.now()}`;
  const importedBodies = mockPieces.map((p, idx) => {
    let mat = groupMat.clone();
    if (idx === 42) {
      mat = piece42CumulativeMat.clone();
    }
    return {
      id: `imported-fixture-${idx}`,
      name: p.name,
      sourceId: modelSourceId,
      partIndex: idx,
      transformMatrix: Array.from(mat.elements),
      visible: idx !== 10, // Piece 10 is hidden
      color: p.color,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number]
    };
  });

  let savedProjectId = '';

  await it(`should save project with ${TOTAL_PIECES} pieces under schemaVersion 2`, () => {
    const savePayload = {
      schemaVersion: 2,
      name: 'Ensamblaje 562 Piezas Test',
      sketches: {},
      operations: [],
      importedModels: [{
        id: modelSourceId,
        filename: 'ensamblaje_industrial_562.step',
        assetHash: computedHash,
        totalParts: TOTAL_PIECES,
        byteLength: encodedBinary.byteLength
      }],
      importedBodies,
      theme: 'dark'
    };

    const saved = saveProject(savePayload as any, null, 3000);
    assert.ok(saved.success, 'Save project must succeed');
    assert.strictEqual(saved.totalParts, TOTAL_PIECES, 'Total parts count in saved summary must match 562');
    assert.strictEqual(saved.totalModels, 1, 'Total models count must match 1');
    savedProjectId = saved.id;
  });

  await it('should load project and confirm piece IDs, matrices, and visibility', () => {
    const loaded = getProject(savedProjectId);
    assert.ok(loaded !== null, 'Loaded project must not be null');
    assert.strictEqual(loaded!.schemaVersion, 2, 'Schema version must be 2');
    assert.strictEqual(loaded!.importedBodies.length, TOTAL_PIECES, `Must contain all ${TOTAL_PIECES} pieces`);

    // Verify piece 10 visibility was preserved (false)
    const piece10 = loaded!.importedBodies[10];
    assert.strictEqual(piece10.visible, false, 'Piece 10 visibility must be preserved as false');

    // Verify piece 42 transformation matrix
    const piece42 = loaded!.importedBodies[42];
    assert.ok(piece42.transformMatrix && piece42.transformMatrix.length === 16, 'Piece 42 must have 16-element transform matrix');

    const reconstructedMat = new THREE.Matrix4().fromArray(piece42.transformMatrix);
    const expectedMat = piece42CumulativeMat;

    // Ensure elements match within floating point precision
    for (let i = 0; i < 16; i++) {
      assert.ok(
        Math.abs(reconstructedMat.elements[i] - expectedMat.elements[i]) < 1e-4,
        `Matrix element ${i} mismatch for piece 42`
      );
    }

    // Verify rehydration: apply matrix to piece 42 original vertices
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(mockPieces[42].vertices, 3));
    geom.applyMatrix4(reconstructedMat);
    const transformedVerts = geom.attributes.position.array;

    // Check vertex 0 transformed coordinates
    const v0Original = new THREE.Vector3(mockPieces[42].vertices[0], mockPieces[42].vertices[1], mockPieces[42].vertices[2]);
    const v0Expected = v0Original.clone().applyMatrix4(expectedMat);

    assert.ok(Math.abs(transformedVerts[0] - v0Expected.x) < 1e-3, 'Vertex X coordinate must match expected transformed position');
    assert.ok(Math.abs(transformedVerts[1] - v0Expected.y) < 1e-3, 'Vertex Y coordinate must match expected transformed position');
    assert.ok(Math.abs(transformedVerts[2] - v0Expected.z) < 1e-3, 'Vertex Z coordinate must match expected transformed position');
  });

  // -------------------------------------------------------------------------
  // 4. Project Listing Metadata (Parts count, Models count, Size)
  // -------------------------------------------------------------------------
  console.log('\n4. Projects List Metadata Verification:');

  await it('should list saved projects with totalParts, models count, and totalSizeBytes', () => {
    const projectsList = listProjects(null, 3000);
    const found = projectsList.find(p => p.id === savedProjectId);
    assert.ok(found !== undefined, 'Saved project must appear in listProjects');
    assert.strictEqual(found!.totalParts, TOTAL_PIECES, 'listProjects must expose totalParts');
    assert.strictEqual(found!.importedModelsCount, 1, 'listProjects must expose importedModelsCount');
    assert.ok(found!.totalSizeBytes! > 0, 'listProjects must expose totalSizeBytes');
  });

  // -------------------------------------------------------------------------
  // 5. Legacy Project Migration Test
  // -------------------------------------------------------------------------
  console.log('\n5. Legacy Project (V1) Compatibility & Graceful Migration:');

  await it('should load legacy V1 project without imported models gracefully', () => {
    const legacyPayload = {
      name: 'Legacy Project V1',
      sketches: {
        'sketch-xy': { id: 'sketch-xy', name: 'Base Sketch', profiles: [] }
      },
      operations: [
        { id: 'op-1', name: 'Extrude 1', type: 'extrude', sketchId: 'sketch-xy', parameters: { height: 20 } }
      ],
      activeSketchId: 'sketch-xy'
    };

    const saved = saveProject(legacyPayload as any, null, 3000);
    const loaded = getProject(saved.id);
    assert.ok(loaded !== null, 'Legacy project must load successfully');
    assert.strictEqual(loaded!.operations.length, 1, 'Sketches and operations must be preserved');
    assert.strictEqual(loaded!.importedBodies.length, 0, 'Missing imported bodies must default to empty array');
  });

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
