import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wgs84ToGcj02 } from '../../core.mjs';

/**
 * 断言 actual 是一个 {lng,lat} 均为数值、且与 expected 在给定容差内相等的坐标点，
 * 同时确认结果不含 NaN。
 */
function approxEqualPoint(actual, expected, epsilon = 0.0002) {
  assert.ok(
    actual && typeof actual.lng === 'number' && typeof actual.lat === 'number',
    `expected a point object with numeric lng/lat, got ${JSON.stringify(actual)}`
  );
  assert.ok(!Number.isNaN(actual.lng) && !Number.isNaN(actual.lat), 'point must not contain NaN');
  assert.ok(
    Math.abs(actual.lng - expected.lng) < epsilon,
    `lng mismatch: got ${actual.lng}, expected ${expected.lng}`
  );
  assert.ok(
    Math.abs(actual.lat - expected.lat) < epsilon,
    `lat mismatch: got ${actual.lat}, expected ${expected.lat}`
  );
}

test('wgs84ToGcj02 天安门 转换后偏移在 GCJ-02 范围内', () => {
  const result = wgs84ToGcj02(116.397428, 39.90923);
  approxEqualPoint(result, { lng: 116.403672, lat: 39.910634 });
  // 偏移量应处于典型的 0.001-0.007 度量级，且方向不应与原点重合
  assert.notEqual(result.lng, 116.397428);
  assert.notEqual(result.lat, 39.90923);
});

test('wgs84ToGcj02 纽约境外坐标原样返回（不加密）', () => {
  const result = wgs84ToGcj02(-74.005974, 40.712776);
  approxEqualPoint(result, { lng: -74.005974, lat: 40.712776 }, 1e-9);
});

test('wgs84ToGcj02 非数字输入抛出 TypeError', () => {
  assert.throws(() => wgs84ToGcj02(NaN, 39.90923), TypeError);
  assert.throws(() => wgs84ToGcj02(116.397428, 'not-a-number'), TypeError);
});
