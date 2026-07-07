// 旅图九格 — 核心纯逻辑（可在 Node 独立测试，验证后嵌入 index.html）
// port 自原版 lvtu_index.html，修正了画线循环 length 不匹配的 bug。

// ==================== Web Mercator 投影 ====================
export function mercatorX(lon) { return lon * (Math.PI / 180) * 6378137; }
export function mercatorY(lat) {
  const rad = lat * (Math.PI / 180);
  return 6378137 * Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

// ==================== WGS84 → GCJ-02 坐标转换（国测局公式） ====================
// 用于国内地图底图（高德/腾讯/Google 中国）叠加：GPS 是 WGS84，国内地图渲染在 GCJ-02
// 加密坐标系，二者境内偏差 100-500m，必须做转换后再投到地图像素。
// 境外坐标不适用国测局偏移，原样返回。
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function gcjOutOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function gcjTransformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  ret += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return ret;
}

function gcjTransformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  ret += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return ret;
}

export function wgs84ToGcj02(lng, lat) {
  if (typeof lng !== 'number' || !Number.isFinite(lng) || typeof lat !== 'number' || !Number.isFinite(lat)) {
    throw new TypeError('wgs84ToGcj02: lng/lat must be finite numbers');
  }
  if (gcjOutOfChina(lng, lat)) return { lng, lat };

  const x = lng - 105, y = lat - 35;
  let dLat = gcjTransformLat(x, y);
  let dLng = gcjTransformLng(x, y);

  const radLat = lat * Math.PI / 180;
  const magic = 1 - GCJ_EE * Math.sin(radLat) * Math.sin(radLat);
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);

  return { lng: lng + dLng, lat: lat + dLat };
}

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

// ==================== 运动指标（时长/均速/配速/爬升） ====================
// 轨迹点可带 time(毫秒 epoch) 与 ele(米)。能算出则返回数值，缺数据返回 null。
// 运动时长(秒)：逐段累加，但跳过速度低于阈值的停顿段（等红灯/休息/过夜），与两步路/Strava 的"运动耗时"一致。
export function trackDurationSec(points){
  if(!points||points.length<2) return null;
  const R=6371000,toR=Math.PI/180,MIN_SPEED=0.5; // m/s
  let moving=0, any=false;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(typeof a.time!=='number'||typeof b.time!=='number') continue;
    const dt=(b.time-a.time)/1000; if(dt<=0) continue;
    any=true;
    const dLat=(b.lat-a.lat)*toR,dLng=(b.lng-a.lng)*toR;
    const h=Math.sin(dLat/2)**2+Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
    const dd=2*R*Math.asin(Math.sqrt(h));
    if(dd/dt>=MIN_SPEED) moving+=dt;
  }
  return any?moving:null;
}
export function avgSpeedKmh(points){
  const sec=trackDurationSec(points); if(!sec||sec<=0) return null;
  return trackDistanceKm(points)/(sec/3600);
}
export function paceSecPerKm(points){
  const sec=trackDurationSec(points), km=trackDistanceKm(points);
  if(!sec||!km||km<=0) return null;
  return sec/km;
}
// 总爬升(米)：先对海拔做移动平均平滑(窗口±win)去高频抖动，再用迟滞阈值累计上升。
// 纯累加/纯阈值都会因 GPS 海拔噪声虚高数倍；平滑+阈值更接近运动 App。
// 仍无法等同气压计+专有算法，多日/导出差异时可手改。
export function elevationGainM(points, win=5, threshold=5){
  const e=(points||[]).map(p=>p.ele).filter(v=>typeof v==='number');
  if(e.length<2) return null;
  const sm=e.map((_,i)=>{
    let s=0,n=0; const lo=Math.max(0,i-win),hi=Math.min(e.length-1,i+win);
    for(let j=lo;j<=hi;j++){ s+=e[j]; n++; }
    return s/n;
  });
  let gain=0, ref=sm[0];
  for(let i=1;i<sm.length;i++){
    if(sm[i]-ref>=threshold){ gain+=sm[i]-ref; ref=sm[i]; }
    else if(sm[i]<ref){ ref=sm[i]; }
  }
  return Math.round(gain);
}
export function formatDuration(sec){
  if(sec==null) return null;
  sec=Math.round(sec);
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
export function formatPace(secPerKm){
  if(secPerKm==null) return null;
  let m=Math.floor(secPerKm/60), s=Math.round(secPerKm%60);
  if(s===60){ m+=1; s=0; }
  return `${m}'${String(s).padStart(2,'0')}"`;
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

// ==================== GeoJSON 坐标提取 ====================
export function extractGeoJSONCoords(geojson) {
  const points = [];
  function walk(obj) {
    if (!obj) return;
    if (obj.type === 'LineString' && Array.isArray(obj.coordinates)) {
      for (const c of obj.coordinates) if (c.length >= 2) points.push({ lng: c[0], lat: c[1] });
    }
    if (obj.type === 'MultiLineString' && Array.isArray(obj.coordinates)) {
      for (const line of obj.coordinates) for (const c of line) if (c.length >= 2) points.push({ lng: c[0], lat: c[1] });
    }
    if (obj.features && Array.isArray(obj.features)) obj.features.forEach(walk);
    if (obj.geometry) walk(obj.geometry);
    if (Array.isArray(obj.geometries)) obj.geometries.forEach(walk); // GeometryCollection
  }
  walk(geojson);
  return points;
}

// ==================== 纯文本 / CSV 坐标提取 ====================
export function extractTextCoords(text) {
  const lines = text.trim().split(/[\n\r]+/);
  const coords = [];
  for (const line of lines) {
    const parts = line.trim().split(/[,;\t\s]+/);
    if (parts.length >= 2) {
      const a = parseFloat(parts[0]), b = parseFloat(parts[1]);
      if (!isNaN(a) && !isNaN(b)) {
        // 纬度物理范围 [-90,90]，经度 [-180,180]。
        // 若某数 |.|>90 必为经度，据此定序；都在 [-90,90] 内则默认 "lat,lng"（最常见）。
        if (Math.abs(a) > 90) coords.push({ lng: a, lat: b });
        else if (Math.abs(b) > 90) coords.push({ lng: b, lat: a });
        else coords.push({ lng: b, lat: a });
      }
    }
  }
  return coords;
}

// ==================== 文字块水平布局（位置 / 对齐 解耦） ====================
// 把整块文字贴在图的 hpos 侧，并永远夹在可用区间 [pad, width-pad] 内；
// align 只决定块内各行如何对齐，不再把文字推出画布（修复旧版"位置+对齐"互相打架越界的 bug）。
// 入参 lineWidths 为各行已按字号 measureText 得到的像素宽（调用方需先做宽度缩放保证 ≤ width-2*pad）。
// 返回 { blockX0, blockWidth, lines:[{x, textAlign}] }，x 为传给 ctx.fillText 的锚点。
export function layoutTextBlockX(lineWidths, { hpos, align, pad, width }) {
  const avail = Math.max(0, width - pad * 2);
  const blockWidth = lineWidths.length ? Math.min(Math.max(...lineWidths), avail) : 0;
  let blockX0;
  if (hpos === 'center') blockX0 = (width - blockWidth) / 2;
  else if (hpos === 'right') blockX0 = width - pad - blockWidth;
  else blockX0 = pad; // left
  const lines = lineWidths.map(() => {
    if (align === 'right') return { x: blockX0 + blockWidth, textAlign: 'right' };
    if (align === 'center') return { x: blockX0 + blockWidth / 2, textAlign: 'center' };
    return { x: blockX0, textAlign: 'left' };
  });
  return { blockX0, blockWidth, lines };
}

// ==================== 零依赖 ZIP（STORE 模式，无压缩） ====================
// PNG/JPEG 已是压缩数据，STORE 模式打包无损且实现简单，彻底摆脱 JSZip CDN 依赖。
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ==================== 多轨迹文件首尾拼接 / 列表重排 ====================
// trackFiles: [{ name, format, points: [{lng,lat,ele?,time?}] }] 按列表顺序首尾拼接。
export function concatTrackPoints(trackFiles) {
  if (!trackFiles.length) return null;
  return trackFiles.flatMap(f => f.points);
}
// act ∈ {'up','down','del'}；返回重排/删除后的新数组，不改动入参。
export function reorderTrackFiles(files, act, i) {
  if (act === 'del') {
    if (i < 0 || i >= files.length) return [...files];
    return files.filter((_, idx) => idx !== i);
  }
  if (act === 'up' && i > 0 && i < files.length) {
    const result = [...files];
    [result[i - 1], result[i]] = [result[i], result[i - 1]];
    return result;
  }
  if (act === 'down' && i >= 0 && i < files.length - 1) {
    const result = [...files];
    [result[i], result[i + 1]] = [result[i + 1], result[i]];
    return result;
  }
  return [...files];
}

// files: [{ name: string, data: Uint8Array }] → Uint8Array (zip)
export function buildStoreZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0;       // 00:00:00
  const DOS_DATE = 0x21;    // 1980-01-01（固定，保证可复现）

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;

    // ---- Local File Header ----
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0, true);           // flags
    lv.setUint16(8, 0, true);           // method = 0 (store)
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);       // compressed size
    lv.setUint32(22, size, true);       // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);          // extra len
    lfh.set(nameBytes, 30);
    chunks.push(lfh, data);

    // ---- Central Directory Header ----
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);          // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);          // extra
    cv.setUint16(32, 0, true);          // comment
    cv.setUint16(34, 0, true);          // disk number
    cv.setUint16(36, 0, true);          // internal attrs
    cv.setUint32(38, 0, true);          // external attrs
    cv.setUint32(42, offset, true);     // offset of local header
    cdh.set(nameBytes, 46);
    central.push(cdh);

    offset += lfh.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;

  // ---- End of Central Directory ----
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  const all = [...chunks, ...central, eocd];
  const total = all.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
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
