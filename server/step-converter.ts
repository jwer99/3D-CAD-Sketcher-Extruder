import { IncomingMessage, ServerResponse } from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { parseSTEPWithOCCT } from "../src/ImporterParser.js";

// Embedded Python script for native 64-bit OpenCASCADE conversion with 100% True STEP Color Extraction
const PYTHON_CONVERTER_SCRIPT = `
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

export async function handleStepConversion(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Método no permitido. Use POST.' }));
    return;
  }

  console.log(`[STEP-CONVERTER] Started 64-bit native conversion.`);

  const chunks: Buffer[] = [];
  
  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  
  req.on('end', async () => {
    const buffer = Buffer.concat(chunks);
    chunks.length = 0; // Free raw chunk references
    const fileSizeMB = buffer.length / (1024 * 1024);
    console.log(`[STEP-CONVERTER] File received: ${fileSizeMB.toFixed(2)} MB`);

    const tmpDir = os.tmpdir();
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const stepFile = path.join(tmpDir, `input_${uniqueId}.step`);
    const binFile = path.join(tmpDir, `output_${uniqueId}.bin`);
    const pyScript = path.join(tmpDir, `step_worker_${uniqueId}.py`);

    try {
      // Write incoming STEP buffer to disk
      await fs.promises.writeFile(stepFile, buffer);
      await fs.promises.writeFile(pyScript, PYTHON_CONVERTER_SCRIPT);

      // Balanced CAD resolution tuned for extreme 300MB+ assemblies to guarantee rock-solid GPU stability
      let deflection = 0.005;
      if (fileSizeMB > 250) deflection = 0.08;
      else if (fileSizeMB > 150) deflection = 0.035;
      else if (fileSizeMB > 70) deflection = 0.015;
      else if (fileSizeMB > 35) deflection = 0.008;

      console.log(`[STEP-CONVERTER] Executing 64-bit OpenCASCADE engine (high-fidelity deflection: ${deflection})...`);
      
      await new Promise<void>((resolve, reject) => {
        execFile('python', [pyScript, stepFile, binFile, String(deflection)], { maxBuffer: 1024 * 1024 * 500 }, (err, stdout, stderr) => {
          if (stdout) console.log(`[STEP-CONVERTER-PY] ${stdout.trim()}`);
          if (stderr) console.warn(`[STEP-CONVERTER-PY-WARN] ${stderr.trim()}`);
          
          if (fs.existsSync(binFile)) {
            return resolve();
          }
          if (err) {
            return reject(new Error(stderr || err.message));
          }
          resolve();
        });
      });

      if (!fs.existsSync(binFile)) {
        throw new Error("El conversor nativo 64-bit no generó el archivo binario de resultado.");
      }

      const stats = await fs.promises.stat(binFile);
      console.log(`[STEP-CONVERTER] Conversion successful! Streaming binary CAD stream (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);

      res.writeHead(200, { 
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size
      });

      const readStream = fs.createReadStream(binFile);
      readStream.pipe(res);

      await new Promise<void>((resolveStream, rejectStream) => {
        readStream.on('end', () => resolveStream());
        readStream.on('error', (err) => rejectStream(err));
      });

    } catch (err: any) {
      console.warn(`[STEP-CONVERTER] Python 64-bit engine failed (${err.message}). Trying OCCT in-memory fallback...`);
      
      try {
        const { meshes } = await parseSTEPWithOCCT(buffer, {
          linearUnit: 'millimeter',
          linearDeflectionType: 'bounding_box_ratio',
          linearDeflection: 0.02,
          angularDeflection: 0.8
        });

        if (!meshes || meshes.length === 0) {
          throw new Error("No se encontraron mallas válidas.");
        }

        const responseData = JSON.stringify({
          success: true,
          meshes: meshes.map(m => ({
            name: m.name,
            vertices: Array.from(m.vertices),
            indices: m.indices ? Array.from(m.indices) : undefined
          }))
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(responseData);
      } catch (fallbackErr: any) {
        console.error(`[STEP-CONVERTER] All conversion methods failed:`, fallbackErr);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || fallbackErr.message || 'Error al procesar el archivo STEP.' }));
      }
    } finally {
      // Cleanup temporary files
      fs.promises.unlink(stepFile).catch(() => {});
      fs.promises.unlink(binFile).catch(() => {});
      fs.promises.unlink(pyScript).catch(() => {});
    }
  });
}
