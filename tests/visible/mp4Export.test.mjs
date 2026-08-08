/**
 * mp4Export · 可见样例测试
 *
 * 覆盖 src/export/mp4-plan.mjs 的主路径：匀速模式的导出决策、逐帧进度、剩余时间文案。
 * DOM 与浏览器全局用替身注入；每个用例自己装卸替身，测试之间不共享可变状态。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveExportPlan, frameProgress, formatEta } from '../../src/export/mp4-plan.mjs';
import { state } from '../../src/state.mjs';
import { timeMode } from '../../src/ui/time-mode.mjs';
import { clampMp4Duration, mp4Bitrate } from '../../src/core/export-params.mjs';
import { MP4_MAX_DURATION_MEMORY } from '../../src/export/mp4-sink.mjs';

/* ==================== 替身与环境 ==================== */

/** 导出面板上 resolveExportPlan 会读到的控件，默认值取自 index.html。 */
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
  };
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k] = { ...v };
  for (const [k, v] of Object.entries(over)) out[k] = { ...(out[k] || {}), ...v };
  return out;
}

/**
 * 装上 document / window 替身与轨迹状态，跑完 fn 后原样还原。
 * cfg: { els, win, points, files, timeMode }
 */
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

/** 一条 4 点直线轨迹，时间戳为 epoch 毫秒。 */
const T0 = Date.UTC(2024, 4, 18, 1, 0, 0);
function straightTrack() {
  return [
    { lng: 120.0, lat: 31.0, time: T0 },
    { lng: 120.01, lat: 31.0, time: T0 + 10_000 },
    { lng: 120.02, lat: 31.0, time: T0 + 20_000 },
    { lng: 120.03, lat: 31.0, time: T0 + 30_000 },
  ];
}

/* ==================== 用例 ==================== */

test('mp4Export · resolveExportPlan(导出决策): 匀速模式给出完整参数对象', () => {
  withEnv(
    {
      els: {
        exportRes: { value: '1080' },
        mp4Quality: { value: 'high' },
        mp4Fps: { value: '30' },
        mp4Duration: { value: '6' },
      },
      win: {}, // 无 showSaveFilePicker / Mp4Muxer -> 全内存路径
      points: straightTrack(),
      files: [{ name: 'ride.gpx', points: straightTrack() }],
    },
    () => {
      const plan = resolveExportPlan();

      assert.equal(plan.mode, 'even');
      assert.equal(plan.fps, 30);
      assert.equal(plan.size, 1080);
      assert.equal(typeof plan.size, 'number');
      assert.equal(plan.quality, 'high');
      assert.equal(plan.bitrate, mp4Bitrate(1080, 'high'));
      assert.equal(plan.maxDurationSec, MP4_MAX_DURATION_MEMORY);
      assert.equal(plan.preferStream, false);
      assert.equal(plan.durationSec, clampMp4Duration(6, MP4_MAX_DURATION_MEMORY));
      assert.equal(plan.durationSec, 6);
      assert.equal(plan.frames, 180); // round(6 × 30)
      assert.equal(plan.suggestedName, '轨迹动画.mp4');
      assert.strictEqual(plan.timePlan, null);
      assert.strictEqual(plan.t0Ms, null);
      assert.equal(plan.scale, 1);
    }
  );
});

test('mp4Export · frameProgress(逐帧进度): 匀速模式为 i/(frames-1)，plan 缺失返回 0', () => {
  const plan = { mode: 'even', frames: 5, timePlan: null };

  assert.equal(frameProgress(plan, 0), 0);
  assert.ok(Math.abs(frameProgress(plan, 1) - 0.25) <= 1e-12);
  assert.ok(Math.abs(frameProgress(plan, 2) - 0.5) <= 1e-12);
  assert.equal(frameProgress(plan, 4), 1);

  // 单帧导出不能除以 0
  assert.equal(frameProgress({ mode: 'even', frames: 1, timePlan: null }, 0), 0);

  // plan 缺失时静默返回 0
  assert.equal(frameProgress(null, 0), 0);
  assert.equal(frameProgress(undefined, 3), 0);
});

test('mp4Export · formatEta(剩余时间文案): 秒 / 分秒 / 时分 三个量级', () => {
  assert.equal(formatEta(0), '剩余约 0 秒');
  assert.equal(formatEta(12.2), '剩余约 13 秒');
  assert.equal(formatEta(90), '剩余约 1 分 30 秒');
  assert.equal(formatEta(3600), '剩余约 1 小时 0 分');
  assert.equal(formatEta(3660), '剩余约 1 小时 1 分');
  assert.equal(formatEta(-1), '');
  assert.equal(formatEta(NaN), '');
});
