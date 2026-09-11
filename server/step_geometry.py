"""Build CAD surfaces from captured construction data, without mesh fitting."""
from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse, BRepAlgoAPI_Common
from OCP.BRepBuilderAPI import (BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire,
    BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace, BRepBuilderAPI_Transform)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.GProp import GProp_GProps
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Pnt, gp_Dir, gp_Ax2, gp_Circ, gp_Vec, gp_Trsf


def volume(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def clean_shape(shape):
    """Merge only coincident surfaces. Retain the input if cleanup is unsafe."""
    if shape.IsNull():
        raise ValueError('Geometría STEP vacía')
    try:
        return _unify_shape(shape)
    except Exception:
        # An unusual imported topology must not make the existing export fail.
        return shape


def _unify_shape(shape):
    unify = ShapeUpgrade_UnifySameDomain(shape, True, True, False)
    unify.SetSafeInputMode(True)
    unify.SetLinearTolerance(1e-6)
    unify.SetAngularTolerance(1e-6)
    unify.Build()
    result = unify.Shape()
    if not result.IsNull() and BRepCheck_Analyzer(result).IsValid():
        before = volume(shape)
        if abs(volume(result) - before) <= max(1e-7, abs(before) * 1e-8):
            return result
    return shape


def make_wire(data):
    if 'center' in data:
        c = data['center']
        radius = float(data['radius'])
        if radius <= 0:
            raise ValueError('Radio inválido')
        circle = gp_Circ(gp_Ax2(gp_Pnt(c['x'], c['y'], 0), gp_Dir(0, 0, 1)), radius)
        return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circle).Edge()).Wire()
    points = data['points']
    if len(points) < 3:
        raise ValueError('Perfil incompleto')
    # Outer face normal +Z; holes are subtracted as solids so loop orientation
    # cannot inadvertently fill a cavity.
    area = sum(a['x'] * b['y'] - b['x'] * a['y'] for a, b in zip(points, points[1:] + points[:1]))
    polygon = BRepBuilderAPI_MakePolygon()
    for p in (points if area > 0 else list(reversed(points))):
        polygon.Add(gp_Pnt(p['x'], p['y'], 0))
    polygon.Close()
    return polygon.Wire()


def apply_boolean(left, right, operation):
    builder = {'cut': BRepAlgoAPI_Cut, 'join': BRepAlgoAPI_Fuse,
               'intersect': BRepAlgoAPI_Common}[operation](left, right)
    builder.Build()
    if not builder.IsDone():
        raise ValueError('La operación CAD no se pudo completar')
    return builder.Shape()


def build_recipe(recipe, depth=0):
    if depth > 256:
        raise ValueError('Historial CAD demasiado profundo')
    kind = recipe['kind']
    if kind == 'transform':
        shape = build_recipe(recipe['source'], depth + 1)
        m = recipe['matrix']
        # Three.js serializes column-major matrices.
        trsf = gp_Trsf()
        trsf.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14])
        result = BRepBuilderAPI_Transform(shape, trsf, True).Shape()
    elif kind == 'boolean':
        result = apply_boolean(build_recipe(recipe['left'], depth + 1),
                               build_recipe(recipe['right'], depth + 1), recipe['operation'])
    elif kind == 'extrude':
        height = float(recipe['height'])
        if abs(height) < 1e-7:
            raise ValueError('Extrusión sin altura')
        def prism(wire):
            face = BRepBuilderAPI_MakeFace(make_wire(wire), True).Face()
            return BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, height)).Shape()
        solids = []
        for region in recipe['regions']:
            solid = prism(region['outer'])
            for hole in region['holes']:
                solid = apply_boolean(solid, prism(hole), 'cut')
            solids.append(solid)
        if not solids:
            raise ValueError('Extrusión sin regiones')
        if len(solids) == 1:
            result = solids[0]
        else:
            result = TopoDS_Compound()
            builder = BRep_Builder()
            builder.MakeCompound(result)
            for solid in solids:
                builder.Add(result, solid)
    else:
        raise ValueError('Operación CAD no soportada')
    if result.IsNull() or not BRepCheck_Analyzer(result).IsValid():
        raise ValueError('La reconstrucción CAD no es válida')
    return result
