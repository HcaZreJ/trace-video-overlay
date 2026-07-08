import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotGeometry } from '../../core.mjs';

/** 断言 actual[key] 与 expected 在容差 1e-9 内相等，且是有限数字。 */
function approxEqualField(actual, key, expected, epsilon = 1e-9) {
  assert.equal(typeof actual[key], 'number', `${key} must be a number, got ${typeof actual[key]}`);
  assert.ok(Number.isFinite(actual[key]), `${key} must be finite, got ${actual[key]}`);
  assert.ok(
    Math.abs(actual[key] - expected) < epsilon,
    `${key} mismatch: got ${actual[key]}, expected ${expected}`
  );
}

test('dotGeometry size=10 返回按公式精确计算的全部几何字段', () => {
  const g = dotGeometry(10);
  approxEqualField(g, 'coreR', 5);
  approxEqualField(g, 'ringW', 1.5);
  approxEqualField(g, 'outerR', 6.5);
  approxEqualField(g, 'shadowBlur', 1.04);
  approxEqualField(g, 'shadowOffsetY', 0.26);
  assert.equal(g.pad, 3, 'pad = Math.ceil(10*0.26) = Math.ceil(2.6) = 3');
  assert.equal(g.full, 16, 'full = size + 2*pad = 10 + 6 = 16');
});

test('dotGeometry size=20 返回按公式精确计算的全部几何字段（不同量级）', () => {
  const g = dotGeometry(20);
  approxEqualField(g, 'coreR', 10);
  approxEqualField(g, 'ringW', 3);
  approxEqualField(g, 'outerR', 13);
  approxEqualField(g, 'shadowBlur', 2.08);
  approxEqualField(g, 'shadowOffsetY', 0.52);
  assert.equal(g.pad, 6, 'pad = Math.ceil(20*0.26) = Math.ceil(5.2) = 6');
  assert.equal(g.full, 32, 'full = size + 2*pad = 20 + 12 = 32');
});

test('dotGeometry 非正 size（如 0 或负数）抛出 RangeError', () => {
  assert.throws(() => dotGeometry(0), RangeError);
  assert.throws(() => dotGeometry(-5), RangeError);
});
