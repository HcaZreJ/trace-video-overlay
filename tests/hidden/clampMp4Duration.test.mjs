import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampMp4Duration } from '../../core.mjs';

// ---------------------------------------------------------------------------
// 区间内数值：原样返回，不做步进取整
// ---------------------------------------------------------------------------

const IN_RANGE_CASES = [
  { input: 6, expected: 6 },
  { input: 1, expected: 1 },
  { input: 60, expected: 60 },
  { input: 7.5, expected: 7.5 },
  { input: 1.0001, expected: 1.0001 },
  { input: 59.9999, expected: 59.9999 },
  { input: 30, expected: 30 },
];

for (const { input, expected } of IN_RANGE_CASES) {
  test(`clampMp4Duration 区间内数值 ${input} 原样返回`, () => {
    assert.equal(clampMp4Duration(input), expected);
  });
}

// ---------------------------------------------------------------------------
// 超出 [1,60] 区间的有限数值：clamp 到最近边界
// ---------------------------------------------------------------------------

const OUT_OF_RANGE_CASES = [
  { input: 0.5, expected: 1 },
  { input: 0, expected: 1 },
  { input: -10, expected: 1 },
  { input: -0.0001, expected: 1 },
  { input: 999, expected: 60 },
  { input: 60.0001, expected: 60 },
  { input: 61, expected: 60 },
  { input: Number.MAX_SAFE_INTEGER, expected: 60 },
];

for (const { input, expected } of OUT_OF_RANGE_CASES) {
  test(`clampMp4Duration 超出区间的数值 ${input} 被 clamp 到 ${expected}`, () => {
    assert.equal(clampMp4Duration(input), expected);
  });
}

// ---------------------------------------------------------------------------
// 非有限数字 / 非 number 类型：一律返回默认值 6，且不抛错
// ---------------------------------------------------------------------------

const DEFAULT_CASES = [
  { name: 'NaN', value: NaN },
  { name: 'Infinity', value: Infinity },
  { name: '-Infinity', value: -Infinity },
  { name: '数字字符串 "6"', value: '6' },
  { name: '数字字符串 "30"', value: '30' },
  { name: 'undefined', value: undefined },
  { name: 'null', value: null },
  { name: '空对象', value: {} },
  { name: '空数组', value: [] },
  { name: '含数字的数组 [30]', value: [30] },
  { name: '布尔值 true', value: true },
  { name: '布尔值 false', value: false },
  { name: '函数', value: () => {} },
];

for (const { name, value } of DEFAULT_CASES) {
  test(`clampMp4Duration 非法/非数字输入返回默认值 6 - ${name}`, () => {
    assert.equal(clampMp4Duration(value), 6);
  });
}

test('clampMp4Duration 无参数调用（undefined）返回默认值 6', () => {
  assert.equal(clampMp4Duration(), 6);
});

// ---------------------------------------------------------------------------
// 全输入域有定义：不抛出任何异常
// ---------------------------------------------------------------------------

const ALL_INPUTS_NO_THROW = [6, 0.5, 999, 1, 60, NaN, Infinity, -Infinity, '6', undefined, null, {}, [], true, false];

for (const value of ALL_INPUTS_NO_THROW) {
  test(`clampMp4Duration 不对输入 ${String(value)} 抛出异常`, () => {
    assert.doesNotThrow(() => clampMp4Duration(value));
  });
}

// ---------------------------------------------------------------------------
// 确定性：相同输入多次调用结果一致
// ---------------------------------------------------------------------------

test('clampMp4Duration 相同输入多次调用返回一致结果（确定性）', () => {
  assert.equal(clampMp4Duration(15), clampMp4Duration(15));
  assert.equal(clampMp4Duration('bad'), clampMp4Duration('bad'));
});

// ---------------------------------------------------------------------------
// 返回类型：始终是 number
// ---------------------------------------------------------------------------

test('clampMp4Duration 返回值始终是 number 类型', () => {
  for (const value of [6, 999, NaN, '6', undefined, null, {}]) {
    assert.equal(typeof clampMp4Duration(value), 'number');
  }
});
