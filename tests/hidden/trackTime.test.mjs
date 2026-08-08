import test from 'node:test';
import assert from 'node:assert/strict';

import {
  trackTimeRange,
  buildTimeIndex,
  progressAtTime,
  timeAtProgress,
} from '../../src/core/track-time.mjs';

// ---------------------------------------------------------------------------
// 独立复刻的墨卡托公式（照 spec 手写，用来推导期望值，不从被测代码反推）
// ---------------------------------------------------------------------------
const EARTH_R = 6378137;
const mercatorX = (lon) => lon * (Math.PI / 180) * EARTH_R;
const mercatorY = (lat) => EARTH_R * Math.log(Math.tan(Math.PI / 4 + (lat * (Math.PI / 180)) / 2));

/** 对全部点按顺序累加墨卡托平面距离，返回 cumLen 数组（cum[0] === 0）。 */
function cumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = Math.hypot(mercatorX(b.lng) - mercatorX(a.lng), mercatorY(b.lat) - mercatorY(a.lat));
    cum.push(cum[i - 1] + d);
  }
  return cum;
}

function approx(actual, expected, tol = 1e-9, msg = '') {
  assert.ok(
    Number.isFinite(actual),
    `${msg} 期望有限数，实际得到 ${String(actual)}`,
  );
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg} 期望 ≈ ${expected}（容差 ${tol}），实际 ${actual}`,
  );
}

/** 相对容差比较，用于米级的弧长数值。 */
function approxRel(actual, expected, rel = 1e-9, msg = '') {
  const tol = Math.max(Math.abs(expected) * rel, 1e-6);
  approx(actual, expected, tol, msg);
}

function approxArray(actual, expected, rel, msg) {
  assert.ok(Array.isArray(actual), `${msg} 期望数组，实际得到 ${String(actual)}`);
  assert.equal(actual.length, expected.length, `${msg} 数组长度应为 ${expected.length}`);
  expected.forEach((v, i) => approxRel(actual[i], v, rel, `${msg} 第 ${i} 项`));
}

// ---------------------------------------------------------------------------
// Fixtures：每个测试各自构造，测试之间无共享可变状态
// ---------------------------------------------------------------------------

/** 赤道等间隔三点，cumLen = [0, d, 2d]。 */
const equator3 = () => [
  { lng: 0, lat: 0, time: 1000 },
  { lng: 1, lat: 0, time: 2000 },
  { lng: 2, lat: 0, time: 3000 },
];

/** 停留段：中间三点坐标完全重合，时间持续推进。cumLen = [0, d, d, d, 2d]。 */
const dwell5 = () => [
  { lng: 0, lat: 0, time: 0 },
  { lng: 1, lat: 0, time: 1000 },
  { lng: 1, lat: 0, time: 2000 },
  { lng: 1, lat: 0, time: 3000 },
  { lng: 2, lat: 0, time: 4000 },
];

/** 部分点缺时间戳：索引 1 无 time，但其弧长仍计入总长。 */
const partialTime4 = () => [
  { lng: 0, lat: 0, time: 0 },
  { lng: 1, lat: 0 },
  { lng: 2, lat: 0, time: 2000 },
  { lng: 3, lat: 0, time: 3000 },
];

/** 两个文件拼接：segmentStarts = [0, 3]，段间存在巨大时间空隙。 */
const twoSegments = () => [
  { lng: 0, lat: 0, time: 0 },
  { lng: 1, lat: 0, time: 1000 },
  { lng: 2, lat: 0, time: 2000 },
  { lng: 3, lat: 0, time: 1000000 },
  { lng: 4, lat: 0, time: 1001000 },
  { lng: 5, lat: 0, time: 1002000 },
];

// ---------------------------------------------------------------------------
// trackTimeRange
// ---------------------------------------------------------------------------

test('trackTime · trackTimeRange(时间范围): 全部点带时间戳时返回完整字段', () => {
  const range = trackTimeRange(equator3());

  assert.ok(range, '应返回对象');
  assert.equal(range.startMs, 1000);
  assert.equal(range.endMs, 3000);
  approx(range.spanSec, 2, 1e-12, 'spanSec = (endMs - startMs) / 1000');
  assert.equal(range.anchorCount, 3, 'anchorCount = 带有效时间戳的点数');
  assert.equal(range.totalCount, 3, 'totalCount = points.length');
});

test('trackTime · trackTimeRange(时间范围): 时间乱序时取最小值与最大值', () => {
  const points = [
    { lng: 0, lat: 0, time: 5000 },
    { lng: 1, lat: 0, time: 1000 },
    { lng: 2, lat: 0, time: 3000 },
  ];
  const range = trackTimeRange(points);

  assert.ok(range, '应返回对象');
  assert.equal(range.startMs, 1000, 'startMs 是最小时间戳而非首点时间戳');
  assert.equal(range.endMs, 5000, 'endMs 是最大时间戳而非末点时间戳');
  approx(range.spanSec, 4, 1e-12, 'spanSec 按最小/最大之差算');
  assert.equal(range.anchorCount, 3);
  assert.equal(range.totalCount, 3);
});

test('trackTime · trackTimeRange(时间范围): 部分点缺时间戳时 anchorCount 与 totalCount 分离', () => {
  const range = trackTimeRange(partialTime4());

  assert.ok(range, '应返回对象');
  assert.equal(range.startMs, 0);
  assert.equal(range.endMs, 3000);
  approx(range.spanSec, 3, 1e-12);
  assert.equal(range.anchorCount, 3, '只有 3 个点带有效时间戳');
  assert.equal(range.totalCount, 4, 'totalCount 仍是全部点数');
});

test('trackTime · trackTimeRange(时间范围): 只有一个时间戳时返回 spanSec 为 0 的对象', () => {
  const points = [
    { lng: 0, lat: 0 },
    { lng: 1, lat: 0, time: 777 },
    { lng: 2, lat: 0 },
  ];
  const range = trackTimeRange(points);

  assert.notEqual(range, null, '单个时间戳不返回 null');
  assert.ok(range, '应返回对象');
  assert.equal(range.startMs, 777);
  assert.equal(range.endMs, 777);
  approx(range.spanSec, 0, 1e-12, 'spanSec 为 0');
  assert.equal(range.anchorCount, 1);
  assert.equal(range.totalCount, 3);
});

test('trackTime · trackTimeRange(时间范围): 空输入与无时间戳的输入返回 null', () => {
  const cases = [
    ['空数组', []],
    ['null', null],
    ['undefined', undefined],
    ['字符串', 'not-an-array'],
    ['普通对象', { length: 2 }],
    ['数字', 42],
    ['全部点无 time 字段', [{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }]],
  ];
  for (const [label, input] of cases) {
    assert.equal(trackTimeRange(input), null, `${label} 应返回 null 且不抛错`);
  }
});

test('trackTime · trackTimeRange(时间范围): 非有限数的 time 不算有效时间戳', () => {
  const bad = [
    { lng: 0, lat: 0, time: Number.NaN },
    { lng: 1, lat: 0, time: Number.POSITIVE_INFINITY },
    { lng: 2, lat: 0, time: Number.NEGATIVE_INFINITY },
    { lng: 3, lat: 0, time: '1700000000000' },
    { lng: 4, lat: 0, time: null },
    { lng: 5, lat: 0, time: true },
  ];
  assert.equal(trackTimeRange(bad), null, '没有一个有效时间戳时返回 null');

  const mixed = [...bad, { lng: 6, lat: 0, time: 5000 }, { lng: 7, lat: 0, time: 9000 }];
  const range = trackTimeRange(mixed);
  assert.ok(range, '存在有效时间戳时返回对象');
  assert.equal(range.startMs, 5000, '非法值不参与最小值');
  assert.equal(range.endMs, 9000, '非法值不参与最大值');
  assert.equal(range.anchorCount, 2, '只计有效时间戳');
  assert.equal(range.totalCount, 8, 'totalCount 计全部点');
});

// ---------------------------------------------------------------------------
// buildTimeIndex
// ---------------------------------------------------------------------------

test('trackTime · buildTimeIndex(时间索引): 等距三点的锚点结构与总长', () => {
  const points = equator3();
  const cum = cumulative(points);
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  assert.deepEqual(index.anchorTimes, [1000, 2000, 3000], '锚点时间按索引顺序');
  approxArray(index.anchorLens, [cum[0], cum[1], cum[2]], 1e-9, 'anchorLens');
  approxRel(index.totalLen, cum[2], 1e-9, 'totalLen');
  assert.equal(index.droppedCount, 0);
  assert.equal(index.startMs, 1000);
  assert.equal(index.endMs, 3000);
});

test('trackTime · buildTimeIndex(时间索引): 弧长用墨卡托平面距离而非大圆或纬度线性距离', () => {
  // 同经度、纬度 0 → 45 → 60。墨卡托 Y 非线性，三种度量给出显著不同的比例。
  const points = [
    { lng: 0, lat: 0, time: 0 },
    { lng: 0, lat: 45, time: 1000 },
    { lng: 0, lat: 60, time: 2000 },
  ];
  const cum = cumulative(points);
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  approxRel(index.totalLen, cum[2], 1e-9, 'totalLen 为墨卡托累计弧长');

  // 手工推导：mercatorY(45)/R = ln(tan(67.5°)) = 0.8813735870195430
  //           mercatorY(60)/R = ln(tan(75°))   = 1.3169578969248166
  // t=500 落在首段中点 → progress = 0.5 * 0.8813735870195430 / 1.3169578969248166
  approx(progressAtTime(index, 500), 0.3346249, 1e-6, '墨卡托比例');
  // 对照：Haversine 大圆距离会给出 0.375，纬度线性会给出 0.375；两者都不对。
  assert.ok(
    Math.abs(progressAtTime(index, 500) - 0.375) > 1e-3,
    '不能用大圆/纬度线性距离折算弧长',
  );
});

test('trackTime · buildTimeIndex(时间索引): 缺时间戳的中间点仍贡献弧长', () => {
  const points = partialTime4();
  const cum = cumulative(points);
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  assert.deepEqual(index.anchorTimes, [0, 2000, 3000], '只有带时间戳的点成为锚点');
  approxArray(index.anchorLens, [cum[0], cum[2], cum[3]], 1e-9, 'anchorLens 取该点的累计弧长');
  approxRel(index.totalLen, cum[3], 1e-9, 'totalLen 覆盖全部点');
  assert.equal(index.droppedCount, 0);

  // t=1000 在锚点 (0, cum0) 与 (2000, cum2) 中点 → len = 0.5 * cum2，约为总长的 1/3
  approx(progressAtTime(index, 1000), (0.5 * cum[2]) / cum[3], 1e-12, '手推锚点插值');
  approx(progressAtTime(index, 1000), 1 / 3, 1e-9, '等间隔四点时恰好三分之一');
  approx(progressAtTime(index, 2500), (cum[2] + 0.5 * (cum[3] - cum[2])) / cum[3], 1e-12, '末段中点');
});

test('trackTime · buildTimeIndex(时间索引): 末尾无时间戳的点计入 totalLen', () => {
  const points = [
    { lng: 0, lat: 0, time: 0 },
    { lng: 1, lat: 0, time: 1000 },
    { lng: 2, lat: 0 },
  ];
  const cum = cumulative(points);
  const index = buildTimeIndex(points);

  assert.ok(index, '两个有效锚点即可建索引');
  assert.deepEqual(index.anchorTimes, [0, 1000]);
  approxRel(index.totalLen, cum[2], 1e-9, 'totalLen 含末尾无时间戳的点');
  // 若 totalLen 只算到末锚点，这里会得到 0.5；正确答案是 0.25。
  approx(progressAtTime(index, 500), 0.25, 1e-9, '总长含尾段时的进度');
});

test('trackTime · buildTimeIndex(时间索引): 时间倒退与重复的锚点被丢弃且计数正确', () => {
  const points = [
    { lng: 0, lat: 0, time: 1000 },
    { lng: 1, lat: 0, time: 5000 },
    { lng: 2, lat: 0, time: 3000 }, // 倒退，丢弃
    { lng: 3, lat: 0, time: 5000 }, // 与已保留锚点相等，丢弃
    { lng: 4, lat: 0, time: 9000 },
  ];
  const cum = cumulative(points);
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  assert.equal(index.droppedCount, 2, '两个非严格递增的锚点被丢弃');
  assert.deepEqual(index.anchorTimes, [1000, 5000, 9000], '保留下来的锚点时间严格递增');
  approxArray(index.anchorLens, [cum[0], cum[1], cum[4]], 1e-9, 'anchorLens 与保留锚点对应');
  approxRel(index.totalLen, cum[4], 1e-9, 'totalLen 仍覆盖全部点');
  assert.equal(index.startMs, 1000);
  assert.equal(index.endMs, 9000);
  for (let i = 1; i < index.anchorTimes.length; i++) {
    assert.ok(index.anchorTimes[i] > index.anchorTimes[i - 1], '锚点时间严格递增');
  }
});

test('trackTime · buildTimeIndex(时间索引): 全部点重合时 totalLen 为 0 且正常返回', () => {
  const points = [
    { lng: 120.5, lat: 31.2, time: 0 },
    { lng: 120.5, lat: 31.2, time: 1000 },
    { lng: 120.5, lat: 31.2, time: 2000 },
  ];
  const index = buildTimeIndex(points);

  assert.notEqual(index, null, '重合轨迹不返回 null');
  assert.ok(index, '应返回索引对象');
  approx(index.totalLen, 0, 1e-9, 'totalLen 为 0');
  assert.deepEqual(index.anchorTimes, [0, 1000, 2000]);
  assert.equal(index.startMs, 0);
  assert.equal(index.endMs, 2000);
});

test('trackTime · buildTimeIndex(时间索引): 输入不足以建索引时返回 null', () => {
  const cases = [
    ['空数组', []],
    ['null', null],
    ['undefined', undefined],
    ['非数组', 'points'],
    ['单点', [{ lng: 0, lat: 0, time: 1000 }]],
    ['无任何时间戳', [{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }, { lng: 2, lat: 0 }]],
    ['只有一个有效时间戳', [{ lng: 0, lat: 0, time: 1000 }, { lng: 1, lat: 0 }, { lng: 2, lat: 0 }]],
    [
      '时间戳全非法',
      [
        { lng: 0, lat: 0, time: Number.NaN },
        { lng: 1, lat: 0, time: '1000' },
        { lng: 2, lat: 0, time: Number.POSITIVE_INFINITY },
      ],
    ],
    [
      '去重后锚点少于 2 个',
      [
        { lng: 0, lat: 0, time: 1000 },
        { lng: 1, lat: 0, time: 1000 },
        { lng: 2, lat: 0, time: 500 },
      ],
    ],
  ];
  for (const [label, input] of cases) {
    assert.equal(buildTimeIndex(input), null, `${label} 应返回 null 且不抛错`);
  }
});

test('trackTime · buildTimeIndex(时间索引): 不折叠时保留段间的巨大空隙', () => {
  const points = twoSegments();
  const cum = cumulative(points);
  const expected = [0, 1000, 2000, 1000000, 1001000, 1002000];

  for (const [label, opts] of [
    ['缺省 opts', undefined],
    ['空 opts', {}],
    ['collapseSegmentGaps 为 false', { segmentStarts: [0, 3], collapseSegmentGaps: false }],
    ['只给 segmentStarts', { segmentStarts: [0, 3] }],
    ['只给 collapseSegmentGaps', { collapseSegmentGaps: true }],
  ]) {
    const index = buildTimeIndex(points, opts);
    assert.ok(index, `${label}: 应返回索引对象`);
    assert.deepEqual(index.anchorTimes, expected, `${label}: 锚点时间不平移`);
    assert.equal(index.endMs, 1002000, `${label}: endMs 保留原始末时刻`);
    assert.equal(index.droppedCount, 0, `${label}: 无锚点被丢弃`);
    approxArray(index.anchorLens, cum, 1e-9, `${label}: anchorLens`);
  }
});

test('trackTime · buildTimeIndex(时间索引): 折叠段间空隙后段尾直接接段头', () => {
  const points = twoSegments();
  const cum = cumulative(points);
  const index = buildTimeIndex(points, { segmentStarts: [0, 3], collapseSegmentGaps: true });

  assert.ok(index, '应返回索引对象');
  // 第二段首锚点时间被设为第一段末锚点时间 2000 + 1ms = 2001（偏移 -997999），整段随之平移。
  // 取 +1ms 而非相等，平移后的锚点仍严格递增，一个都不丢。
  assert.deepEqual(index.anchorTimes, [0, 1000, 2000, 2001, 3001, 4001], '折叠后时间连续无空隙');
  assert.equal(index.droppedCount, 0, '折叠不制造重复时刻，无锚点被丢弃');
  assert.equal(index.startMs, 0);
  assert.equal(index.endMs, 4001, '折叠后 endMs 为平移后的末锚点时间');
  approxArray(index.anchorLens, cum, 1e-9, 'anchorLens 覆盖全部点，段首锚点未被丢弃');
  approxRel(index.totalLen, cum[5], 1e-9, 'totalLen 不受时间折叠影响');
  for (let i = 1; i < index.anchorTimes.length; i++) {
    assert.ok(index.anchorTimes[i] > index.anchorTimes[i - 1], '折叠后仍严格递增');
  }
  // 跨段跳跃发生在 2000→2001 这 1 毫秒内：30fps 下远小于一帧，呈现为瞬移。
  approx(progressAtTime(index, 2000), cum[2] / cum[5], 1e-12, 't=2000 停在第一段末尾');
  approx(progressAtTime(index, 2001), cum[3] / cum[5], 1e-12, 't=2001 已到第二段起点');
});

test('trackTime · buildTimeIndex(时间索引): 三段拼接时逐个边界累积折叠', () => {
  const points = [
    { lng: 0, lat: 0, time: 0 },
    { lng: 1, lat: 0, time: 1000 },
    { lng: 2, lat: 0, time: 2000 },
    { lng: 3, lat: 0, time: 1000000 },
    { lng: 4, lat: 0, time: 1001000 },
    { lng: 5, lat: 0, time: 1002000 },
    { lng: 6, lat: 0, time: 5000000 },
    { lng: 7, lat: 0, time: 5001000 },
    { lng: 8, lat: 0, time: 5002000 },
  ];
  const cum = cumulative(points);
  const index = buildTimeIndex(points, { segmentStarts: [0, 3, 6], collapseSegmentGaps: true });

  assert.ok(index, '应返回索引对象');
  // 边界逐个累积：段2 首锚点 = 2000+1 = 2001（偏移 -997999）→ 段2 = [2001,3001,4001]；
  // 段3 首锚点 = 平移后的段2 末锚点 4001+1 = 4002（偏移 -4995998）→ 段3 = [4002,5002,6002]。
  assert.deepEqual(
    index.anchorTimes,
    [0, 1000, 2000, 2001, 3001, 4001, 4002, 5002, 6002],
    '两处空隙都被折叠，偏移逐个边界累积',
  );
  assert.equal(index.droppedCount, 0, '折叠不丢弃任何锚点');
  assert.equal(index.endMs, 6002);
  approxArray(index.anchorLens, cum, 1e-9, 'anchorLens 覆盖全部九个点');
  for (let i = 1; i < index.anchorTimes.length; i++) {
    assert.ok(index.anchorTimes[i] > index.anchorTimes[i - 1], '折叠后仍严格递增');
  }
});

// ---------------------------------------------------------------------------
// progressAtTime
// ---------------------------------------------------------------------------

test('trackTime · progressAtTime(时刻→进度): 区间内线性插值', () => {
  const points = equator3();
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  approx(progressAtTime(index, 1250), 0.125, 1e-9, '首段四分之一处');
  approx(progressAtTime(index, 1500), 0.25, 1e-9, '首段中点');
  approx(progressAtTime(index, 2000), 0.5, 1e-9, '中间锚点');
  approx(progressAtTime(index, 2500), 0.75, 1e-9, '末段中点');
  approx(progressAtTime(index, 2750), 0.875, 1e-9, '末段四分之三处');
});

test('trackTime · progressAtTime(时刻→进度): 起止之外的时刻 clamp 到 0 与 1', () => {
  const index = buildTimeIndex(equator3());

  assert.ok(index, '应返回索引对象');
  approx(progressAtTime(index, 1000), 0, 1e-12, '恰好 startMs 返回 0');
  approx(progressAtTime(index, 999), 0, 1e-12, '早于 startMs 返回 0');
  approx(progressAtTime(index, -8.64e12), 0, 1e-12, '远早于 startMs 返回 0');
  approx(progressAtTime(index, 3000), 1, 1e-12, '恰好 endMs 返回 1');
  approx(progressAtTime(index, 3001), 1, 1e-12, '晚于 endMs 返回 1');
  approx(progressAtTime(index, 8.64e12), 1, 1e-12, '远晚于 endMs 返回 1');

  for (const t of [900, 1000, 1500, 2000, 3000, 4000]) {
    const p = progressAtTime(index, t);
    assert.ok(p >= 0 && p <= 1, `progress 必须落在 [0,1]，t=${t} 得到 ${p}`);
  }
});

test('trackTime · progressAtTime(时刻→进度): index 缺失或时刻非有限数时返回 0', () => {
  const index = buildTimeIndex(equator3());

  assert.ok(index, '应返回索引对象');
  approx(progressAtTime(null, 2000), 0, 1e-12, 'index 为 null');
  approx(progressAtTime(undefined, 2000), 0, 1e-12, 'index 为 undefined');
  approx(progressAtTime(index, Number.NaN), 0, 1e-12, 'tMs 为 NaN');
  approx(progressAtTime(index, Number.POSITIVE_INFINITY), 0, 1e-12, 'tMs 为 +Infinity');
  approx(progressAtTime(index, Number.NEGATIVE_INFINITY), 0, 1e-12, 'tMs 为 -Infinity');
  approx(progressAtTime(null, Number.NaN), 0, 1e-12, 'index 与 tMs 都无效');
});

test('trackTime · progressAtTime(时刻→进度): totalLen 为 0 时恒返回 0', () => {
  const points = [
    { lng: 8.5, lat: 47.3, time: 0 },
    { lng: 8.5, lat: 47.3, time: 1000 },
    { lng: 8.5, lat: 47.3, time: 2000 },
  ];
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  approx(progressAtTime(index, -500), 0, 1e-12, '起点之前');
  approx(progressAtTime(index, 0), 0, 1e-12, '起点');
  approx(progressAtTime(index, 500), 0, 1e-12, '区间内');
  approx(progressAtTime(index, 1500), 0, 1e-12, '区间内');
  // totalLen === 0 优先于「tMs >= endMs 返回 1」：零长度轨迹缩成一个点，任何时刻都指向它。
  approx(progressAtTime(index, 2000), 0, 1e-12, '恰好 endMs 仍返回 0 而非 1');
  approx(progressAtTime(index, 2500), 0, 1e-12, '晚于 endMs 仍返回 0 而非 1');
  approx(progressAtTime(index, 8.64e12), 0, 1e-12, '远晚于 endMs 仍返回 0');
});

test('trackTime · progressAtTime(时刻→进度): 停留段内 progress 恒定不动', () => {
  const points = dwell5();
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  assert.deepEqual(index.anchorTimes, [0, 1000, 2000, 3000, 4000], '重合点同样成为锚点');

  const samples = [1000, 1001, 1200, 1500, 1999, 2000, 2001, 2500, 2999, 3000];
  const base = progressAtTime(index, samples[0]);
  approx(base, 0.5, 1e-9, '停留发生在总弧长的一半处');
  for (const t of samples) {
    approx(progressAtTime(index, t), base, 1e-12, `停留段内 t=${t} 的 progress 应与段首一致`);
  }
  // 停留段之外照常前进
  approx(progressAtTime(index, 500), 0.25, 1e-9, '停留之前仍在移动');
  approx(progressAtTime(index, 3500), 0.75, 1e-9, '停留之后恢复移动');
});

test('trackTime · progressAtTime(时刻→进度): 折叠开关改变中段时刻的进度', () => {
  const points = twoSegments();
  const cum = cumulative(points);
  const raw = buildTimeIndex(points, { segmentStarts: [0, 3], collapseSegmentGaps: false });
  const collapsed = buildTimeIndex(points, { segmentStarts: [0, 3], collapseSegmentGaps: true });

  assert.ok(raw, '不折叠索引');
  assert.ok(collapsed, '折叠索引');

  // 不折叠：t=3001 只走完了第一段再多一丁点（空隙占掉了几乎全部时间）
  const f = 1001 / 998000;
  approx(
    progressAtTime(raw, 3001),
    (cum[2] + f * (cum[3] - cum[2])) / cum[5],
    1e-12,
    '不折叠时 t=3001 仍卡在段间空隙里',
  );
  // 折叠：t=3001 恰好落在第二段的第二个锚点（cum[4]）上
  approx(progressAtTime(collapsed, 3001), cum[4] / cum[5], 1e-12, '折叠后 t=3001 已进入第二段');
  approx(progressAtTime(collapsed, 3001), 0.8, 1e-9, '折叠后恰好走完总弧长的五分之四');
  assert.ok(
    Math.abs(progressAtTime(raw, 3001) - progressAtTime(collapsed, 3001)) > 0.1,
    '折叠开关必须导致可观测差异',
  );
});

// ---------------------------------------------------------------------------
// timeAtProgress
// ---------------------------------------------------------------------------

test('trackTime · timeAtProgress(进度→时刻): 区间内线性插值与边界取值', () => {
  const index = buildTimeIndex(equator3());

  assert.ok(index, '应返回索引对象');
  approx(timeAtProgress(index, 0), 1000, 1e-9, 'progress 0 → startMs');
  approx(timeAtProgress(index, 1), 3000, 1e-9, 'progress 1 → endMs');
  approx(timeAtProgress(index, -0.5), 1000, 1e-9, 'progress 小于 0 → startMs');
  approx(timeAtProgress(index, 2), 3000, 1e-9, 'progress 大于 1 → endMs');
  approx(timeAtProgress(index, 0.25), 1500, 1e-6, '四分之一弧长处');
  approx(timeAtProgress(index, 0.5), 2000, 1e-6, '一半弧长处');
  approx(timeAtProgress(index, 0.75), 2500, 1e-6, '四分之三弧长处');
});

test('trackTime · timeAtProgress(进度→时刻): index 缺失返回 null，progress 非有限数退回 startMs', () => {
  const index = buildTimeIndex(equator3());

  assert.ok(index, '应返回索引对象');
  assert.equal(timeAtProgress(null, 0.5), null, 'index 为 null 返回 null');
  assert.equal(timeAtProgress(undefined, 0.5), null, 'index 为 undefined 返回 null');
  assert.equal(timeAtProgress(null, Number.NaN), null, 'index 为 null 时非有限 progress 仍返回 null');
  assert.equal(timeAtProgress(index, Number.NaN), 1000, 'progress 为 NaN 时退回 startMs');
  assert.equal(
    timeAtProgress(index, Number.POSITIVE_INFINITY),
    1000,
    'progress 为 +Infinity 时退回 startMs',
  );
  assert.equal(
    timeAtProgress(index, Number.NEGATIVE_INFINITY),
    1000,
    'progress 为 -Infinity 时退回 startMs',
  );
});

test('trackTime · timeAtProgress(进度→时刻): totalLen 为 0 时返回 startMs', () => {
  const points = [
    { lng: -0.12, lat: 51.5, time: 4000 },
    { lng: -0.12, lat: 51.5, time: 5000 },
    { lng: -0.12, lat: 51.5, time: 6000 },
  ];
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  approx(index.totalLen, 0, 1e-9, 'totalLen 为 0');
  assert.equal(timeAtProgress(index, 0), 4000, 'progress 0 → startMs');
  assert.equal(timeAtProgress(index, 0.25), 4000, '零长轨迹上任意进度都停在起始时刻');
  assert.equal(timeAtProgress(index, 0.5), 4000);
  assert.equal(timeAtProgress(index, 0.9), 4000);
  // totalLen === 0 优先于「progress >= 1 返回 endMs」：零长度轨迹缩成一个点，任何进度都指向它。
  assert.equal(timeAtProgress(index, 1), 4000, 'progress 1 仍返回 startMs 而非 endMs');
  assert.equal(timeAtProgress(index, 2), 4000, 'progress 大于 1 仍返回 startMs');
  assert.equal(timeAtProgress(index, -1), 4000, 'progress 小于 0 仍返回 startMs');
});

test('trackTime · timeAtProgress(进度→时刻): 停留段平台返回最早的时刻', () => {
  const index = buildTimeIndex(dwell5());

  assert.ok(index, '应返回索引对象');
  // anchorLens = [0, d, d, d, 2d]；progress 0.5 命中平台，约定取平台最早时刻 1000。
  approx(timeAtProgress(index, 0.5), 1000, 1e-6, '平台上取最早时刻而非最晚时刻');
  approx(timeAtProgress(index, 0.25), 500, 1e-6, '平台之前正常插值');
  approx(timeAtProgress(index, 0.75), 3500, 1e-6, '平台之后正常插值');
  approx(timeAtProgress(index, 0), 0, 1e-9, 'progress 0 → startMs');
  approx(timeAtProgress(index, 1), 4000, 1e-9, 'progress 1 → endMs');
});

// ---------------------------------------------------------------------------
// 互逆性
// ---------------------------------------------------------------------------

test('trackTime · 互逆性: progressAtTime(timeAtProgress(p)) 回到 p', () => {
  const cases = [
    ['等距三点', equator3(), undefined],
    ['部分点缺时间戳', partialTime4(), undefined],
    ['两段折叠', twoSegments(), { segmentStarts: [0, 3], collapseSegmentGaps: true }],
  ];
  for (const [label, points, opts] of cases) {
    const index = buildTimeIndex(points, opts);
    assert.ok(index, `${label}: 应返回索引对象`);
    for (const p of [0, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]) {
      const t = timeAtProgress(index, p);
      assert.ok(Number.isFinite(t), `${label}: progress ${p} 应换算出有限时刻`);
      approx(progressAtTime(index, t), p, 1e-9, `${label}: progress ${p} 往返`);
    }
  }
});

test('trackTime · 互逆性: timeAtProgress(progressAtTime(t)) 回到 t', () => {
  const points = partialTime4();
  const index = buildTimeIndex(points);

  assert.ok(index, '应返回索引对象');
  for (const t of [1, 250, 500, 1000, 1500, 1999, 2000, 2001, 2500, 2999]) {
    const p = progressAtTime(index, t);
    assert.ok(p >= 0 && p <= 1, `progress 必须落在 [0,1]，t=${t} 得到 ${p}`);
    approx(timeAtProgress(index, p), t, 1e-6, `时刻 ${t} 往返`);
  }
});

test('trackTime · 端到端: 时间范围 · 索引 · 双向换算在同一条轨迹上自洽', () => {
  const points = dwell5();
  const cum = cumulative(points);

  const range = trackTimeRange(points);
  assert.ok(range, 'trackTimeRange 返回对象');
  assert.equal(range.startMs, 0);
  assert.equal(range.endMs, 4000);
  approx(range.spanSec, 4, 1e-12);
  assert.equal(range.anchorCount, 5);
  assert.equal(range.totalCount, 5);

  const index = buildTimeIndex(points);
  assert.ok(index, 'buildTimeIndex 返回索引');
  assert.equal(index.startMs, range.startMs, '索引起始时刻与时间范围一致');
  assert.equal(index.endMs, range.endMs, '索引结束时刻与时间范围一致');
  approxRel(index.totalLen, cum[4], 1e-9, 'totalLen');

  // 扫拨条从头拖到尾：progress 单调不减，且对应时刻单调不减。
  let lastProgress = -1;
  let lastTime = -Infinity;
  for (let t = 0; t <= 4000; t += 250) {
    const p = progressAtTime(index, t);
    assert.ok(p >= lastProgress - 1e-12, `progress 随时间单调不减，t=${t}`);
    lastProgress = p;
  }
  for (let i = 0; i <= 20; i++) {
    const t = timeAtProgress(index, i / 20);
    assert.ok(t >= lastTime - 1e-6, `时刻随 progress 单调不减，p=${i / 20}`);
    lastTime = t;
  }
  approx(lastProgress, 1, 1e-12, '拖到末尾 progress 为 1');
  approx(lastTime, 4000, 1e-9, '拖到末尾对应结束时刻');
});
