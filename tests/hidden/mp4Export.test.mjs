/**
 * mp4Export · 隐藏测试
 *
 * 两类断言：
 *   1. src/export/mp4-plan.mjs 的四个函数做真实单元测试（DOM / window / 共享状态用替身注入）。
 *   2. src/export/mp4.mjs 的主流程做静态源码断言（取材走 tests/helpers/source.mjs）。
 *
 * 每个用例自己装卸替身与 state / timeMode，测试之间无共享可变状态、不依赖执行顺序。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveExportPlan,
  frameProgress,
  formatEta,
  buildExportSidecar,
} from '../../src/export/mp4-plan.mjs';
import { state } from '../../src/state.mjs';
import { timeMode, currentExportWindow } from '../../src/ui/time-mode.mjs';
import { clampMp4Duration, mp4Bitrate } from '../../src/core/export-params.mjs';
import { buildTimeTrueFilename, buildSidecarMeta } from '../../src/core/export-meta.mjs';
import { progressAtTime } from '../../src/core/track-time.mjs';
import { buildTimeTruePlan } from '../../src/export/mp4-opts.mjs';
import {
  streamSinkSupported,
  MP4_MAX_DURATION_STREAM,
  MP4_MAX_DURATION_MEMORY,
} from '../../src/export/mp4-sink.mjs';
import { ROOT } from '../helpers/source.mjs';

/* ==================== 替身与环境 ==================== */

/** 导出面板上决策层会读到的控件，默认值取自 index.html。 */
function makeEls(over = {}) {
  const base = {
    exportRes: { value: '1080' },
    mp4Quality: { value: 'medium' },
    mp4Fps: { value: '30' },
    mp4Duration: { value: '6' },
    mp4Eta: { textContent: '' },
    mp4TimeModeEven: { checked: true },
    mp4TimeModeTrue: { checked: false },
    mp4TimeStart: { value: '' },
    mp4TimeEnd: { value: '' },
    mp4TimeScale: { value: '1' },
    mp4TrueFps: { value: '30' },
    mp4CollapseGaps: { checked: false },
    mp4TrueDurationHint: { textContent: '', style: {} },
    mp4CollapseGapsField: { style: {} },
    mp4TimeModeHint: { textContent: '', style: {} },
  };
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = { ...v };
  for (const [k, v] of Object.entries(over)) out[k] = { ...(out[k] || {}), ...v };
  return out;
}

/** 装上 document / window 替身与轨迹状态，跑完 fn 后原样还原。 */
function withEnv(cfg, fn) {
  const hadDoc = 'document' in globalThis;
  const oldDoc = globalThis.document;
  const hadWin = 'window' in globalThis;
  const oldWin = globalThis.window;
  const oldPoints = state.trackPoints;
  const oldFiles = state.trackFiles;
  const tmKeys = Object.keys(timeMode);
  const tmSnapshot = { ...timeMode };
  try {
    const els = makeEls(cfg.els);
    globalThis.document = { getElementById: (id) => els[id] || null };
    globalThis.window = cfg.win === undefined ? {} : cfg.win;
    if ('points' in cfg) state.trackPoints = cfg.points;
    if ('files' in cfg) state.trackFiles = cfg.files;
    if (cfg.timeMode) Object.assign(timeMode, cfg.timeMode);
    return fn(els);
  } finally {
    for (const k of Object.keys(timeMode)) if (!tmKeys.includes(k)) delete timeMode[k];
    Object.assign(timeMode, tmSnapshot);
    state.trackPoints = oldPoints;
    state.trackFiles = oldFiles;
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    if (hadWin) globalThis.window = oldWin;
    else delete globalThis.window;
  }
}

/** 流式写盘可用的 window 替身：showSaveFilePicker 与 Mp4Muxer 齐备。 */
function streamingWindow() {
  return {
    showSaveFilePicker: async () => ({}),
    Mp4Muxer: {
      Muxer: function Muxer() {},
      ArrayBufferTarget: function ArrayBufferTarget() {},
      StreamTarget: function StreamTarget() {},
      FileSystemWritableFileStreamTarget: function FileSystemWritableFileStreamTarget() {},
    },
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** epoch 毫秒 → <input type="datetime-local" step="1"> 的本地时刻取值。 */
function dtLocal(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

const T0 = Date.UTC(2024, 4, 18, 1, 0, 0);

/** 4 点匀速直线轨迹，跨 30 秒。 */
function straightTrack() {
  return [
    { lng: 120.0, lat: 31.0, time: T0 },
    { lng: 120.01, lat: 31.0, time: T0 + 10_000 },
    { lng: 120.02, lat: 31.0, time: T0 + 20_000 },
    { lng: 120.03, lat: 31.0, time: T0 + 30_000 },
  ];
}

/** 中段原地停留 60 秒的轨迹，跨 80 秒。 */
function pausedTrack() {
  return [
    { lng: 120.0, lat: 31.0, time: T0 },
    { lng: 120.01, lat: 31.0, time: T0 + 10_000 },
    { lng: 120.01, lat: 31.0, time: T0 + 40_000 },
    { lng: 120.01, lat: 31.0, time: T0 + 70_000 },
    { lng: 120.02, lat: 31.0, time: T0 + 80_000 },
  ];
}

/** 跨 5 小时的轨迹，用来把真实时长顶穿上限。 */
function longTrack() {
  const out = [];
  for (let i = 0; i <= 10; i++) {
    out.push({ lng: 120 + i * 0.01, lat: 31.0, time: T0 + i * 1_800_000 });
  }
  return out;
}

/** 时间真实模式的一整套控件取值。 */
function trueModeEls(startMs, endMs, { scale = '1', fps = '30', collapse = false } = {}) {
  return {
    mp4TimeModeEven: { checked: false },
    mp4TimeModeTrue: { checked: true },
    mp4TimeStart: { value: dtLocal(startMs) },
    mp4TimeEnd: { value: dtLocal(endMs) },
    mp4TimeScale: { value: scale },
    mp4TrueFps: { value: fps },
    mp4CollapseGaps: { checked: collapse },
  };
}

/** 时间轴就绪的 timeMode 属性。 */
function trueModeState(points) {
  const startMs = points[0].time;
  const endMs = points[points.length - 1].time;
  return {
    available: true,
    range: { startMs, endMs, start: startMs, end: endMs },
  };
}

const near = (a, b, eps = 1e-9) =>
  assert.ok(
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps,
    `期望 ${a} ≈ ${b}（容差 ${eps}）`
  );

/* ==================== resolveExportPlan · 匀速模式 ==================== */

test('mp4Export · resolveExportPlan(导出决策): 匀速模式给出规格里的全部字段', () => {
  withEnv(
    {
      els: {
        exportRes: { value: '1080' },
        mp4Quality: { value: 'medium' },
        mp4Fps: { value: '60' },
        mp4Duration: { value: '8' },
      },
      win: {},
      points: straightTrack(),
      files: [{ name: 'ride.gpx', points: straightTrack() }],
    },
    () => {
      const plan = resolveExportPlan();

      for (const key of [
        'mode', 'fps', 'frames', 'durationSec', 'size', 'quality', 'bitrate',
        'maxDurationSec', 'preferStream', 'suggestedName', 'timePlan', 't0Ms', 'scale',
      ]) {
        assert.ok(Object.hasOwn(plan, key), `plan 应当带有 ${key} 字段`);
      }

      assert.equal(plan.mode, 'even');
      assert.equal(plan.fps, 60);
      assert.equal(plan.size, 1080);
      assert.equal(plan.quality, 'medium');
      assert.equal(plan.bitrate, mp4Bitrate(1080, 'medium'));
      assert.equal(plan.preferStream, false);
      assert.equal(plan.maxDurationSec, MP4_MAX_DURATION_MEMORY);
      assert.equal(plan.durationSec, clampMp4Duration(8, MP4_MAX_DURATION_MEMORY));
      assert.equal(plan.durationSec, 8);
      assert.equal(plan.frames, 480);
      assert.equal(plan.suggestedName, '轨迹动画.mp4');
      assert.strictEqual(plan.timePlan, null);
      assert.strictEqual(plan.t0Ms, null);
      assert.equal(plan.scale, 1);
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): 分辨率先转数值，码率落 720 那一档', () => {
  assert.notEqual(
    mp4Bitrate(720, 'high'),
    mp4Bitrate(1080, 'high'),
    '前置：720 与 1080 的高质量码率本就不同，这条断言才有意义'
  );

  withEnv(
    {
      els: { exportRes: { value: '720' }, mp4Quality: { value: 'high' } },
      win: {},
      points: straightTrack(),
      files: [{ name: 'ride.gpx', points: straightTrack() }],
    },
    () => {
      const plan = resolveExportPlan();
      assert.equal(typeof plan.size, 'number', 'size 必须是数值，字符串会让 mp4Bitrate 查表失手');
      assert.equal(plan.size, 720);
      assert.equal(plan.bitrate, mp4Bitrate(720, 'high'));
      assert.notEqual(plan.bitrate, mp4Bitrate(1080, 'high'));
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): 分辨率为空或 0 时回落 1080', () => {
  for (const value of ['', '0', 'abc']) {
    withEnv(
      {
        els: { exportRes: { value }, mp4Quality: { value: 'low' } },
        win: {},
        points: straightTrack(),
        files: [{ name: 'ride.gpx', points: straightTrack() }],
      },
      () => {
        const plan = resolveExportPlan();
        assert.equal(plan.size, 1080, `exportRes="${value}" 应当回落 1080`);
        assert.equal(plan.bitrate, mp4Bitrate(1080, 'low'));
      }
    );
  }
});

test('mp4Export · resolveExportPlan(导出决策): 匀速帧率经 Math.max(1, value || 30) 归一', () => {
  const cases = [
    ['30', 30],
    ['60', 60],
    ['', 30],
    ['0', 30],
    ['abc', 30],
    ['-5', 1],
    ['0.5', 1],
  ];
  for (const [value, expected] of cases) {
    withEnv(
      {
        els: { mp4Fps: { value }, mp4Duration: { value: '4' } },
        win: {},
        points: straightTrack(),
        files: [{ name: 'ride.gpx', points: straightTrack() }],
      },
      () => {
        const plan = resolveExportPlan();
        assert.equal(plan.fps, expected, `mp4Fps="${value}" 应当归一到 ${expected}`);
        assert.equal(plan.frames, Math.max(1, Math.round(plan.durationSec * expected)));
      }
    );
  }
});

test('mp4Export · resolveExportPlan(导出决策): 匀速时长被 maxDurationSec 夹取且 frames 按夹后时长重算', () => {
  withEnv(
    {
      els: { mp4Duration: { value: '5000' }, mp4Fps: { value: '30' } },
      win: {}, // 全内存路径，上限 600 秒
      points: straightTrack(),
      files: [{ name: 'ride.gpx', points: straightTrack() }],
    },
    () => {
      const plan = resolveExportPlan();
      assert.equal(plan.maxDurationSec, MP4_MAX_DURATION_MEMORY);
      assert.equal(plan.durationSec, clampMp4Duration(5000, MP4_MAX_DURATION_MEMORY));
      assert.equal(plan.durationSec, MP4_MAX_DURATION_MEMORY);
      assert.ok(plan.durationSec < 5000, '超上限的时长必须被压下来');
      assert.equal(plan.frames, Math.round(MP4_MAX_DURATION_MEMORY * 30));
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): maxDurationSec 随流式可用性在 21600 / 600 之间切换', () => {
  assert.equal(MP4_MAX_DURATION_STREAM, 21600);
  assert.equal(MP4_MAX_DURATION_MEMORY, 600);

  withEnv(
    {
      win: {},
      points: straightTrack(),
      files: [{ name: 'ride.gpx', points: straightTrack() }],
    },
    () => {
      const plan = resolveExportPlan();
      assert.equal(plan.preferStream, false, '裸 window 上没有 showSaveFilePicker，不该走流式');
      assert.equal(plan.maxDurationSec, MP4_MAX_DURATION_MEMORY);
    }
  );

  withEnv(
    {
      win: streamingWindow(),
      points: straightTrack(),
      files: [{ name: 'ride.gpx', points: straightTrack() }],
    },
    () => {
      const plan = resolveExportPlan();
      assert.equal(plan.preferStream, streamSinkSupported());
      assert.equal(
        plan.maxDurationSec,
        plan.preferStream ? MP4_MAX_DURATION_STREAM : MP4_MAX_DURATION_MEMORY
      );
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): 轨迹为空或为 null 时照常给出匀速对象', () => {
  for (const points of [[], null]) {
    withEnv(
      {
        els: { mp4Duration: { value: '6' }, mp4Fps: { value: '30' } },
        win: {},
        points,
        files: [],
      },
      () => {
        const plan = resolveExportPlan();
        assert.equal(plan.mode, 'even');
        assert.strictEqual(plan.timePlan, null);
        assert.strictEqual(plan.t0Ms, null);
        assert.equal(plan.suggestedName, '轨迹动画.mp4');
        assert.equal(plan.frames, 180);
      }
    );
  }
});

/* ==================== resolveExportPlan · 时间真实模式 ==================== */

test('mp4Export · resolveExportPlan(导出决策): 时间真实模式给出 timePlan / t0Ms / 缩放', () => {
  const points = straightTrack();
  withEnv(
    {
      els: trueModeEls(points[0].time, points[points.length - 1].time, { scale: '4', fps: '30' }),
      win: {},
      points,
      files: [{ name: 'ride.gpx', points }],
      timeMode: trueModeState(points),
    },
    () => {
      const win = currentExportWindow();
      assert.ok(win, '前置：时间真实模式的控件齐备时应当算得出导出窗口');

      const plan = resolveExportPlan();
      assert.equal(plan.mode, 'true');
      assert.ok(plan.timePlan, '时间真实模式必须带上 timePlan');
      assert.equal(plan.fps, win.fps, 'fps 取自导出窗口');
      assert.equal(plan.scale, win.scale, 'scale 取自导出窗口');
      assert.equal(plan.t0Ms, win.startMs, 't0Ms 等于窗口起点');
      assert.equal(plan.t0Ms, plan.timePlan.t0Ms);
      assert.equal(plan.durationSec, clampMp4Duration(plan.timePlan.durationSec, plan.maxDurationSec));
      assert.equal(plan.frames, Math.max(1, Math.round(plan.durationSec * plan.fps)));
      assert.equal(plan.size, 1080);
      assert.equal(plan.bitrate, mp4Bitrate(plan.size, plan.quality));
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): 时间真实模式的文件名由 buildTimeTrueFilename 逐字符生成', () => {
  const points = straightTrack();
  withEnv(
    {
      els: trueModeEls(points[0].time, points[points.length - 1].time, { scale: '8', fps: '25' }),
      win: {},
      points,
      files: [{ name: 'ride.gpx', points }],
      timeMode: trueModeState(points),
    },
    () => {
      assert.ok(currentExportWindow(), '前置：导出窗口应当就绪');
      const plan = resolveExportPlan();
      assert.equal(plan.mode, 'true');
      assert.equal(plan.suggestedName, buildTimeTrueFilename(plan.t0Ms, plan.scale, 'mp4'));
      assert.notEqual(plan.suggestedName, '轨迹动画.mp4');
      assert.ok(plan.suggestedName.endsWith('.mp4'), '建议文件名应当以 .mp4 收尾');
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): 超长真实窗口被夹到上限、frames 按夹后时长重算', () => {
  const points = longTrack(); // 跨 5 小时，scale=1 时真实时长 18000 秒
  withEnv(
    {
      els: trueModeEls(points[0].time, points[points.length - 1].time, { scale: '1', fps: '30' }),
      win: {}, // 全内存路径，上限 600 秒
      points,
      files: [{ name: 'ride.gpx', points }],
      timeMode: trueModeState(points),
    },
    () => {
      assert.ok(currentExportWindow(), '前置：导出窗口应当就绪');
      const plan = resolveExportPlan();
      assert.equal(plan.mode, 'true');
      assert.equal(plan.maxDurationSec, MP4_MAX_DURATION_MEMORY);
      assert.ok(
        plan.timePlan.durationSec > MP4_MAX_DURATION_MEMORY,
        '前置：这条轨迹的真实时长本就超过全内存上限'
      );
      assert.equal(plan.durationSec, MP4_MAX_DURATION_MEMORY);
      assert.equal(plan.frames, Math.round(MP4_MAX_DURATION_MEMORY * plan.fps));
      assert.ok(
        plan.frames < Math.round(plan.timePlan.durationSec * plan.fps),
        'frames 必须按夹取后的时长重算，不能按原始时长溢出'
      );
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): 节奏 radio 未选中真实时间时回落匀速', () => {
  const points = straightTrack();
  const els = trueModeEls(points[0].time, points[points.length - 1].time);
  els.mp4TimeModeTrue = { checked: false };
  els.mp4TimeModeEven = { checked: true };
  withEnv(
    { els, win: {}, points, files: [{ name: 'ride.gpx', points }], timeMode: trueModeState(points) },
    () => {
      const plan = resolveExportPlan();
      assert.equal(plan.mode, 'even');
      assert.strictEqual(plan.timePlan, null);
      assert.strictEqual(plan.t0Ms, null);
      assert.equal(plan.scale, 1);
      assert.equal(plan.suggestedName, '轨迹动画.mp4');
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): timeMode.available 为 false 时回落匀速', () => {
  const points = straightTrack();
  withEnv(
    {
      els: trueModeEls(points[0].time, points[points.length - 1].time),
      win: {},
      points,
      files: [{ name: 'ride.gpx', points }],
      timeMode: { ...trueModeState(points), available: false },
    },
    () => {
      const plan = resolveExportPlan();
      assert.equal(plan.mode, 'even');
      assert.strictEqual(plan.timePlan, null);
      assert.strictEqual(plan.t0Ms, null);
      assert.equal(plan.suggestedName, '轨迹动画.mp4');
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): currentExportWindow() 为 null 时回落匀速', () => {
  const points = straightTrack();
  withEnv(
    {
      els: {
        mp4TimeModeEven: { checked: false },
        mp4TimeModeTrue: { checked: true },
        mp4TimeStart: { value: '' },
        mp4TimeEnd: { value: '' },
        mp4Duration: { value: '6' },
        mp4Fps: { value: '30' },
      },
      win: {},
      points,
      files: [{ name: 'ride.gpx', points }],
      timeMode: { available: false, range: null },
    },
    () => {
      assert.strictEqual(currentExportWindow(), null, '前置：时间轴不可用时窗口应当为 null');
      const plan = resolveExportPlan();
      assert.equal(plan.mode, 'even');
      assert.strictEqual(plan.timePlan, null);
      assert.equal(plan.frames, 180);
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): buildTimeTruePlan 拿不出计划时回落匀速', () => {
  const points = straightTrack();
  withEnv(
    {
      els: {
        ...trueModeEls(points[0].time, points[points.length - 1].time),
        mp4Duration: { value: '6' },
        mp4Fps: { value: '30' },
      },
      win: {},
      points: [], // 有窗口但没有轨迹点 -> buildTimeTruePlan 给不出计划
      files: [],
      timeMode: trueModeState(points),
    },
    () => {
      const plan = resolveExportPlan();
      assert.equal(plan.mode, 'even');
      assert.strictEqual(plan.timePlan, null);
      assert.strictEqual(plan.t0Ms, null);
      assert.equal(plan.scale, 1);
      assert.equal(plan.suggestedName, '轨迹动画.mp4');
      assert.equal(plan.frames, 180);
    }
  );
});

test('mp4Export · resolveExportPlan(导出决策): 非法缩放在窗口那层已被消毒，决策层不抛错', () => {
  // 缩放控件清空或填 0 时，currentExportWindow 兜底成 1；决策层直接用窗口给的值，
  // 于是那条会抛 RangeError 的路径从界面上不可达——否则点导出会毫无反应
  // （异常跑到异步流程之外，既没有状态提示也没有进度条）。
  const points = straightTrack();
  withEnv(
    {
      els: trueModeEls(points[0].time, points[points.length - 1].time, { scale: '0' }),
      win: {},
      points,
      files: [{ name: 'ride.gpx', points }],
      timeMode: trueModeState(points),
    },
    () => {
      let plan = null;
      assert.doesNotThrow(() => { plan = resolveExportPlan(); }, '非法缩放不该让决策层抛错');
      assert.equal(plan.mode, 'true', '窗口仍然算得出来，模式不该回落匀速');
      assert.equal(plan.scale, 1, '缩放应当是窗口兜底后的 1');
    }
  );
});

/* ==================== frameProgress ==================== */

test('mp4Export · frameProgress(逐帧进度): 匀速模式逐帧等于 i/(frames-1)', () => {
  const plan = { mode: 'even', frames: 121, timePlan: null };
  for (const i of [0, 1, 30, 60, 119, 120]) {
    near(frameProgress(plan, i), i / 120);
  }
  assert.equal(frameProgress(plan, 0), 0);
  assert.equal(frameProgress(plan, 120), 1);
});

test('mp4Export · frameProgress(逐帧进度): 单帧与零帧计划返回 0 而不是除零', () => {
  assert.equal(frameProgress({ mode: 'even', frames: 1, timePlan: null }, 0), 0);
  assert.equal(frameProgress({ mode: 'even', frames: 1, timePlan: null }, 5), 0);
  assert.equal(frameProgress({ mode: 'even', frames: 0, timePlan: null }, 0), 0);
});

test('mp4Export · frameProgress(逐帧进度): plan 为 null / undefined 时返回 0 不抛', () => {
  assert.equal(frameProgress(null, 0), 0);
  assert.equal(frameProgress(null, 42), 0);
  assert.equal(frameProgress(undefined, 0), 0);
});

test('mp4Export · frameProgress(逐帧进度): 时间真实模式等于 progressAtTime(index, frameTimeMs(i))', () => {
  const points = pausedTrack();
  const timePlan = buildTimeTruePlan({
    points,
    segmentStarts: [0],
    collapseSegmentGaps: false,
    startMs: points[0].time,
    endMs: points[points.length - 1].time,
    scale: 1,
    fps: 10,
  });
  assert.ok(timePlan, '前置：buildTimeTruePlan 应当给出计划');

  const frames = Math.max(1, Math.round(timePlan.durationSec * 10));
  const plan = { mode: 'true', frames, fps: 10, timePlan, t0Ms: timePlan.t0Ms, scale: 1 };

  for (const i of [0, 1, 50, 200, 500, frames - 1]) {
    near(frameProgress(plan, i), progressAtTime(timePlan.index, timePlan.frameTimeMs(i)));
  }
  near(frameProgress(plan, 0), 0);

  // 第 i 帧代表 [i/fps, (i+1)/fps) 这段时间的起点，所以 frames 帧里的最后一帧落在窗口
  // 末尾的前一帧处：仍在途中，再走一帧才踩到终点。
  // 「差一帧」换算成多少进度取决于那一刻的骑行速度——这条轨迹含停留段，时间到进度的
  // 映射本就非线性，所以这里不对差值设下界，只断言「未到终点」与「再一帧到终点」。
  const last = frameProgress(plan, frames - 1);
  assert.ok(last > 0 && last < 1, `最后一帧应仍在途中，实际 ${last}（frames=${frames}）`);
  near(frameProgress(plan, frames), 1, 1e-6);
});

test('mp4Export · frameProgress(逐帧进度): 停留段内连续若干帧的进度完全相同', () => {
  const points = pausedTrack(); // T0+10s 起原地停留到 T0+70s
  const fps = 10;
  const timePlan = buildTimeTruePlan({
    points,
    segmentStarts: [0],
    collapseSegmentGaps: false,
    startMs: points[0].time,
    endMs: points[points.length - 1].time,
    scale: 1,
    fps,
  });
  assert.ok(timePlan, '前置：buildTimeTruePlan 应当给出计划');

  const frames = Math.max(1, Math.round(timePlan.durationSec * fps));
  const plan = { mode: 'true', frames, fps, timePlan, t0Ms: timePlan.t0Ms, scale: 1 };

  // 停留区间 [T0+10s, T0+70s] 对应帧序号 [100, 700]，取中间几帧
  const inPause = [200, 300, 400, 500, 600];
  const baseline = frameProgress(plan, inPause[0]);
  assert.ok(baseline > 0 && baseline < 1, '停留发生在轨迹中段，进度应当严格落在 0 与 1 之间');
  for (const i of inPause) {
    near(frameProgress(plan, i), baseline, 1e-9);
  }

  // 停留结束后进度必须继续往前走
  assert.ok(
    frameProgress(plan, frames - 1) > baseline,
    '停留结束后定位点应当继续前进'
  );
});

/* ==================== formatEta ==================== */

test('mp4Export · formatEta(剩余时间文案): 一分钟以内向上取整到秒', () => {
  assert.equal(formatEta(0), '剩余约 0 秒');
  assert.equal(formatEta(0.1), '剩余约 1 秒');
  assert.equal(formatEta(1), '剩余约 1 秒');
  assert.equal(formatEta(12.2), '剩余约 13 秒');
  assert.equal(formatEta(59), '剩余约 59 秒');
  assert.equal(formatEta(59.4), '剩余约 60 秒');
});

test('mp4Export · formatEta(剩余时间文案): 分秒量级与秒进位到 60', () => {
  assert.equal(formatEta(60), '剩余约 1 分 0 秒');
  assert.equal(formatEta(90), '剩余约 1 分 30 秒');
  assert.equal(formatEta(125.4), '剩余约 2 分 5 秒');
  assert.equal(formatEta(119.6), '剩余约 2 分 0 秒', '秒进位到 60 时应当向分进 1、秒归 0');
  assert.equal(formatEta(3599.6), '剩余约 60 分 0 秒');
});

test('mp4Export · formatEta(剩余时间文案): 时分量级与分进位到 60', () => {
  assert.equal(formatEta(3600), '剩余约 1 小时 0 分');
  assert.equal(formatEta(3660), '剩余约 1 小时 1 分');
  assert.equal(formatEta(5400), '剩余约 1 小时 30 分');
  assert.equal(formatEta(7170), '剩余约 2 小时 0 分', '分进位到 60 时应当向时进 1、分归 0');
  assert.equal(formatEta(21600), '剩余约 6 小时 0 分');
});

test('mp4Export · formatEta(剩余时间文案): 非有限数与负数返回空串', () => {
  assert.equal(formatEta(NaN), '');
  assert.equal(formatEta(Infinity), '');
  assert.equal(formatEta(-Infinity), '');
  assert.equal(formatEta(-1), '');
  assert.equal(formatEta(-0.5), '');
  assert.equal(formatEta(undefined), '');
});

/* ==================== buildExportSidecar ==================== */

/**
 * 逐字段比对 sidecar：值随每次调用变动的字段（生成时刻这类）跳过，其余必须逐个相等。
 */
function assertSidecarMatches(actual, expectedInput) {
  const expected = buildSidecarMeta(expectedInput);
  assert.ok(actual && typeof actual === 'object', 'sidecar 应当是对象');
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    'sidecar 的字段集合应当与 buildSidecarMeta 的输出一致'
  );
  for (const key of Object.keys(expected)) {
    const a = JSON.stringify(actual[key]);
    const b = JSON.stringify(expected[key]);
    const wallClock =
      a !== b &&
      typeof actual[key] === 'string' &&
      typeof expected[key] === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(expected[key]);
    if (wallClock) continue; // 生成时刻这类随调用变动的字段不参与比对
    assert.deepStrictEqual(actual[key], expected[key], `sidecar 字段 ${key} 映射有误`);
  }
}

test('mp4Export · buildExportSidecar(旁车元数据): 逐个字段映射到 buildSidecarMeta', () => {
  const plan = {
    mode: 'true',
    fps: 25,
    frames: 617,
    durationSec: 24.68,
    size: 720,
    quality: 'high',
    bitrate: 7_654_321,
    maxDurationSec: MP4_MAX_DURATION_STREAM,
    preferStream: true,
    suggestedName: 'x.mp4',
    timePlan: {},
    t0Ms: 1_716_000_000_000,
    scale: 4,
  };
  const extra = {
    trackStartMs: 1_715_990_000_000,
    trackEndMs: 1_716_100_000_000,
    sourceFiles: ['ride-a.gpx', 'ride-b.fit'],
    collapsedSegmentGaps: true,
  };

  const sidecar = buildExportSidecar(plan, extra);
  assertSidecarMatches(sidecar, {
    t0Ms: plan.t0Ms,
    scale: plan.scale,
    fps: plan.fps,
    durationSec: plan.durationSec,
    frames: plan.frames,
    resolution: plan.size,
    quality: plan.quality,
    bitrate: plan.bitrate,
    trackStartMs: extra.trackStartMs,
    trackEndMs: extra.trackEndMs,
    sourceFiles: extra.sourceFiles,
    collapsedSegmentGaps: extra.collapsedSegmentGaps,
  });
});

test('mp4Export · buildExportSidecar(旁车元数据): 换一组取值仍逐字段跟随 plan 与 extra', () => {
  const plan = {
    mode: 'true',
    fps: 60,
    frames: 1_200,
    durationSec: 20,
    size: 1440,
    quality: 'low',
    bitrate: 3_000_000,
    maxDurationSec: MP4_MAX_DURATION_MEMORY,
    preferStream: false,
    suggestedName: 'y.mp4',
    timePlan: {},
    t0Ms: 1_600_000_000_000,
    scale: 0.5,
  };
  const extra = {
    trackStartMs: 1_599_999_000_000,
    trackEndMs: 1_600_050_000_000,
    sourceFiles: ['single.gpx'],
    collapsedSegmentGaps: false,
  };

  assertSidecarMatches(buildExportSidecar(plan, extra), {
    t0Ms: plan.t0Ms,
    scale: plan.scale,
    fps: plan.fps,
    durationSec: plan.durationSec,
    frames: plan.frames,
    resolution: plan.size,
    quality: plan.quality,
    bitrate: plan.bitrate,
    trackStartMs: extra.trackStartMs,
    trackEndMs: extra.trackEndMs,
    sourceFiles: extra.sourceFiles,
    collapsedSegmentGaps: extra.collapsedSegmentGaps,
  });
});

test('mp4Export · buildExportSidecar(旁车元数据): 匀速模式与非有限 t0Ms 返回 null', () => {
  const extra = {
    trackStartMs: 1_715_990_000_000,
    trackEndMs: 1_716_100_000_000,
    sourceFiles: ['ride.gpx'],
    collapsedSegmentGaps: false,
  };
  const base = {
    fps: 30,
    frames: 180,
    durationSec: 6,
    size: 1080,
    quality: 'high',
    bitrate: 1_000_000,
    scale: 1,
  };

  assert.strictEqual(
    buildExportSidecar({ ...base, mode: 'even', t0Ms: null }, extra),
    null,
    '匀速模式不产 sidecar'
  );
  assert.strictEqual(
    buildExportSidecar({ ...base, mode: 'even', t0Ms: 1_716_000_000_000 }, extra),
    null,
    'mode 不是 true 就不产 sidecar'
  );
  for (const t0Ms of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.strictEqual(
      buildExportSidecar({ ...base, mode: 'true', t0Ms }, extra),
      null,
      `t0Ms=${String(t0Ms)} 非有限数时不产 sidecar`
    );
  }
});

/* ==================== src/export/mp4.mjs 静态断言 ==================== */

const MP4_PATH = join(ROOT, 'src', 'export', 'mp4.mjs');
const MP4_RAW = readFileSync(MP4_PATH, 'utf8');

/** 去掉块注释与行注释，避免注释里的字眼污染断言。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const MP4_CODE = stripComments(MP4_RAW);

/** 取一个顶层函数从签名到列 0 的收尾大括号之间的源码。 */
function topLevelBody(src, name) {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const end = rest.search(/\n\}\s*(?:\n|$)/);
  return end === -1 ? rest : rest.slice(0, end);
}

test('mp4Export · mp4.mjs(主流程): createMp4Sink 是流程里第一个 await，早于底图补拉', () => {
  const body = topLevelBody(MP4_CODE, 'exportMp4');
  assert.ok(body, 'mp4.mjs 应当定义 exportMp4');

  const iSink = body.indexOf('createMp4Sink(');
  const iMap = body.indexOf('onPreviewMapOverlay(');
  assert.ok(iSink >= 0, 'exportMp4 应当调用 createMp4Sink 建立产物落盘出口');
  assert.ok(iMap >= 0, 'exportMp4 应当保留底图补拉 onPreviewMapOverlay');
  assert.ok(iSink < iMap, 'createMp4Sink 必须出现在 onPreviewMapOverlay 之前，否则用户手势已过期');

  assert.match(
    body.slice(Math.max(0, iSink - 60), iSink + 20),
    /await\s+createMp4Sink\(/,
    'createMp4Sink 应当被 await'
  );

  const iAwait = body.indexOf('await ');
  assert.ok(iAwait >= 0, 'exportMp4 里应当有 await');
  assert.match(
    body.slice(iAwait, iAwait + 40),
    /await\s+createMp4Sink\(/,
    '整个流程里的第一个 await 必须是 createMp4Sink'
  );
});

test('mp4Export · mp4.mjs(主流程): muxer 的 fastStart 与 target 取自 sink', () => {
  // 只认「值来自 sink」这件事，不限定写法：`fastStart: sink.fastStart` 与先取局部变量
  // 再用对象简写都算数。
  assert.match(MP4_CODE, /sink\.fastStart/, 'fastStart 应当取自 sink，而不是硬编码');
  assert.match(MP4_CODE, /fastStart/, 'muxer 配置里应当有 fastStart');
  assert.doesNotMatch(
    MP4_CODE,
    /fastStart\s*:\s*['"]in-memory['"]/,
    'fastStart 不应当硬编码成 in-memory'
  );
  assert.match(MP4_CODE, /sink\.target/, 'muxer 的 target 应当取自 sink');
  assert.match(MP4_CODE, /sink\.finish\(/, '收尾应当调 sink.finish');
});

test('mp4Export · mp4.mjs(主流程): 码率取自 plan.bitrate，MP4_BITRATE 常量表已不复存在', () => {
  assert.doesNotMatch(MP4_CODE, /MP4_BITRATE/, 'mp4.mjs 里不应当再有 MP4_BITRATE 常量表');
  assert.match(MP4_CODE, /plan\.bitrate/, '编码器码率应当取自 plan.bitrate');
});

test('mp4Export · mp4.mjs(主流程): 逐帧进度取自 frameProgress，帧参数取自 buildFrameOpts', () => {
  assert.match(
    MP4_CODE,
    /import\s*\{[^}]*\bframeProgress\b[^}]*\}\s*from\s*['"]\.\/mp4-plan\.mjs['"]/,
    'frameProgress 应当从 ./mp4-plan.mjs import'
  );
  assert.match(MP4_CODE, /frameProgress\s*\(\s*plan\s*,/, '逐帧进度应当是 frameProgress(plan, i)');

  assert.match(
    MP4_CODE,
    /import\s*\{[^}]*\bbuildFrameOpts\b[^}]*\}\s*from\s*['"]\.\/mp4-opts\.mjs['"]/,
    'buildFrameOpts 应当从 ./mp4-opts.mjs import'
  );
  assert.doesNotMatch(
    MP4_CODE,
    /function\s+buildFrameOpts\s*\(/,
    'buildFrameOpts 已迁到 mp4-opts.mjs，本文件不再定义它'
  );
  assert.match(MP4_CODE, /plan\.frames/, '编码循环的总帧数应当取自 plan.frames');
  assert.match(MP4_CODE, /plan\.size/, '帧尺寸应当取自 plan.size');
});

test('mp4Export · mp4.mjs(主流程): AbortError 有专门分支，中止走 sink.abort()', () => {
  assert.match(MP4_CODE, /AbortError/, '保存框被取消时抛的 AbortError 应当有专门判别分支');
  // 只要求中止确实走 sink.abort()。出现几处不代表正确性——把它统一收在 finally 里一处，
  // 比散在取消与出错两条路径上更不容易漏。
  assert.match(MP4_CODE, /sink\.abort\(\)/, '中止应当走 sink.abort()');
});

test('mp4Export · mp4.mjs(主流程): 接上 sidecar 下载与剩余时间显示', () => {
  assert.match(MP4_CODE, /buildExportSidecar\s*\(/, '时间真实模式应当产 sidecar');
  assert.match(MP4_CODE, /downloadSidecar\s*\(/, 'sidecar 应当经 downloadSidecar 下载');
  assert.match(MP4_CODE, /buildTimeTrueFilename\s*\(/, 'sidecar 文件名应当由 buildTimeTrueFilename 生成');
  assert.match(MP4_CODE, /formatEta\s*\(/, '进度行的剩余时间应当经 formatEta 格式化');
  assert.match(MP4_CODE, /mp4Eta/, '剩余时间应当写进 #mp4Eta');
});

test('mp4Export · mp4.mjs(主流程): 既有导出行为原样保留', () => {
  assert.match(MP4_CODE, /export\s+function\s+mp4Supported\s*\(/, 'mp4Supported 应当保留');
  assert.match(MP4_CODE, /onExpMp4Click/, 'onExpMp4Click 应当保留');
  assert.match(MP4_CODE, /取消导出/, '导出期间按钮文案应当换成「取消导出」');
  assert.match(MP4_CODE, /setExportKindLocked\(/, '导出期间应当锁住产物切换');
  assert.match(MP4_CODE, /beforeunload/, '导出期间应当装上 beforeunload 拦截');
  assert.match(MP4_CODE, /showExportBlockedStatus\(/, '底图缺失时应当走 showExportBlockedStatus');
  assert.match(MP4_CODE, /forceNoBasemap/, 'forceNoBasemap 的一次性消费语义应当保留');
  assert.match(MP4_CODE, /已取消/, '取消时的状态文案应当保留');
});

test('mp4Export · mp4.mjs(主流程): 文件仍在 200 行以内', () => {
  const lines = MP4_RAW.replace(/\s+$/, '').split('\n').length;
  assert.ok(lines <= 200, `src/export/mp4.mjs 应当控制在 200 行以内，当前 ${lines} 行`);
});
