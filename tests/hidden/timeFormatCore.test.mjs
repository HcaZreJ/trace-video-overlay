// timeFormatCore · 本地时刻格式化与分段起点提取（hidden 全面用例）
//
// 时区约定：所有时刻由 `new Date(年, 月索引, 日, 时, 分, 秒[, 毫秒])` 构造，
// 它落在测试机的本地时区上；被测函数也按本地分量输出/解释。两端用同一套本地分量，
// 断言因而与测试机时区无关，也不含任何带时区含义的字面串（无 Z、无偏移量）。
// 往返用例的时间戳一律由本地分量构造，使 DST 折返小时里的实例化结果保持自洽。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  toLocalInputValue,
  parseLocalInputValue,
  formatLocalHms,
  formatLocalIso,
} from '../../src/core/time-format.mjs';
import { segmentStartIndices, concatTrackPoints } from '../../src/core/track-files.mjs';
import { ROOT } from '../helpers/source.mjs';

/** 把任意值渲染成断言消息里可读的标签。 */
function label(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[]';
  if (value !== null && typeof value === 'object') return '{}';
  return String(value);
}

/** 格式化函数在非有限数入参下应当返回 '' 的取值集合。 */
const NON_FINITE_INPUTS = [
  NaN,
  Infinity,
  -Infinity,
  undefined,
  null,
  '2024-01-05T09:07:03',
  '1704409623000',
  {},
  [],
  true,
];

// ---------------------------------------------------------------- toLocalInputValue

const PAD_CASES = [
  // [年, 月索引, 日, 时, 分, 秒, 期望串]
  [2024, 0, 5, 9, 7, 3, '2024-01-05T09:07:03'], // 月/日/时/分/秒全为个位数
  [2024, 8, 9, 8, 5, 6, '2024-09-09T08:05:06'], // 月份 9 仍要补零
  [2024, 11, 25, 14, 30, 59, '2024-12-25T14:30:59'], // 两位分量原样输出
  [2024, 1, 29, 12, 0, 0, '2024-02-29T12:00:00'], // 闰年 2 月 29 日
  [2023, 11, 31, 23, 59, 59, '2023-12-31T23:59:59'], // 年末
  [1970, 0, 1, 12, 0, 0, '1970-01-01T12:00:00'], // 四位年份
  [2100, 5, 1, 6, 8, 9, '2100-06-01T06:08:09'], // 未来年份
];

for (const [y, mo, d, h, mi, s, expected] of PAD_CASES) {
  test(`timeFormatCore · toLocalInputValue 补零输出 ${expected}`, () => {
    const ms = new Date(y, mo, d, h, mi, s).getTime();
    assert.equal(toLocalInputValue(ms), expected);
  });
}

test('timeFormatCore · toLocalInputValue 丢弃毫秒部分，秒位无小数', () => {
  const ms = new Date(2024, 0, 5, 9, 7, 3, 456).getTime();
  assert.equal(toLocalInputValue(ms), '2024-01-05T09:07:03');

  const ms999 = new Date(2024, 0, 5, 9, 7, 3, 999).getTime();
  assert.equal(toLocalInputValue(ms999), '2024-01-05T09:07:03');
});

test('timeFormatCore · toLocalInputValue 对负 epoch（1970 之前）仍输出本地分量', () => {
  const ms = new Date(1969, 6, 20, 12, 34, 56).getTime();
  assert.equal(toLocalInputValue(ms), '1969-07-20T12:34:56');
});

test('timeFormatCore · toLocalInputValue 的输出严格匹配 YYYY-MM-DDTHH:mm:ss 且不带时区后缀', () => {
  const ms = new Date(2024, 2, 4, 5, 6, 7).getTime();
  const out = toLocalInputValue(ms);
  assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(out.length, 19);
  assert.equal(out.includes('Z'), false);
  assert.equal(out.includes('+'), false);
});

test('timeFormatCore · toLocalInputValue 对非有限数入参返回空串', () => {
  for (const bad of NON_FINITE_INPUTS) {
    assert.equal(toLocalInputValue(bad), '', `入参 ${label(bad)}`);
  }
});

// ---------------------------------------------------------------- parseLocalInputValue

test('timeFormatCore · parseLocalInputValue 分钟精度形态，秒与毫秒按 0', () => {
  assert.equal(
    parseLocalInputValue('2024-01-05T09:07'),
    new Date(2024, 0, 5, 9, 7, 0, 0).getTime(),
  );
});

test('timeFormatCore · parseLocalInputValue 秒精度形态，毫秒按 0', () => {
  assert.equal(
    parseLocalInputValue('2024-01-05T09:07:03'),
    new Date(2024, 0, 5, 9, 7, 3, 0).getTime(),
  );
});

test('timeFormatCore · parseLocalInputValue 毫秒精度形态', () => {
  assert.equal(
    parseLocalInputValue('2024-01-05T09:07:03.456'),
    new Date(2024, 0, 5, 9, 7, 3, 456).getTime(),
  );
});

test('timeFormatCore · parseLocalInputValue 的毫秒段不足三位按右补零', () => {
  const base = new Date(2024, 0, 5, 9, 7, 3, 0).getTime();
  assert.equal(parseLocalInputValue('2024-01-05T09:07:03.5'), base + 500, '.5 → 500 毫秒');
  assert.equal(parseLocalInputValue('2024-01-05T09:07:03.05'), base + 50, '.05 → 50 毫秒');
  assert.equal(parseLocalInputValue('2024-01-05T09:07:03.005'), base + 5, '.005 → 5 毫秒');
  assert.equal(parseLocalInputValue('2024-01-05T09:07:03.000'), base, '.000 → 0 毫秒');
});

test('timeFormatCore · parseLocalInputValue 容忍首尾空白', () => {
  const expected = new Date(2024, 0, 5, 9, 7, 3, 0).getTime();
  assert.equal(parseLocalInputValue('  2024-01-05T09:07:03'), expected);
  assert.equal(parseLocalInputValue('2024-01-05T09:07:03   '), expected);
  assert.equal(parseLocalInputValue('\t 2024-01-05T09:07:03 \n'), expected);
  assert.equal(
    parseLocalInputValue('  2024-01-05T09:07  '),
    new Date(2024, 0, 5, 9, 7, 0, 0).getTime(),
    '分钟精度形态同样容忍空白',
  );
});

test('timeFormatCore · parseLocalInputValue 跨日期边界与闰日的解析', () => {
  assert.equal(
    parseLocalInputValue('2024-02-29T23:59:59'),
    new Date(2024, 1, 29, 23, 59, 59, 0).getTime(),
    '闰年 2 月 29 日',
  );
  assert.equal(
    parseLocalInputValue('2023-12-31T00:00'),
    new Date(2023, 11, 31, 0, 0, 0, 0).getTime(),
    '年末零点',
  );
  assert.equal(
    parseLocalInputValue('2024-01-01T00:00:00.000'),
    new Date(2024, 0, 1, 0, 0, 0, 0).getTime(),
    '年初零点',
  );
});

const MALFORMED_TEXTS = [
  '',
  '   ',
  'not-a-time',
  '2024-01-05',
  '09:07:03',
  '2024-01-05T09',
  '2024/01/05T09:07',
  'T09:07',
  '2024-01-05T09:07:03.456Z',
  '2024-01-05T09:07:03+08:00',
  'abcd-ef-ghTij:kl',
];

test('timeFormatCore · parseLocalInputValue 对格式不匹配的字符串返回 NaN', () => {
  for (const text of MALFORMED_TEXTS) {
    const got = parseLocalInputValue(text);
    assert.equal(Number.isNaN(got), true, `入参 ${label(text)} 期望 NaN，实得 ${got}`);
  }
});

test('timeFormatCore · parseLocalInputValue 对非字符串入参返回 NaN', () => {
  const badInputs = [null, undefined, 0, 1704409623000, NaN, {}, [], true, new Date()];
  for (const bad of badInputs) {
    const got = parseLocalInputValue(bad);
    assert.equal(Number.isNaN(got), true, `入参 ${label(bad)} 期望 NaN，实得 ${got}`);
  }
});

test('timeFormatCore · parseLocalInputValue 对形态正确但数值越界的串返回有限数（交给 Date 归一化）', () => {
  for (const text of ['2024-13-45T99:99', '2024-02-30T25:61:61', '2024-00-00T00:00']) {
    const got = parseLocalInputValue(text);
    assert.equal(Number.isFinite(got), true, `入参 ${label(text)} 期望有限数，实得 ${got}`);
  }
});

// ---------------------------------------------------------------- 往返一致

const ROUND_TRIP_CASES = [
  ['年初', [2024, 0, 1, 12, 0, 0]],
  ['年末', [2023, 11, 31, 23, 59, 59]],
  ['闰年 2 月 29 日', [2024, 1, 29, 12, 30, 15]],
  ['世纪闰年 2 月 29 日', [2000, 1, 29, 10, 0, 0]],
  ['月末跨月', [2024, 4, 31, 21, 45, 1]],
  ['年中', [2024, 6, 15, 8, 30, 45]],
  ['1970 之前', [1969, 6, 20, 12, 34, 56]],
];

for (const [name, parts] of ROUND_TRIP_CASES) {
  test(`timeFormatCore · toLocalInputValue → parseLocalInputValue 往返一致 · ${name}`, () => {
    const ms = new Date(...parts).getTime();
    assert.equal(parseLocalInputValue(toLocalInputValue(ms)), ms);
  });
}

test('timeFormatCore · 往返在整分钟与整点上同样精确', () => {
  for (const parts of [[2024, 3, 18, 13, 0, 0], [2024, 9, 7, 9, 15, 0], [2024, 7, 1, 0, 0, 0]]) {
    const ms = new Date(...parts).getTime();
    assert.equal(parseLocalInputValue(toLocalInputValue(ms)), ms, `分量 ${parts.join(',')}`);
  }
});

// ---------------------------------------------------------------- formatLocalHms

test('timeFormatCore · formatLocalHms 输出 HH:MM:SS 并补零', () => {
  assert.equal(formatLocalHms(new Date(2024, 0, 5, 9, 7, 3).getTime()), '09:07:03');
  assert.equal(formatLocalHms(new Date(2024, 5, 1, 0, 0, 0).getTime()), '00:00:00');
  assert.equal(formatLocalHms(new Date(2024, 5, 1, 23, 59, 59).getTime()), '23:59:59');
  assert.equal(formatLocalHms(new Date(2024, 5, 1, 7, 0, 8).getTime()), '07:00:08');
});

test('timeFormatCore · formatLocalHms 的输出恒为 8 字符且只含数字与冒号', () => {
  for (const parts of [[2024, 0, 5, 9, 7, 3], [2024, 11, 25, 14, 30, 59], [1969, 6, 20, 12, 34, 56]]) {
    const out = formatLocalHms(new Date(...parts).getTime());
    assert.match(out, /^\d{2}:\d{2}:\d{2}$/, `分量 ${parts.join(',')}`);
    assert.equal(out.length, 8);
  }
});

test('timeFormatCore · formatLocalHms 忽略毫秒', () => {
  assert.equal(formatLocalHms(new Date(2024, 0, 5, 9, 7, 3, 789).getTime()), '09:07:03');
});

test('timeFormatCore · formatLocalHms 对非有限数入参返回空串', () => {
  for (const bad of NON_FINITE_INPUTS) {
    assert.equal(formatLocalHms(bad), '', `入参 ${label(bad)}`);
  }
});

// ---------------------------------------------------------------- formatLocalIso

test('timeFormatCore · formatLocalIso 输出 YYYY-MM-DD HH:MM:SS（一个空格、无 T、无时区后缀）', () => {
  const out = formatLocalIso(new Date(2024, 0, 5, 9, 7, 3).getTime());
  assert.equal(out, '2024-01-05 09:07:03');
  assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(out.includes('T'), false);
  assert.equal(out.includes('Z'), false);
  assert.equal(out.includes('+'), false);
  assert.equal(out.split(' ').length, 2, '日期与时刻之间恰好一个空格');
  assert.equal(out.length, 19);
});

test('timeFormatCore · formatLocalIso 的补零与边界时刻', () => {
  assert.equal(formatLocalIso(new Date(2024, 8, 9, 8, 5, 6).getTime()), '2024-09-09 08:05:06');
  assert.equal(formatLocalIso(new Date(2023, 11, 31, 23, 59, 59).getTime()), '2023-12-31 23:59:59');
  assert.equal(formatLocalIso(new Date(2024, 1, 29, 0, 0, 0).getTime()), '2024-02-29 00:00:00');
  assert.equal(formatLocalIso(new Date(2024, 0, 5, 9, 7, 3, 456).getTime()), '2024-01-05 09:07:03');
});

test('timeFormatCore · formatLocalIso 对非有限数入参返回空串', () => {
  for (const bad of NON_FINITE_INPUTS) {
    assert.equal(formatLocalIso(bad), '', `入参 ${label(bad)}`);
  }
});

test('timeFormatCore · 三个格式化函数对同一时刻自洽（iso = input 换空格，hms = iso 的时刻段）', () => {
  const samples = [
    [2024, 0, 5, 9, 7, 3],
    [2024, 6, 15, 8, 30, 45],
    [2023, 11, 31, 23, 59, 59],
    [2024, 1, 29, 0, 0, 0],
  ];
  for (const parts of samples) {
    const ms = new Date(...parts).getTime();
    const input = toLocalInputValue(ms);
    const iso = formatLocalIso(ms);
    const hms = formatLocalHms(ms);
    assert.equal(iso, input.replace('T', ' '), `分量 ${parts.join(',')}`);
    assert.equal(hms, iso.slice(11), `分量 ${parts.join(',')}`);
  }
});

// ---------------------------------------------------------------- segmentStartIndices

function pointsOf(count, base) {
  return Array.from({ length: count }, (_, i) => ({ lat: base + i, lon: base * 10 + i }));
}

test('timeFormatCore · segmentStartIndices 累计三段不等长的起始索引', () => {
  const files = [
    { name: 'a.gpx', format: 'gpx', points: pointsOf(3, 1) },
    { name: 'b.gpx', format: 'gpx', points: pointsOf(2, 4) },
    { name: 'c.gpx', format: 'gpx', points: pointsOf(4, 6) },
  ];
  assert.deepEqual(segmentStartIndices(files), [0, 3, 5]);
});

test('timeFormatCore · segmentStartIndices 单段返回 [0]，空数组返回 []', () => {
  assert.deepEqual(segmentStartIndices([{ name: 'a.gpx', format: 'gpx', points: pointsOf(7, 1) }]), [0]);
  assert.deepEqual(segmentStartIndices([]), []);
});

test('timeFormatCore · segmentStartIndices 输出长度恒等于段数', () => {
  const files = [
    { name: 'a', format: 'gpx', points: pointsOf(1, 1) },
    { name: 'b', format: 'gpx', points: pointsOf(5, 2) },
    { name: 'c', format: 'gpx', points: pointsOf(2, 3) },
    { name: 'd', format: 'gpx', points: pointsOf(9, 4) },
    { name: 'e', format: 'gpx', points: pointsOf(3, 5) },
  ];
  const starts = segmentStartIndices(files);
  assert.equal(starts.length, files.length);
  assert.deepEqual(starts, [0, 1, 6, 8, 17]);
});

test('timeFormatCore · segmentStartIndices 对空 points 段按 0 点计，该段仍占索引位', () => {
  const files = [
    { name: 'a', format: 'gpx', points: [] },
    { name: 'b', format: 'gpx', points: pointsOf(2, 1) },
    { name: 'c', format: 'gpx', points: [] },
    { name: 'd', format: 'gpx', points: pointsOf(3, 5) },
  ];
  assert.deepEqual(segmentStartIndices(files), [0, 0, 2, 2]);
});

test('timeFormatCore · segmentStartIndices 对缺 points 或 points 非数组的段按 0 点计', () => {
  const files = [
    { name: 'a', format: 'gpx', points: pointsOf(2, 1) },
    { name: 'b', format: 'gpx' }, // 缺 points
    { name: 'c', format: 'gpx', points: null },
    { name: 'd', format: 'gpx', points: 'nope' },
    { name: 'e', format: 'gpx', points: { length: 4 } },
    { name: 'f', format: 'gpx', points: pointsOf(3, 9) },
  ];
  assert.deepEqual(segmentStartIndices(files), [0, 2, 2, 2, 2, 2]);
});

test('timeFormatCore · segmentStartIndices 首段恒为 0 且序列单调不减', () => {
  const files = [
    { name: 'a', format: 'gpx', points: [] },
    { name: 'b', format: 'gpx', points: pointsOf(4, 1) },
    { name: 'c', format: 'gpx' },
    { name: 'd', format: 'gpx', points: pointsOf(2, 7) },
  ];
  const starts = segmentStartIndices(files);
  assert.equal(starts[0], 0);
  for (let i = 1; i < starts.length; i += 1) {
    assert.equal(starts[i] >= starts[i - 1], true, `starts[${i}] 应当不小于 starts[${i - 1}]`);
    assert.equal(Number.isInteger(starts[i]), true, `starts[${i}] 应当是整数`);
  }
});

test('timeFormatCore · segmentStartIndices 与 concatTrackPoints 配套：starts[k] 指向第 k 段首点', () => {
  const files = [
    { name: 'a.gpx', format: 'gpx', points: pointsOf(2, 1) },
    { name: 'b.gpx', format: 'gpx', points: pointsOf(3, 10) },
    { name: 'c.gpx', format: 'gpx', points: pointsOf(1, 20) },
  ];
  const starts = segmentStartIndices(files);
  const concat = concatTrackPoints(files);

  for (let k = 0; k < files.length; k += 1) {
    const first = files[k].points[0];
    assert.equal(concat[starts[k]].lat, first.lat, `第 ${k} 段首点 lat`);
    assert.equal(concat[starts[k]].lon, first.lon, `第 ${k} 段首点 lon`);
  }
});

test('timeFormatCore · segmentStartIndices 跳过空段后仍与 concatTrackPoints 对齐', () => {
  const files = [
    { name: 'a.gpx', format: 'gpx', points: pointsOf(2, 1) },
    { name: 'b.gpx', format: 'gpx', points: [] },
    { name: 'c.gpx', format: 'gpx', points: pointsOf(3, 30) },
  ];
  const starts = segmentStartIndices(files);
  const concat = concatTrackPoints(files);

  assert.deepEqual(starts, [0, 2, 2]);
  for (const k of [0, 2]) {
    assert.equal(concat[starts[k]].lat, files[k].points[0].lat, `第 ${k} 段首点 lat`);
    assert.equal(concat[starts[k]].lon, files[k].points[0].lon, `第 ${k} 段首点 lon`);
  }
});

test('timeFormatCore · segmentStartIndices 对非数组入参返回 [] 且不抛', () => {
  // 直接调用：契约要求不抛，抛出会让本用例失败
  for (const bad of [null, undefined, {}, 'abc', 42, true, NaN, { points: [] }]) {
    assert.deepEqual(segmentStartIndices(bad), [], `入参 ${label(bad)} 期望 []`);
  }
});

test('timeFormatCore · segmentStartIndices 不修改入参', () => {
  const files = [
    { name: 'a', format: 'gpx', points: pointsOf(2, 1) },
    { name: 'b', format: 'gpx', points: pointsOf(3, 5) },
  ];
  const snapshot = JSON.stringify(files);
  segmentStartIndices(files);
  assert.equal(JSON.stringify(files), snapshot);
  assert.equal(files.length, 2);
});

/* ============ 调用点收敛：上层不再各自实现同一套换算 ============ */

// 这批换算原本在界面层与导出层各写一份。重复实现最大的代价不是行数，而是
// 时区往返这种最容易写错的逻辑散在浏览器层、拿不到 core 的单测覆盖。

test('timeFormatCore · 调用点收敛: 本地时刻换算统一从 core/time-format.mjs 取', () => {
  const CONSUMERS = ['src/ui/time-mode.mjs', 'src/ui/preview.mjs', 'src/export/mp4.mjs'];
  let importers = 0;
  for (const rel of CONSUMERS) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const imports = /import\s*\{[^}]*\}\s*from\s*['"][^'"]*core\/time-format\.mjs['"]/.test(src);
    if (imports) importers += 1;
    assert.doesNotMatch(
      src,
      /function\s+(toLocalInputValue|parseLocalInputValue|localHms|localIsoText|formatLocalHms|formatLocalIso)\s*\(/,
      `${rel} 不该再自己实现本地时刻换算，应当从 core/time-format.mjs 取`,
    );
  }
  assert.ok(importers >= 2, `期望至少两个上层模块改为 import，实得 ${importers} 个`);
});

test('timeFormatCore · 调用点收敛: 分段起点统一从 core/track-files.mjs 取', () => {
  for (const rel of ['src/ui/time-mode.mjs', 'src/export/mp4-plan.mjs']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(
      src,
      /import\s*\{[^}]*\bsegmentStartIndices\b[^}]*\}\s*from\s*['"][^'"]*core\/track-files\.mjs['"]/,
      `${rel} 应当从 core/track-files.mjs 取 segmentStartIndices`,
    );
    assert.match(src, /segmentStartIndices\s*\(/, `${rel} 应当调用它`);
    assert.doesNotMatch(
      src,
      /segmentStarts\.push\s*\(/,
      `${rel} 不该再自己累计分段起点`,
    );
  }
});
