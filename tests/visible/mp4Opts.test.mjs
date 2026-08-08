// ==================== mp4Opts · MP4 帧参数（可见样例） ====================
// 覆盖 buildFrameOpts 的 DOM 快照与两条 proj 分支、buildTimeTruePlan 的帧时刻映射锚点。
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFrameOpts, buildTimeTruePlan } from '../../src/export/mp4-opts.mjs';
import { state, CARD_SIZE } from '../../src/state.mjs';
import { projectTrack } from '../../src/core/geo.mjs';
import { projectTrackOnAmap, computeOverlayScale } from '../../src/core/amap.mjs';
import { buildTimeIndex } from '../../src/core/track-time.mjs';

// ---------- 测试数据 ----------

const T0 = 1_700_000_000_000;

/** 5 个点的轨迹，坐标各异、时间戳等间隔（总跨度 100 秒）。 */
const TRACK = [
  { lng: 120.2000, lat: 31.2000, ele: 5, time: T0 },
  { lng: 120.2040, lat: 31.2030, ele: 6, time: T0 + 25_000 },
  { lng: 120.2100, lat: 31.2065, ele: 8, time: T0 + 50_000 },
  { lng: 120.2155, lat: 31.2110, ele: 7, time: T0 + 75_000 },
  { lng: 120.2210, lat: 31.2140, ele: 5, time: T0 + 100_000 },
];

const BASE_VALUES = {
  radius: '24',
  pad: '40',
  lineWidth: '6',
  mp4BgMode: 'card',
  mp4PageColor: '#ffffff',
  mp4GreenColor: '#00b140',
  bgColor: '#101418',
  bgOpacity: '80',
  lineColor: '#ff3b30',
  markerSize: '10',
  startColor: '#00c853',
  endColor: '#d50000',
  dotColor: '#ffffff',
  dotSize: '14',
};

const BASE_CHECKS = { showMarkers: true };

const ACTIVE_OVERLAY = {
  basemapImage: { tag: 'fake-basemap' },
  mapCenter: { lng: 120.2105, lat: 31.2070 },
  mapZoom: 13,
  spanPx: 800,
  contentSize: 1024,
  viewScale: 1,
  overlayMode: 'mask',
  overlayMaskOpacity: 0.35,
};

// ---------- 替身安装/还原 ----------

const ORIGINAL_TRACK_POINTS = state.trackPoints;

function setupEnv({ values = {}, checks = {}, mapOverlayState = null, trackPoints = TRACK } = {}) {
  const els = {};
  for (const [id, value] of Object.entries({ ...BASE_VALUES, ...values })) els[id] = { value };
  for (const [id, checked] of Object.entries({ ...BASE_CHECKS, ...checks })) els[id] = { checked };
  globalThis.document = { getElementById: (id) => (id in els ? els[id] : null) };
  globalThis.window = { mapOverlayState };
  state.trackPoints = trackPoints;
  return els;
}

function teardownEnv() {
  delete globalThis.document;
  delete globalThis.window;
  state.trackPoints = ORIGINAL_TRACK_POINTS;
}

// ---------- 断言工具 ----------

function assertApprox(actual, expected, tol, label) {
  assert.ok(
    typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tol,
    `${label}: 期望 ≈${expected}（容差 ${tol}），实得 ${actual}`,
  );
}

function assertProjEqual(actual, expected, label) {
  assert.ok(actual && typeof actual === 'object', `${label}: proj 应为对象`);
  assert.ok(Array.isArray(actual.points), `${label}: proj.points 应为数组`);
  assert.equal(actual.points.length, expected.points.length, `${label}: 投影点数一致`);
  assertApprox(actual.fullSize, expected.fullSize, 1e-9, `${label}: proj.fullSize`);
  for (let i = 0; i < expected.points.length; i++) {
    assertApprox(actual.points[i].x, expected.points[i].x, 1e-6, `${label}: 第 ${i} 点 x`);
    assertApprox(actual.points[i].y, expected.points[i].y, 1e-6, `${label}: 第 ${i} 点 y`);
  }
}

// ==================== buildFrameOpts ====================

test('mp4Opts · buildFrameOpts(控件快照): 15 个字段取值正确且非底图分支用 projectTrack', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: null });

  const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });

  assert.equal(opts.radius, 24);
  assert.equal(opts.pad, 40);
  assert.equal(opts.lineWidth, 6);
  assert.equal(opts.bgMode, 'card');
  assert.equal(opts.pageColor, '#ffffff');
  assert.equal(opts.greenColor, '#00b140');
  assert.equal(opts.bgColor, '#101418');
  assertApprox(opts.bgOpacity, 0.8, 1e-12, 'bgOpacity 应为 80/100');
  assert.equal(opts.lineColor, '#ff3b30');
  assert.equal(opts.showMarkers, true);
  assert.equal(opts.markerSize, 10);
  assert.equal(opts.startColor, '#00c853');
  assert.equal(opts.endColor, '#d50000');
  assert.equal(opts.dotColor, '#ffffff');
  assert.equal(opts.dotSize, 14);

  // 数值字段是 number 而非字符串
  for (const key of ['radius', 'pad', 'lineWidth', 'bgOpacity', 'markerSize', 'dotSize']) {
    assert.equal(typeof opts[key], 'number', `${key} 应为 number`);
  }

  // overlay 未激活 → 地图字段取缺省值
  assert.equal(opts.basemapImage, null);
  assert.equal(opts.mapCenter, null);
  assert.equal(opts.mapZoom, null);
  assert.equal(opts.spanPx, 0);
  assert.equal(opts.contentSize, 1024);
  assert.equal(opts.viewScale, 1);
  assert.equal(opts.overlayMode, 'none');
  assert.equal(opts.overlayMaskOpacity, 0);

  // padPx = 40 * 1080 / 600 = 72 → 投影边长 1080 - 144 = 936
  const padPx = 40 * 1080 / CARD_SIZE;
  assertProjEqual(opts.proj, projectTrack(TRACK, 1080 - 2 * padPx), '非底图分支 proj');
  assert.equal(opts.proj.fullSize, 936);
});

test('mp4Opts · buildFrameOpts(底图分支): overlay 激活时 proj 用 projectTrackOnAmap', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: ACTIVE_OVERLAY });

  const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });

  // 地图字段透传
  assert.equal(opts.basemapImage, ACTIVE_OVERLAY.basemapImage);
  assert.deepEqual(opts.mapCenter, ACTIVE_OVERLAY.mapCenter);
  assert.equal(opts.mapZoom, 13);
  assert.equal(opts.spanPx, 800);
  assert.equal(opts.contentSize, 1024);
  assert.equal(opts.viewScale, 1);
  assert.equal(opts.overlayMode, 'mask');
  assert.equal(opts.overlayMaskOpacity, 0.35);

  const padPx = 40 * 1080 / CARD_SIZE;
  const k = computeOverlayScale(800, 1080, padPx, 1);
  const expected = projectTrackOnAmap(TRACK, 1080, ACTIVE_OVERLAY.mapCenter, 13, k);
  assertProjEqual(opts.proj, expected, '底图分支 proj');
});

// ==================== buildTimeTruePlan ====================

test('mp4Opts · buildTimeTruePlan(帧时刻映射): 全程窗口下锚点与帧数正确', () => {
  const index = buildTimeIndex(TRACK, {});
  assert.ok(index, '样例轨迹应当能建出时间索引');

  const plan = buildTimeTruePlan({ points: TRACK, scale: 1, fps: 30 });

  assert.ok(plan, '有效时间轴应当产出 plan');
  assert.equal(plan.t0Ms, index.startMs);
  assert.equal(plan.t1Ms, index.endMs);
  assert.equal(plan.t0Ms, T0);
  assert.equal(plan.t1Ms, T0 + 100_000);
  assertApprox(plan.durationSec, 100, 1e-9, 'durationSec');
  assert.equal(plan.frames, 3000);
  assert.deepEqual(plan.index, index);

  // 契约锚点：第 0 帧就是窗口起点；动画第 x 秒 = 真实 t0 + x * scale * 1000
  assert.equal(typeof plan.frameTimeMs, 'function');
  assert.equal(plan.frameTimeMs(0), plan.t0Ms);
  for (const x of [1, 5, 17]) {
    assertApprox(plan.frameTimeMs(x * 30), plan.t0Ms + x * 1 * 1000, 1e-6, `frameTimeMs(${x}*fps)`);
  }
});
