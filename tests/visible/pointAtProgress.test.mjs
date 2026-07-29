import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointAtProgress } from '../../src/core/geo.mjs';

// 直线三点，相邻段长均为 10，total = 20
const LINE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];

/**
 * 断言 actual 是一个 {x,y} 均为数值、且与 expected 在给定容差内相等的点，
 * 同时确认结果不含 NaN。
 */
function approxEqualPoint(actual, expected, epsilon = 1e-9) {
  assert.ok(
    actual && typeof actual.x === 'number' && typeof actual.y === 'number',
    `expected a point object with numeric x/y, got ${JSON.stringify(actual)}`
  );
  assert.ok(!Number.isNaN(actual.x) && !Number.isNaN(actual.y), 'point must not contain NaN');
  assert.ok(
    Math.abs(actual.x - expected.x) < epsilon,
    `x mismatch: got ${actual.x}, expected ${expected.x}`
  );
  assert.ok(
    Math.abs(actual.y - expected.y) < epsilon,
    `y mismatch: got ${actual.y}, expected ${expected.y}`
  );
}

test('pointAtProgress 直线 progress=0 返回起点', () => {
  const result = pointAtProgress(LINE, 0);
  approxEqualPoint(result, { x: 0, y: 0 });
});

test('pointAtProgress 直线 progress=0.5 返回弧长中点', () => {
  // total = 20, target = total * 0.5 = 10 -> 恰好落在第二个点
  const result = pointAtProgress(LINE, 0.5);
  approxEqualPoint(result, { x: 10, y: 0 });
});

test('pointAtProgress 直线 progress=1 返回终点', () => {
  const result = pointAtProgress(LINE, 1);
  approxEqualPoint(result, { x: 20, y: 0 });
});
