import test from 'node:test';
import assert from 'node:assert/strict';

import {
  trackTimeRange,
  buildTimeIndex,
  progressAtTime,
  timeAtProgress,
} from '../../src/core/track-time.mjs';

// ---------------------------------------------------------------------------
// 独立复刻的墨卡托公式（照 spec 手写，用来推导期望值）
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

// 赤道上等经度间隔的三点：cumLen = [0, d, 2d]，弧长比例干净可推导。
const EQUATOR_3 = [
  { lng: 0, lat: 0, time: 1000 },
  { lng: 1, lat: 0, time: 2000 },
  { lng: 2, lat: 0, time: 3000 },
];

test('trackTime · trackTimeRange(时间范围): 三点轨迹返回起止时刻与跨度', () => {
  const range = trackTimeRange(EQUATOR_3);

  assert.ok(range, 'trackTimeRange 对带时间戳的轨迹应返回对象');
  assert.equal(range.startMs, 1000, 'startMs 取有效时间戳最小值');
  assert.equal(range.endMs, 3000, 'endMs 取有效时间戳最大值');
  approx(range.spanSec, 2, 1e-12, 'spanSec = (endMs - startMs) / 1000');
  assert.equal(range.anchorCount, 3, '三个点都带时间戳');
  assert.equal(range.totalCount, 3, 'totalCount 是点总数');
});

test('trackTime · buildTimeIndex + progressAtTime: 按墨卡托弧长比例定位时刻', () => {
  const cum = cumulative(EQUATOR_3);
  const index = buildTimeIndex(EQUATOR_3);

  assert.ok(index, 'buildTimeIndex 对 3 个带时间戳的点应返回索引');
  assert.deepEqual(index.anchorTimes, [1000, 2000, 3000], '锚点时间按索引顺序');
  assert.equal(index.anchorTimes.length, index.anchorLens.length, '锚点时间与弧长一一对应');
  approx(index.anchorLens[1], cum[1], 1e-6, '第二个锚点弧长 = 首段墨卡托距离');
  approx(index.totalLen, cum[2], 1e-6, 'totalLen = 全部点累计弧长');
  assert.equal(index.droppedCount, 0, '时间严格递增，无锚点被丢弃');
  assert.equal(index.startMs, 1000, 'startMs = 首锚点时间');
  assert.equal(index.endMs, 3000, 'endMs = 末锚点时间');

  approx(progressAtTime(index, 1000), 0, 1e-12, '起点时刻 progress = 0');
  approx(progressAtTime(index, 1500), 0.25, 1e-9, '首段中点走过总弧长的四分之一');
  approx(progressAtTime(index, 2000), 0.5, 1e-9, '中间锚点走过总弧长的一半');
  approx(progressAtTime(index, 3000), 1, 1e-12, '终点时刻 progress = 1');
});

test('trackTime · timeAtProgress(进度→时刻): 与 progressAtTime 互逆', () => {
  const index = buildTimeIndex(EQUATOR_3);

  assert.ok(index, 'buildTimeIndex 应返回索引');
  assert.equal(timeAtProgress(index, 0), 1000, 'progress 0 对应起始时刻');
  assert.equal(timeAtProgress(index, 1), 3000, 'progress 1 对应结束时刻');
  approx(timeAtProgress(index, 0.25), 1500, 1e-6, '四分之一弧长处对应首段中点时刻');

  for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    approx(progressAtTime(index, timeAtProgress(index, p)), p, 1e-9, `progress ${p} 往返应回到自身`);
  }
});
