// ==================== mp4Opts · MP4 帧参数（隐藏全量） ====================
// buildFrameOpts：DOM 快照 · 地图字段来源分支 · proj 预投影分支 · padPx 缩放 · 空轨迹 · 错误传播
// buildTimeTruePlan：窗口 clamp · 帧数换算 · 帧时刻映射锚点 · 空窗口 · 参数校验
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFrameOpts, buildTimeTruePlan } from '../../src/export/mp4-opts.mjs';
import { state, CARD_SIZE } from '../../src/state.mjs';
import { projectTrack } from '../../src/core/geo.mjs';
import { projectTrackOnAmap, computeOverlayScale } from '../../src/core/amap.mjs';
import { buildTimeIndex } from '../../src/core/track-time.mjs';

// ---------- 测试数据 ----------

const T0 = 1_700_000_000_000;

/** 6 个点、坐标各异、时间戳等间隔（总跨度 100 秒）。 */
const TRACK = [
  { lng: 120.2000, lat: 31.2000, ele: 5, time: T0 },
  { lng: 120.2040, lat: 31.2030, ele: 6, time: T0 + 20_000 },
  { lng: 120.2100, lat: 31.2065, ele: 8, time: T0 + 40_000 },
  { lng: 120.2155, lat: 31.2110, ele: 7, time: T0 + 60_000 },
  { lng: 120.2210, lat: 31.2140, ele: 5, time: T0 + 80_000 },
  { lng: 120.2280, lat: 31.2185, ele: 4, time: T0 + 100_000 },
];

/** 同样形状但完全没有时间戳。 */
const NO_TIME_TRACK = TRACK.map(({ lng, lat, ele }) => ({ lng, lat, ele }));

/** 只有一个点带时间戳 → 锚点不足 2 个。 */
const ONE_ANCHOR_TRACK = NO_TIME_TRACK.map((p, i) => (i === 2 ? { ...p, time: T0 } : { ...p }));

/** 两段拼接：第二段起始时间比第一段末尾晚一小时。 */
const SEG_TRACK = [
  { lng: 120.2000, lat: 31.2000, time: T0 },
  { lng: 120.2040, lat: 31.2030, time: T0 + 10_000 },
  { lng: 120.2100, lat: 31.2065, time: T0 + 20_000 },
  { lng: 120.3000, lat: 31.3000, time: T0 + 3_600_000 },
  { lng: 120.3040, lat: 31.3030, time: T0 + 3_610_000 },
  { lng: 120.3100, lat: 31.3065, time: T0 + 3_620_000 },
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

/** 激活中的地图 overlay 运行时状态，字段值刻意做得显眼便于识别来源。 */
const ACTIVE_OVERLAY = {
  basemapImage: { tag: 'fake-basemap' },
  mapCenter: { lng: 120.2140, lat: 31.2092 },
  mapZoom: 13,
  spanPx: 800,
  contentSize: 1024,
  viewScale: 1,
  overlayMode: 'mask',
  overlayMaskOpacity: 0.35,
};

/** skipBasemap 场景专用：每个字段都与缺省值不同，一旦被读到就能识别出来。 */
const LOUD_OVERLAY = {
  basemapImage: { tag: 'SHOULD-NOT-APPEAR' },
  mapCenter: { lng: 1.5, lat: 2.5 },
  mapZoom: 9,
  spanPx: 777,
  contentSize: 2048,
  viewScale: 3.5,
  overlayMode: 'mask',
  overlayMaskOpacity: 0.42,
};

const MAP_DEFAULTS = {
  basemapImage: null,
  mapCenter: null,
  mapZoom: null,
  spanPx: 0,
  contentSize: 1024,
  viewScale: 1,
  overlayMode: 'none',
  overlayMaskOpacity: 0,
};

// ---------- 替身安装/还原 ----------

const ORIGINAL_TRACK_POINTS = state.trackPoints;

function setupEnv({
  values = {},
  checks = {},
  mapOverlayState = null,
  windowObj = undefined,
  trackPoints = TRACK,
} = {}) {
  const els = {};
  for (const [id, value] of Object.entries({ ...BASE_VALUES, ...values })) els[id] = { value };
  for (const [id, checked] of Object.entries({ ...BASE_CHECKS, ...checks })) els[id] = { checked };
  globalThis.document = { getElementById: (id) => (id in els ? els[id] : null) };
  globalThis.window = windowObj === undefined ? { mapOverlayState } : windowObj;
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
  assert.ok(actual.points.length > 0, `${label}: proj.points 应非空`);
  assert.equal(actual.points.length, expected.points.length, `${label}: 投影点数一致`);
  assertApprox(actual.fullSize, expected.fullSize, 1e-9, `${label}: proj.fullSize`);
  for (let i = 0; i < expected.points.length; i++) {
    assertApprox(actual.points[i].x, expected.points[i].x, 1e-6, `${label}: 第 ${i} 点 x`);
    assertApprox(actual.points[i].y, expected.points[i].y, 1e-6, `${label}: 第 ${i} 点 y`);
  }
}

/**
 * 调用 fn 并交回它抛出的错误。
 * 尚未实现的 stub 抛的 NotImplementedError 直接向外传，
 * 让「尚未实现」与「抛了错但契约不符」在报错里一眼可分。
 */
function captureError(fn) {
  try {
    fn();
  } catch (err) {
    const notImplemented = !!err
      && (err.name === 'NotImplementedError' || /NotImplementedError/.test(String(err.message)));
    if (notImplemented) throw err;
    return err;
  }
  assert.fail('期望抛出错误，实际正常返回');
}

/** 两组投影是否至少有一个点明显不同。 */
function projDiffers(a, b) {
  return a.points.some((p, i) => Math.abs(p.x - b.points[i].x) > 1e-3 || Math.abs(p.y - b.points[i].y) > 1e-3);
}

function expectedAmapProj(size, pad, overlay, points = TRACK) {
  const padPx = pad * size / CARD_SIZE;
  const k = computeOverlayScale(overlay.spanPx, size, padPx, overlay.viewScale);
  return projectTrackOnAmap(points, size, overlay.mapCenter, overlay.mapZoom, k);
}

function expectedPlainProj(size, pad, points = TRACK) {
  const padPx = pad * size / CARD_SIZE;
  return projectTrack(points, size - 2 * padPx);
}

// ==================== buildFrameOpts · DOM 字段 ====================

test('mp4Opts · buildFrameOpts(DOM 字段): 15 个控件值逐个映射且数值字段是 number', (t) => {
  t.after(teardownEnv);
  setupEnv();

  const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });

  assert.equal(opts.radius, 24);
  assert.equal(opts.pad, 40);
  assert.equal(opts.lineWidth, 6);
  assert.equal(opts.bgMode, 'card');
  assert.equal(opts.pageColor, '#ffffff');
  assert.equal(opts.greenColor, '#00b140');
  assert.equal(opts.bgColor, '#101418');
  assertApprox(opts.bgOpacity, 0.8, 1e-12, 'bgOpacity');
  assert.equal(opts.lineColor, '#ff3b30');
  assert.equal(opts.showMarkers, true);
  assert.equal(opts.markerSize, 10);
  assert.equal(opts.startColor, '#00c853');
  assert.equal(opts.endColor, '#d50000');
  assert.equal(opts.dotColor, '#ffffff');
  assert.equal(opts.dotSize, 14);

  for (const key of ['radius', 'pad', 'lineWidth', 'bgOpacity', 'markerSize', 'dotSize']) {
    assert.equal(typeof opts[key], 'number', `${key} 应为 number 而非字符串`);
  }
  for (const key of ['bgMode', 'pageColor', 'greenColor', 'bgColor', 'lineColor', 'startColor', 'endColor', 'dotColor']) {
    assert.equal(typeof opts[key], 'string', `${key} 应为字符串`);
  }
  assert.equal(typeof opts.showMarkers, 'boolean', 'showMarkers 应为布尔');
});

test('mp4Opts · buildFrameOpts(DOM 字段): 换一组控件值同样逐个映射', (t) => {
  t.after(teardownEnv);
  setupEnv({
    values: {
      radius: '0',
      pad: '12',
      lineWidth: '2.5',
      mp4BgMode: 'green',
      mp4PageColor: '#123456',
      mp4GreenColor: '#00ff00',
      bgColor: '#000000',
      bgOpacity: '0',
      lineColor: '#abcdef',
      markerSize: '3',
      startColor: '#111111',
      endColor: '#222222',
      dotColor: '#333333',
      dotSize: '0',
    },
    checks: { showMarkers: false },
  });

  const opts = buildFrameOpts({ skipBasemap: false, size: 600 });

  assert.equal(opts.radius, 0);
  assert.equal(opts.pad, 12);
  assert.equal(opts.lineWidth, 2.5);
  assert.equal(opts.bgMode, 'green');
  assert.equal(opts.pageColor, '#123456');
  assert.equal(opts.greenColor, '#00ff00');
  assert.equal(opts.bgColor, '#000000');
  assert.equal(opts.bgOpacity, 0);
  assert.equal(opts.lineColor, '#abcdef');
  assert.equal(opts.showMarkers, false);
  assert.equal(opts.markerSize, 3);
  assert.equal(opts.startColor, '#111111');
  assert.equal(opts.endColor, '#222222');
  assert.equal(opts.dotColor, '#333333');
  assert.equal(opts.dotSize, 0);
});

for (const [raw, expected] of [['0', 0], ['1', 0.01], ['37', 0.37], ['55', 0.55], ['100', 1]]) {
  test(`mp4Opts · buildFrameOpts(bgOpacity 换算): '${raw}' → ${expected}`, (t) => {
    t.after(teardownEnv);
    setupEnv({ values: { bgOpacity: raw } });

    const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });
    assertApprox(opts.bgOpacity, expected, 1e-12, `bgOpacity('${raw}')`);
  });
}

// ==================== buildFrameOpts · 地图字段来源 ====================

test('mp4Opts · buildFrameOpts(地图字段): skipBasemap 时取缺省值且不带出 overlay 的值', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: LOUD_OVERLAY });

  const opts = buildFrameOpts({ skipBasemap: true, size: 1080 });

  for (const [key, value] of Object.entries(MAP_DEFAULTS)) {
    assert.equal(opts[key], value, `skipBasemap 时 ${key} 应为缺省值 ${JSON.stringify(value)}`);
  }
  // overlay 里的显眼值一个都不该被带出来
  for (const key of Object.keys(MAP_DEFAULTS)) {
    assert.notDeepEqual(opts[key], LOUD_OVERLAY[key], `${key} 不应取自 overlay`);
  }
  assert.equal(
    Object.values(opts).includes(LOUD_OVERLAY.basemapImage),
    false,
    'overlay 的 basemapImage 对象不应出现在任何字段里',
  );
  // 其余控件字段照常
  assert.equal(opts.radius, 24);
  assert.equal(opts.bgMode, 'card');
});

test('mp4Opts · buildFrameOpts(地图字段): skipBasemap 时 window 上没有 mapOverlayState 也不出错', (t) => {
  t.after(teardownEnv);
  setupEnv({ windowObj: {} });

  const opts = buildFrameOpts({ skipBasemap: true, size: 720 });

  for (const [key, value] of Object.entries(MAP_DEFAULTS)) {
    assert.equal(opts[key], value, `${key} 应为缺省值`);
  }
});

test('mp4Opts · buildFrameOpts(地图字段): overlay 激活时 8 个字段透传自 window.mapOverlayState', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: ACTIVE_OVERLAY });

  const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });

  assert.equal(opts.basemapImage, ACTIVE_OVERLAY.basemapImage);
  assert.deepEqual(opts.mapCenter, ACTIVE_OVERLAY.mapCenter);
  assert.equal(opts.mapZoom, ACTIVE_OVERLAY.mapZoom);
  assert.equal(opts.spanPx, ACTIVE_OVERLAY.spanPx);
  assert.equal(opts.contentSize, ACTIVE_OVERLAY.contentSize);
  assert.equal(opts.viewScale, ACTIVE_OVERLAY.viewScale);
  assert.equal(opts.overlayMode, ACTIVE_OVERLAY.overlayMode);
  assert.equal(opts.overlayMaskOpacity, ACTIVE_OVERLAY.overlayMaskOpacity);
});

test('mp4Opts · buildFrameOpts(地图字段): mapOverlayState 为 null 时取缺省值', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: null });

  const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });

  for (const [key, value] of Object.entries(MAP_DEFAULTS)) {
    assert.equal(opts[key], value, `${key} 应为缺省值 ${JSON.stringify(value)}`);
  }
  assert.equal(opts.dotSize, 14, '控件字段照常取值');
});

// ==================== buildFrameOpts · proj 分支 ====================

test('mp4Opts · buildFrameOpts(proj 分支): 底图激活 + bgMode=card 用 projectTrackOnAmap 的结果', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: ACTIVE_OVERLAY, values: { mp4BgMode: 'card' } });

  const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });
  const expected = expectedAmapProj(1080, 40, ACTIVE_OVERLAY);

  assertProjEqual(opts.proj, expected, '底图分支 proj');
  assert.equal(opts.proj.fullSize, 1080, '底图分支 fullSize 为画面边长');
  assert.ok(
    projDiffers(opts.proj, expectedPlainProj(1080, 40)),
    '底图分支的坐标应与非底图分支不同',
  );
});

test('mp4Opts · buildFrameOpts(proj 分支): bgMode=green 时即使有底图也用 projectTrack', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: ACTIVE_OVERLAY, values: { mp4BgMode: 'green' } });

  const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });

  assert.equal(opts.bgMode, 'green');
  assert.equal(opts.basemapImage, ACTIVE_OVERLAY.basemapImage, '绿幕仍然透传 basemapImage');
  assertProjEqual(opts.proj, expectedPlainProj(1080, 40), '绿幕分支 proj');
});

test('mp4Opts · buildFrameOpts(proj 分支): 无底图时用 projectTrack', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: { ...ACTIVE_OVERLAY, basemapImage: null } });

  const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });

  assert.equal(opts.basemapImage, null);
  assertProjEqual(opts.proj, expectedPlainProj(1080, 40), '无底图分支 proj');
});

test('mp4Opts · buildFrameOpts(proj 分支): skipBasemap 时即便 overlay 有底图也走 projectTrack', (t) => {
  t.after(teardownEnv);
  setupEnv({ mapOverlayState: ACTIVE_OVERLAY, values: { mp4BgMode: 'card' } });

  const opts = buildFrameOpts({ skipBasemap: true, size: 1080 });

  assertProjEqual(opts.proj, expectedPlainProj(1080, 40), 'skipBasemap 下的 proj');
});

for (const { size, pad, fullSize } of [
  { size: 1080, pad: 40, fullSize: 936 },
  { size: 600, pad: 40, fullSize: 520 },
  { size: 1920, pad: 30, fullSize: 1728 },
  { size: 720, pad: 0, fullSize: 720 },
]) {
  test(`mp4Opts · buildFrameOpts(padPx 缩放): size=${size} pad=${pad} → 投影边长 ${fullSize}`, (t) => {
    t.after(teardownEnv);
    setupEnv({ values: { pad: String(pad) }, mapOverlayState: null });

    const opts = buildFrameOpts({ skipBasemap: false, size });

    assertApprox(opts.proj.fullSize, fullSize, 1e-9, 'proj.fullSize');
    assertProjEqual(opts.proj, expectedPlainProj(size, pad), `size=${size} pad=${pad} 的 proj`);
  });
}

// ==================== buildFrameOpts · 空轨迹与错误传播 ====================

for (const [label, trackPoints] of [['null', null], ['空数组', []]]) {
  test(`mp4Opts · buildFrameOpts(空轨迹): trackPoints 为${label}时 proj 为 null，其余字段照常`, (t) => {
    t.after(teardownEnv);
    setupEnv({ mapOverlayState: ACTIVE_OVERLAY, trackPoints });

    const opts = buildFrameOpts({ skipBasemap: false, size: 1080 });

    assert.equal(opts.proj, null, 'proj 应为 null');
    assert.equal(opts.radius, 24);
    assert.equal(opts.pad, 40);
    assertApprox(opts.bgOpacity, 0.8, 1e-12, 'bgOpacity');
    assert.equal(opts.showMarkers, true);
    assert.equal(opts.basemapImage, ACTIVE_OVERLAY.basemapImage);
    assert.equal(opts.mapZoom, 13);
  });
}

test('mp4Opts · buildFrameOpts(错误传播): 投影参数非法时让错误抛出而不吞掉', (t) => {
  t.after(teardownEnv);
  // amapZoom 合法区间为 [1,17]，99 会让 projectTrackOnAmap 抛 RangeError
  setupEnv({ mapOverlayState: { ...ACTIVE_OVERLAY, mapZoom: 99 } });

  const err = captureError(() => buildFrameOpts({ skipBasemap: false, size: 1080 }));
  assert.ok(err instanceof RangeError, `底图分支的投影错误应当向外传播，实得 ${err && err.name}`);
  assert.match(err.message, /amapZoom/, '应当是投影函数自己抛的错误');
});

// ==================== buildTimeTruePlan · 帧时刻映射 ====================

for (const scale of [1, 2, 0.5, 8]) {
  test(`mp4Opts · buildTimeTruePlan(帧时刻映射): scale=${scale} 时 frameTimeMs 锚点成立`, () => {
    const fps = 30;
    const plan = buildTimeTruePlan({ points: TRACK, scale, fps });

    assert.ok(plan, 'plan 应当产出');
    assert.equal(typeof plan.frameTimeMs, 'function', 'frameTimeMs 应为函数');
    assert.equal(plan.frameTimeMs(0), plan.t0Ms, 'frameTimeMs(0) === t0Ms');
    for (const x of [1, 2, 5, 13]) {
      assertApprox(
        plan.frameTimeMs(x * fps),
        plan.t0Ms + x * scale * 1000,
        1e-6,
        `scale=${scale} 时 frameTimeMs(${x}*fps)`,
      );
    }
    // 半帧位置同样线性
    assertApprox(plan.frameTimeMs(15), plan.t0Ms + 0.5 * scale * 1000, 1e-6, '半秒处的帧时刻');
    // 单调递增
    assert.ok(plan.frameTimeMs(1) > plan.frameTimeMs(0), 'frameTimeMs 应随帧号递增');
  });
}

test('mp4Opts · buildTimeTruePlan(帧时刻映射): fps=60 时锚点同样成立', () => {
  const plan = buildTimeTruePlan({ points: TRACK, scale: 1, fps: 60 });

  assert.ok(plan);
  assert.equal(plan.frameTimeMs(0), plan.t0Ms);
  assertApprox(plan.frameTimeMs(60), plan.t0Ms + 1000, 1e-6, 'frameTimeMs(fps)');
  assertApprox(plan.frameTimeMs(180), plan.t0Ms + 3000, 1e-6, 'frameTimeMs(3*fps)');
});

// ==================== buildTimeTruePlan · 时长与帧数 ====================

for (const { label, startOff, endOff, scale, fps, durationSec, frames } of [
  { label: '整段 100s / scale 1 / 30fps', startOff: 0, endOff: 100_000, scale: 1, fps: 30, durationSec: 100, frames: 3000 },
  { label: '窗口 60s / scale 1 / 30fps', startOff: 10_000, endOff: 70_000, scale: 1, fps: 30, durationSec: 60, frames: 1800 },
  { label: '窗口 60s / scale 2 / 30fps', startOff: 10_000, endOff: 70_000, scale: 2, fps: 30, durationSec: 30, frames: 900 },
  { label: '窗口 60s / scale 0.5 / 24fps', startOff: 10_000, endOff: 70_000, scale: 0.5, fps: 24, durationSec: 120, frames: 2880 },
  { label: '窗口 1017ms 触发 Math.round 向上', startOff: 0, endOff: 1017, scale: 1, fps: 30, durationSec: 1.017, frames: 31 },
  { label: '窗口 1010ms 触发 Math.round 向下', startOff: 0, endOff: 1010, scale: 1, fps: 30, durationSec: 1.01, frames: 30 },
]) {
  test(`mp4Opts · buildTimeTruePlan(时长与帧数): ${label}`, () => {
    const plan = buildTimeTruePlan({
      points: TRACK,
      startMs: T0 + startOff,
      endMs: T0 + endOff,
      scale,
      fps,
    });

    assert.ok(plan, 'plan 应当产出');
    assert.equal(plan.t0Ms, T0 + startOff);
    assert.equal(plan.t1Ms, T0 + endOff);
    assertApprox(plan.durationSec, durationSec, 1e-9, 'durationSec');
    assert.equal(plan.frames, frames, 'frames');
    assert.ok(Number.isInteger(plan.frames), 'frames 应为整数');
    // 末帧落在窗口终点附近（不超过半帧）
    assertApprox(
      plan.frameTimeMs(plan.frames),
      plan.t1Ms,
      (scale * 1000 / fps) * 0.5 + 1e-6,
      '末帧时刻应贴近 t1Ms',
    );
  });
}

test('mp4Opts · buildTimeTruePlan(帧数下界): 极短窗口至少产出 1 帧', () => {
  const plan = buildTimeTruePlan({
    points: TRACK,
    startMs: T0,
    endMs: T0 + 10, // 0.01s * 30fps = 0.3 帧 → Math.round 得 0
    scale: 1,
    fps: 30,
  });

  assert.ok(plan, '窗口非空时仍应产出 plan');
  assertApprox(plan.durationSec, 0.01, 1e-12, 'durationSec');
  assert.equal(plan.frames, 1, 'frames 下界为 1');
  assert.equal(plan.frameTimeMs(0), plan.t0Ms);
});

test('mp4Opts · buildTimeTruePlan(帧数下界): 大 scale 压缩到不足一帧时也给 1 帧', () => {
  const plan = buildTimeTruePlan({
    points: TRACK,
    startMs: T0,
    endMs: T0 + 100_000,
    scale: 100_000, // 100s / 100000 = 0.001s → 0.03 帧
    fps: 30,
  });

  assert.ok(plan);
  assertApprox(plan.durationSec, 0.001, 1e-12, 'durationSec');
  assert.equal(plan.frames, 1);
});

// ==================== buildTimeTruePlan · 窗口 clamp ====================

test('mp4Opts · buildTimeTruePlan(窗口 clamp): 越界的 startMs / endMs 被夹进轨迹时间范围', () => {
  const index = buildTimeIndex(TRACK, {});
  assert.ok(index);

  const plan = buildTimeTruePlan({
    points: TRACK,
    startMs: index.startMs - 500_000,
    endMs: index.endMs + 500_000,
    scale: 1,
    fps: 30,
  });

  assert.ok(plan);
  assert.equal(plan.t0Ms, index.startMs, 'startMs 被夹到轨迹起点');
  assert.equal(plan.t1Ms, index.endMs, 'endMs 被夹到轨迹终点');
});

for (const [label, startMs, endMs] of [
  ['都缺省', undefined, undefined],
  ['都是 null', null, null],
  ['都是 NaN', NaN, NaN],
  ['都是 Infinity', Infinity, -Infinity],
]) {
  test(`mp4Opts · buildTimeTruePlan(窗口缺省): ${label}时取轨迹全程`, () => {
    const index = buildTimeIndex(TRACK, {});
    const plan = buildTimeTruePlan({ points: TRACK, startMs, endMs, scale: 1, fps: 30 });

    assert.ok(plan, 'plan 应当产出');
    assert.equal(plan.t0Ms, index.startMs);
    assert.equal(plan.t1Ms, index.endMs);
  });
}

test('mp4Opts · buildTimeTruePlan(窗口缺省): 只给 startMs 时终点取轨迹终点', () => {
  const index = buildTimeIndex(TRACK, {});
  const plan = buildTimeTruePlan({ points: TRACK, startMs: T0 + 40_000, scale: 1, fps: 30 });

  assert.ok(plan);
  assert.equal(plan.t0Ms, T0 + 40_000);
  assert.equal(plan.t1Ms, index.endMs);
  assertApprox(plan.durationSec, (index.endMs - (T0 + 40_000)) / 1000, 1e-9, 'durationSec');
});

for (const [label, startMs, endMs] of [
  ['起止相等', T0 + 40_000, T0 + 40_000],
  ['起止反序', T0 + 80_000, T0 + 20_000],
  ['起点越过轨迹终点后与缺省终点相等', T0 + 900_000, undefined],
  ['终点越过轨迹起点前与缺省起点相等', undefined, T0 - 900_000],
]) {
  test(`mp4Opts · buildTimeTruePlan(空窗口): ${label}时返回 null`, () => {
    const plan = buildTimeTruePlan({ points: TRACK, startMs, endMs, scale: 1, fps: 30 });
    assert.equal(plan, null, '空窗口应当返回 null');
  });
}

// ==================== buildTimeTruePlan · 无时间轴 ====================

for (const [label, points] of [
  ['全部点无时间戳', NO_TIME_TRACK],
  ['只有一个点带时间戳', ONE_ANCHOR_TRACK],
  ['只有一个点', [{ lng: 120.2, lat: 31.2, time: T0 }]],
  ['空数组', []],
  ['points 为 null', null],
]) {
  test(`mp4Opts · buildTimeTruePlan(无时间轴): ${label}时返回 null 而不抛错`, () => {
    const plan = buildTimeTruePlan({ points, scale: 1, fps: 30 });
    assert.equal(plan, null, '无可用时间轴应当返回 null');
  });
}

test('mp4Opts · buildTimeTruePlan(分段选项): segmentStarts + collapseSegmentGaps 透传给时间索引', () => {
  const opts = { segmentStarts: [0, 3], collapseSegmentGaps: true };
  const collapsed = buildTimeIndex(SEG_TRACK, opts);
  const raw = buildTimeIndex(SEG_TRACK, {});
  assert.ok(collapsed && raw, '两种索引都应当建得出来');
  assert.ok(collapsed.endMs < raw.endMs, '折叠后总时长应当变短（前置条件）');

  const plan = buildTimeTruePlan({
    points: SEG_TRACK,
    segmentStarts: opts.segmentStarts,
    collapseSegmentGaps: true,
    scale: 1,
    fps: 30,
  });

  assert.ok(plan);
  assert.deepEqual(plan.index, collapsed, 'plan.index 应为折叠后的时间索引');
  assert.equal(plan.t0Ms, collapsed.startMs);
  assert.equal(plan.t1Ms, collapsed.endMs);
  assertApprox(plan.durationSec, (collapsed.endMs - collapsed.startMs) / 1000, 1e-9, 'durationSec');

  const plain = buildTimeTruePlan({
    points: SEG_TRACK,
    segmentStarts: opts.segmentStarts,
    collapseSegmentGaps: false,
    scale: 1,
    fps: 30,
  });
  assert.ok(plain);
  assert.equal(plain.t1Ms, raw.endMs, '不折叠时终点为原始时间轴终点');
});

// ==================== buildTimeTruePlan · 参数校验 ====================

for (const [label, scale] of [
  ['0', 0],
  ['负数', -1],
  ['负小数', -0.5],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
  ['undefined', undefined],
  ['null', null],
]) {
  test(`mp4Opts · buildTimeTruePlan(参数校验): scale 为${label}时抛 RangeError`, () => {
    const err = captureError(() => buildTimeTruePlan({ points: TRACK, scale, fps: 30 }));
    assert.ok(err instanceof RangeError, `应为 RangeError，实得 ${err && err.name}`);
    assert.equal(err.message, 'buildTimeTruePlan: scale must be a positive finite number');
  });
}

for (const [label, fps] of [
  ['0', 0],
  ['负数', -30],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['undefined', undefined],
  ['null', null],
]) {
  test(`mp4Opts · buildTimeTruePlan(参数校验): fps 为${label}时抛 RangeError`, () => {
    const err = captureError(() => buildTimeTruePlan({ points: TRACK, scale: 1, fps }));
    assert.ok(err instanceof RangeError, `应为 RangeError，实得 ${err && err.name}`);
    assert.equal(err.message, 'buildTimeTruePlan: fps must be a positive finite number');
  });
}

test('mp4Opts · buildTimeTruePlan(参数校验): scale/fps 校验先于时间轴检查', () => {
  // 轨迹没有时间轴（正常路径会返回 null），但非法 scale/fps 仍必须抛错
  const scaleErr = captureError(() => buildTimeTruePlan({ points: NO_TIME_TRACK, scale: 0, fps: 30 }));
  assert.ok(scaleErr instanceof RangeError, `应为 RangeError，实得 ${scaleErr && scaleErr.name}`);
  assert.equal(scaleErr.message, 'buildTimeTruePlan: scale must be a positive finite number');

  const fpsErr = captureError(() => buildTimeTruePlan({ points: NO_TIME_TRACK, scale: 1, fps: -1 }));
  assert.ok(fpsErr instanceof RangeError, `应为 RangeError，实得 ${fpsErr && fpsErr.name}`);
  assert.equal(fpsErr.message, 'buildTimeTruePlan: fps must be a positive finite number');

  const nullPointsErr = captureError(() => buildTimeTruePlan({ points: null, scale: NaN, fps: 30 }));
  assert.ok(nullPointsErr instanceof RangeError, 'points 为 null 时也先校验 scale');
});

for (const [label, params] of [['undefined', undefined], ['null', null]]) {
  test(`mp4Opts · buildTimeTruePlan(参数校验): 入参为${label}时抛 TypeError`, () => {
    const err = captureError(() => buildTimeTruePlan(params));
    assert.ok(err instanceof TypeError, `应为 TypeError，实得 ${err && err.name}`);
    assert.equal(err.message, 'buildTimeTruePlan: params must be an object');
  });
}

test('mp4Opts · buildTimeTruePlan(返回结构): plan 字段齐备且类型正确', () => {
  const plan = buildTimeTruePlan({ points: TRACK, scale: 1.5, fps: 25 });

  assert.ok(plan && typeof plan === 'object');
  for (const key of ['index', 't0Ms', 't1Ms', 'durationSec', 'frames', 'frameTimeMs']) {
    assert.ok(key in plan, `plan 应含字段 ${key}`);
  }
  assert.equal(typeof plan.t0Ms, 'number');
  assert.equal(typeof plan.t1Ms, 'number');
  assert.equal(typeof plan.durationSec, 'number');
  assert.equal(typeof plan.frames, 'number');
  assert.equal(typeof plan.frameTimeMs, 'function');
  assert.ok(plan.index && typeof plan.index === 'object', 'index 应为时间索引对象');
  assert.equal(typeof plan.index.startMs, 'number');
  assert.equal(typeof plan.index.endMs, 'number');
  assert.ok(plan.t1Ms > plan.t0Ms, 't1Ms 应大于 t0Ms');
});
