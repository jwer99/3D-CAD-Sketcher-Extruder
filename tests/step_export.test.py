"""Round-trip the actual frontend payload through STEP and the CAD kernel."""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from step_geometry import build_recipe, clean_shape, volume
from step_exporter_core import export_meshes_to_solid_step
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopoDS import TopoDS
from OCP.TopExp import TopExp_Explorer


def shapes(shape, kind):
    result = []
    explorer = TopExp_Explorer(shape, kind)
    while explorer.More():
        result.append(explorer.Current())
        explorer.Next()
    return result


def read_step(path):
    reader = STEPControl_Reader()
    assert reader.ReadFile(str(path)) == IFSelect_RetDone
    reader.TransferRoots()
    return reader.OneShape()


class StepExportTest(unittest.TestCase):
    def test_native_three_holes_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'input.json', Path(tmp) / 'part.step'
            subprocess.run(['node', 'node_modules/tsx/dist/cli.mjs', 'tests/step_recipe.test.ts', str(source)], cwd=ROOT, check=True)
            export_meshes_to_solid_step(str(source), str(target))
            shape = read_step(target)
            self.assertTrue(BRepCheck_Analyzer(shape).IsValid())
            self.assertEqual(len(shapes(shape, TopAbs_SOLID)), 1)
            faces = shapes(shape, TopAbs_FACE)
            types = [BRepAdaptor_Surface(TopoDS.Face_s(f)).GetType() for f in faces]
            self.assertEqual(types.count(GeomAbs_Plane), 6)
            self.assertEqual(types.count(GeomAbs_Cylinder), 3)
            self.assertEqual(len(faces), 9, 'No triangulated CAD faces')
            # Region extraction has a 1e-5 inset on polygon edges.
            expected = (20 - 2e-5) ** 2 * 20 - math.pi * 4 * (40 + 20 - 2e-5)
            self.assertAlmostEqual(volume(shape), expected, delta=0.005)

    def test_mesh_box_faces_are_merged(self):
        verts = [0,0,0, 10,0,0, 10,10,0, 0,10,0, 0,0,10, 10,0,10, 10,10,10, 0,10,10]
        inds = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp) / 'input.json', Path(tmp) / 'box.step'
            source.write_text(json.dumps({'parts': [{'name': 'Imported box', 'vertices': verts, 'indices': inds}]}))
            export_meshes_to_solid_step(str(source), str(target))
            shape = read_step(target)
            self.assertTrue(BRepCheck_Analyzer(shape).IsValid())
            self.assertEqual(len(shapes(shape, TopAbs_FACE)), 6)
            self.assertAlmostEqual(volume(shape), 1000, places=5)

    def test_negative_extrusion_and_hole(self):
        recipe = {'kind': 'extrude', 'height': -10, 'regions': [{'outer': {'center': {'x': 0, 'y': 0}, 'radius': 5},
            'holes': [{'center': {'x': 0, 'y': 0}, 'radius': 2}]}]}
        shape = clean_shape(build_recipe(recipe))
        self.assertTrue(BRepCheck_Analyzer(shape).IsValid())
        self.assertAlmostEqual(volume(shape), math.pi * 21 * 10, places=5)


if __name__ == '__main__':
    unittest.main()
