/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { SketchData, CADOperation, PlaneType, Point2D, Profile } from "./types";
import { getStyledProfile } from "./GeometryUtils";
import polygonClipping from "polygon-clipping";

function isPointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  const x = pt.x, y = pt.y;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function getPolygonArea(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Custom STEP (ISO 10303-21) exporter for 3D solid geometries.
 * Generates an AP214 compliant B-Rep STEP file. Sketches and operations
 * are exported as pure analytical solid bodies (cylinder, planar box, etc.)
 * while complex or imported meshes fall back to triangulated B-Rep sheets.
 */
export function exportToSTEP(
  bodies: { name: string; mesh: THREE.Mesh }[],
  sketches?: Record<string, SketchData>,
  operations?: CADOperation[]
): string {
  let idCounter = 1;
  const lines: string[] = [];

  const addEntity = (type: string, params: string): number => {
    const id = idCounter++;
    lines.push(`#${id} = ${type}(${params});`);
    return id;
  };

  const addComplexEntity = (content: string): number => {
    const id = idCounter++;
    lines.push(`#${id} = ${content};`);
    return id;
  };

  // Header and Metadata
  const dateStr = new Date().toISOString().replace(/\.\d+Z$/, "").replace(/[:\.-]/g, "").substring(0, 15);
  
  const header = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('CAD geometry extruded and revolved from 2D sketches','2;1'),'21;');
FILE_NAME('${bodies[0]?.name || "model"}.step','${dateStr}',('AI Studio User'),('Google AI Studio'),'3D CAD Sketcher Exporter','Step3D Designer','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;`;

  // Standard Product Setup Boilerplate
  const appContextId = addEntity("APPLICATION_CONTEXT", "'core data for automotive mechanical design processes'");
  const appProtocolDefId = addEntity("APPLICATION_PROTOCOL_DEFINITION", `'international standard','automotive_design',2000,#${appContextId}`);

  const productContextId = addEntity("PRODUCT_CONTEXT", `'',#${appContextId},'mechanical'`);
  const productId = addEntity("PRODUCT", `'Design','Design','',(#${productContextId})`);
  const formationId = addEntity("PRODUCT_DEFINITION_FORMATION", `'1.0','First version',#${productId}`);
  const prodDefContextId = addEntity("PRODUCT_DEFINITION_CONTEXT", `'part definition',#${appContextId},'design'`);
  const productDefinitionId = addEntity("PRODUCT_DEFINITION", `'design',$,#${formationId},#${prodDefContextId}`);

  // Product categories required by some loaders
  addEntity("PRODUCT_CATEGORY", `'part',$`);
  addEntity("PRODUCT_RELATED_PRODUCT_CATEGORY", `'detail',$,(#${productId})`);

  const lengthUnitId = addComplexEntity("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )");
  const planeAngleUnitId = addComplexEntity("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )");
  const uncertaintyId = addEntity("UNCERTAINTY_MEASURE_WITH_UNIT", `LENGTH_MEASURE(1.D-05),#${lengthUnitId},'distance_accuracy_value','confusion accuracy'`);
  
  const geomContextId = addComplexEntity(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertaintyId})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnitId},#${planeAngleUnitId})) REPRESENTATION_CONTEXT('Context #1','3D Context with millimeter and radian') )`);

  // Direct direction references (fixed double quotes to single quotes)
  const dirXId = addEntity("DIRECTION", `'',(1.0,0.0,0.0)`);
  const dirYId = addEntity("DIRECTION", `'',(0.0,1.0,0.0)`);
  const dirZId = addEntity("DIRECTION", `'',(0.0,0.0,1.0)`);
  const dirNegXId = addEntity("DIRECTION", `'',(-1.0,0.0,0.0)`);
  const dirNegYId = addEntity("DIRECTION", `'',(0.0,-1.0,0.0)`);
  const dirNegZId = addEntity("DIRECTION", `'',(0.0,0.0,-1.0)`);

  const solidBrepIds: number[] = [];
  const surfaceModelIds: number[] = [];
  const exportedSketchIds = new Set<string>();

  // STEP AP214 Presentation Style & Color System
  const styledItemIds: number[] = [];
  const colorStyleMap = new Map<string, number>();

  const getPresentationStyleId = (r: number, g: number, b: number): number => {
    const cr = Math.min(1, Math.max(0, r));
    const cg = Math.min(1, Math.max(0, g));
    const cb = Math.min(1, Math.max(0, b));
    const key = `${cr.toFixed(3)},${cg.toFixed(3)},${cb.toFixed(3)}`;
    if (colorStyleMap.has(key)) {
      return colorStyleMap.get(key)!;
    }

    const colId = addEntity("COLOUR_RGB", `'',(${cr.toFixed(4)},${cg.toFixed(4)},${cb.toFixed(4)})`);
    const fillColId = addEntity("FILL_AREA_STYLE_COLOUR", `'',#${colId}`);
    const fillStyleId = addEntity("FILL_AREA_STYLE", `'',(#${fillColId})`);
    const surfFillId = addEntity("SURFACE_STYLE_FILL_AREA", `#${fillStyleId}`);
    const sideStyleId = addEntity("SURFACE_SIDE_STYLE", `'',(#${surfFillId})`);
    const usageId = addEntity("SURFACE_STYLE_USAGE", `.BOTH.,#${sideStyleId}`);
    const assignId = addEntity("PRESENTATION_STYLE_ASSIGNMENT", `(#${usageId})`);

    colorStyleMap.set(key, assignId);
    return assignId;
  };

  const assignColorToItem = (itemId: number, r: number, g: number, b: number) => {
    const styleAssignId = getPresentationStyleId(r, g, b);
    const styledItemId = addEntity("STYLED_ITEM", `'color',(#${styleAssignId}),#${itemId}`);
    styledItemIds.push(styledItemId);
  };

  const extractMeshColor = (mesh: THREE.Mesh): [number, number, number] => {
    if (mesh.userData?.baseColor) {
      const bc = mesh.userData.baseColor;
      if (Array.isArray(bc) && bc.length >= 3) {
        return [Number(bc[0]), Number(bc[1]), Number(bc[2])];
      }
      if (typeof bc === "string") {
        const c = new THREE.Color(bc);
        return [c.r, c.g, c.b];
      }
    }
    if (mesh.material) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat && "color" in mat && (mat as any).color) {
        const c = (mat as any).color;
        return [c.r, c.g, c.b];
      }
    }
    return [0.72, 0.72, 0.75];
  };

  // Analytical Builder function for Extruded solids
  const buildAnalyticalExtrusion = (
    outer: Profile,
    holes: Profile[],
    plane: PlaneType,
    offset: number,
    height: number,
    bodyName: string
  ): number => {
    // 3D coordinate normal mapping parameters
    let normalDir = { x: 0, y: 1, z: 0 };
    let negNormalDir = { x: 0, y: -1, z: 0 };
    let uDir = { x: 1, y: 0, z: 0 };
    let vDir = { x: 0, y: 0, z: -1 };

    let normalDirId = dirYId;
    let negNormalDirId = dirNegYId;
    let uDirId = dirXId;

    if (plane === "XZ") {
      normalDir = { x: 0, y: 0, z: 1 };
      negNormalDir = { x: 0, y: 0, z: -1 };
      uDir = { x: 1, y: 0, z: 0 };
      vDir = { x: 0, y: 1, z: 0 };

      normalDirId = dirZId;
      negNormalDirId = dirNegZId;
      uDirId = dirXId;
    } else if (plane === "YZ") {
      normalDir = { x: 1, y: 0, z: 0 };
      negNormalDir = { x: -1, y: 0, z: 0 };
      uDir = { x: 0, y: 0, z: 1 };
      vDir = { x: 0, y: 1, z: 0 };

      normalDirId = dirXId;
      negNormalDirId = dirNegXId;
      uDirId = dirZId;
    }

    const mapPoint = (u: number, v: number, depth: number) => {
      if (plane === "XY") {
        return { x: u, y: offset + depth, z: -v };
      } else if (plane === "XZ") {
        return { x: u, y: v, z: offset + depth };
      } else { // YZ
        return { x: offset + depth, y: v, z: u };
      }
    };

    const baseOrigin = mapPoint(0, 0, 0);
    const topOrigin = mapPoint(0, 0, height);

    const faces: number[] = [];

    // Helper to build wire edges & vertices at a given extrusion depth
    const buildWireData = (profile: Profile, depth: number) => {
      if (profile.type === "circle" && profile.center && profile.radius !== undefined) {
        const cx = profile.center.x;
        const cy = profile.center.y;
        const R = profile.radius;

        const c3d = mapPoint(cx, cy, depth);
        const p1_3d = { x: c3d.x + R * uDir.x, y: c3d.y + R * uDir.y, z: c3d.z + R * uDir.z };
        const p2_3d = { x: c3d.x - R * uDir.x, y: c3d.y - R * uDir.y, z: c3d.z - R * uDir.z };

        const cp1Id = addEntity("CARTESIAN_POINT", `'',(${p1_3d.x.toFixed(5)},${p1_3d.y.toFixed(5)},${p1_3d.z.toFixed(5)})`);
        const cp2Id = addEntity("CARTESIAN_POINT", `'',(${p2_3d.x.toFixed(5)},${p2_3d.y.toFixed(5)},${p2_3d.z.toFixed(5)})`);
        
        const v1Id = addEntity("VERTEX_POINT", `'',#${cp1Id}`);
        const v2Id = addEntity("VERTEX_POINT", `'',#${cp2Id}`);

        const ccId = addEntity("CARTESIAN_POINT", `'',(${c3d.x.toFixed(5)},${c3d.y.toFixed(5)},${c3d.z.toFixed(5)})`);
        const circlePlacementId = addEntity("AXIS2_PLACEMENT_3D", `'',#${ccId},#${normalDirId},#${uDirId}`);
        const circleCurveId = addEntity("CIRCLE", `'',#${circlePlacementId},${R.toFixed(5)}`);

        // Create two semi-circle edges
        const e1Id = addEntity("EDGE_CURVE", `'',#${v1Id},#${v2Id},#${circleCurveId},.T.`);
        const e2Id = addEntity("EDGE_CURVE", `'',#${v2Id},#${v1Id},#${circleCurveId},.T.`);

        return {
          type: "circle" as const,
          vertices: [v1Id, v2Id],
          edges: [e1Id, e2Id],
          points3d: [p1_3d, p2_3d],
          center3d: c3d,
          radius: R
        };
      } else {
        // Polygonal loop
        const N = profile.points.length;
        const vertexIds: number[] = [];
        const pts3d: { x: number; y: number; z: number }[] = [];

        for (let i = 0; i < N; i++) {
          const pt = profile.points[i];
          const pos3d = mapPoint(pt.x, pt.y, depth);
          const cpId = addEntity("CARTESIAN_POINT", `'',(${pos3d.x.toFixed(5)},${pos3d.y.toFixed(5)},${pos3d.z.toFixed(5)})`);
          const vId = addEntity("VERTEX_POINT", `'',#${cpId}`);
          vertexIds.push(vId);
          pts3d.push(pos3d);
        }

        const edgeIds: number[] = [];
        for (let i = 0; i < N; i++) {
          const next = (i + 1) % N;
          const v1 = vertexIds[i];
          const v2 = vertexIds[next];
          const p1 = pts3d[i];
          const p2 = pts3d[next];

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dz = p2.z - p1.z;
          const len = Math.hypot(dx, dy, dz);

          const lineDirId = addEntity("DIRECTION", `'',(${ (dx/len).toFixed(5) },${ (dy/len).toFixed(5) },${ (dz/len).toFixed(5) })`);
          const lineVectorId = addEntity("VECTOR", `'',#${lineDirId},${len.toFixed(5)}`);
          const lineOriginId = addEntity("CARTESIAN_POINT", `'',(${p1.x.toFixed(5)},${p1.y.toFixed(5)},${p1.z.toFixed(5)})`);
          const lineCurveId = addEntity("LINE", `'',#${lineOriginId},#${lineVectorId}`);

          const edgeId = addEntity("EDGE_CURVE", `'',#${v1},#${v2},#${lineCurveId},.T.`);
          edgeIds.push(edgeId);
        }

        return {
          type: "polygon" as const,
          vertices: vertexIds,
          edges: edgeIds,
          points3d: pts3d
        };
      }
    };

    const buildLoopFromWire = (wire: any, isReverse: boolean): number => {
      const edges = isReverse ? [...wire.edges].reverse() : wire.edges;
      const oEdges = edges.map(e => addEntity("ORIENTED_EDGE", `'',*,*,#${e},${isReverse ? ".F." : ".T."}`));
      return addEntity("EDGE_LOOP", `'',(${oEdges.map(id => `#${id}`).join(",")})`);
    };

    // 1. Build Bottom & Top wires for the outer shell
    const outerWireB = buildWireData(outer, 0);
    const outerWireT = buildWireData(outer, height);

    const botBoundIds: number[] = [];
    const topBoundIds: number[] = [];

    // Outer loops
    const botOuterLoopId = buildLoopFromWire(outerWireB, true); // clock-wise reverse on bottom face to point normal outward/downward
    botBoundIds.push(addEntity("FACE_OUTER_BOUND", `'',#${botOuterLoopId},.T.`));

    const topOuterLoopId = buildLoopFromWire(outerWireT, false); // counter-clockwise forward on top face
    topBoundIds.push(addEntity("FACE_OUTER_BOUND", `'',#${topOuterLoopId},.T.`));

    // 2. Build Bottom & Top wires for internal holes (cavities)
    const holesWireB = holes.map(h => buildWireData(h, 0));
    const holesWireT = holes.map(h => buildWireData(h, height));

    holesWireB.forEach((holeB, idx) => {
      const holeLoopId = buildLoopFromWire(holeB, false); // inner bound holes go CCW on bottom face
      botBoundIds.push(addEntity("FACE_BOUND", `'',#${holeLoopId},.T.`));
    });

    holesWireT.forEach((holeT, idx) => {
      const holeLoopId = buildLoopFromWire(holeT, true); // inner bound holes go CW on top face
      topBoundIds.push(addEntity("FACE_BOUND", `'',#${holeLoopId},.T.`));
    });

    // 3. Build lateral face bounds for outer and internal hole segments
    const buildLateralFacesForWire = (wireB: any, wireT: any, isHole: boolean) => {
      const N = wireB.vertices.length;

      // Vertical line edges connecting top and bottom vertices
      const verticalEdgeIds: number[] = [];
      for (let i = 0; i < N; i++) {
        const vB = wireB.vertices[i];
        const vT = wireT.vertices[i];
        const pB = wireB.points3d[i];

        const extDirectionId = height >= 0 ? normalDirId : negNormalDirId;
        const vVecId = addEntity("VECTOR", `'',#${extDirectionId},${Math.abs(height).toFixed(5)}`);
        const vOriginId = addEntity("CARTESIAN_POINT", `'',(${pB.x.toFixed(5)},${pB.y.toFixed(5)},${pB.z.toFixed(5)})`);
        const lineCurveId = addEntity("LINE", `'',#${vOriginId},#${vVecId}`);
        const edgeId = addEntity("EDGE_CURVE", `'',#${vB},#${vT},#${lineCurveId},.T.`);
        verticalEdgeIds.push(edgeId);
      }

      for (let i = 0; i < N; i++) {
        const next = (i + 1) % N;
        let oe1, oe2, oe3, oe4;
        if (height >= 0) {
          oe1 = addEntity("ORIENTED_EDGE", `'',*,*,#${wireB.edges[i]},.T.`);
          oe2 = addEntity("ORIENTED_EDGE", `'',*,*,#${verticalEdgeIds[next]},.T.`);
          oe3 = addEntity("ORIENTED_EDGE", `'',*,*,#${wireT.edges[i]},.F.`);
          oe4 = addEntity("ORIENTED_EDGE", `'',*,*,#${verticalEdgeIds[i]},.F.`);
        } else {
          // If height < 0, the face normal points outward, but the default sequence
          // becomes clockwise. We traverse in reverse to maintain CCW orientation.
          oe1 = addEntity("ORIENTED_EDGE", `'',*,*,#${verticalEdgeIds[i]},.T.`);
          oe2 = addEntity("ORIENTED_EDGE", `'',*,*,#${wireT.edges[i]},.T.`);
          oe3 = addEntity("ORIENTED_EDGE", `'',*,*,#${verticalEdgeIds[next]},.F.`);
          oe4 = addEntity("ORIENTED_EDGE", `'',*,*,#${wireB.edges[i]},.F.`);
        }

        const latLoopId = addEntity("EDGE_LOOP", `'',(#${oe1},#${oe2},#${oe3},#${oe4})`);
        const latBoundId = addEntity("FACE_OUTER_BOUND", `'',#${latLoopId},.T.`);

        if (wireB.type === "circle") {
          const cylCenterId = addEntity("CARTESIAN_POINT", `'',(${wireB.center3d.x.toFixed(5)},${wireB.center3d.y.toFixed(5)},${wireB.center3d.z.toFixed(5)})`);
          const cylPlacementId = addEntity("AXIS2_PLACEMENT_3D", `'',#${cylCenterId},#${normalDirId},#${uDirId}`);
          const cylSurfId = addEntity("CYLINDRICAL_SURFACE", `'',#${cylPlacementId},${wireB.radius.toFixed(5)}`);
          
          // Analytical Cylindrical Face (invert normal direction for holes so they point outwards from solid)
          const latFaceId = addEntity("ADVANCED_FACE", `'',(#${latBoundId}),#${cylSurfId},${isHole ? ".F." : ".T."}`);
          faces.push(latFaceId);
        } else {
          // Flat Planar Face
          const p1 = wireB.points3d[i];
          const p2 = wireB.points3d[next];
          const sDir = new THREE.Vector3().subVectors(new THREE.Vector3(p2.x, p2.y, p2.z), new THREE.Vector3(p1.x, p1.y, p1.z)).normalize();
          const extNorm = new THREE.Vector3(normalDir.x, normalDir.y, normalDir.z).normalize();
          
          let latNorm = new THREE.Vector3().crossVectors(sDir, extNorm).normalize();
          if (isHole) {
            latNorm.negate(); // Flip hole normal to point outward from solid
          }

          const latOriginId = addEntity("CARTESIAN_POINT", `'',(${p1.x.toFixed(5)},${p1.y.toFixed(5)},${p1.z.toFixed(5)})`);
          const latNormDirId = addEntity("DIRECTION", `'',(${latNorm.x.toFixed(5)},${latNorm.y.toFixed(5)},${latNorm.z.toFixed(5)})`);
          const sDirId = addEntity("DIRECTION", `'',(${sDir.x.toFixed(5)},${sDir.y.toFixed(5)},${sDir.z.toFixed(5)})`);

          const latPlacementId = addEntity("AXIS2_PLACEMENT_3D", `'',#${latOriginId},#${latNormDirId},#${sDirId}`);
          const latPlaneId = addEntity("PLANE", `'',#${latPlacementId}`);

          const latFaceId = addEntity("ADVANCED_FACE", `'',(#${latBoundId}),#${latPlaneId},.T.`);
          faces.push(latFaceId);
        }
      }
    };

    buildLateralFacesForWire(outerWireB, outerWireT, false);
    holesWireB.forEach((holeB, idx) => {
      buildLateralFacesForWire(holeB, holesWireT[idx], true);
    });

    // 4. Create top and bottom advanced planar faces
    const botOriginId = addEntity("CARTESIAN_POINT", `'',(${baseOrigin.x.toFixed(5)},${baseOrigin.y.toFixed(5)},${baseOrigin.z.toFixed(5)})`);
    const botNormalId = height >= 0 ? negNormalDirId : normalDirId;
    const botPlacementId = addEntity("AXIS2_PLACEMENT_3D", `'',#${botOriginId},#${botNormalId},#${uDirId}`);
    const botPlaneId = addEntity("PLANE", `'',#${botPlacementId}`);
    const botFaceId = addEntity("ADVANCED_FACE", `'',(${botBoundIds.map(id => `#${id}`).join(",")}),#${botPlaneId},.T.`);
    faces.push(botFaceId);

    const topOriginId = addEntity("CARTESIAN_POINT", `'',(${topOrigin.x.toFixed(5)},${topOrigin.y.toFixed(5)},${topOrigin.z.toFixed(5)})`);
    const topNormalId = height >= 0 ? normalDirId : negNormalDirId;
    const topPlacementId = addEntity("AXIS2_PLACEMENT_3D", `'',#${topOriginId},#${topNormalId},#${uDirId}`);
    const topPlaneId = addEntity("PLANE", `'',#${topPlacementId}`);
    const topFaceId = addEntity("ADVANCED_FACE", `'',(${topBoundIds.map(id => `#${id}`).join(",")}),#${topPlaneId},.T.`);
    faces.push(topFaceId);

    // 5. Create final solid Brep
    const closedShellId = addEntity("CLOSED_SHELL", `'',(${faces.map(id => `#${id}`).join(",")})`);
    return addEntity("MANIFOLD_SOLID_BREP", `'${bodyName.replace(/'/g, "")}',#${closedShellId}`);
  };

  // Check and process sketch operations analytically
  if (sketches && operations) {
    operations.forEach((op) => {
      const sketch = sketches[op.sketchId];
      if (!sketch || sketch.profiles.length === 0) return;

      // Keep analytical export to pure extrusions (no revolves, taper angles, or fillets)
      const height = op.parameters.height || 20;
      const isPureExtrude = op.type === "extrude" && 
                            (!op.parameters.bevelType || op.parameters.bevelType === "none") && 
                            (!op.parameters.taperScale || op.parameters.taperScale === 1.0) &&
                            (!op.parameters.booleanOp || op.parameters.booleanOp !== "cut");

      if (!isPureExtrude) {
        // Let it fall back to standard triangulated geometry in the bodies loop
        return;
      }
      
      const closedProfiles = sketch.profiles.filter(p => p.isClosed && (p.points.length >= 3 || p.type === "circle"));
      if (closedProfiles.length === 0) return;

      // Compute containment matrix
      const containment = new Array(closedProfiles.length).fill(0);
      const containsMatrix = Array.from({ length: closedProfiles.length }, () => new Array(closedProfiles.length).fill(false));
      
      for (let i = 0; i < closedProfiles.length; i++) {
        const pI = closedProfiles[i];
        const testPt = pI.type === "circle" ? pI.center : pI.points[0];
        if (!testPt) continue;
        for (let j = 0; j < closedProfiles.length; j++) {
          if (i === j) continue;
          const pJ = closedProfiles[j];
          if (pJ.type === "circle") {
            if (pJ.center && pJ.radius) {
              const dist = Math.hypot(testPt.x - pJ.center.x, testPt.y - pJ.center.y);
              if (dist < pJ.radius) {
                containment[i]++;
                containsMatrix[j][i] = true;
              }
            }
          } else {
            if (isPointInPolygon(testPt, pJ.points)) {
              containment[i]++;
              containsMatrix[j][i] = true;
            }
          }
        }
      }

      const outers: number[] = [];
      const holes: number[] = [];
      for (let i = 0; i < closedProfiles.length; i++) {
        if (containment[i] % 2 === 0) {
          outers.push(i);
        } else {
          holes.push(i);
        }
      }

      const outerToHoles = new Map<number, number[]>();
      outers.forEach(o => outerToHoles.set(o, []));
      
      holes.forEach(hIdx => {
        let parentIdx = -1;
        let minArea = Infinity;
        const hProf = closedProfiles[hIdx];
        const testPt = hProf.type === "circle" ? hProf.center : hProf.points[0];
        if (!testPt) return;

        outers.forEach(oIdx => {
          if (containsMatrix[oIdx][hIdx]) {
            const oProf = closedProfiles[oIdx];
            const area = oProf.type === "circle" ? (Math.PI * (oProf.radius || 0) ** 2) : getPolygonArea(oProf.points);
            if (area < minArea) {
              minArea = area;
              parentIdx = oIdx;
            }
          }
        });
        if (parentIdx !== -1) {
          outerToHoles.get(parentIdx)!.push(hIdx);
        }
      });

      outers.forEach((outerIdx) => {
        const rawOuter = closedProfiles[outerIdx];
        const rawHoles = (outerToHoles.get(outerIdx) || []).map(idx => closedProfiles[idx]);
        
        // Preserve 'circle' profiles for true STEP analytical cylinders.
        // We only use polygonClipping for non-circle holes that might share coincident edges with the boundary.
        const clippableHoles = rawHoles.filter(h => h.type !== "circle");
        const analyticalHoles = rawHoles.filter(h => h.type === "circle");

        let resultRegions: { outer: Profile, holes: Profile[] }[] = [];

        if (clippableHoles.length > 0) {
           const outerRing = rawOuter.points.map(p => [p.x, p.y] as [number, number]);
           if (outerRing.length > 0 && (outerRing[0][0] !== outerRing[outerRing.length - 1][0] || outerRing[0][1] !== outerRing[outerRing.length - 1][1])) {
             outerRing.push([outerRing[0][0], outerRing[0][1]]);
           }
           const outerPoly = [outerRing];

           const holePolys = clippableHoles.map(hp => {
             const ring = hp.points.map(p => [p.x, p.y] as [number, number]);
             if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
               ring.push([ring[0][0], ring[0][1]]);
             }
             return [ring];
           });

           let resultMultiPolys: polygonClipping.MultiPolygon = [outerPoly];
           try {
             const holesToSubtract = holePolys.map(h => [h] as polygonClipping.MultiPolygon);
             resultMultiPolys = polygonClipping.difference([outerPoly], ...holesToSubtract);
           } catch(e) {
             console.warn("STEP clipping failed, falling back to unclipped", e);
             resultMultiPolys = [outerPoly];
           }

           resultMultiPolys.forEach((poly, polyIdx) => {
             const extRing = poly[0];
             if (!extRing || extRing.length < 3) return;
             
             // Strip duplicate last point from polygon-clipping for our Profile definition
             const cleanedExtRing = [...extRing];
             if (cleanedExtRing.length > 0 && cleanedExtRing[0][0] === cleanedExtRing[cleanedExtRing.length - 1][0] && cleanedExtRing[0][1] === cleanedExtRing[cleanedExtRing.length - 1][1]) {
               cleanedExtRing.pop();
             }

             const newOuterProfile: Profile = {
               id: rawOuter.id + "_clipped_" + polyIdx,
               type: "polygon",
               isClosed: true,
               points: cleanedExtRing.map(pt => ({ x: pt[0], y: pt[1] }))
             };
             
             const newHoleProfiles: Profile[] = [];
             for (let i = 1; i < poly.length; i++) {
               const holeRing = poly[i];
               if (!holeRing || holeRing.length < 3) continue;
               
               const cleanedHoleRing = [...holeRing];
               if (cleanedHoleRing.length > 0 && cleanedHoleRing[0][0] === cleanedHoleRing[cleanedHoleRing.length - 1][0] && cleanedHoleRing[0][1] === cleanedHoleRing[cleanedHoleRing.length - 1][1]) {
                 cleanedHoleRing.pop();
               }

               newHoleProfiles.push({
                 id: rawOuter.id + "_hole_" + polyIdx + "_" + i,
                 type: "polygon",
                 isClosed: true,
                 points: cleanedHoleRing.map(pt => ({ x: pt[0], y: pt[1] }))
               });
             }
             
             resultRegions.push({
               outer: newOuterProfile,
               holes: [...newHoleProfiles, ...analyticalHoles.map(h => getStyledProfile(h))]
             });
           });
        } else {
           resultRegions.push({
             outer: getStyledProfile(rawOuter),
             holes: analyticalHoles.map(h => getStyledProfile(h))
           });
        }

        resultRegions.forEach(region => {
          try {
            const solidId = buildAnalyticalExtrusion(
              region.outer,
              region.holes,
              sketch.plane,
              sketch.offset || 0,
              height,
              op.name || sketch.name
            );
            solidBrepIds.push(solidId);
            exportedSketchIds.add(sketch.id);
            const sketchMesh = bodies.find(b => b.mesh.userData?.sketchId === sketch.id)?.mesh;
            const [skR, skG, skB] = sketchMesh ? extractMeshColor(sketchMesh) : [0.23, 0.51, 0.96];
            assignColorToItem(solidId, skR, skG, skB);
          } catch (e) {
            console.error("Analytical extrusion export failed. Falling back to triangulated mesh B-Rep:", e);
          }
        });
      });
    });
  }

  // Iterate meshes for any remaining bodies (e.g. imported files, complex revolves, bevels, or demo bolt)
  for (const body of bodies) {
    const mesh = body.mesh;
    const isSketched = mesh.userData.sketchId && sketches && operations;
    const isAlreadyExported = isSketched && exportedSketchIds.has(mesh.userData.sketchId);

    if (isAlreadyExported) {
      continue;
    }

    const [cr, cg, cb] = extractMeshColor(mesh);

    const geometry = mesh.geometry;
    const posAttr = geometry.getAttribute("position");
    if (!posAttr) continue;
    
    const indices: number[] = [];
    const indexAttr = geometry.getIndex();
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i));
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(i);
      }
    }

    const localFaces: number[] = [];
    const getVertex = (index: number): THREE.Vector3 => {
      const v = new THREE.Vector3(posAttr.getX(index), posAttr.getY(index), posAttr.getZ(index));
      v.applyMatrix4(mesh.matrixWorld);
      return v;
    };

    for (let i = 0; i < indices.length; i += 3) {
      const idx0 = indices[i];
      const idx1 = indices[i + 1];
      const idx2 = indices[i + 2];

      const v0 = getVertex(idx0);
      const v1 = getVertex(idx1);
      const v2 = getVertex(idx2);

      if (v0.distanceToSquared(v1) < 1e-6 || v1.distanceToSquared(v2) < 1e-6 || v2.distanceToSquared(v0) < 1e-6) {
        continue;
      }

      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
      const uDirVec = edge1.clone().normalize();

      const p1Id = addEntity("CARTESIAN_POINT", `'',(${v0.x.toFixed(5)},${v0.y.toFixed(5)},${v0.z.toFixed(5)})`);
      const p2Id = addEntity("CARTESIAN_POINT", `'',(${v1.x.toFixed(5)},${v1.y.toFixed(5)},${v1.z.toFixed(5)})`);
      const p3Id = addEntity("CARTESIAN_POINT", `'',(${v2.x.toFixed(5)},${v2.y.toFixed(5)},${v2.z.toFixed(5)})`);

      const normDirId = addEntity("DIRECTION", `'',(${normal.x.toFixed(5)},${normal.y.toFixed(5)},${normal.z.toFixed(5)})`);
      const uDirIdLoc = addEntity("DIRECTION", `'',(${uDirVec.x.toFixed(5)},${uDirVec.y.toFixed(5)},${uDirVec.z.toFixed(5)})`);

      const originId = addEntity("CARTESIAN_POINT", `'',(${v0.x.toFixed(5)},${v0.y.toFixed(5)},${v0.z.toFixed(5)})`);
      const axis3DId = addEntity("AXIS2_PLACEMENT_3D", `'',#${originId},#${normDirId},#${uDirIdLoc}`);

      const planeId = addEntity("PLANE", `'',#${axis3DId}`);
      const polyLoopId = addEntity("POLY_LOOP", `'',(#${p1Id},#${p2Id},#${p3Id})`);
      const boundId = addEntity("FACE_OUTER_BOUND", `'',#${polyLoopId},.T.`);

      const faceId = addEntity("FACE_SURFACE", `'',(#${boundId}),#${planeId},.T.`);
      localFaces.push(faceId);
    }

    if (localFaces.length > 0) {
      const safeName = (body.name || "Solid_Part").replace(/['\\]/g, "");
      const closedShellId = addEntity("CLOSED_SHELL", `'',(${localFaces.map(id => `#${id}`).join(",")})`);
      const solidBrepId = addEntity("MANIFOLD_SOLID_BREP", `'${safeName}',#${closedShellId}`);
      solidBrepIds.push(solidBrepId);
      assignColorToItem(solidBrepId, cr, cg, cb);
    }
  }

  const designShapeId = addEntity("PRODUCT_DEFINITION_SHAPE", `'','',#${productDefinitionId}`);
  
  if (solidBrepIds.length > 0) {
    const shapeRepId = addEntity("ADVANCED_BREP_SHAPE_REPRESENTATION", `'',(${solidBrepIds.map(id => `#${id}`).join(",")}),#${geomContextId}`);
    addEntity("SHAPE_DEFINITION_REPRESENTATION", `#${designShapeId},#${shapeRepId}`);
  }

  if (surfaceModelIds.length > 0) {
    const shapeRepId = addEntity("MANIFOLD_SURFACE_SHAPE_REPRESENTATION", `'',(${surfaceModelIds.map(id => `#${id}`).join(",")}),#${geomContextId}`);
    addEntity("SHAPE_DEFINITION_REPRESENTATION", `#${designShapeId},#${shapeRepId}`);
  }

  if (styledItemIds.length > 0) {
    addEntity("MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION", `'',(${styledItemIds.map(id => `#${id}`).join(",")}),#${geomContextId}`);
  }

  if (solidBrepIds.length === 0 && surfaceModelIds.length === 0) {
    const emptyShellId = addEntity("CLOSED_SHELL", `'',()`);
    const emptySolidBrepId = addEntity("MANIFOLD_SOLID_BREP", `'',#${emptyShellId}`);
    const shapeRepId = addEntity("ADVANCED_BREP_SHAPE_REPRESENTATION", `'',(#${emptySolidBrepId}),#${geomContextId}`);
    addEntity("SHAPE_DEFINITION_REPRESENTATION", `#${designShapeId},#${shapeRepId}`);
  }

  const footer = `ENDSEC;
END-ISO-10303-21;`;

  const finalStep = `${header}\n${lines.join("\n")}\n${footer}`;
  return finalStep;
}

/**
 * Generates an STL file (ASCII format) so the user can download and use it for 3D printing.
 */
export function exportToSTL(bodies: { name: string; mesh: THREE.Mesh }[]): string {
  let output = "solid model_exported\n";

  for (const body of bodies) {
    const mesh = body.mesh;
    const geometry = mesh.geometry;
    const posAttr = geometry.getAttribute("position");
    if (!posAttr) continue;

    const indices: number[] = [];
    const indexAttr = geometry.getIndex();
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i));
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(i);
      }
    }

    const getVertex = (index: number): THREE.Vector3 => {
      const v = new THREE.Vector3(posAttr.getX(index), posAttr.getY(index), posAttr.getZ(index));
      v.applyMatrix4(mesh.matrixWorld);
      return v;
    };

    for (let i = 0; i < indices.length; i += 3) {
      const v0 = getVertex(indices[i]);
      const v1 = getVertex(indices[i+1]);
      const v2 = getVertex(indices[i+2]);

      // Calculate facet normal
      const e1 = new THREE.Vector3().subVectors(v1, v0);
      const e2 = new THREE.Vector3().subVectors(v2, v0);
      const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();

      output += `  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n`;
      output += "    outer loop\n";
      output += `      vertex ${v0.x.toFixed(6)} ${v0.y.toFixed(6)} ${v0.z.toFixed(6)}\n`;
      output += `      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}\n`;
      output += `      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}\n`;
      output += "    endloop\n";
      output += "  endfacet\n";
    }
  }

  output += "endsolid model_exported\n";
  return output;
}

/**
 * Generates an OBJ file.
 */
export function exportToOBJ(bodies: { name: string; mesh: THREE.Mesh }[]): string {
  let output = "# OBJ Export from Step3D Designer\n";
  let vOffset = 1;

  for (const body of bodies) {
    output += `o ${body.name.replace(/\s+/g, "_")}\n`;
    
    const mesh = body.mesh;
    const geometry = mesh.geometry;
    const posAttr = geometry.getAttribute("position");
    if (!posAttr) continue;

    const indices: number[] = [];
    const indexAttr = geometry.getIndex();
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i));
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(i);
      }
    }

    // Write vertices
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      v.applyMatrix4(mesh.matrixWorld);
      output += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    }

    // Write normals
    const normAttr = geometry.getAttribute("normal");
    if (normAttr) {
      for (let i = 0; i < normAttr.count; i++) {
        const n = new THREE.Vector3(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
        // Rotate normals by normal matrix (inverse transpose of model matrix)
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
        n.applyMatrix3(normalMatrix).normalize();
        output += `vn ${n.x.toFixed(6)} ${n.y.toFixed(6)} ${n.z.toFixed(6)}\n`;
      }
    }

    // Write faces (OBJ faces are 1-based index)
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] + vOffset;
      const i1 = indices[i+1] + vOffset;
      const i2 = indices[i+2] + vOffset;
      
      if (normAttr) {
        output += `f ${i0}//${i0} ${i1}//${i1} ${i2}//${i2}\n`;
      } else {
        output += `f ${i0} ${i1} ${i2}\n`;
      }
    }

    vOffset += posAttr.count;
  }

  return output;
}
