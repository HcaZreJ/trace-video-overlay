import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAmapUrlForTrack,
  projectTrackOnAmap,
  computeAmapView,
  buildAmapStaticUrl,
  wgs84ToGcj02,
  smoothTrack,
  AMAP_STATIC_ZOOM_BIAS,
} from '../../core.mjs';

// 境外坐标：wgs84ToGcj02 对境外坐标原样返回，方便手工推导期望值（无需额外调用 wgs84ToGcj02）。
const PARIS = { lng: 2.3522, lat: 48.8566 };
const SYDNEY = { lng: 151.2093, lat: -33.8688 };
const TOKYO_OUTSIDE = { lng: 10, lat: 60 }; // 仅用作扩展 bbox 的第三个境外点，坐标本身无地理含义

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
 * gcjPoints 必须已经是 GCJ-02 坐标（对境外坐标而言即原始 WGS84 坐标本身；境内坐标需先手动 wgs84ToGcj02）。
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

// ===========================================================================
// computeAmapUrlForTrack
// ===========================================================================

test('computeAmapUrlForTrack 境外双点轨迹在无 scale/traffic 时与 oracle 精确一致', () => {
  const size = 600;
  const key = 'abc123';
  const expected = expectedFromGcjPoints([PARIS, SYDNEY], size, key, undefined, undefined);
  const result = computeAmapUrlForTrack([PARIS, SYDNEY], size, key);

  assert.equal(result.url, expected.url);
  assert.equal(result.zoom, expected.zoom);
  assert.deepEqual(result.center, expected.center);
  approxEqual(result.spanPx, expected.spanPx, 0.5);
});

test('computeAmapUrlForTrack 多点(3点)境外轨迹 bbox 取全体 min/max 而非仅首尾点', () => {
  const size = 600;
  const key = 'k';
  const points = [PARIS, TOKYO_OUTSIDE, SYDNEY]; // 中间点纬度更靠北，扩展了 bbox 上界
  const expected = expectedFromGcjPoints(points, size, key, undefined, undefined);
  const result = computeAmapUrlForTrack(points, size, key);

  assert.equal(result.zoom, expected.zoom);
  assert.deepEqual(result.center, expected.center);
  assert.equal(result.url, expected.url);
});

test('computeAmapUrlForTrack 单点境外轨迹退化为该点：zoom=15，center 等于该点，spanPx=0', () => {
  const result = computeAmapUrlForTrack([SYDNEY], 600, 'k');
  assert.equal(result.zoom, 15);
  assert.deepEqual(result.center, { lng: SYDNEY.lng, lat: SYDNEY.lat });
  assert.equal(result.spanPx, 0);
});

test('computeAmapUrlForTrack scale=2 时 url 与 oracle 一致且包含 &scale=2', () => {
  const size = 600;
  const key = 'abc123';
  const expected = expectedFromGcjPoints([PARIS, SYDNEY], size, key, 2, undefined);
  const result = computeAmapUrlForTrack([PARIS, SYDNEY], size, key, 2);
  assert.equal(result.url, expected.url);
  assert.ok(result.url.includes('&scale=2'));
});

test('computeAmapUrlForTrack traffic=1 时 url 与 oracle 一致且包含 &traffic=1', () => {
  const size = 600;
  const key = 'abc123';
  const expected = expectedFromGcjPoints([PARIS, SYDNEY], size, key, undefined, 1);
  const result = computeAmapUrlForTrack([PARIS, SYDNEY], size, key, undefined, 1);
  assert.equal(result.url, expected.url);
  assert.ok(result.url.includes('&traffic=1'));
});

test('computeAmapUrlForTrack scale=2 且 traffic=1 同时给出时 url 与 oracle 一致', () => {
  const size = 1024;
  const key = 'k';
  const expected = expectedFromGcjPoints([PARIS, SYDNEY], size, key, 2, 1);
  const result = computeAmapUrlForTrack([PARIS, SYDNEY], size, key, 2, 1);
  assert.equal(result.url, expected.url);
  assert.ok(result.url.includes('&scale=2'));
  assert.ok(result.url.includes('&traffic=1'));
});

test('computeAmapUrlForTrack 不给 scale/traffic 时 url 不包含这两段', () => {
  const result = computeAmapUrlForTrack([PARIS, SYDNEY], 600, 'k');
  assert.ok(!result.url.includes('&scale='), `should not contain &scale=: ${result.url}`);
  assert.ok(!result.url.includes('&traffic='), `should not contain &traffic=: ${result.url}`);
});

test('computeAmapUrlForTrack 返回的 spanPx 与 computeAmapView oracle 一致', () => {
  const size = 700;
  const key = 'k';
  const expected = expectedFromGcjPoints([PARIS, SYDNEY], size, key, undefined, undefined);
  const result = computeAmapUrlForTrack([PARIS, SYDNEY], size, key);
  approxEqual(result.spanPx, expected.spanPx, 0.5);
});

test('computeAmapUrlForTrack 境内坐标先经 wgs84ToGcj02 换算再求 bbox（端到端与 oracle 一致）', () => {
  const size = 600;
  const key = 'k';
  const points = [
    { lng: 116.397428, lat: 39.90923 },
    { lng: 116.403981, lat: 39.917839 },
  ];
  const gcjPoints = points.map((p) => wgs84ToGcj02(p.lng, p.lat));
  const expected = expectedFromGcjPoints(gcjPoints, size, key, undefined, undefined);
  const result = computeAmapUrlForTrack(points, size, key);

  assert.equal(result.url, expected.url);
  assert.equal(result.zoom, expected.zoom);
  approxEqual(result.center.lng, expected.center.lng, 1e-9);
  approxEqual(result.center.lat, expected.center.lat, 1e-9);
});

test('computeAmapUrlForTrack 返回对象包含合法结构的 url/center/zoom/spanPx 字段', () => {
  const result = computeAmapUrlForTrack([PARIS, SYDNEY], 600, 'k');
  assert.equal(typeof result.url, 'string');
  assert.equal(typeof result.center.lng, 'number');
  assert.equal(typeof result.center.lat, 'number');
  assert.ok(!Number.isNaN(result.center.lng) && !Number.isNaN(result.center.lat));
  assert.ok(Number.isInteger(result.zoom) && result.zoom >= 1 && result.zoom <= 17);
  assert.equal(typeof result.spanPx, 'number');
  assert.ok(!Number.isNaN(result.spanPx) && result.spanPx >= 0);
});

const INVALID_TRACKS = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: '空数组', value: [] },
  { label: '字符串', value: 'not-an-array' },
  { label: '数字', value: 42 },
  { label: '普通对象', value: { lng: 1, lat: 2 } },
];
for (const t of INVALID_TRACKS) {
  test(`computeAmapUrlForTrack pointsWgs84 为 ${t.label} 时抛出 TypeError`, () => {
    assert.throws(() => computeAmapUrlForTrack(t.value, 600, 'k'), TypeError);
  });
}

test('computeAmapUrlForTrack size<=0 时透传 computeAmapView 抛出的 RangeError', () => {
  assert.throws(() => computeAmapUrlForTrack([PARIS, SYDNEY], 0, 'k'), RangeError);
});

test('computeAmapUrlForTrack size 超过 1024 上限时透传 buildAmapStaticUrl 抛出的 RangeError', () => {
  assert.throws(() => computeAmapUrlForTrack([PARIS, SYDNEY], 2000, 'k'), RangeError);
});

test('computeAmapUrlForTrack key 为空字符串时透传 buildAmapStaticUrl 抛出的 TypeError', () => {
  assert.throws(() => computeAmapUrlForTrack([PARIS, SYDNEY], 600, ''), TypeError);
});

test('computeAmapUrlForTrack scale 非法值(5)时透传 buildAmapStaticUrl 抛出的 RangeError', () => {
  assert.throws(() => computeAmapUrlForTrack([PARIS, SYDNEY], 600, 'k', 5), RangeError);
});

test('computeAmapUrlForTrack traffic 非法值(9)时透传 buildAmapStaticUrl 抛出的 RangeError', () => {
  assert.throws(() => computeAmapUrlForTrack([PARIS, SYDNEY], 600, 'k', undefined, 9), RangeError);
});

// ===========================================================================
// projectTrackOnAmap
// ===========================================================================

test('projectTrackOnAmap 单点境外轨迹且 center 等于该点时输出点约等于画布中心 (size/2,size/2)', () => {
  for (const size of [400, 600, 1024]) {
    const result = projectTrackOnAmap([SYDNEY], size, SYDNEY, 12, 1);
    approxEqual(result.points[0].x, size / 2, 0.05);
    approxEqual(result.points[0].y, size / 2, 0.05);
    assert.strictEqual(result.fullSize, size);
  }
});

const PROJECT_FORMULA_CASES = [
  { size: 600, amapZoom: 5, k: 1, center: PARIS },
  { size: 1024, amapZoom: 12, k: 0.5, center: SYDNEY },
  { size: 400, amapZoom: 17, k: 2, center: { lng: 0, lat: 0 } },
  { size: 800, amapZoom: 1, k: 1, center: PARIS },
];
for (const c of PROJECT_FORMULA_CASES) {
  test(`projectTrackOnAmap 精确公式校验 - size=${c.size} amapZoom=${c.amapZoom} k=${c.k}`, () => {
    const mercZoom = c.amapZoom + AMAP_STATIC_ZOOM_BIAS;
    const result = projectTrackOnAmap([PARIS, SYDNEY], c.size, c.center, c.amapZoom, c.k);
    const centerWorld = refPixel(c.center.lng, c.center.lat, mercZoom);
    const pts = [PARIS, SYDNEY];
    for (let i = 0; i < pts.length; i++) {
      const world = refPixel(pts[i].lng, pts[i].lat, mercZoom);
      const expectedX = (world.x - centerWorld.x) * c.k + c.size / 2;
      const expectedY = (world.y - centerWorld.y) * c.k + c.size / 2;
      approxEqual(result.points[i].x, expectedX, 0.05, `x mismatch at point ${i}`);
      approxEqual(result.points[i].y, expectedY, 0.05, `y mismatch at point ${i}`);
    }
  });
}

test('projectTrackOnAmap k 翻倍时，各点相对画布中心的偏移量翻倍', () => {
  const size = 600;
  const amapZoom = 9;
  const r1 = projectTrackOnAmap([PARIS, SYDNEY], size, PARIS, amapZoom, 1);
  const r2 = projectTrackOnAmap([PARIS, SYDNEY], size, PARIS, amapZoom, 2);
  for (let i = 0; i < r1.points.length; i++) {
    const dx1 = r1.points[i].x - size / 2;
    const dy1 = r1.points[i].y - size / 2;
    const dx2 = r2.points[i].x - size / 2;
    const dy2 = r2.points[i].y - size / 2;
    approxEqual(dx2, dx1 * 2, 0.05, `dx mismatch at point ${i}`);
    approxEqual(dy2, dy1 * 2, 0.05, `dy mismatch at point ${i}`);
  }
});

test('projectTrackOnAmap 境内坐标先经 wgs84ToGcj02 转换再投影（否则不会精确落在画布中心）', () => {
  const size = 600;
  const amapZoom = 15;
  const beijingPoint = { lng: 116.397428, lat: 39.90923 };
  const gcjCenter = wgs84ToGcj02(beijingPoint.lng, beijingPoint.lat);
  const result = projectTrackOnAmap([beijingPoint], size, gcjCenter, amapZoom, 1);
  approxEqual(result.points[0].x, size / 2, 0.05);
  approxEqual(result.points[0].y, size / 2, 0.05);
});

test('projectTrackOnAmap 输出 fullSize 严格等于输入 canvasSize（多个尺寸）', () => {
  for (const size of [400, 600, 800, 1024]) {
    const result = projectTrackOnAmap([PARIS, SYDNEY], size, PARIS, 10, 1);
    assert.strictEqual(result.fullSize, size);
  }
});

test('projectTrackOnAmap amapZoom 合法边界 1 与 17 均不抛错并产生数值型输出', () => {
  for (const zoom of [1, 17]) {
    const result = projectTrackOnAmap([PARIS, SYDNEY], 600, PARIS, zoom, 1);
    for (const p of result.points) {
      assert.equal(typeof p.x, 'number');
      assert.equal(typeof p.y, 'number');
      assert.ok(!Number.isNaN(p.x) && !Number.isNaN(p.y));
    }
  }
});

test('projectTrackOnAmap 少于3点的轨迹不经平滑，输出点数与输入一致', () => {
  const result = projectTrackOnAmap([PARIS, SYDNEY], 600, PARIS, 10, 1);
  assert.equal(result.points.length, 2);
});

test('projectTrackOnAmap 不少于500点的轨迹保持原点数（smoothTrack 原样返回）', () => {
  const track = [];
  for (let i = 0; i < 500; i++) {
    track.push({ lng: -60 + i * 0.001, lat: 10 + i * 0.0005 }); // 全程境外坐标
  }
  const expectedLen = smoothTrack(track, 500).length;
  assert.equal(expectedLen, 500, 'sanity check on smoothTrack pass-through behavior for >=500 points');
  const result = projectTrackOnAmap(track, 600, PARIS, 10, 1);
  assert.equal(result.points.length, expectedLen);
});

test('projectTrackOnAmap 3至499点之间的轨迹经 smoothTrack 平滑，输出点数与 smoothTrack(pointsWgs84,500) 一致', () => {
  const track = [];
  for (let i = 0; i < 5; i++) {
    track.push({ lng: -60 + i * 0.01, lat: 10 + i * 0.01 });
  }
  const expectedLen = smoothTrack(track, 500).length;
  const result = projectTrackOnAmap(track, 600, PARIS, 10, 1);
  assert.equal(result.points.length, expectedLen);
});

const INVALID_POINTS_INPUTS = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: '空数组', value: [] },
  { label: '字符串', value: 'not-an-array' },
  { label: '数字', value: 42 },
  { label: '普通对象', value: { lng: 1, lat: 2 } },
];
for (const t of INVALID_POINTS_INPUTS) {
  test(`projectTrackOnAmap pointsWgs84 为 ${t.label} 时抛出 TypeError`, () => {
    assert.throws(() => projectTrackOnAmap(t.value, 600, PARIS, 10, 1), TypeError);
  });
}

const INVALID_CENTERS = [
  { label: 'null', value: null },
  { label: '非object(字符串)', value: 'center' },
  { label: '缺lng', value: { lat: 0 } },
  { label: '缺lat', value: { lng: 0 } },
  { label: 'lng非数字', value: { lng: '0', lat: 0 } },
  { label: 'lat非数字', value: { lng: 0, lat: '0' } },
];
for (const c of INVALID_CENTERS) {
  test(`projectTrackOnAmap center 为 ${c.label} 时抛出 TypeError`, () => {
    assert.throws(() => projectTrackOnAmap([PARIS, SYDNEY], 600, c.value, 10, 1), TypeError);
  });
}

const INVALID_ZOOMS = [0, 18, -1, 1.5, NaN];
for (const z of INVALID_ZOOMS) {
  test(`projectTrackOnAmap amapZoom=${z} 抛出 RangeError`, () => {
    assert.throws(() => projectTrackOnAmap([PARIS, SYDNEY], 600, PARIS, z, 1), RangeError);
  });
}

const INVALID_KS = [0, -1, NaN, Infinity];
for (const k of INVALID_KS) {
  test(`projectTrackOnAmap k=${k} 抛出 RangeError`, () => {
    assert.throws(() => projectTrackOnAmap([PARIS, SYDNEY], 600, PARIS, 10, k), RangeError);
  });
}

// ===========================================================================
// 集成：computeAmapUrlForTrack 的输出可直接喂给 projectTrackOnAmap
// ===========================================================================

test('集成：computeAmapUrlForTrack 输出的 center/zoom 可直接作为 projectTrackOnAmap 的输入而不抛错', () => {
  const size = 600;
  const { center, zoom } = computeAmapUrlForTrack([PARIS, SYDNEY], size, 'k');
  const result = projectTrackOnAmap([PARIS, SYDNEY], size, center, zoom, 1);

  assert.ok(Array.isArray(result.points) && result.points.length > 0);
  assert.strictEqual(result.fullSize, size);
  for (const p of result.points) {
    assert.ok(!Number.isNaN(p.x) && !Number.isNaN(p.y));
  }
});

test('集成：computeAmapUrlForTrack 与 projectTrackOnAmap 串联后，bbox 中心点本身投影结果约等于画布中心', () => {
  const size = 600;
  const { center, zoom } = computeAmapUrlForTrack([PARIS, SYDNEY], size, 'k');
  const result = projectTrackOnAmap([{ lng: center.lng, lat: center.lat }], size, center, zoom, 1);
  approxEqual(result.points[0].x, size / 2, 0.05);
  approxEqual(result.points[0].y, size / 2, 0.05);
});
