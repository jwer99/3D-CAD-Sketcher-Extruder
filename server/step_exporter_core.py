"""
OpenCASCADE STEP exporter. Rebuild supported native construction recipes as CAD
surfaces; sew and simplify mesh-only parts without inventing analytic curves.
"""

import sys
import os
import json
from step_geometry import build_recipe, clean_shape

def export_meshes_to_solid_step(input_json_path: str, output_step_path: str):
    if not os.path.exists(input_json_path):
        print(f"[STEP-EXPORTER] Input file not found: {input_json_path}", file=sys.stderr)
        sys.exit(1)

    with open(input_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    parts = data.get('parts', [])
    if not parts:
        print("[STEP-EXPORTER] No parts found in payload", file=sys.stderr)
        sys.exit(1)

    from OCP.BRepBuilderAPI import (
        BRepBuilderAPI_Sewing,
        BRepBuilderAPI_MakePolygon,
        BRepBuilderAPI_MakeFace,
        BRepBuilderAPI_MakeSolid
    )
    from OCP.gp import gp_Pnt
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_SHELL, TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.STEPCAFControl import STEPCAFControl_Writer
    from OCP.TDocStd import TDocStd_Document
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.XCAFApp import XCAFApp_Application
    from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorSurf
    from OCP.TDataStd import TDataStd_Name
    from OCP.Quantity import Quantity_ColorRGBA
    from OCP.ShapeFix import ShapeFix_Solid

    fmt = TCollection_ExtendedString('BinXCAF')
    doc = TDocStd_Document(fmt)
    app = XCAFApp_Application.GetApplication_s()
    app.NewDocument(fmt, doc)

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())

    total_solids_created = 0
    mesh_parts = 0

    def add_part(shape, name, color):
        shape = clean_shape(shape)
        lbl = shape_tool.AddShape(shape)
        TDataStd_Name.Set_s(lbl, TCollection_ExtendedString(name))
        rgba = Quantity_ColorRGBA(*[max(0.0, min(1.0, float(c))) for c in color[:3]], 1.0)
        color_tool.SetColor(lbl, rgba, XCAFDoc_ColorSurf)

    for idx, part in enumerate(parts):
        name = part.get('name', f'Pieza_{idx + 1}')
        color_rgb = part.get('color', [0.72, 0.76, 0.82])
        if part.get('recipe'):
            try:
                shape = build_recipe(part['recipe'])
                add_part(shape, name, color_rgb)
                total_solids_created += 1
                continue
            except Exception as exc:
                print(f'[STEP-EXPORTER] Mesh fallback for {name}: {exc}', file=sys.stderr)
        raw_verts = part.get('vertices', [])
        raw_inds = part.get('indices', [])

        if not raw_verts:
            continue

        num_verts = len(raw_verts) // 3
        if num_verts < 3:
            continue

        # Build list of 3D points
        pnts = [gp_Pnt(raw_verts[i * 3], raw_verts[i * 3 + 1], raw_verts[i * 3 + 2]) for i in range(num_verts)]

        # Determine triangles
        if raw_inds and len(raw_inds) >= 3:
            triangles = [(raw_inds[i], raw_inds[i + 1], raw_inds[i + 2]) for i in range(0, len(raw_inds) - 2, 3)]
        else:
            triangles = [(i, i + 1, i + 2) for i in range(0, num_verts - 2, 3)]

        if not triangles:
            continue

        mesh_parts += 1

        # Sew triangles into watertight manifold shell
        sewing = BRepBuilderAPI_Sewing(1e-3)
        for i1, i2, i3 in triangles:
            if i1 >= num_verts or i2 >= num_verts or i3 >= num_verts:
                continue
            p1, p2, p3 = pnts[i1], pnts[i2], pnts[i3]
            # Discard degenerate triangles
            if p1.Distance(p2) < 1e-6 or p2.Distance(p3) < 1e-6 or p3.Distance(p1) < 1e-6:
                continue
            poly = BRepBuilderAPI_MakePolygon(p1, p2, p3, True)
            if poly.IsDone():
                face = BRepBuilderAPI_MakeFace(poly.Wire())
                if face.IsDone():
                    sewing.Add(face.Face())

        sewing.Perform()
        sewed_shape = sewing.SewedShape()

        # Collect solids from sewed result
        part_solids = []
        exp_s = TopExp_Explorer(sewed_shape, TopAbs_SOLID)
        while exp_s.More():
            part_solids.append(TopoDS.Solid_s(exp_s.Current()))
            exp_s.Next()

        # If no solids found yet, build solids from closed shells
        if not part_solids:
            from OCP.ShapeFix import ShapeFix_Shell
            exp_sh = TopExp_Explorer(sewed_shape, TopAbs_SHELL)
            while exp_sh.More():
                shell = TopoDS.Shell_s(exp_sh.Current())
                try:
                    fixer_sh = ShapeFix_Shell()
                    fixer_sh.Init(shell)
                    fixer_sh.Perform()
                    shell = fixer_sh.Shell()
                except Exception:
                    pass
                maker = BRepBuilderAPI_MakeSolid(shell)
                if maker.IsDone():
                    part_solids.append(maker.Solid())
                exp_sh.Next()

        # If still no solids, fallback to using sewed shape directly
        shapes_to_add = part_solids if part_solids else [sewed_shape]

        for s_idx, s in enumerate(shapes_to_add):
            try:
                # Fix topology, orientations, and closure
                if not s.IsNull() and s.ShapeType() == TopAbs_SOLID:
                    fixer = ShapeFix_Solid()
                    fixer.Init(TopoDS.Solid_s(s))
                    fixer.Perform()
                    s = fixer.Solid()
            except Exception:
                pass

            part_title = name if len(shapes_to_add) == 1 else f"{name} ({s_idx + 1})"
            add_part(s, part_title, color_rgb)
            total_solids_created += 1

    writer = STEPCAFControl_Writer()
    writer.SetColorMode(True)
    writer.SetNameMode(True)
    writer.SetLayerMode(False)
    if not total_solids_created:
        raise ValueError('No se pudo exportar ninguna pieza')
    if not writer.Transfer(doc):
        raise ValueError('No se pudo transferir el documento STEP')
    
    os.makedirs(os.path.dirname(os.path.abspath(output_step_path)), exist_ok=True)
    from OCP.IFSelect import IFSelect_RetDone
    if writer.Write(output_step_path) != IFSelect_RetDone:
        raise ValueError('No se pudo escribir el archivo STEP')
    print('STEP_EXPORT_RESULT=' + json.dumps({'meshParts': mesh_parts}))
    print(f"[STEP-EXPORTER] Wrote {total_solids_created} parts to {output_step_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python step_exporter_core.py <input.json> <output.step>")
        sys.exit(1)
    export_meshes_to_solid_step(sys.argv[1], sys.argv[2])
