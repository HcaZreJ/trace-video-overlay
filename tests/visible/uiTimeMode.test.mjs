// uiTimeMode · 时间真实模式的界面状态与联动（visible 样例）
//
// 全部函数读 DOM，Node 里注入假 document。`$` 是 `id => document.getElementById(id)`，
// 箭头函数体内才求值，所以模块 import 在 Node 里安全，逐个用例设定替身即可。
//
// 时区：`datetime-local` 按本地时区解析与格式化，断言一律写成往返一致或相对关系。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  timeMode,
  refreshTimeMode,
  isTimeTrueMode,
  updateTimeModeUI,
  currentExportWindow,
} from '../../src/ui/time-mode.mjs';
import { state } from '../../src/state.mjs';
import { trackTimeRange } from '../../src/core/track-time.mjs';
import {
  clampMp4Duration,
  estimateMp4Bytes,
  formatByteSize,
  mp4Bitrate,
} from '../../src/core/export-params.mjs';

/* ---------------------------------------------------------------- 假 DOM */

const ELEMENT_IDS = [
  'mp4TimeModeEven', 'mp4TimeModeTrue', 'mp4TimeModeHint',
  'mp4EvenFields', 'mp4TrueFields',
  'mp4TimeStart', 'mp4TimeEnd', 'mp4TimeScale',
  'mp4CollapseGapsField', 'mp4CollapseGaps',
  'mp4TrueFps', 'mp4TrueDurationHint',
  'mp4Quality', 'mp4SizeHint', 'mp4Duration', 'exportRes',
];

/** index.html 里各控件的初始形态。 */
const DEFAULTS = {
  mp4TimeModeEven: { checked: true },
  mp4TimeModeTrue: { checked: false },
  mp4TimeModeHint: { style: { display: 'none' } },
  mp4EvenFields: { style: { display: '' } },
  mp4TrueFields: { style: { display: 'none' } },
  mp4TimeScale: { value: '1' },
  mp4CollapseGapsField: { style: { display: 'none' } },
  mp4CollapseGaps: { checked: false },
  mp4TrueFps: { value: '30' },
  mp4Quality: { value: 'high' },
  mp4Duration: { value: '12' },
  exportRes: { value: '1080' },
};

const makeEl = (init = {}) => ({
  value: '', checked: false, textContent: '', disabled: false, min: '', max: '',
  ...init,
  style: { display: '', ...(init.style || {}) },
});

/**
 * 装好假 document / window / state / timeMode，返回替身与还原函数。
 * 每个用例自己 setup + finally restore，测试之间无共享可变状态。
 */
function setup({ els: overrides = {}, trackFiles = [], trackPoints = [], timeMode: tm = {} } = {}) {
  const els = {};
  for (const id of ELEMENT_IDS) {
    els[id] = makeEl({ ...(DEFAULTS[id] || {}), ...(overrides[id] || {}) });
  }

  const hadDoc = 'document' in globalThis;
  const prevDoc = globalThis.document;
  const hadWin = 'window' in globalThis;
  const prevWin = globalThis.window;
  globalThis.document = { getElementById: (id) => els[id] || null };
  globalThis.window = {};

  const prevFiles = state.trackFiles;
  const prevPoints = state.trackPoints;
  state.trackFiles = trackFiles;
  state.trackPoints = trackPoints;

  const prevTimeMode = { ...timeMode };
  timeMode.index = null;
  timeMode.range = null;
  timeMode.available = false;
  Object.assign(timeMode, tm);
  // 假索引写成占位空对象时按 range 补齐端点：真实索引一定带端点，
  // 且单段不折叠时两者相同。
  if (timeMode.index && timeMode.range && timeMode.index.startMs === undefined) {
    timeMode.index.startMs = timeMode.range.startMs;
    timeMode.index.endMs = timeMode.range.endMs;
  }

  return {
    els,
    restore() {
      if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document;
      if (hadWin) globalThis.window = prevWin; else delete globalThis.window;
      state.trackFiles = prevFiles;
      state.trackPoints = prevPoints;
      Object.assign(timeMode, prevTimeMode);
    },
  };
}

/* ------------------------------------------------------- 本地时区工具 */

const pad2 = (n) => String(n).padStart(2, '0');

/** 毫秒时间戳 → `YYYY-MM-DDTHH:mm:ss`（本地时区分量）。 */
const fmtLocal = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/** `YYYY-MM-DDTHH:mm[:ss]`（本地时区）→ 毫秒时间戳，解析不出时 NaN。 */
const parseLocal = (text) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, 0).getTime();
};

/* ------------------------------------------------------------ 轨迹夹具 */

/** 秒对齐的锚点时刻，保证 datetime-local 的秒级精度能无损往返。 */
const T0 = Date.UTC(2024, 4, 1, 2, 0, 0);

const P = (i, timeMs) => ({
  lng: 120 + i * 0.0015,
  lat: 30 + i * 0.0011,
  ...(timeMs === undefined ? {} : { time: timeMs }),
});

/** n 个点、每点间隔 stepMs 的带时间戳轨迹。 */
const timedTrack = (n, stepMs, t0 = T0) => Array.from({ length: n }, (_, i) => P(i, t0 + i * stepMs));

const asFile = (name, points) => ({ name, format: 'gpx', points });

const sizeHintText = (durationSec, resValue, quality) =>
  `预计文件大小 ≈ ${formatByteSize(estimateMp4Bytes(durationSec, mp4Bitrate(+resValue, quality)))}`;

/* ==================================================================== */

test('uiTimeMode · refreshTimeMode(时间轴刷新): 带时间戳的轨迹进入可用态并填好起止时刻', () => {
  const points = timedTrack(11, 45_000);          // 跨度 450 秒
  const range = trackTimeRange(points);
  const env = setup({ trackFiles: [asFile('ride.gpx', points)], trackPoints: points });

  try {
    refreshTimeMode();

    assert.deepEqual(timeMode.range, range, 'timeMode.range 取自 trackTimeRange');
    assert.notEqual(timeMode.index, null, '带两个以上时间戳锚点应能建出时间轴');
    assert.equal(timeMode.available, true);

    assert.equal(env.els.mp4TimeModeTrue.disabled, false, '可用时放开时间真实 radio');
    assert.equal(env.els.mp4TimeModeHint.textContent, '', '可用时清空原因文案');
    assert.equal(env.els.mp4TimeModeHint.style.display, 'none', '可用时隐藏原因文案');

    // 时区无关：填进 datetime-local 的字符串按本地时区解析回来应回到原始毫秒。
    assert.equal(parseLocal(env.els.mp4TimeStart.value), range.startMs);
    assert.equal(parseLocal(env.els.mp4TimeEnd.value), range.endMs);
    assert.equal(parseLocal(env.els.mp4TimeStart.min), range.startMs);
    assert.equal(parseLocal(env.els.mp4TimeStart.max), range.endMs);
    assert.equal(parseLocal(env.els.mp4TimeEnd.min), range.startMs);
    assert.equal(parseLocal(env.els.mp4TimeEnd.max), range.endMs);

    // 单文件时折叠开关整行隐藏。
    assert.equal(env.els.mp4CollapseGapsField.style.display, 'none');
  } finally {
    env.restore();
  }
});

test('uiTimeMode · currentExportWindow(导出窗口): 刷新后直接读回轨迹的完整时间范围', () => {
  const points = timedTrack(11, 45_000);
  const range = trackTimeRange(points);
  const env = setup({
    trackFiles: [asFile('ride.gpx', points)],
    trackPoints: points,
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeScale: { value: '2' },
      mp4TrueFps: { value: '60' },
      mp4CollapseGaps: { checked: true },
    },
  });

  try {
    refreshTimeMode();
    assert.equal(isTimeTrueMode(), true, 'radio 选中且轨迹可用 → 时间真实模式');

    const win = currentExportWindow();
    assert.notEqual(win, null);
    assert.equal(win.startMs, range.startMs, '往返一致：填进去的起点读回原始毫秒');
    assert.equal(win.endMs, range.endMs, '往返一致：填进去的终点读回原始毫秒');
    assert.equal(win.endMs - win.startMs, 450_000);
    assert.equal(win.scale, 2);
    assert.equal(win.fps, 60);
    assert.equal(win.collapseSegmentGaps, true);
  } finally {
    env.restore();
  }
});

test('uiTimeMode · updateTimeModeUI(面板联动): 两种模式各显各的面板并各自算体积', () => {
  const points = timedTrack(11, 45_000);          // 跨度 450 秒
  const range = trackTimeRange(points);
  const env = setup({
    trackPoints: points,
    trackFiles: [asFile('ride.gpx', points)],
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(range.startMs) },
      mp4TimeEnd: { value: fmtLocal(range.endMs) },
      mp4TimeScale: { value: '1' },
      mp4Duration: { value: '30' },
      exportRes: { value: '720' },                // DOM 的真实形态是字符串，查表前要 + 成数值
      mp4Quality: { value: 'medium' },
    },
  });

  try {
    updateTimeModeUI();

    assert.equal(env.els.mp4TrueFields.style.display, '', '时间真实模式显示 true 面板');
    assert.equal(env.els.mp4EvenFields.style.display, 'none', '时间真实模式隐藏匀速面板');

    // 缩放 1 → 视频时长与真实时间同为 450 秒。
    assert.match(env.els.mp4TrueDurationHint.textContent, /视频时长/);
    assert.match(env.els.mp4TrueDurationHint.textContent, /真实时间/);
    assert.equal(env.els.mp4SizeHint.textContent, sizeHintText(450, '720', 'medium'));

    // 切回按距离匀速：面板反过来，体积改按 clamp 后的时长秒数算。
    env.els.mp4TimeModeTrue.checked = false;
    env.els.mp4TimeModeEven.checked = true;
    updateTimeModeUI();

    assert.equal(env.els.mp4EvenFields.style.display, '');
    assert.equal(env.els.mp4TrueFields.style.display, 'none');
    assert.equal(
      env.els.mp4SizeHint.textContent,
      sizeHintText(clampMp4Duration(30), '720', 'medium'),
    );
  } finally {
    env.restore();
  }
});
