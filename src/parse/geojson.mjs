// ==================== GeoJSON 坐标提取 ====================
export function extractGeoJSONCoords(geojson) {
  const points = [];
  const mk = c => { const pt = { lng: c[0], lat: c[1] }; if (c.length >= 3 && typeof c[2] === 'number') pt.ele = c[2]; return pt; };
  function walk(obj) {
    if (!obj) return;
    if (obj.type === 'LineString' && Array.isArray(obj.coordinates)) {
      for (const c of obj.coordinates) if (c.length >= 2) points.push(mk(c));
    }
    if (obj.type === 'MultiLineString' && Array.isArray(obj.coordinates)) {
      for (const line of obj.coordinates) for (const c of line) if (c.length >= 2) points.push(mk(c));
    }
    if (obj.features && Array.isArray(obj.features)) obj.features.forEach(walk);
    if (obj.geometry) walk(obj.geometry);
    if (Array.isArray(obj.geometries)) obj.geometries.forEach(walk); // GeometryCollection
  }
  walk(geojson);
  return points;
}
