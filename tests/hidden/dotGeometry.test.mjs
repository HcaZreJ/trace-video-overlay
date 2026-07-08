import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotGeometry } from '../../core.mjs';

/**
 * 按 spec 公式计算 size 对应的期望几何字段：
 * coreR=size/2；ringW=size*0.15；outerR=coreR+ringW；shadowBlur=size*0.104；
 * shadowOffsetY=size*0.026；pad=ceil(size*0.26)；full=size+2*pad。
 */
function expectedGeometry(size) {
  const coreR = size / 2;
  const ringW = size * 0.15;
  const outerR = coreR + ringW;
  const shadowBlur = size * 0.104;
  const shadowOffsetY = size * 0.026;
  const pad = Math.ceil(size * 0.26);
  const full = size + 2 * pad;
  return { coreR, ringW, outerR, shadowBlur, shadowOffsetY, pad, full };
}

/** 断言 actual 的每个数值字段与 expected 在容差内相等，pad 为精确整数比较。 */
function assertGeometryMatches(actual, expected, epsilon = 1e-9) {
  for (const key of ['coreR', 'ringW', 'outerR', 'shadowBlur', 'shadowOffsetY', 'full']) {
    assert.equal(typeof actual[key], 'number', `${key} must be a number, got ${typeof actual[key]}`);
    assert.ok(Number.isFinite(actual[key]), `${key} must be finite, got ${actual[key]}`);
    assert.ok(
      Math.abs(actual[key] - expected[key]) < epsilon,
      `${key} mismatch: got ${actual[key]}, expected ${expected[key]}`
    );
  }
  assert.equal(typeof actual.pad, 'number', 'pad must be a number');
  assert.equal(actual.pad, expected.pad, `pad mismatch: got ${actual.pad}, expected ${expected.pad}`);
}

// ---------------------------------------------------------------------------
// 正常路径：多种 size 下，全部字段按公式精确计算
// ---------------------------------------------------------------------------

const HAPPY_SIZES = [10, 20, 1, 100, 7.5, 0.001, 1e6, 3];

for (const size of HAPPY_SIZES) {
  test(`dotGeometry size=${size} 返回按公式精确计算的全部字段`, () => {
    const g = dotGeometry(size);
    assertGeometryMatches(g, expectedGeometry(size));
  });
}

// ---------------------------------------------------------------------------
// 结构性关系：outerR = coreR + ringW 恒成立（跨多种 size）
// ---------------------------------------------------------------------------

for (const size of [1, 5, 12.34, 500]) {
  test(`dotGeometry size=${size} 满足 outerR = coreR + ringW`, () => {
    const g = dotGeometry(size);
    assert.ok(
      Math.abs(g.outerR - (g.coreR + g.ringW)) < 1e-9,
      `outerR (${g.outerR}) must equal coreR (${g.coreR}) + ringW (${g.ringW})`
    );
  });
}

// ---------------------------------------------------------------------------
// 不变量：full >= 2*outerR + shadowBlur 恒成立
// ---------------------------------------------------------------------------

for (const size of [0.5, 1, 5, 10, 20, 100, 999, 1e6]) {
  test(`dotGeometry size=${size} 满足不变量 full >= 2*outerR + shadowBlur`, () => {
    const g = dotGeometry(size);
    assert.ok(
      g.full >= 2 * g.outerR + g.shadowBlur - 1e-9,
      `invariant violated for size=${size}: full=${g.full}, 2*outerR+shadowBlur=${2 * g.outerR + g.shadowBlur}`
    );
  });
}

// ---------------------------------------------------------------------------
// pad 的 ceil 语义：非整数中间值应向上取整
// ---------------------------------------------------------------------------

test('dotGeometry pad 对 size*0.26 的非整数结果向上取整', () => {
  // size=10 -> size*0.26 = 2.6 -> ceil = 3（非精确落在整数上）
  const g = dotGeometry(10);
  assert.equal(g.pad, 3);
});

test('dotGeometry pad 对不同 size 的 ceil 结果与 Math.ceil(size*0.26) 一致', () => {
  for (const size of [3, 15, 33, 77.7]) {
    const g = dotGeometry(size);
    assert.equal(g.pad, Math.ceil(size * 0.26), `pad mismatch for size=${size}`);
  }
});

// ---------------------------------------------------------------------------
// 全部字段均为 number 类型，且 full/pad 存在
// ---------------------------------------------------------------------------

test('dotGeometry 返回对象的每个必需字段都是有限 number', () => {
  const g = dotGeometry(42);
  for (const key of ['coreR', 'ringW', 'outerR', 'pad', 'full', 'shadowBlur', 'shadowOffsetY']) {
    assert.equal(typeof g[key], 'number', `${key} must be a number`);
    assert.ok(Number.isFinite(g[key]), `${key} must be finite`);
  }
});

// ---------------------------------------------------------------------------
// 确定性：相同输入多次调用结果一致
// ---------------------------------------------------------------------------

test('dotGeometry 相同 size 多次调用返回一致结果（确定性）', () => {
  const first = dotGeometry(15);
  const second = dotGeometry(15);
  assert.deepEqual(second, first);
});

test('dotGeometry 交替调用不同 size 互不影响（无共享状态）', () => {
  const a1 = dotGeometry(10);
  const b = dotGeometry(50);
  const a2 = dotGeometry(10);
  assert.deepEqual(a2, a1, 'interleaved call with a different size must not affect prior result');
  assert.notDeepEqual(b, a1);
});

// ---------------------------------------------------------------------------
// 错误路径：size 非 number / NaN / Infinity / -Infinity / 0 / 负数
// ---------------------------------------------------------------------------

const INVALID_SIZES = [
  { name: 'NaN', value: NaN },
  { name: 'Infinity', value: Infinity },
  { name: '-Infinity', value: -Infinity },
  { name: '0', value: 0 },
  { name: '负数 (-5)', value: -5 },
  { name: '负小数 (-0.001)', value: -0.001 },
  { name: '字符串 "10"', value: '10' },
  { name: 'null', value: null },
  { name: 'undefined', value: undefined },
  { name: '空对象', value: {} },
  { name: '空数组', value: [] },
  { name: '布尔值 true', value: true },
  { name: '函数', value: () => {} },
];

for (const { name, value } of INVALID_SIZES) {
  test(`dotGeometry size 非法输入抛出 RangeError - ${name}`, () => {
    assert.throws(
      () => dotGeometry(value),
      (err) => {
        assert.ok(err instanceof RangeError, `expected RangeError, got ${err && err.constructor && err.constructor.name}`);
        assert.ok(
          typeof err.message === 'string' && err.message.includes('dotGeometry'),
          `expected error message to mention 'dotGeometry', got: ${err.message}`
        );
        return true;
      }
    );
  });
}
