import { Point2D, Profile } from '../types';

function contains(points: Point2D[], point: Point2D) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pickSketchProfile(profiles: Profile[], point: Point2D, tolerance = 4) {
  // Prefer an outline; for overlapping interiors choose the last drawn figure.
  const topmost = [...profiles].reverse();
  const outline = topmost.find(profile => profile.points.some((a, index, points) => {
    if (!profile.isClosed && index === points.length - 1) return false;
    const b = points[(index + 1) % points.length];
    const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length2)) : 0;
    return Math.hypot(point.x - a.x - t * (b.x - a.x), point.y - a.y - t * (b.y - a.y)) <= tolerance;
  }));
  return outline || topmost.find(profile => {
    if (profile.type === 'circle' && profile.center && profile.radius) {
      return Math.hypot(point.x - profile.center.x, point.y - profile.center.y) <= profile.radius + tolerance;
    }
    return profile.isClosed && contains(profile.points, point);
  });
}
