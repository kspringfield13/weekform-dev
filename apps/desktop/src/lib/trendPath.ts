type TrendPoint = { x: number; y: number };

function formatCoordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// Join observations with horizontal-tangent cubic curves. Every curve lands on
// the measured weekly value, while the shared tangent at each point avoids the
// angular, point-to-point look of a polyline without inventing extra extrema.
export function buildSmoothTrendPath(points: TrendPoint[]): string {
  const first = points[0];
  if (!first) return "";

  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]!;
    const midpointX = (previous.x + point.x) / 2;
    return `${path} C ${formatCoordinate(midpointX)} ${formatCoordinate(previous.y)} ${formatCoordinate(midpointX)} ${formatCoordinate(point.y)} ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`;
  }, `M ${formatCoordinate(first.x)} ${formatCoordinate(first.y)}`);
}
