import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/** Display edges only. CSG can leave T junctions (one long edge against several
 * short edges), which EdgesGeometry mistakes for open boundaries. Compare the
 * overlapping intervals on each line without changing the solid itself. */
export function solidEdges(geometry: BufferGeometry, thresholdAngle = 35): BufferGeometry {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const output = new BufferGeometry();
  if (!position) return output;
  const tolerance = 1e-4;
  type Edge = { start: number; end: number; normal: Vector3 };
  type Line = { origin: Vector3; direction: Vector3; edges: Edge[] };
  const lines = new Map<string, Line>();
  const key = (v: Vector3, precision: number) =>
    [v.x, v.y, v.z].map(n => Math.round(n / precision)).join(',');
  const count = index ? index.count : position.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const points = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j));
    const normal = new Vector3().subVectors(points[1], points[0])
      .cross(new Vector3().subVectors(points[2], points[0])).normalize();
    if (normal.lengthSq() === 0) continue;
    for (let j = 0; j < 3; j++) {
      const a = points[j], b = points[(j + 1) % 3];
      const direction = new Vector3().subVectors(b, a);
      if (direction.length() < tolerance) continue;
      direction.normalize();
      // Canonical orientation, independent of triangle winding.
      const components = [direction.x, direction.y, direction.z];
      const dominant = components.reduce((best, n, k) => Math.abs(n) > Math.abs(components[best]) ? k : best, 0);
      if (components[dominant] < 0) direction.negate();
      const origin = a.clone().addScaledVector(direction, -a.dot(direction));
      const hash = `${key(direction, 1e-5)}:${key(origin, tolerance)}`;
      let line = lines.get(hash);
      if (!line) {
        line = { origin, direction, edges: [] };
        lines.set(hash, line);
      }
      const start = a.dot(line.direction), end = b.dot(line.direction);
      line.edges.push({ start: Math.min(start, end), end: Math.max(start, end), normal });
    }
  }
  const vertices: number[] = [];
  const threshold = Math.cos(thresholdAngle * Math.PI / 180);
  for (const { origin, direction, edges } of lines.values()) {
    const events = edges.flatMap(edge => [
      { at: edge.start, edge, add: true }, { at: edge.end, edge, add: false },
    ]).sort((a, b) => a.at - b.at);
    const active = new Set<Edge>();
    for (let i = 0; i < events.length;) {
      const start = events[i].at;
      do {
        const event = events[i++];
        if (event.add) active.add(event.edge); else active.delete(event.edge);
      } while (i < events.length && events[i].at - start < tolerance);
      if (i === events.length || active.size === 0) continue;
      const end = events[i].at;
      const adjacent = [...active];
      const sharp = adjacent.some((a, j) => adjacent.slice(j + 1).some(b => a.normal.dot(b.normal) <= threshold));
      if (end - start > tolerance && (active.size === 1 || sharp)) {
        vertices.push(...origin.clone().addScaledVector(direction, start).toArray(),
          ...origin.clone().addScaledVector(direction, end).toArray());
      }
    }
  }
  return output.setAttribute('position', new Float32BufferAttribute(vertices, 3));
}
