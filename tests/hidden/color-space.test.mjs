import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHex,
  formatHex,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
} from '../../core.mjs';

// ---------- helpers ----------
const EPS = 1e-6;

function approxEqual(actual, expected, epsilon = EPS, label = '') {
  assert.ok(
    typeof actual === 'number' && Number.isFinite(actual),
    `${label}: expected finite number, got ${actual}`
  );
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${label}: expected ${expected}, got ${actual} (diff ${Math.abs(actual - expected)})`
  );
}

function assertRgbClose(actual, expected, tolerance = 1) {
  assert.ok(actual && typeof actual === 'object', 'expected rgb object');
  assert.ok(
    Math.abs(actual.r - expected.r) <= tolerance,
    `r mismatch: got ${actual.r}, expected ${expected.r}`
  );
  assert.ok(
    Math.abs(actual.g - expected.g) <= tolerance,
    `g mismatch: got ${actual.g}, expected ${expected.g}`
  );
  assert.ok(
    Math.abs(actual.b - expected.b) <= tolerance,
    `b mismatch: got ${actual.b}, expected ${expected.b}`
  );
}

// ==================================================================
// parseHex
// ==================================================================

test('parseHex(解析 hex 字符串到 RGB): 6 位标准形式解析为整数 rgb', () => {
  // #003366 → 0x00=0, 0x33=51, 0x66=102
  assert.deepEqual(parseHex('#003366'), { r: 0, g: 51, b: 102 });
  // 项目现有默认色 #ffd60a
  assert.deepEqual(parseHex('#ffd60a'), { r: 255, g: 214, b: 10 });
});

test('parseHex(解析 hex 字符串到 RGB): 3 位速记等价于每位复写', () => {
  // #f0a → #ff00aa → {255, 0, 170}
  assert.deepEqual(parseHex('#f0a'), { r: 255, g: 0, b: 170 });
  // #abc → #aabbcc → {170, 187, 204}
  assert.deepEqual(parseHex('#abc'), { r: 170, g: 187, b: 204 });
});

test('parseHex(解析 hex 字符串到 RGB): 无 # 前缀等价于带 #', () => {
  assert.deepEqual(parseHex('003366'), { r: 0, g: 51, b: 102 });
  assert.deepEqual(parseHex('f0a'), { r: 255, g: 0, b: 170 });
});

test('parseHex(解析 hex 字符串到 RGB): 大小写不敏感', () => {
  assert.deepEqual(parseHex('#FfFfFf'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex('#AbCdEf'), parseHex('#abcdef'));
});

test('parseHex(解析 hex 字符串到 RGB): 纯黑 #000000 → (0,0,0)', () => {
  assert.deepEqual(parseHex('#000000'), { r: 0, g: 0, b: 0 });
});

test('parseHex(解析 hex 字符串到 RGB): 纯白 #ffffff → (255,255,255)', () => {
  assert.deepEqual(parseHex('#ffffff'), { r: 255, g: 255, b: 255 });
});

test('parseHex(解析 hex 字符串到 RGB): 纯红 #ff0000 → (255,0,0)', () => {
  assert.deepEqual(parseHex('#ff0000'), { r: 255, g: 0, b: 0 });
});

test('parseHex(解析 hex 字符串到 RGB): 非 string 输入抛 TypeError', () => {
  assert.throws(() => parseHex(null), TypeError);
  assert.throws(() => parseHex(0x003366), TypeError);
  assert.throws(() => parseHex(undefined), TypeError);
  assert.throws(() => parseHex({ r: 0, g: 51, b: 102 }), TypeError);
});

test('parseHex(解析 hex 字符串到 RGB): 长度非 3/6 抛 RangeError', () => {
  // 长度不合法（去掉 # 后）
  assert.throws(() => parseHex('#12'), RangeError);
  assert.throws(() => parseHex('#12345'), RangeError);
  assert.throws(() => parseHex('#1234567'), RangeError);
  assert.throws(() => parseHex(''), RangeError);
});

test('parseHex(解析 hex 字符串到 RGB): 含非法 hex 字符抛 RangeError', () => {
  assert.throws(() => parseHex('#zzzzzz'), RangeError);
  assert.throws(() => parseHex('#00gg66'), RangeError);
  assert.throws(() => parseHex('#xyz'), RangeError);
});

// ==================================================================
// formatHex
// ==================================================================

test('formatHex(RGB→hex 字符串): 标准输入返回 6 位小写含 # 前缀', () => {
  assert.equal(formatHex(0, 51, 102), '#003366');
  assert.equal(formatHex(255, 214, 10), '#ffd60a');
  assert.equal(formatHex(255, 0, 170), '#ff00aa');
});

test('formatHex(RGB→hex 字符串): clamp 超界 + round 浮点分量', () => {
  // 300 clamp → 255；-10 clamp → 0；128.7 round → 129 = 0x81
  assert.equal(formatHex(300, -10, 128.7), '#ff0081');
});

test('formatHex(RGB→hex 字符串): 边界值 0 与 255', () => {
  assert.equal(formatHex(0, 0, 0), '#000000');
  assert.equal(formatHex(255, 255, 255), '#ffffff');
});

test('formatHex(RGB→hex 字符串): 单分量小于 16 时前导补零', () => {
  // 15 → 0f，1 → 01
  assert.equal(formatHex(15, 1, 0), '#0f0100');
});

test('formatHex(RGB→hex 字符串): 任一分量非 number 抛 TypeError', () => {
  assert.throws(() => formatHex('0', 51, 102), TypeError);
  assert.throws(() => formatHex(0, null, 102), TypeError);
  assert.throws(() => formatHex(0, 51, undefined), TypeError);
});

test('formatHex(RGB→hex 字符串): NaN 或 Infinity 抛 RangeError', () => {
  assert.throws(() => formatHex(NaN, 0, 0), RangeError);
  assert.throws(() => formatHex(0, Infinity, 0), RangeError);
  assert.throws(() => formatHex(0, 0, -Infinity), RangeError);
});

// ==================================================================
// rgbToHsl
// ==================================================================

test('rgbToHsl(RGB→HSL): 锚定值 (0,51,102) → (210,100,20)', () => {
  // 手工验算见 visible 测试注释
  assert.deepEqual(rgbToHsl(0, 51, 102), { h: 210, s: 100, l: 20 });
});

test('rgbToHsl(RGB→HSL): 灰阶 (max===min) h=0 s=0', () => {
  const gray = rgbToHsl(128, 128, 128);
  assert.equal(gray.h, 0);
  assert.equal(gray.s, 0);
  // l = 128/255 * 100 ≈ 50.196 → round 50
  assert.equal(gray.l, 50);
});

test('rgbToHsl(RGB→HSL): 纯黑 → (0,0,0)', () => {
  assert.deepEqual(rgbToHsl(0, 0, 0), { h: 0, s: 0, l: 0 });
});

test('rgbToHsl(RGB→HSL): 纯白 → (0,0,100)', () => {
  assert.deepEqual(rgbToHsl(255, 255, 255), { h: 0, s: 0, l: 100 });
});

test('rgbToHsl(RGB→HSL): 纯红 → (0,100,50)', () => {
  assert.deepEqual(rgbToHsl(255, 0, 0), { h: 0, s: 100, l: 50 });
});

test('rgbToHsl(RGB→HSL): 非有限数抛 RangeError', () => {
  assert.throws(() => rgbToHsl(NaN, 0, 0), RangeError);
  assert.throws(() => rgbToHsl(0, Infinity, 0), RangeError);
  assert.throws(() => rgbToHsl(0, 0, -Infinity), RangeError);
});

// ==================================================================
// hslToRgb
// ==================================================================

test('hslToRgb(HSL→RGB): 锚定值 (210,100,20) → (0,51,102)', () => {
  // 手工验算：l<0.5, q=l*(1+s)=0.4, p=2l-q=0；
  // tr=h+1/3=0.917 → p=0；tg=0.583 → p+(q-p)*(2/3-t)*6 = 0.4*0.5=0.2 → 51；
  // tb=0.25 → q=0.4 → 102。
  assert.deepEqual(hslToRgb(210, 100, 20), { r: 0, g: 51, b: 102 });
});

test('hslToRgb(HSL→RGB): h 超出范围内部 mod 归一', () => {
  // 720 mod 360 = 0，故 (720,50,50) 与 (0,50,50) 等价
  assert.deepEqual(hslToRgb(720, 50, 50), hslToRgb(0, 50, 50));
  // 负数也应归一（-360 ≡ 0）
  assert.deepEqual(hslToRgb(-360, 100, 50), hslToRgb(0, 100, 50));
  // 非整数倍 360 的负数归一：-90 ≡ 270（防止实现用 `h % 360` 而未加 `+360` 修正）
  assert.deepEqual(hslToRgb(-90, 100, 50), hslToRgb(270, 100, 50));
  // -180 ≡ 180
  assert.deepEqual(hslToRgb(-180, 100, 50), hslToRgb(180, 100, 50));
});

test('hslToRgb(HSL→RGB): s/l 超出 [0,100] 内部 clamp', () => {
  // s clamp
  assert.deepEqual(hslToRgb(0, 150, 50), hslToRgb(0, 100, 50));
  // l clamp
  assert.deepEqual(hslToRgb(0, 100, 150), hslToRgb(0, 100, 100));
  assert.deepEqual(hslToRgb(0, 100, -20), hslToRgb(0, 100, 0));
});

test('hslToRgb(HSL→RGB): 纯红 (0,100,50) → (255,0,0)', () => {
  assert.deepEqual(hslToRgb(0, 100, 50), { r: 255, g: 0, b: 0 });
});

test('hslToRgb(HSL→RGB): l=0 → 纯黑, l=100 → 纯白', () => {
  assert.deepEqual(hslToRgb(180, 50, 0), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hslToRgb(180, 50, 100), { r: 255, g: 255, b: 255 });
});

test('hslToRgb(HSL→RGB): 非有限数抛 RangeError', () => {
  assert.throws(() => hslToRgb(NaN, 50, 50), RangeError);
  assert.throws(() => hslToRgb(0, Infinity, 50), RangeError);
  assert.throws(() => hslToRgb(0, 50, -Infinity), RangeError);
});

// ==================================================================
// rgbToHsv
// ==================================================================

test('rgbToHsv(RGB→HSV): 锚定值 (0,51,102) → (h=210, s=1, v=0.4)', () => {
  // 手工验算：max=0.4, min=0, delta=0.4；v=max=0.4；s=delta/max=1；
  // max=b → h = ((r-g)/delta + 4) * 60 = 210
  const hsv = rgbToHsv(0, 51, 102);
  approxEqual(hsv.h, 210, 1e-6, 'h');
  approxEqual(hsv.s, 1, 1e-6, 's');
  approxEqual(hsv.v, 102 / 255, 1e-6, 'v');
});

test('rgbToHsv(RGB→HSV): 输出不 round，返回连续浮点', () => {
  // rgbToHsv(128, 64, 32): v = 128/255 ≈ 0.501961（明显非整数），s = 0.75
  const hsv = rgbToHsv(128, 64, 32);
  approxEqual(hsv.v, 128 / 255, 1e-6, 'v');
  approxEqual(hsv.s, 0.75, 1e-6, 's');
  // 显式确认 v 不是整数（未 round 到 0 或 1，也未 round 到两位小数如 0.5）
  assert.ok(Math.abs(hsv.v - 0.5) > 1e-6, `v should not be rounded to 0.5, got ${hsv.v}`);
  assert.ok(hsv.v !== Math.round(hsv.v), `v should not be an integer, got ${hsv.v}`);
});

test('rgbToHsv(RGB→HSV): 灰阶 h=0 s=0', () => {
  const hsv = rgbToHsv(128, 128, 128);
  approxEqual(hsv.h, 0, 1e-6, 'h');
  approxEqual(hsv.s, 0, 1e-6, 's');
  approxEqual(hsv.v, 128 / 255, 1e-6, 'v');
});

test('rgbToHsv(RGB→HSV): 纯黑 → h=0,s=0,v=0', () => {
  const hsv = rgbToHsv(0, 0, 0);
  approxEqual(hsv.h, 0, 1e-6, 'h');
  approxEqual(hsv.s, 0, 1e-6, 's');
  approxEqual(hsv.v, 0, 1e-6, 'v');
});

test('rgbToHsv(RGB→HSV): 纯红 → h=0,s=1,v=1', () => {
  const hsv = rgbToHsv(255, 0, 0);
  approxEqual(hsv.h, 0, 1e-6, 'h');
  approxEqual(hsv.s, 1, 1e-6, 's');
  approxEqual(hsv.v, 1, 1e-6, 'v');
});

test('rgbToHsv(RGB→HSV): 非有限数抛 RangeError', () => {
  assert.throws(() => rgbToHsv(NaN, 0, 0), RangeError);
  assert.throws(() => rgbToHsv(0, Infinity, 0), RangeError);
  assert.throws(() => rgbToHsv(0, 0, -Infinity), RangeError);
});

// ==================================================================
// hsvToRgb
// ==================================================================

test('hsvToRgb(HSV→RGB): 锚定值 (210, 1, 0.4) → (0,51,102)', () => {
  // rgbToHsv(0,51,102) 的逆
  const rgb = hsvToRgb(210, 1, 102 / 255);
  assertRgbClose(rgb, { r: 0, g: 51, b: 102 }, 1);
});

test('hsvToRgb(HSV→RGB): h 超出范围内部 mod 归一', () => {
  // 720 mod 360 = 0
  assert.deepEqual(hsvToRgb(720, 1, 1), hsvToRgb(0, 1, 1));
  assert.deepEqual(hsvToRgb(-360, 1, 1), hsvToRgb(0, 1, 1));
  // 非整数倍 360 的负数归一：-90 ≡ 270（防止实现用 `h % 360` 而未加 `+360` 修正）
  assert.deepEqual(hsvToRgb(-90, 1, 1), hsvToRgb(270, 1, 1));
  // -180 ≡ 180
  assert.deepEqual(hsvToRgb(-180, 1, 1), hsvToRgb(180, 1, 1));
});

test('hsvToRgb(HSV→RGB): s/v 超出 [0,1] 内部 clamp', () => {
  assert.deepEqual(hsvToRgb(0, 1.5, 1), hsvToRgb(0, 1, 1));
  assert.deepEqual(hsvToRgb(0, 1, 1.5), hsvToRgb(0, 1, 1));
  assert.deepEqual(hsvToRgb(0, -0.5, 1), hsvToRgb(0, 0, 1));
  assert.deepEqual(hsvToRgb(0, 1, -0.5), hsvToRgb(0, 1, 0));
});

test('hsvToRgb(HSV→RGB): 三原色锚定', () => {
  assert.deepEqual(hsvToRgb(0, 1, 1), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hsvToRgb(120, 1, 1), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hsvToRgb(240, 1, 1), { r: 0, g: 0, b: 255 });
});

test('hsvToRgb(HSV→RGB): v=0 → 纯黑, s=0 v=1 → 纯白', () => {
  assert.deepEqual(hsvToRgb(180, 1, 0), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hsvToRgb(180, 0, 1), { r: 255, g: 255, b: 255 });
});

test('hsvToRgb(HSV→RGB): 非有限数抛 RangeError', () => {
  assert.throws(() => hsvToRgb(NaN, 1, 1), RangeError);
  assert.throws(() => hsvToRgb(0, Infinity, 1), RangeError);
  assert.throws(() => hsvToRgb(0, 1, -Infinity), RangeError);
});

// ==================================================================
// 往返一致性（round-trip）
// ==================================================================

test('往返一致性: parseHex → formatHex 无损（6 位小写标准形式）', () => {
  const cases = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
                 '#003366', '#ffd60a', '#0a84ff', '#ff00aa', '#abcdef'];
  for (const hex of cases) {
    const rgb = parseHex(hex);
    const back = formatHex(rgb.r, rgb.g, rgb.b);
    assert.equal(back, hex, `round-trip failed for ${hex}, got ${back}`);
  }
});

test('往返一致性: RGB → rgbToHsl → hslToRgb 截尾误差 ≤ 2', () => {
  // 容差 2：rgbToHsl 输出 h/s/l 已 round 到整数（spec 要求），
  // 反向后累计误差理论上限约 ±2（如 rgb(128,64,32) → HSL(20,60,31) → r=126）。
  const cases = [
    { r: 0, g: 51, b: 102 },
    { r: 255, g: 214, b: 10 },
    { r: 10, g: 132, b: 255 },
    { r: 255, g: 0, b: 170 },
    { r: 128, g: 64, b: 32 },
    { r: 200, g: 150, b: 100 },
    { r: 12, g: 34, b: 56 },
  ];
  for (const c of cases) {
    const hsl = rgbToHsl(c.r, c.g, c.b);
    const back = hslToRgb(hsl.h, hsl.s, hsl.l);
    assertRgbClose(back, c, 2);
  }
});

test('往返一致性: RGB → rgbToHsv → hsvToRgb 截尾误差 ≤ 1', () => {
  const cases = [
    { r: 0, g: 51, b: 102 },
    { r: 255, g: 214, b: 10 },
    { r: 10, g: 132, b: 255 },
    { r: 255, g: 0, b: 170 },
    { r: 128, g: 64, b: 32 },
    { r: 200, g: 150, b: 100 },
    { r: 12, g: 34, b: 56 },
  ];
  for (const c of cases) {
    const hsv = rgbToHsv(c.r, c.g, c.b);
    const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
    assertRgbClose(back, c, 1);
  }
});
