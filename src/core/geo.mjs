// ==================== Web Mercator 投影 ====================
export function mercatorX(lon) { return lon * (Math.PI / 180) * 6378137; }
export function mercatorY(lat) {
  const rad = lat * (Math.PI / 180);
  return 6378137 * Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

// ==================== 轨迹总里程（Haversine 累加，单位 km） ====================
export function trackDistanceKm(points) {
  if (!points || points.length < 2) return 0;
  const R = 6371000, toR = Math.PI / 180;
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    m += 2 * R * Math.asin(Math.sqrt(h));
  }
  return m / 1000;
}

// ==================== Catmull-Rom 平滑插值 ====================
// 在稀疏点之间补点，消除折线尖角。点数已足够则原样返回。
export function smoothTrack(points, targetCount) {
  if (points.length >= targetCount || points.length < 3) return points;
  const perSegment = Math.ceil(targetCount / (points.length - 1));

  // 补两个镜像端点用于边界切线计算
  const wrap = [...points];
  wrap.unshift({ lng: points[0].lng * 2 - points[1].lng, lat: points[0].lat * 2 - points[1].lat });
  wrap.push({
    lng: points[points.length - 1].lng * 2 - points[points.length - 2].lng,
    lat: points[points.length - 1].lat * 2 - points[points.length - 2].lat,
  });

  const result = [];
  for (let i = 1; i < wrap.length - 2; i++) {
    const p0 = wrap[i - 1], p1 = wrap[i], p2 = wrap[i + 1], p3 = wrap[i + 2];
    const steps = (i === wrap.length - 3) ? perSegment : perSegment; // 每段统一补点
    for (let t = 0; t < steps; t++) {
      const tt = t / steps;
      const tt2 = tt * tt, tt3 = tt2 * tt;
      const lng = 0.5 * ((2 * p1.lng) + (-p0.lng + p2.lng) * tt + (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * tt2 + (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * tt3);
      const lat = 0.5 * ((2 * p1.lat) + (-p0.lat + p2.lat) * tt + (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * tt2 + (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * tt3);
      result.push({ lng, lat });
    }
  }
  // 确保终点被包含
  result.push({ ...points[points.length - 1] });
  return result;
}

// ==================== 轨迹投影到正方形画布 ====================
// 返回投影后的屏幕坐标数组（已含平滑），调用方直接顺序连线即可。
// 修正原版 bug：原版用 points.length 循环却索引 smoothed 数组，点数不一致会画歪。
export function projectTrack(points, fullSize) {
  const smoothed = smoothTrack(points, 500);
  const xs = smoothed.map(p => mercatorX(p.lng));
  const ys = smoothed.map(p => mercatorY(p.lat));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);

  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const padX = xRange * 0.05, padY = yRange * 0.05;
  const maxRange = Math.max(xRange, yRange);
  const xCenter = (xMin + xMax) / 2;
  const yCenter = (yMin + yMax) / 2;
  const half = maxRange / 2 + Math.max(padX, padY);

  const xLow = xCenter - half, xHigh = xCenter + half;
  const yLow = yCenter - half, yHigh = yCenter + half;

  const mapX = (mx) => ((mx - xLow) / (xHigh - xLow)) * fullSize;
  const mapY = (my) => fullSize - ((my - yLow) / (yHigh - yLow)) * fullSize;

  return { points: xs.map((x, i) => ({ x: mapX(x), y: mapY(ys[i]) })), fullSize };
}

// ==================== 沿弧长匀速插值定位点（progress∈[0,1] → 屏幕坐标） ====================
// points 为 projectTrack 输出的屏幕坐标数组，按相邻线段累计弧长匀速插值出 progress 处的点。
export function pointAtProgress(points, progress) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) return { x: points[0].x, y: points[0].y };

  const segLengths = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLengths.push(len);
    total += len;
  }

  if (progress <= 0 || total === 0) return { x: points[0].x, y: points[0].y };
  if (progress >= 1) return { x: points[points.length - 1].x, y: points[points.length - 1].y };

  const target = total * progress;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const len = segLengths[i];
    if (len === 0) continue;
    if (acc + len >= target) {
      const f = (target - acc) / len;
      const p0 = points[i], p1 = points[i + 1];
      return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
    }
    acc += len;
  }

  return { x: points[points.length - 1].x, y: points[points.length - 1].y };
}
