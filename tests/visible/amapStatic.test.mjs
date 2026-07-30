import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lngLatToAmapPixel,
  computeAmapView,
  buildAmapStaticUrl,
  computeOverlayScale,
  computeBasemapDrawRect,
} from '../../src/core/amap.mjs';

/** 浮点容差比较：|actual-expected| < epsilon。 */
function approxEqual(actual, expected, epsilon, msg) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    msg || `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

// ---------------------------------------------------------------------------
// lngLatToAmapPixel
// ---------------------------------------------------------------------------

test('lngLatToAmapPixel (0,0) 在 zoom=1 落在世界地图正中心 (256,256)', () => {
  const result = lngLatToAmapPixel(0, 0, 1);
  approxEqual(result.x, 256, 0.001);
  approxEqual(result.y, 256, 0.001);
});

test('lngLatToAmapPixel (0,0) 在合法上界 zoom=18 落在 (128*2^18, 128*2^18)', () => {
  const result = lngLatToAmapPixel(0, 0, 18);
  const expected = 128 * Math.pow(2, 18);
  approxEqual(result.x, expected, 0.01);
  approxEqual(result.y, expected, 0.01);
});

test('lngLatToAmapPixel zoom=19 超出合法上界 18 抛出 RangeError', () => {
  assert.throws(() => lngLatToAmapPixel(0, 0, 19), RangeError);
});

// ---------------------------------------------------------------------------
// computeAmapView
// ---------------------------------------------------------------------------

test('computeAmapView 单点 bbox 返回该点为 center、zoom=15、spanPx=0', () => {
  const result = computeAmapView({ lngMin: 116.4, lngMax: 116.4, latMin: 39.9, latMax: 39.9 }, 600);
  assert.deepEqual(result.center, { lng: 116.4, lat: 39.9 });
  assert.equal(result.zoom, 15);
  assert.equal(result.spanPx, 0);
});

test('computeAmapView 跨度恰在阈值附近（sizePx/1.4）时选中对应 amapZoom 级别', () => {
  const sizePx = 700;
  const mercZoomTarget = 13; // amapZoom = 12
  const worldPxAtTarget = 256 * Math.pow(2, mercZoomTarget);
  const desiredDx = sizePx / 1.4; // 500
  const lngSpanExact = (desiredDx / worldPxAtTarget) * 360;

  // 略低于阈值：应选中 amapZoom=12
  const result = computeAmapView(
    { lngMin: 0, lngMax: lngSpanExact * 0.999999, latMin: 0, latMax: 0 },
    sizePx
  );
  assert.equal(result.zoom, 12);
  approxEqual(result.spanPx, desiredDx, 0.5);
});

test('computeAmapView bbox 缺字段抛出 TypeError；sizePx 非正抛出 RangeError', () => {
  assert.throws(() => computeAmapView({ lngMin: 116.4, lngMax: 116.5, latMin: 39.9 }, 600), TypeError);
  assert.throws(
    () => computeAmapView({ lngMin: 116.4, lngMax: 116.5, latMin: 39.9, latMax: 39.91 }, 0),
    RangeError
  );
});

// ---------------------------------------------------------------------------
// buildAmapStaticUrl
// ---------------------------------------------------------------------------

test('buildAmapStaticUrl 最简参数（无 scale/traffic）生成精确匹配的 URL', () => {
  const url = buildAmapStaticUrl({ key: 'abc123', center: { lng: 116.4, lat: 39.9 }, zoom: 15, size: 600 });
  assert.equal(
    url,
    'https://restapi.amap.com/v3/staticmap?key=abc123&location=116.400000,39.900000&zoom=15&size=600*600'
  );
});

test('buildAmapStaticUrl 带 scale 与 traffic 时按固定顺序追加', () => {
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

test('buildAmapStaticUrl size 超过 1024 上限抛出 RangeError', () => {
  assert.throws(() => buildAmapStaticUrl({ key: 'k', center: { lng: 0, lat: 0 }, zoom: 1, size: 1025 }), RangeError);
});

// ---------------------------------------------------------------------------
// computeOverlayScale
// ---------------------------------------------------------------------------

test('computeOverlayScale(500,600,70,1) 恰好等于 0.92', () => {
  assert.equal(computeOverlayScale(500, 600, 70, 1), 0.92);
});

test('computeOverlayScale spanPx=0 时以 1 兜底分母，得到 460', () => {
  assert.equal(computeOverlayScale(0, 600, 70, 1), 460);
});

test('computeOverlayScale 使 2×padPx≥canvasSize 时抛出 RangeError', () => {
  assert.throws(() => computeOverlayScale(500, 600, 300, 1), RangeError);
});

// ---------------------------------------------------------------------------
// computeBasemapDrawRect
// ---------------------------------------------------------------------------

test('computeBasemapDrawRect(600,1024,0.5) 返回精确的居中矩形', () => {
  const rect = computeBasemapDrawRect(600, 1024, 0.5);
  assert.deepEqual(rect, { x: 44, y: 44, w: 512, h: 512 });
});

test('computeBasemapDrawRect(600,600,1) 内容与画布同尺寸时居中矩形起点为 (0,0)', () => {
  const rect = computeBasemapDrawRect(600, 600, 1);
  assert.deepEqual(rect, { x: 0, y: 0, w: 600, h: 600 });
});

test('computeBasemapDrawRect k=0（非正）抛出 RangeError', () => {
  assert.throws(() => computeBasemapDrawRect(600, 1024, 0), RangeError);
});
