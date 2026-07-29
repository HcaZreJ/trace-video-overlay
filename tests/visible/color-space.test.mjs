import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHex, rgbToHsl } from '../../src/core/color.mjs';

// Visible samples：给实现 agent 用于 sanity-check 的锚定示例，
// 覆盖 parseHex 主路径、rgbToHsl 手工验算锚定值，以及 parseHex 的 TypeError 分支。

test('parseHex(解析 hex 字符串到 RGB): 标准 6 位小写返回整数 rgb 对象', () => {
  // 手工验算：#003366 → r=0x00=0, g=0x33=51, b=0x66=102
  const result = parseHex('#003366');
  assert.deepEqual(result, { r: 0, g: 51, b: 102 });
});

test('rgbToHsl(RGB→HSL): (0,51,102) 的锚定值为 (210,100,20)', () => {
  // 手工验算：r=0, g=0.2, b=0.4
  //   max=0.4, min=0, l=0.2 → 20
  //   delta=0.4, l<0.5 → s = delta/(max+min) = 1 → 100
  //   max=b → h = ((r-g)/delta + 4) * 60 = ((-0.5)+4)*60 = 210
  const result = rgbToHsl(0, 51, 102);
  assert.equal(result.h, 210);
  assert.equal(result.s, 100);
  assert.equal(result.l, 20);
});

test('parseHex(解析 hex 字符串到 RGB): 非 string 输入抛 TypeError', () => {
  assert.throws(() => parseHex(null), TypeError);
});
