import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointAtProgress } from '../../core.mjs';

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

// ---- 固定数据集 ----

// 直线三点，相邻段长均为 10，total = 20
const LINE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];

// 折线（带拐点），第一段长 20，第二段长 10，total = 30
const DOGLEG = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }];

// 非均匀段长（勾股数），第一段长 5，第二段长 12，total = 17
const PYTHAGOREAN = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 16 }];

// 含零长度段（相邻点重合）：段长依次为 10, 0, 10，total = 20
const WITH_ZERO_SEGMENT = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 0 },
  { x: 20, y: 0 },
];

// 所有点重合，总弧长为 0
const ALL_SAME = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];

// 单点数组
const SINGLE = [{ x: 7, y: -3 }];

// ---- happy path 变体：直线 ----

test('pointAtProgress 直线 progress=0 返回起点', () => {
  approxEqualPoint(pointAtProgress(LINE, 0), { x: 0, y: 0 });
});

test('pointAtProgress 直线 progress=0.25 落在第一段内部插值', () => {
  // target = 20 * 0.25 = 5 -> 第一段 [0,10] 内 ratio = 0.5
  approxEqualPoint(pointAtProgress(LINE, 0.25), { x: 5, y: 0 });
});

test('pointAtProgress 直线 progress=0.5 返回弧长中点', () => {
  approxEqualPoint(pointAtProgress(LINE, 0.5), { x: 10, y: 0 });
});

test('pointAtProgress 直线 progress=0.75 落在第二段内部插值', () => {
  // target = 20 * 0.75 = 15 -> 第二段 [10,20] 内 ratio = 0.5
  approxEqualPoint(pointAtProgress(LINE, 0.75), { x: 15, y: 0 });
});

test('pointAtProgress 直线 progress=1 返回终点', () => {
  approxEqualPoint(pointAtProgress(LINE, 1), { x: 20, y: 0 });
});

// ---- happy path 变体：折线跨段插值 ----

test('pointAtProgress 折线跨段插值 progress=0.5 落在第一段内', () => {
  // total = 30, target = 15 -> 第一段 [0,20] 内 ratio = 0.75
  approxEqualPoint(pointAtProgress(DOGLEG, 0.5), { x: 15, y: 0 });
});

test('pointAtProgress 折线跨段插值 progress=5/6 落在第二段内', () => {
  // total = 30, target = 25 -> 第一段耗尽 20，剩余 5 落入第二段(长10) ratio = 0.5
  approxEqualPoint(pointAtProgress(DOGLEG, 5 / 6), { x: 20, y: 5 });
});

test('pointAtProgress 折线插值 progress 恰好落在拐点边界', () => {
  // total = 30, target = 20 -> 恰好等于第一段全长，落在拐点上
  approxEqualPoint(pointAtProgress(DOGLEG, 2 / 3), { x: 20, y: 0 });
});

// ---- happy path 变体：非均匀段长（勾股数） ----

test('pointAtProgress 非均匀段长(勾股数)第一段插值', () => {
  // total = 17, target = 2.5 -> 第一段(长5) 内 ratio = 0.5
  approxEqualPoint(pointAtProgress(PYTHAGOREAN, 2.5 / 17), { x: 1.5, y: 2 });
});

test('pointAtProgress 非均匀段长(勾股数)第二段插值', () => {
  // total = 17, target = 11 -> 第一段耗尽 5，剩余 6 落入第二段(长12) ratio = 0.5
  approxEqualPoint(pointAtProgress(PYTHAGOREAN, 11 / 17), { x: 3, y: 10 });
});

// ---- error_cases ----

test('pointAtProgress 空数组返回 null', () => {
  assert.strictEqual(pointAtProgress([], 0.5), null);
});

test('pointAtProgress 单点数组对任意 progress 均返回该点拷贝', () => {
  for (const progress of [-5, 0, 0.3, 0.7, 1, 5]) {
    const result = pointAtProgress(SINGLE, progress);
    approxEqualPoint(result, { x: 7, y: -3 });
  }
});

test('pointAtProgress progress 为负数时 clamp 到起点', () => {
  approxEqualPoint(pointAtProgress(LINE, -3), { x: 0, y: 0 });
  approxEqualPoint(pointAtProgress(LINE, -0.0001), { x: 0, y: 0 });
  approxEqualPoint(pointAtProgress(DOGLEG, -2), { x: 0, y: 0 });
});

test('pointAtProgress progress 大于 1 时 clamp 到终点', () => {
  approxEqualPoint(pointAtProgress(LINE, 1.5), { x: 20, y: 0 });
  approxEqualPoint(pointAtProgress(LINE, 100), { x: 20, y: 0 });
  approxEqualPoint(pointAtProgress(DOGLEG, 50), { x: 20, y: 10 });
});

test('pointAtProgress 含零长度段-目标点落在零长段之前不受影响', () => {
  // total = 20 (10+0+10), target = 5 -> 落在第一段内 ratio = 0.5
  approxEqualPoint(pointAtProgress(WITH_ZERO_SEGMENT, 0.25), { x: 5, y: 0 });
});

test('pointAtProgress 含零长度段-目标点恰好落在零长段边界不产生NaN', () => {
  // total = 20, target = 10 -> 恰好落在重合点上，无论内部如何处理都不应出现 NaN
  const result = pointAtProgress(WITH_ZERO_SEGMENT, 0.5);
  approxEqualPoint(result, { x: 10, y: 0 });
});

test('pointAtProgress 含零长度段-跳过零长段后继续定位到之后的段', () => {
  // total = 20, target = 15 -> 跳过零长段后落在第三段(长10)内 ratio = 0.5
  approxEqualPoint(pointAtProgress(WITH_ZERO_SEGMENT, 0.75), { x: 15, y: 0 });
});

test('pointAtProgress 所有点重合总弧长为0时返回起点', () => {
  approxEqualPoint(pointAtProgress(ALL_SAME, 0.5), { x: 5, y: 5 });
  approxEqualPoint(pointAtProgress(ALL_SAME, 0.9), { x: 5, y: 5 });
});

// ---- 返回值结构 ----

test('pointAtProgress 返回对象包含数值类型的x和y字段', () => {
  const result = pointAtProgress(DOGLEG, 0.5);
  assert.equal(typeof result.x, 'number');
  assert.equal(typeof result.y, 'number');
  assert.ok(!Number.isNaN(result.x) && !Number.isNaN(result.y));
});

test('pointAtProgress 空输入的返回值严格为null而非undefined或其它假值', () => {
  const result = pointAtProgress([], 0);
  assert.strictEqual(result, null);
  assert.notStrictEqual(result, undefined);
});
