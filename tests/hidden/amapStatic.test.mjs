import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMAP_STATIC_ZOOM_BIAS,
  lngLatToAmapPixel,
  computeAmapView,
  buildAmapStaticUrl,
  computeOverlayScale,
  computeBasemapDrawRect,
} from '../../core.mjs';

// ---------------------------------------------------------------------------
// 独立于实现的参考公式（用于生成 oracle 期望值，来源：spec 给出的球体墨卡托公式）
// ---------------------------------------------------------------------------

/** 与 spec 公式一致的参考像素投影，仅用于测试内部计算期望值，不依赖被测实现。 */
function refPixel(lng, lat, zoom) {
  const worldPx = 256 * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * worldPx;
  const siny = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * worldPx;
  return { x, y };
}

/** 与 spec 行为描述一致的参考 computeAmapView 算法（1.4 系数、+1 zoom bias），仅用于生成期望的 zoom/center/spanPx。 */
function refComputeView(bbox, sizePx) {
  const { lngMin, lngMax, latMin, latMax } = bbox;
  if (lngMin === lngMax && latMin === latMax) {
    return { center: { lng: lngMin, lat: latMin }, zoom: 15, spanPx: 0 };
  }
  let chosenZoom = 1;
  let chosenSpan = null;
  for (let z = 17; z >= 1; z--) {
    const mercZoom = z + AMAP_STATIC_ZOOM_BIAS;
    const p1 = refPixel(lngMin, latMin, mercZoom);
    const p2 = refPixel(lngMax, latMax, mercZoom);
    const span = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
    if (span * 1.4 <= sizePx) {
      chosenZoom = z;
      chosenSpan = span;
      break;
    }
  }
  if (chosenSpan === null) {
    const mercZoom = 1 + AMAP_STATIC_ZOOM_BIAS;
    const p1 = refPixel(lngMin, latMin, mercZoom);
    const p2 = refPixel(lngMax, latMax, mercZoom);
    chosenSpan = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
  }
  return {
    center: { lng: (lngMin + lngMax) / 2, lat: (latMin + latMax) / 2 },
    zoom: chosenZoom,
    spanPx: chosenSpan,
  };
}

/** 浮点容差比较：|actual-expected| < epsilon。 */
function approxEqual(actual, expected, epsilon, msg) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    msg || `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

// ===========================================================================
// AMAP_STATIC_ZOOM_BIAS
// ===========================================================================

test('AMAP_STATIC_ZOOM_BIAS 常量值为 1', () => {
  assert.equal(AMAP_STATIC_ZOOM_BIAS, 1);
});

// ===========================================================================
// lngLatToAmapPixel
// ===========================================================================

test('lngLatToAmapPixel (0,0) 在任意合法 zoom 下落在世界正中心 (128*2^zoom, 128*2^zoom)', () => {
  for (const zoom of [1, 5, 10, 17, 18]) {
    const result = lngLatToAmapPixel(0, 0, zoom);
    const expected = 128 * Math.pow(2, zoom);
    approxEqual(result.x, expected, 0.01, `x mismatch at zoom=${zoom}`);
    approxEqual(result.y, expected, 0.01, `y mismatch at zoom=${zoom}`);
  }
});

const PIXEL_POINTS = [
  { desc: '天安门 GCJ-02 附近坐标 zoom=15', lng: 116.403672, lat: 39.910634, zoom: 15 },
  { desc: '上海 GCJ-02 附近坐标 zoom=15', lng: 121.504151, lat: 31.237689, zoom: 15 },
  { desc: '纽约 zoom=8', lng: -74.006, lat: 40.7128, zoom: 8 },
  { desc: '悉尼 zoom=12', lng: 151.2093, lat: -33.8688, zoom: 12 },
  { desc: '经度180 zoom=1（世界最东端）', lng: 180, lat: 0, zoom: 1 },
  { desc: '经度-180 zoom=1（世界最西端）', lng: -180, lat: 0, zoom: 1 },
  { desc: '零点附近微小偏移 zoom=17', lng: 0.000123, lat: -0.000456, zoom: 17 },
];

for (const p of PIXEL_POINTS) {
  test(`lngLatToAmapPixel 与独立参考公式一致 - ${p.desc}`, () => {
    const result = lngLatToAmapPixel(p.lng, p.lat, p.zoom);
    const expected = refPixel(p.lng, p.lat, p.zoom);
    approxEqual(result.x, expected.x, 0.5);
    approxEqual(result.y, expected.y, 0.5);
  });
}

test('lngLatToAmapPixel 纬度墨卡托上限 85.05112878 合法且与参考值一致', () => {
  const result = lngLatToAmapPixel(0, 85.05112878, 10);
  const expected = refPixel(0, 85.05112878, 10);
  approxEqual(result.x, expected.x, 0.5);
  approxEqual(result.y, expected.y, 0.5);
});

test('lngLatToAmapPixel 纬度墨卡托下限 -85.05112878 合法且与参考值一致', () => {
  const result = lngLatToAmapPixel(0, -85.05112878, 10);
  const expected = refPixel(0, -85.05112878, 10);
  approxEqual(result.x, expected.x, 0.5);
  approxEqual(result.y, expected.y, 0.5);
});

test('lngLatToAmapPixel zoom=0 低于合法下限 1 抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, 0, 0), RangeError);
});

test('lngLatToAmapPixel zoom=19 超出合法上限 18 抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, 0, 19), RangeError);
});

test('lngLatToAmapPixel zoom=-1 为负数抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, 0, -1), RangeError);
});

test('lngLatToAmapPixel zoom=3.5 非整数抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, 0, 3.5), RangeError);
});

test('lngLatToAmapPixel zoom=NaN 非整数抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, 0, NaN), RangeError);
});

test('lngLatToAmapPixel lat 超过墨卡托上限 (85.06) 抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, 85.06, 10), RangeError);
});

test('lngLatToAmapPixel lat 超过墨卡托下限 (-85.06) 抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, -85.06, 10), RangeError);
});

test('lngLatToAmapPixel lat=90（远超墨卡托极限）抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, 90, 10), RangeError);
});

test('lngLatToAmapPixel lat=-90（远超墨卡托极限）抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, -90, 10), RangeError);
});

// ===========================================================================
// computeAmapView
// ===========================================================================

const SINGLE_POINTS = [
  { lng: 116.4, lat: 39.9 },
  { lng: -74.006, lat: 40.7128 },
  { lng: 0, lat: 0 },
];

for (const pt of SINGLE_POINTS) {
  test(`computeAmapView 单点 bbox (${pt.lng},${pt.lat}) 返回该点为 center、zoom=15、spanPx=0（与 sizePx 无关）`, () => {
    for (const sizePx of [100, 600, 1024]) {
      const result = computeAmapView({ lngMin: pt.lng, lngMax: pt.lng, latMin: pt.lat, latMax: pt.lat }, sizePx);
      assert.deepEqual(result.center, { lng: pt.lng, lat: pt.lat });
      assert.equal(result.zoom, 15);
      assert.equal(result.spanPx, 0);
    }
  });
}

// -- zoom 选择边界：跨度恰在 sizePx/1.4 阈值附近，跨多个目标 zoom 级别验证 --
const BOUNDARY_TARGET_ZOOMS = [1, 5, 10, 16];
for (const targetAmapZoom of BOUNDARY_TARGET_ZOOMS) {
  const sizePx = 700;
  const mercZoomTarget = targetAmapZoom + AMAP_STATIC_ZOOM_BIAS;
  const worldPxAtTarget = 256 * Math.pow(2, mercZoomTarget);
  const desiredDx = sizePx / 1.4;
  const lngSpanExact = (desiredDx / worldPxAtTarget) * 360;

  test(`computeAmapView 跨度略低于sizePx/1.4阈值时选中amapZoom=${targetAmapZoom}`, () => {
    const bbox = { lngMin: 0, lngMax: lngSpanExact * 0.999999, latMin: 0, latMax: 0 };
    const result = computeAmapView(bbox, sizePx);
    assert.equal(result.zoom, targetAmapZoom);
    approxEqual(result.spanPx, desiredDx, 0.5);
    approxEqual(result.center.lng, bbox.lngMax / 2, 1e-9);
    assert.equal(result.center.lat, 0);
  });

  test(`computeAmapView 跨度略高于sizePx/1.4阈值时降一级（target=${targetAmapZoom}）`, () => {
    const bbox = { lngMin: 0, lngMax: lngSpanExact * 1.000001, latMin: 0, latMax: 0 };
    const result = computeAmapView(bbox, sizePx);
    const expectedZoom = targetAmapZoom > 1 ? targetAmapZoom - 1 : 1;
    assert.equal(result.zoom, expectedZoom);
  });
}

const REALISTIC_BBOXES = [
  { desc: '天安门附近小 bbox（约0.01度跨度）', bbox: { lngMin: 116.395, lngMax: 116.405, latMin: 39.905, latMax: 39.915 }, sizePx: 600 },
  { desc: '上海附近中等 bbox', bbox: { lngMin: 121.4, lngMax: 121.6, latMin: 31.15, latMax: 31.3 }, sizePx: 800 },
  { desc: '跨市较大 bbox', bbox: { lngMin: 116.0, lngMax: 117.5, latMin: 39.5, latMax: 40.5 }, sizePx: 1024 },
];

for (const c of REALISTIC_BBOXES) {
  test(`computeAmapView ${c.desc} 与独立参考算法算出的 zoom/center/spanPx 一致`, () => {
    const result = computeAmapView(c.bbox, c.sizePx);
    const expected = refComputeView(c.bbox, c.sizePx);
    assert.equal(result.zoom, expected.zoom);
    assert.ok(Number.isInteger(result.zoom) && result.zoom >= 1 && result.zoom <= 17);
    approxEqual(result.center.lng, expected.center.lng, 1e-9);
    approxEqual(result.center.lat, expected.center.lat, 1e-9);
    approxEqual(result.spanPx, expected.spanPx, 0.5);
  });
}

test('computeAmapView 全球超大 bbox 被下限保护 clamp 到 zoom=1', () => {
  const bbox = { lngMin: -180, lngMax: 180, latMin: -85, latMax: 85 };
  const result = computeAmapView(bbox, 600);
  assert.equal(result.zoom, 1);
  assert.deepEqual(result.center, { lng: 0, lat: 0 });
  const expected = refComputeView(bbox, 600);
  approxEqual(result.spanPx, expected.spanPx, 1);
});

test('computeAmapView 全球超大 bbox 配合极小 sizePx=1 仍 clamp 到 zoom=1（不会选出非法的 zoom=0）', () => {
  const result = computeAmapView({ lngMin: -180, lngMax: 180, latMin: -85, latMax: 85 }, 1);
  assert.equal(result.zoom, 1);
});

test('computeAmapView bbox 反向 (lngMin > lngMax) 抛出 RangeError', () => {
  assert.throws(
    () => computeAmapView({ lngMin: 116.5, lngMax: 116.4, latMin: 39.9, latMax: 39.91 }, 600),
    RangeError
  );
});

test('computeAmapView bbox 反向 (latMin > latMax) 抛出 RangeError', () => {
  assert.throws(
    () => computeAmapView({ lngMin: 116.4, lngMax: 116.5, latMin: 39.91, latMax: 39.9 }, 600),
    RangeError
  );
});

test('computeAmapView sizePx=0 抛出 RangeError', () => {
  assert.throws(
    () => computeAmapView({ lngMin: 116.4, lngMax: 116.5, latMin: 39.9, latMax: 39.91 }, 0),
    RangeError
  );
});

test('computeAmapView sizePx 为负数抛出 RangeError', () => {
  assert.throws(
    () => computeAmapView({ lngMin: 116.4, lngMax: 116.5, latMin: 39.9, latMax: 39.91 }, -100),
    RangeError
  );
});

test('computeAmapView sizePx=NaN 抛出 RangeError', () => {
  assert.throws(
    () => computeAmapView({ lngMin: 116.4, lngMax: 116.5, latMin: 39.9, latMax: 39.91 }, NaN),
    RangeError
  );
});

test('computeAmapView sizePx=Infinity 抛出 RangeError', () => {
  assert.throws(
    () => computeAmapView({ lngMin: 116.4, lngMax: 116.5, latMin: 39.9, latMax: 39.91 }, Infinity),
    RangeError
  );
});

test('computeAmapView sizePx 非数字（字符串）抛出 RangeError', () => {
  assert.throws(
    () => computeAmapView({ lngMin: 116.4, lngMax: 116.5, latMin: 39.9, latMax: 39.91 }, '600'),
    RangeError
  );
});

const MISSING_FIELD_BBOXES = [
  { field: 'lngMin', bbox: { lngMax: 116.5, latMin: 39.9, latMax: 39.91 } },
  { field: 'lngMax', bbox: { lngMin: 116.4, latMin: 39.9, latMax: 39.91 } },
  { field: 'latMin', bbox: { lngMin: 116.4, lngMax: 116.5, latMax: 39.91 } },
  { field: 'latMax', bbox: { lngMin: 116.4, lngMax: 116.5, latMin: 39.9 } },
];
for (const c of MISSING_FIELD_BBOXES) {
  test(`computeAmapView bbox 缺 ${c.field} 字段抛出 TypeError`, () => {
    assert.throws(() => computeAmapView(c.bbox, 600), TypeError);
  });
}

test('computeAmapView bbox 为空对象抛出 TypeError', () => {
  assert.throws(() => computeAmapView({}, 600), TypeError);
});

const NON_NUMBER_FIELD_BBOXES = [
  { field: 'lngMin', bbox: { lngMin: '116.4', lngMax: 116.5, latMin: 39.9, latMax: 39.91 } },
  { field: 'latMax', bbox: { lngMin: 116.4, lngMax: 116.5, latMin: 39.9, latMax: null } },
];
for (const c of NON_NUMBER_FIELD_BBOXES) {
  test(`computeAmapView bbox 字段 ${c.field} 非 number 抛出 TypeError`, () => {
    assert.throws(() => computeAmapView(c.bbox, 600), TypeError);
  });
}

// ===========================================================================
// buildAmapStaticUrl（契约不变，回归覆盖）
// ===========================================================================

test('buildAmapStaticUrl 最简参数（无 scale/traffic）生成精确匹配的 URL', () => {
  const url = buildAmapStaticUrl({ key: 'abc123', center: { lng: 116.4, lat: 39.9 }, zoom: 15, size: 600 });
  assert.equal(
    url,
    'https://restapi.amap.com/v3/staticmap?key=abc123&location=116.400000,39.900000&zoom=15&size=600*600'
  );
});

test('buildAmapStaticUrl 带 scale=2 与 traffic=1 时按固定顺序追加', () => {
  const url = buildAmapStaticUrl({
    key: 'k',
    center: { lng: 0, lat: 0 },
    zoom: 1,
    size: 1024,
    scale: 2,
    traffic: 1,
  });
  assert.equal(
    url,
    'https://restapi.amap.com/v3/staticmap?key=k&location=0.000000,0.000000&zoom=1&size=1024*1024&scale=2&traffic=1'
  );
});

test('buildAmapStaticUrl 仅带 traffic=0（无 scale）时不追加 scale 段', () => {
  const url = buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 600, traffic: 0 });
  assert.equal(
    url,
    'https://restapi.amap.com/v3/staticmap?key=k&location=0.000000,0.000000&zoom=1&size=600*600&traffic=0'
  );
});

test('buildAmapStaticUrl zoom=17（合法上界）生成正确 URL', () => {
  const url = buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 17, size: 600 });
  assert.equal(url, 'https://restapi.amap.com/v3/staticmap?key=k&location=0.000000,0.000000&zoom=17&size=600*600');
});

test('buildAmapStaticUrl 经纬度按 toFixed(6) 精确舍入格式化', () => {
  const url = buildAmapStaticUrl({ key: 'k', center: { lng: 100.123456789, lat: -73.9876543 }, zoom: 5, size: 600 });
  assert.equal(
    url,
    'https://restapi.amap.com/v3/staticmap?key=k&location=100.123457,-73.987654&zoom=5&size=600*600'
  );
});

test('buildAmapStaticUrl 显式传入 scale:undefined/traffic:undefined 时等同于不传', () => {
  const url = buildAmapStaticUrl({
    key: 'k',
    center: { lng: 0, lat: 0 },
    zoom: 1,
    size: 600,
    scale: undefined,
    traffic: undefined,
  });
  assert.equal(url, 'https://restapi.amap.com/v3/staticmap?key=k&location=0.000000,0.000000&zoom=1&size=600*600');
});

test('buildAmapStaticUrl 同一 params 对象多次调用返回完全一致的字符串（确定性）', () => {
  const params = { key: 'abc123', center: { lng: 116.4, lat: 39.9 }, zoom: 15, size: 600 };
  const first = buildAmapStaticUrl(params);
  const second = buildAmapStaticUrl(params);
  assert.equal(first, second);
});

test('buildAmapStaticUrl key 为空字符串抛出 TypeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: '', center: { lng: 0, lat: 0 }, zoom: 1, size: 600 }), TypeError);
});

test('buildAmapStaticUrl key 为非字符串（数字）抛出 TypeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 123, center: { lng: 0, lat: 0 }, zoom: 1, size: 600 }), TypeError);
});

test('buildAmapStaticUrl key 缺失（undefined）抛出 TypeError', () => {
  assert.throws(() => buildAmapStaticUrl({ center: { lng: 0, lat: 0 }, zoom: 1, size: 600 }), TypeError);
});

test('buildAmapStaticUrl size 超过 1024 上限抛出 RangeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 1025 }), RangeError);
});

test('buildAmapStaticUrl size=0 抛出 RangeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 0 }), RangeError);
});

test('buildAmapStaticUrl size 为负数抛出 RangeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: -600 }), RangeError);
});

test('buildAmapStaticUrl size 非整数抛出 RangeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 600.5 }), RangeError);
});

test('buildAmapStaticUrl scale=3（非 1 或 2）抛出 RangeError', () => {
  assert.throws(
    () => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 600, scale: 3 }),
    RangeError
  );
});

test('buildAmapStaticUrl scale=0（非 1 或 2）抛出 RangeError', () => {
  assert.throws(
    () => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 600, scale: 0 }),
    RangeError
  );
});

test('buildAmapStaticUrl traffic=2（非 0 或 1）抛出 RangeError', () => {
  assert.throws(
    () => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 600, traffic: 2 }),
    RangeError
  );
});

test('buildAmapStaticUrl traffic=-1（非 0 或 1）抛出 RangeError', () => {
  assert.throws(
    () => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 600, traffic: -1 }),
    RangeError
  );
});

test('buildAmapStaticUrl zoom=0 低于合法下限 1 抛出 RangeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 0, size: 600 }), RangeError);
});

test('buildAmapStaticUrl zoom=18 超出合法上限 17 抛出 RangeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 18, size: 600 }), RangeError);
});

test('buildAmapStaticUrl zoom=15.5 非整数抛出 RangeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 15.5, size: 600 }), RangeError);
});

// ===========================================================================
// computeOverlayScale
// ===========================================================================

test('computeOverlayScale(500,600,70,1) 恰好等于 0.92（锚定值）', () => {
  assert.equal(computeOverlayScale(500, 600, 70, 1), 0.92);
});

test('computeOverlayScale(0,600,70,1) 以 max(spanPx,1) 兜底得到 460（锚定值）', () => {
  assert.equal(computeOverlayScale(0, 600, 70, 1), 460);
});

const OVERLAY_SCALE_CASES = [
  { spanPx: 100, canvasSize: 500, padPx: 0, viewScale: 1 },
  { spanPx: 250, canvasSize: 800, padPx: 40, viewScale: 1.5 },
  { spanPx: 1, canvasSize: 1024, padPx: 100, viewScale: 0.8 },
];
for (const c of OVERLAY_SCALE_CASES) {
  test(`computeOverlayScale(${c.spanPx},${c.canvasSize},${c.padPx},${c.viewScale}) 与公式一致`, () => {
    const expected = (c.viewScale * (c.canvasSize - 2 * c.padPx)) / Math.max(c.spanPx, 1);
    approxEqual(computeOverlayScale(c.spanPx, c.canvasSize, c.padPx, c.viewScale), expected, 1e-9);
  });
}

test('computeOverlayScale viewScale 翻倍时结果翻倍（线性关系）', () => {
  const base = computeOverlayScale(500, 600, 70, 1);
  const doubled = computeOverlayScale(500, 600, 70, 2);
  approxEqual(doubled, base * 2, 1e-9);
});

test('computeOverlayScale spanPx 为负数抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(-1, 600, 70, 1), RangeError);
});

test('computeOverlayScale spanPx=NaN 抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(NaN, 600, 70, 1), RangeError);
});

test('computeOverlayScale spanPx=Infinity 抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(Infinity, 600, 70, 1), RangeError);
});

test('computeOverlayScale canvasSize=0 抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, 0, 70, 1), RangeError);
});

test('computeOverlayScale canvasSize 为负数抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, -600, 70, 1), RangeError);
});

test('computeOverlayScale canvasSize=Infinity 抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, Infinity, 70, 1), RangeError);
});

test('computeOverlayScale padPx 为负数抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, 600, -1, 1), RangeError);
});

test('computeOverlayScale padPx=NaN 抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, 600, NaN, 1), RangeError);
});

test('computeOverlayScale 2×padPx 恰等于 canvasSize 时抛出 RangeError（>=判断）', () => {
  assert.throws(() => computeOverlayScale(500, 600, 300, 1), RangeError);
});

test('computeOverlayScale 2×padPx 超过 canvasSize 时抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, 600, 400, 1), RangeError);
});

test('computeOverlayScale viewScale=0 抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, 600, 70, 0), RangeError);
});

test('computeOverlayScale viewScale 为负数抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, 600, 70, -1), RangeError);
});

test('computeOverlayScale viewScale=Infinity 抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, 600, 70, Infinity), RangeError);
});

// ===========================================================================
// computeBasemapDrawRect
// ===========================================================================

test('computeBasemapDrawRect(600,1024,0.5) 返回精确的居中矩形（锚定值）', () => {
  const rect = computeBasemapDrawRect(600, 1024, 0.5);
  assert.deepEqual(rect, { x: 44, y: 44, w: 512, h: 512 });
});

test('computeBasemapDrawRect(600,600,1) 内容与画布同尺寸时居中矩形起点为 (0,0)', () => {
  const rect = computeBasemapDrawRect(600, 600, 1);
  assert.deepEqual(rect, { x: 0, y: 0, w: 600, h: 600 });
});

const DRAW_RECT_CASES = [
  { canvasSize: 500, contentSize: 300, k: 0.7 },
  { canvasSize: 1024, contentSize: 2048, k: 1.3 },
  { canvasSize: 800, contentSize: 100, k: 3 },
];
for (const c of DRAW_RECT_CASES) {
  test(`computeBasemapDrawRect(${c.canvasSize},${c.contentSize},${c.k}) 与公式一致且为正方形`, () => {
    const rect = computeBasemapDrawRect(c.canvasSize, c.contentSize, c.k);
    const expectedW = c.contentSize * c.k;
    const expectedX = c.canvasSize / 2 - expectedW / 2;
    approxEqual(rect.w, expectedW, 1e-9);
    approxEqual(rect.h, expectedW, 1e-9);
    approxEqual(rect.x, expectedX, 1e-9);
    approxEqual(rect.y, expectedX, 1e-9);
    assert.equal(rect.w, rect.h, 'draw rect must always be square');
  });
}

test('computeBasemapDrawRect canvasSize=0 抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(0, 1024, 0.5), RangeError);
});

test('computeBasemapDrawRect canvasSize 为负数抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(-600, 1024, 0.5), RangeError);
});

test('computeBasemapDrawRect canvasSize=NaN 抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(NaN, 1024, 0.5), RangeError);
});

test('computeBasemapDrawRect contentSize=0 抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(600, 0, 0.5), RangeError);
});

test('computeBasemapDrawRect contentSize 为负数抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(600, -1024, 0.5), RangeError);
});

test('computeBasemapDrawRect contentSize=Infinity 抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(600, Infinity, 0.5), RangeError);
});

test('computeBasemapDrawRect k=0（非正）抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(600, 1024, 0), RangeError);
});

test('computeBasemapDrawRect k 为负数抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(600, 1024, -0.5), RangeError);
});

test('computeBasemapDrawRect k=NaN 抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(600, 1024, NaN), RangeError);
});
