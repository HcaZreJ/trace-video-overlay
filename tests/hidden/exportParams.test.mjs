// 导出参数（时长上限参数化 · 画质码率 · 体积估算）的完整契约测试。
// 全部锚定值照 spec 的表格与公式手工推导，不从实现反推。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampMp4Duration,
  mp4Bitrate,
  estimateMp4Bytes,
  formatByteSize,
} from '../../src/core/export-params.mjs';

/** 断言失败信息里用的可读入参表示。 */
function show(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.join(',')}]`;
  if (value !== null && typeof value === 'object') return '{}';
  return String(value);
}

/** 浮点容差比较：绝对误差在 tol 以内即视为相等。 */
function assertClose(actual, expected, tol, message) {
  assert.equal(
    typeof actual,
    'number',
    `${message ?? ''} 期望返回 number，实际拿到 ${typeof actual}`,
  );
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    `${message ?? ''} 期望 ≈ ${expected}（容差 ${tol}），实际 ${actual}`,
  );
}

// ---------------------------------------------------------------------------
// clampMp4Duration —— 单参向后兼容
// ---------------------------------------------------------------------------

test('exportParams · clampMp4Duration(时长上限): 单参调用与既有事实逐值一致', () => {
  // 区间内原样返回
  assert.equal(clampMp4Duration(6), 6);
  assert.equal(clampMp4Duration(30), 30);
  assert.equal(clampMp4Duration(599), 599);
  assertClose(clampMp4Duration(123.5), 123.5, 1e-9, 'clampMp4Duration(123.5)');
  // 边界值原样返回
  assert.equal(clampMp4Duration(1), 1);
  assert.equal(clampMp4Duration(600), 600);
  // 低于下限抬到 1
  assert.equal(clampMp4Duration(0), 1);
  assert.equal(clampMp4Duration(-10), 1);
  assertClose(clampMp4Duration(0.5), 1, 1e-9, 'clampMp4Duration(0.5)');
  // 高于上限压到 600
  assert.equal(clampMp4Duration(9999), 600);
  assert.equal(clampMp4Duration(600.5), 600);
});

test('exportParams · clampMp4Duration(时长上限): 单参非法输入返回 6', () => {
  const invalid = [
    NaN,
    Infinity,
    -Infinity,
    '10',
    '',
    'abc',
    null,
    undefined,
    {},
    [],
    [30],
  ];
  for (const value of invalid) {
    assert.equal(
      clampMp4Duration(value),
      6,
      `clampMp4Duration(${show(value)}) 应回落到 6`,
    );
  }
});

// ---------------------------------------------------------------------------
// clampMp4Duration —— 双参（上限参数化）
// ---------------------------------------------------------------------------

test('exportParams · clampMp4Duration(时长上限): 双参自定义上限生效', () => {
  const SIX_HOURS = 21600;
  // 区间内原样返回，包括原先会被 600 压掉的值
  assert.equal(clampMp4Duration(700, SIX_HOURS), 700);
  assert.equal(clampMp4Duration(1800, SIX_HOURS), 1800);
  assert.equal(clampMp4Duration(21599, SIX_HOURS), 21599);
  // 超出自定义上限被压到上限
  assert.equal(clampMp4Duration(21601, SIX_HOURS), SIX_HOURS);
  assert.equal(clampMp4Duration(1e9, SIX_HOURS), SIX_HOURS);
  // 显式传 600 与单参行为一致
  assert.equal(clampMp4Duration(700, 600), 600);
  assert.equal(clampMp4Duration(123, 600), 123);
});

test('exportParams · clampMp4Duration(时长上限): 上限非法时回落到 600', () => {
  const badMax = [undefined, null, NaN, Infinity, -Infinity, 0, 0.999, -5, '900', {}];
  for (const maxSec of badMax) {
    assert.equal(
      clampMp4Duration(700, maxSec),
      600,
      `maxSec=${show(maxSec)} 应按 600 处理`,
    );
    assert.equal(
      clampMp4Duration(120, maxSec),
      120,
      `maxSec=${show(maxSec)} 时区间内的值原样返回`,
    );
  }
});

test('exportParams · clampMp4Duration(时长上限): 下限恒为 1，与上限取值无关', () => {
  assert.equal(clampMp4Duration(0, 21600), 1);
  assert.equal(clampMp4Duration(-10, 21600), 1);
  assert.equal(clampMp4Duration(0, 5), 1);
  assert.equal(clampMp4Duration(-1e9, 600), 1);
  // 上限恰为下限时收口到 1
  assert.equal(clampMp4Duration(0.5, 1), 1);
  assert.equal(clampMp4Duration(1, 1), 1);
  assert.equal(clampMp4Duration(50, 1), 1);
});

test('exportParams · clampMp4Duration(时长上限): 双参下的边界值与非法 value', () => {
  // 上下边界原样返回
  assert.equal(clampMp4Duration(1, 21600), 1);
  assert.equal(clampMp4Duration(21600, 21600), 21600);
  // value 非法时不受自定义上限影响，仍返回默认 6
  for (const value of [NaN, Infinity, undefined, null, 'abc', {}]) {
    assert.equal(
      clampMp4Duration(value, 21600),
      6,
      `value=${show(value)} 应回落到 6`,
    );
  }
});

// ---------------------------------------------------------------------------
// mp4Bitrate
// ---------------------------------------------------------------------------

const BITRATE_TABLE = [
  { size: 720, quality: 'high', bps: 6e6 },
  { size: 1080, quality: 'high', bps: 12e6 },
  { size: 1440, quality: 'high', bps: 20e6 },
  { size: 720, quality: 'medium', bps: 3e6 },
  { size: 1080, quality: 'medium', bps: 6e6 },
  { size: 1440, quality: 'medium', bps: 10e6 },
  { size: 720, quality: 'low', bps: 1.5e6 },
  { size: 1080, quality: 'low', bps: 3e6 },
  { size: 1440, quality: 'low', bps: 5e6 },
];

test('exportParams · mp4Bitrate(画质码率): 九个格子逐个精确断言', () => {
  for (const { size, quality, bps } of BITRATE_TABLE) {
    assertClose(
      mp4Bitrate(size, quality),
      bps,
      1,
      `mp4Bitrate(${size}, '${quality}')`,
    );
  }
});

test('exportParams · mp4Bitrate(画质码率): size 非法时按 1080 那一列取值', () => {
  const badSizes = [undefined, null, NaN, Infinity, 0, -1080, 999, 2160, '720', '1080', {}];
  const column = { high: 12e6, medium: 6e6, low: 3e6 };
  for (const quality of ['high', 'medium', 'low']) {
    for (const size of badSizes) {
      assertClose(
        mp4Bitrate(size, quality),
        column[quality],
        1,
        `mp4Bitrate(${show(size)}, '${quality}')`,
      );
    }
  }
});

test('exportParams · mp4Bitrate(画质码率): quality 非法时按 high 那一行取值', () => {
  const badQualities = [undefined, null, '', 'HIGH', 'ultra', 'mid', 42, {}, true];
  const row = { 720: 6e6, 1080: 12e6, 1440: 20e6 };
  for (const size of [720, 1080, 1440]) {
    for (const quality of badQualities) {
      assertClose(
        mp4Bitrate(size, quality),
        row[size],
        1,
        `mp4Bitrate(${size}, ${show(quality)})`,
      );
    }
  }
});

// size 与 quality 双非法时回落到 1080 / high 这一格；下列每次调用都要求正常返回而非抛错。
test('exportParams · mp4Bitrate(画质码率): 双非法返回 12e6 且永不抛错', () => {
  assertClose(mp4Bitrate(), 12e6, 1, 'mp4Bitrate() 缺省');
  assertClose(mp4Bitrate(undefined, undefined), 12e6, 1, 'mp4Bitrate(undefined, undefined)');
  assertClose(mp4Bitrate(null, null), 12e6, 1, 'mp4Bitrate(null, null)');
  assertClose(mp4Bitrate(NaN, 'ultra'), 12e6, 1, "mp4Bitrate(NaN, 'ultra')");
  assertClose(mp4Bitrate({}, []), 12e6, 1, 'mp4Bitrate({}, [])');
  assertClose(mp4Bitrate(360, ''), 12e6, 1, "mp4Bitrate(360, '')");
});

// ---------------------------------------------------------------------------
// estimateMp4Bytes
// ---------------------------------------------------------------------------

test('exportParams · estimateMp4Bytes(体积估算): 整除的常规用例', () => {
  // durationSec * bitrate / 8
  assert.equal(estimateMp4Bytes(6, 12e6), 9000000);
  assert.equal(estimateMp4Bytes(60, 1.5e6), 11250000);
  assert.equal(estimateMp4Bytes(600, 20e6), 1500000000);
  assert.equal(estimateMp4Bytes(123.5, 1.5e6), 23156250);
  // 6 小时 @ 20 Mbps
  assert.equal(estimateMp4Bytes(21600, 20e6), 54000000000);
});

test('exportParams · estimateMp4Bytes(体积估算): 除不尽时向上取整', () => {
  assert.equal(estimateMp4Bytes(3, 7), 3); // 21 / 8 = 2.625 → 3
  assert.equal(estimateMp4Bytes(7, 9), 8); // 63 / 8 = 7.875 → 8
  assert.equal(estimateMp4Bytes(5, 5), 4); // 25 / 8 = 3.125 → 4
  assert.equal(estimateMp4Bytes(1, 1), 1); //  1 / 8 = 0.125 → 1
  assert.equal(estimateMp4Bytes(1, 3), 1); //  3 / 8 = 0.375 → 1
});

test('exportParams · estimateMp4Bytes(体积估算): 零值合法并返回 0', () => {
  assert.equal(estimateMp4Bytes(0, 12e6), 0);
  assert.equal(estimateMp4Bytes(600, 0), 0);
  assert.equal(estimateMp4Bytes(0, 0), 0);
});

test('exportParams · estimateMp4Bytes(体积估算): 负数或非有限数返回 0', () => {
  const cases = [
    [-1, 12e6],
    [-600, 20e6],
    [60, -1],
    [60, -12e6],
    [NaN, 12e6],
    [60, NaN],
    [Infinity, 12e6],
    [60, Infinity],
    [-Infinity, 12e6],
    [60, -Infinity],
    [undefined, 12e6],
    [60, undefined],
    [null, 12e6],
    [60, null],
    ['10', 12e6],
    [60, '12000000'],
    [{}, 12e6],
    [60, {}],
  ];
  for (const [durationSec, bitrate] of cases) {
    assert.equal(
      estimateMp4Bytes(durationSec, bitrate),
      0,
      `estimateMp4Bytes(${show(durationSec)}, ${show(bitrate)}) 应返回 0`,
    );
  }
});

// ---------------------------------------------------------------------------
// formatByteSize
// ---------------------------------------------------------------------------

test('exportParams · formatByteSize(体积格式化): 小于 1024 走 B 且为整数', () => {
  assert.equal(formatByteSize(0), '0 B');
  assert.equal(formatByteSize(1), '1 B');
  assert.equal(formatByteSize(512), '512 B');
  assert.equal(formatByteSize(1023), '1023 B');
});

test('exportParams · formatByteSize(体积格式化): 各量级边界逐个换算', () => {
  const cases = [
    [1024, '1 KB'],
    [1025, '1 KB'],
    [1536, '1.5 KB'],
    [1024 * 1023, '1023 KB'], // 1047552，KB 量级的上沿
    [1024 ** 2, '1 MB'],
    [1024 ** 2 * 1.5, '1.5 MB'], // 1572864
    [1024 ** 3 - 1024 ** 2, '1023 MB'], // 1072693248，MB↔GB 边界之下
    [1024 ** 3, '1 GB'],
    [1024 ** 4 - 1024 ** 3, '1023 GB'], // GB↔TB 边界之下
    [1024 ** 4, '1 TB'],
    [1024 ** 4 * 5, '5 TB'],
  ];
  for (const [bytes, expected] of cases) {
    assert.equal(formatByteSize(bytes), expected, `formatByteSize(${bytes})`);
  }
});

test('exportParams · formatByteSize(体积格式化): 超过 TB 量级停在 TB', () => {
  assert.equal(formatByteSize(1024 ** 5), '1024 TB');
  assert.equal(formatByteSize(1024 ** 5 * 2), '2048 TB');
  for (const bytes of [1024 ** 5, 1024 ** 6]) {
    assert.ok(
      formatByteSize(bytes).endsWith(' TB'),
      `formatByteSize(${bytes}) 应停在 TB，实际 ${formatByteSize(bytes)}`,
    );
  }
});

test('exportParams · formatByteSize(体积格式化): 保留 1 位小数并去掉多余的 .0', () => {
  assert.equal(formatByteSize(1024 ** 3), '1 GB');
  assert.notEqual(formatByteSize(1024 ** 3), '1.0 GB');
  assert.equal(formatByteSize(1024 ** 2), '1 MB');
  assert.notEqual(formatByteSize(1024 ** 2), '1.0 MB');
  assert.equal(formatByteSize(1300), '1.3 KB'); // 1.2695… → 1.3
  assert.equal(formatByteSize(3975000000), '3.7 GB'); // 3.702… → 3.7
  assert.equal(formatByteSize(1500000000), '1.4 GB'); // 1.3969… → 1.4
  // 至多 1 位小数
  for (const bytes of [1300, 3975000000, 1500000000, 1024 ** 2 * 1.5]) {
    const decimals = (formatByteSize(bytes).split(' ')[0].split('.')[1] ?? '').length;
    assert.ok(decimals <= 1, `formatByteSize(${bytes}) 小数位应 ≤ 1，实际 ${formatByteSize(bytes)}`);
  }
});

test('exportParams · formatByteSize(体积格式化): 数值与单位之间恰好一个空格', () => {
  for (const bytes of [0, 512, 1024, 1536, 1024 ** 2, 1024 ** 3, 3975000000, 1024 ** 4]) {
    const out = formatByteSize(bytes);
    assert.match(
      out,
      /^\d+(\.\d)? (B|KB|MB|GB|TB)$/,
      `formatByteSize(${bytes}) 格式应为「数值 空格 单位」，实际 ${JSON.stringify(out)}`,
    );
    assert.equal(out.split(' ').length, 2, `formatByteSize(${bytes}) 应只有一个空格`);
  }
});

test('exportParams · formatByteSize(体积格式化): 非有限数或负数返回 0 B', () => {
  const invalid = [NaN, Infinity, -Infinity, -1, -1024, -(1024 ** 3), undefined, null, 'abc', {}];
  for (const bytes of invalid) {
    assert.equal(
      formatByteSize(bytes),
      '0 B',
      `formatByteSize(${show(bytes)}) 应返回 '0 B'`,
    );
  }
});

// ---------------------------------------------------------------------------
// 验收：四个函数串起来就是界面上的「预计文件大小」
// ---------------------------------------------------------------------------

test('exportParams · 验收: 时长 → 码率 → 字节 → 可读体积 的完整链路', () => {
  // 全内存通道（上限 600）：用户填 9999 秒、1080p / medium
  const memDuration = clampMp4Duration(9999);
  assert.equal(memDuration, 600);
  const memBytes = estimateMp4Bytes(memDuration, mp4Bitrate(1080, 'medium'));
  assert.equal(memBytes, 450000000); // 600 * 6e6 / 8
  assert.equal(formatByteSize(memBytes), '429.2 MB');

  // 流式写盘通道（上限 21600）：用户填 30000 秒、1440p / high
  const streamDuration = clampMp4Duration(30000, 21600);
  assert.equal(streamDuration, 21600);
  const streamBytes = estimateMp4Bytes(streamDuration, mp4Bitrate(1440, 'high'));
  assert.equal(streamBytes, 54000000000); // 21600 * 20e6 / 8
  assert.equal(formatByteSize(streamBytes), '50.3 GB');

  // 短片 + 最低画质：60 秒、720p / low
  const shortBytes = estimateMp4Bytes(clampMp4Duration(60, 21600), mp4Bitrate(720, 'low'));
  assert.equal(shortBytes, 11250000); // 60 * 1.5e6 / 8
  assert.equal(formatByteSize(shortBytes), '10.7 MB');
});
