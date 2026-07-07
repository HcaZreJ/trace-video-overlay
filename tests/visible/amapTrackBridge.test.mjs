import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAmapUrlForTrack,
  projectTrackOnAmap,
  computeAmapView,
  buildAmapStaticUrl,
  AMAP_STATIC_ZOOM_BIAS,
} from '../../core.mjs';

// 境外坐标（巴黎、悉尼）：wgs84ToGcj02 对境外坐标原样返回，方便手工推导期望值。
const PARIS = { lng: 2.3522, lat: 48.8566 };
const SYDNEY = { lng: 151.2093, lat: -33.8688 };

/** 浮点容差比较：|actual-expected| < epsilon。 */
function approxEqual(actual, expected, epsilon, msg) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    msg || `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

/** spec 给出的球体墨卡托像素投影公式（与 lngLatToAmapPixel 的契约一致），用于独立推导期望值。 */
function refPixel(lng, lat, zoom) {
  const worldPx = 256 * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * worldPx;
  const siny = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * worldPx;
  return { x, y };
}

/**
 * 按 spec 描述的"串联"顺序，独立组合 computeAmapView + buildAmapStaticUrl 得到 oracle 结果。
 * gcjPoints 必须已经是 GCJ-02 坐标（对境外坐标而言即原始 WGS84 坐标本身）。
 */
function expectedFromGcjPoints(gcjPoints, size, key, scale, traffic) {
  const lngs = gcjPoints.map((p) => p.lng);
  const lats = gcjPoints.map((p) => p.lat);
  const bbox = {
    lngMin: Math.min(...lngs),
    lngMax: Math.max(...lngs),
    latMin: Math.min(...lats),
    latMax: Math.max(...lats),
  };
  const view = computeAmapView(bbox, size);
  const url = buildAmapStaticUrl({ key, center: view.center, zoom: view.zoom, size, scale, traffic });
  return { url, center: view.center, zoom: view.zoom, spanPx: view.spanPx };
}

test('computeAmapUrlForTrack 境外双点轨迹与串联 computeAmapView+buildAmapStaticUrl 的期望结果一致', () => {
  const size = 600;
  const key = 'testkey';
  const expected = expectedFromGcjPoints([PARIS, SYDNEY], size, key, undefined, undefined);
  const result = computeAmapUrlForTrack([PARIS, SYDNEY], size, key);

  assert.equal(result.url, expected.url);
  assert.equal(result.zoom, expected.zoom);
  assert.deepEqual(result.center, expected.center);
  approxEqual(result.spanPx, expected.spanPx, 0.5);
});

test('computeAmapUrlForTrack 单点境外轨迹退化为该点：zoom=15，center 等于该点', () => {
  const result = computeAmapUrlForTrack([PARIS], 600, 'k');
  assert.equal(result.zoom, 15);
  assert.deepEqual(result.center, { lng: PARIS.lng, lat: PARIS.lat });
  assert.equal(result.spanPx, 0);
});

test('computeAmapUrlForTrack 空数组抛出 TypeError', () => {
  assert.throws(() => computeAmapUrlForTrack([], 600, 'k'), TypeError);
});

test('projectTrackOnAmap 轨迹中的点等于 center 时，该点投影结果约等于画布中心，且 fullSize 等于 canvasSize', () => {
  const size = 600;
  const result = projectTrackOnAmap([PARIS, SYDNEY], size, PARIS, 10, 1);
  const projectedParis = result.points[0]; // 两点轨迹（<3点）不会被 smoothTrack 改变顺序/点数
  approxEqual(projectedParis.x, size / 2, 0.01);
  approxEqual(projectedParis.y, size / 2, 0.01);
  assert.strictEqual(result.fullSize, size);
});

test('projectTrackOnAmap 两点间输出像素距离等于世界像素距离乘以 k', () => {
  const size = 600;
  const amapZoom = 8;
  const k = 1.5;
  const mercZoom = amapZoom + AMAP_STATIC_ZOOM_BIAS;
  const result = projectTrackOnAmap([PARIS, SYDNEY], size, PARIS, amapZoom, k);

  const worldA = refPixel(PARIS.lng, PARIS.lat, mercZoom);
  const worldB = refPixel(SYDNEY.lng, SYDNEY.lat, mercZoom);
  const expectedDist = Math.hypot(worldB.x - worldA.x, worldB.y - worldA.y) * k;

  const [pA, pB] = result.points;
  const actualDist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
  approxEqual(actualDist, expectedDist, 0.05);
});

test('projectTrackOnAmap 空数组抛出 TypeError', () => {
  assert.throws(() => projectTrackOnAmap([], 600, PARIS, 10, 1), TypeError);
});
