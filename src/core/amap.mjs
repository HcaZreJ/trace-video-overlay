import { smoothTrack } from './geo.mjs';
import { wgs84ToGcj02 } from './gcj02.mjs';

// ==================== 高德静图墨卡托像素 + 静图请求参数 ====================
// 高德静图按 512px tile 渲染：zoom=N 的地面分辨率 = 标准 256px Web Mercator 的 N+1。
// 涉及像素的计算统一换算 mercZoom = amapZoom + AMAP_STATIC_ZOOM_BIAS。
// 输入必须已是 GCJ-02 坐标（境内数据先经 wgs84ToGcj02 转换），本节函数不做坐标系转换。
export const AMAP_STATIC_ZOOM_BIAS = 1;
const AMAP_MERCATOR_LAT_LIMIT = 85.05112878;

export function computeOverlayScale(spanPx, canvasSize, padPx, viewScale) {
  if (typeof spanPx !== 'number' || !Number.isFinite(spanPx) || spanPx < 0) {
    throw new RangeError('computeOverlayScale: spanPx must be a non-negative finite number');
  }
  if (typeof canvasSize !== 'number' || !Number.isFinite(canvasSize) || canvasSize <= 0) {
    throw new RangeError('computeOverlayScale: canvasSize must be a positive finite number');
  }
  if (typeof padPx !== 'number' || !Number.isFinite(padPx) || padPx < 0 || 2 * padPx >= canvasSize) {
    throw new RangeError('computeOverlayScale: padPx must be a non-negative finite number with 2*padPx < canvasSize');
  }
  if (typeof viewScale !== 'number' || !Number.isFinite(viewScale) || viewScale <= 0) {
    throw new RangeError('computeOverlayScale: viewScale must be a positive finite number');
  }
  return viewScale * (canvasSize - 2 * padPx) / Math.max(spanPx, 1);
}

export function computeBasemapDrawRect(canvasSize, contentSize, k) {
  if (typeof canvasSize !== 'number' || !Number.isFinite(canvasSize) || canvasSize <= 0) {
    throw new RangeError('computeBasemapDrawRect: canvasSize must be a positive finite number');
  }
  if (typeof contentSize !== 'number' || !Number.isFinite(contentSize) || contentSize <= 0) {
    throw new RangeError('computeBasemapDrawRect: contentSize must be a positive finite number');
  }
  if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0) {
    throw new RangeError('computeBasemapDrawRect: k must be a positive finite number');
  }
  const w = contentSize * k;
  const h = w;
  const x = canvasSize / 2 - w / 2;
  const y = x;
  return { x, y, w, h };
}

export function lngLatToAmapPixel(lng, lat, zoom) {
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 18) {
    throw new RangeError('lngLatToAmapPixel: zoom must be an integer in [1,18]');
  }
  if (lat > AMAP_MERCATOR_LAT_LIMIT || lat < -AMAP_MERCATOR_LAT_LIMIT) {
    throw new RangeError('lngLatToAmapPixel: lat out of Mercator range');
  }
  const worldPx = 256 * Math.pow(2, zoom);
  const x = (lng + 180) / 360 * worldPx;
  const siny = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * worldPx;
  return { x, y };
}

export function computeAmapView(bboxGcj02, sizePx) {
  const b = bboxGcj02 || {};
  if (
    typeof b.lngMin !== 'number' || typeof b.lngMax !== 'number' ||
    typeof b.latMin !== 'number' || typeof b.latMax !== 'number'
  ) {
    throw new TypeError('computeAmapView: bboxGcj02 must have numeric lngMin/lngMax/latMin/latMax');
  }
  const { lngMin, lngMax, latMin, latMax } = b;
  if (lngMin > lngMax || latMin > latMax) {
    throw new RangeError('computeAmapView: bbox is reversed (min > max)');
  }
  if (typeof sizePx !== 'number' || !Number.isFinite(sizePx) || sizePx <= 0) {
    throw new RangeError('computeAmapView: sizePx must be a positive number');
  }

  const center = { lng: (lngMin + lngMax) / 2, lat: (latMin + latMax) / 2 };
  if (lngMin === lngMax && latMin === latMax) {
    return { center: { lng: lngMin, lat: latMin }, zoom: 15, spanPx: 0 };
  }

  let fallbackSpanPx = 0;
  for (let zoom = 17; zoom >= 1; zoom--) {
    const mercZoom = zoom + AMAP_STATIC_ZOOM_BIAS;
    const pMin = lngLatToAmapPixel(lngMin, latMin, mercZoom);
    const pMax = lngLatToAmapPixel(lngMax, latMax, mercZoom);
    const dxPx = Math.abs(pMax.x - pMin.x);
    const dyPx = Math.abs(pMax.y - pMin.y);
    const spanPx = Math.max(dxPx, dyPx);
    if (spanPx * 1.4 <= sizePx) {
      return { center, zoom, spanPx };
    }
    fallbackSpanPx = spanPx;
  }
  return { center, zoom: 1, spanPx: fallbackSpanPx };
}

export function buildAmapStaticUrl(params) {
  const p = params || {};
  const { key, center, zoom, size, scale, traffic } = p;

  if (typeof key !== 'string' || key === '') {
    throw new TypeError('buildAmapStaticUrl: key must be a non-empty string');
  }
  if (!Number.isInteger(size) || size <= 0 || size > 1024) {
    throw new RangeError('buildAmapStaticUrl: size must be an integer in (0,1024]');
  }
  if (scale !== undefined && scale !== 1 && scale !== 2) {
    throw new RangeError('buildAmapStaticUrl: scale must be 1 or 2');
  }
  if (traffic !== undefined && traffic !== 0 && traffic !== 1) {
    throw new RangeError('buildAmapStaticUrl: traffic must be 0 or 1');
  }
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 17) {
    throw new RangeError('buildAmapStaticUrl: zoom must be an integer in [1,17]');
  }

  let url = `https://restapi.amap.com/v3/staticmap?key=${key}&location=${center.lng.toFixed(6)},${center.lat.toFixed(6)}&zoom=${zoom}&size=${size}*${size}`;
  if (scale !== undefined) url += `&scale=${scale}`;
  if (traffic !== undefined) url += `&traffic=${traffic}`;
  return url;
}

// ==================== 组合层：轨迹 → 高德底图 URL / 与地图对齐的轨迹投影 ====================
// 上层入口：把 WGS84 轨迹（GPS 原始数据）与高德静图桥接。内部串联
// wgs84ToGcj02 + computeAmapView + buildAmapStaticUrl + lngLatToAmapPixel。
export function computeAmapUrlForTrack(pointsWgs84, size, key, scale, traffic) {
  if (!Array.isArray(pointsWgs84) || pointsWgs84.length === 0) {
    throw new TypeError('computeAmapUrlForTrack: pointsWgs84 must be a non-empty array');
  }
  const gcjPoints = pointsWgs84.map(p => wgs84ToGcj02(p.lng, p.lat));
  const lngs = gcjPoints.map(p => p.lng);
  const lats = gcjPoints.map(p => p.lat);
  const bbox = {
    lngMin: Math.min(...lngs),
    lngMax: Math.max(...lngs),
    latMin: Math.min(...lats),
    latMax: Math.max(...lats),
  };
  const { center, zoom, spanPx } = computeAmapView(bbox, size);
  const url = buildAmapStaticUrl({ key, center, zoom, size, scale, traffic });
  return { url, center, zoom, spanPx };
}

export function projectTrackOnAmap(pointsWgs84, size, center, amapZoom, k) {
  if (!Array.isArray(pointsWgs84) || pointsWgs84.length === 0) {
    throw new TypeError('projectTrackOnAmap: pointsWgs84 must be a non-empty array');
  }
  if (!center || typeof center !== 'object' || typeof center.lng !== 'number' || typeof center.lat !== 'number') {
    throw new TypeError('projectTrackOnAmap: center must be an object with numeric lng/lat');
  }
  if (!Number.isInteger(amapZoom) || amapZoom < 1 || amapZoom > 17) {
    throw new RangeError('projectTrackOnAmap: amapZoom must be an integer in [1,17]');
  }
  if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0) {
    throw new RangeError('projectTrackOnAmap: k must be a positive finite number');
  }
  const mercZoom = amapZoom + AMAP_STATIC_ZOOM_BIAS;
  const smoothed = smoothTrack(pointsWgs84, 500);
  const centerPx = lngLatToAmapPixel(center.lng, center.lat, mercZoom);
  const points = smoothed.map(p => {
    const gcj = wgs84ToGcj02(p.lng, p.lat);
    const worldPx = lngLatToAmapPixel(gcj.lng, gcj.lat, mercZoom);
    return {
      x: (worldPx.x - centerPx.x) * k + size / 2,
      y: (worldPx.y - centerPx.y) * k + size / 2,
    };
  });
  return { points, fullSize: size };
}
