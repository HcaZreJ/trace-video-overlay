// exportHardening · 导出链路加固（hidden 全面用例）
//
// 两类断言，按被测对象选：
//   · 行为测试（注入假 DOM）：A / B / C / J 与 G 的 sink 侧。
//     `$` 是 `id => document.getElementById(id)`，箭头函数体内才求值，所以模块 import 在
//     Node 里安全，逐个用例设定 globalThis.document / globalThis.window 替身即可。
//   · 静态源码断言：D / E / F / H / I 与 G 的 mp4.mjs 侧。exportMp4 是依赖 WebCodecs 的
//     长异步流程，取材用 readFileSync 读单文件，先剥注释再按下标区间判定位置关系。
//
// 时区：涉及 datetime 取值的断言一律写成往返一致或相对关系，不写死带时区含义的字符串。
// 每个用例自己装卸替身与 state / timeMode，测试之间无共享可变状态、不依赖执行顺序。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  timeMode,
  refreshTimeMode,
  updateTimeModeUI,
  currentExportWindow,
} from '../../src/ui/time-mode.mjs';
import { resolveExportPlan } from '../../src/export/mp4-plan.mjs';
import {
  createMp4Sink,
  MP4_MAX_DURATION_STREAM,
  MP4_MAX_DURATION_MEMORY,
} from '../../src/export/mp4-sink.mjs';
import { state } from '../../src/state.mjs';
import { buildTimeIndex } from '../../src/core/track-time.mjs';
import {
  clampMp4Duration,
  estimateMp4Bytes,
  formatByteSize,
  mp4Bitrate,
} from '../../src/core/export-params.mjs';
import { ROOT } from '../helpers/source.mjs';

/* ================================================================ 假 DOM */

const ELEMENT_IDS = [
  'mp4TimeModeEven', 'mp4TimeModeTrue',
  'mp4TimeModeEvenLabel', 'mp4TimeModeTrueLabel',
  'mp4TimeModeHint', 'mp4EvenFields', 'mp4TrueFields',
  'mp4TimeStart', 'mp4TimeEnd', 'mp4TimeScale',
  'mp4CollapseGapsField', 'mp4CollapseGaps',
  'mp4TrueFps', 'mp4TrueDurationHint',
  'mp4Quality', 'mp4SizeHint', 'mp4Duration', 'exportRes',
  'mp4Fps', 'mp4Eta',
];

/** index.html 里各控件的初始形态。 */
const DEFAULTS = {
  mp4TimeModeEven: { checked: true },
  mp4TimeModeTrue: { checked: false },
  mp4TimeModeEvenLabel: { className: 'seg-opt active' },
  mp4TimeModeTrueLabel: { className: 'seg-opt' },
  mp4TimeModeHint: { style: { display: 'none' } },
  mp4EvenFields: { style: { display: '' } },
  mp4TrueFields: { style: { display: 'none' } },
  mp4TimeScale: { value: '1' },
  mp4CollapseGapsField: { style: { display: 'none' } },
  mp4CollapseGaps: { checked: false },
  mp4TrueFps: { value: '30' },
  mp4Quality: { value: 'high' },
  mp4Duration: { value: '12' },
  mp4Fps: { value: '30' },
  exportRes: { value: '1080' },
};

/** 带 classList 的假元素：className 是唯一真相，classList 的读写都落到它上面。 */
function makeEl(init = {}) {
  const el = {
    value: '', checked: false, textContent: '', disabled: false,
    min: '', max: '', className: '',
    ...init,
    style: { display: '', ...(init.style || {}) },
  };
  const read = () => new Set(String(el.className || '').split(/\s+/).filter(Boolean));
  const write = (set) => { el.className = [...set].join(' '); };
  el.classList = {
    add(...names) { const s = read(); for (const n of names) s.add(n); write(s); },
    remove(...names) { const s = read(); for (const n of names) s.delete(n); write(s); },
    contains(name) { return read().has(name); },
    toggle(name, force) {
      const s = read();
      const on = force === undefined ? !s.has(name) : Boolean(force);
      if (on) s.add(name); else s.delete(name);
      write(s);
      return on;
    },
  };
  el.setAttribute = (key, value) => { if (key === 'class') el.className = value; else el[key] = value; };
  el.getAttribute = (key) => (key === 'class' ? el.className : el[key]);
  return el;
}

/** 装好假 document / window / state / timeMode，返回替身与还原函数。 */
function setup({
  els: overrides = {},
  trackFiles = [],
  trackPoints = [],
  timeMode: tm = {},
  windowStub = {},
} = {}) {
  const els = {};
  for (const id of ELEMENT_IDS) els[id] = makeEl({ ...(DEFAULTS[id] || {}), ...(overrides[id] || {}) });

  const hadDoc = 'document' in globalThis;
  const prevDoc = globalThis.document;
  const hadWin = 'window' in globalThis;
  const prevWin = globalThis.window;
  globalThis.document = { getElementById: (id) => els[id] || null };
  globalThis.window = windowStub;

  const prevFiles = state.trackFiles;
  const prevPoints = state.trackPoints;
  state.trackFiles = trackFiles;
  state.trackPoints = trackPoints;

  const tmKeys = Object.keys(timeMode);
  const prevTimeMode = { ...timeMode };
  timeMode.index = null;
  timeMode.range = null;
  timeMode.available = false;
  Object.assign(timeMode, tm);

  return {
    els,
    restore() {
      for (const k of Object.keys(timeMode)) if (!tmKeys.includes(k)) delete timeMode[k];
      Object.assign(timeMode, prevTimeMode);
      state.trackFiles = prevFiles;
      state.trackPoints = prevPoints;
      if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document;
      if (hadWin) globalThis.window = prevWin; else delete globalThis.window;
    },
  };
}

const hasActive = (el) => el.classList.contains('active');

/** 流式写盘可用的 window 替身：showSaveFilePicker 与 Mp4Muxer 齐备。 */
const streamingWindow = () => ({
  showSaveFilePicker: async () => ({}),
  Mp4Muxer: {
    Muxer: function Muxer() {},
    ArrayBufferTarget: function ArrayBufferTarget() {},
    FileSystemWritableFileStreamTarget: function FileSystemWritableFileStreamTarget() {},
  },
});

/* ========================================================= 本地时区工具 */

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

/** datetime-local 只有秒级精度，时刻断言统一给 1 秒容差。 */
function assertNearMs(actual, expected, label) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) < 1000,
    `${label}：期望 ≈ ${expected}（${new Date(expected).toISOString()}），`
    + `实得 ${actual}（${Number.isFinite(actual) ? new Date(actual).toISOString() : '解析不出'}）`,
  );
}

function assertFarMs(actual, unexpected, label) {
  assert.ok(
    !Number.isFinite(actual) || Math.abs(actual - unexpected) >= 1000,
    `${label}：不应等于 ${unexpected}（${new Date(unexpected).toISOString()}）`,
  );
}

/* ============================================================ 轨迹夹具 */

/** 秒对齐的锚点时刻，保证 datetime-local 的秒级精度能无损往返。 */
const T0 = Date.UTC(2024, 4, 1, 2, 0, 0);
const DAY_MS = 86_400_000;

const P = (i, timeMs) => ({ lng: 120 + i * 0.0015, lat: 30 + i * 0.0011, time: timeMs });

/** n 个点、每点间隔 stepMs 的带时间戳轨迹。 */
const timedTrack = (n, stepMs, t0 = T0) => Array.from({ length: n }, (_, i) => P(i, t0 + i * stepMs));

const asFile = (name, points) => ({ name, format: 'gpx', points });

/** 两段各 60 秒、中间隔整一天的轨迹：折叠与不折叠的时间轴差一天。 */
function gappedTrack() {
  const segA = [P(0, T0), P(1, T0 + 30_000), P(2, T0 + 60_000)];
  const segB = [P(3, T0 + DAY_MS), P(4, T0 + DAY_MS + 30_000), P(5, T0 + DAY_MS + 60_000)];
  return {
    segA,
    segB,
    points: [...segA, ...segB],
    files: [asFile('a.gpx', segA), asFile('b.gpx', segB)],
    collapsedIndex: buildTimeIndex([...segA, ...segB], { segmentStarts: [0, 3], collapseSegmentGaps: true }),
  };
}

/** 时间轴就绪、起止取轨迹两端的一整套时间真实模式环境。 */
function trueModeEnv(points, overrides = {}) {
  const startMs = points[0].time;
  const endMs = points[points.length - 1].time;
  return setup({
    trackFiles: [asFile('ride.gpx', points)],
    trackPoints: points,
    timeMode: {
      available: true,
      range: {
        startMs, endMs, spanSec: (endMs - startMs) / 1000,
        anchorCount: points.length, totalCount: points.length,
      },
      index: { startMs, endMs },
    },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(startMs) },
      mp4TimeEnd: { value: fmtLocal(endMs) },
      ...overrides,
    },
  });
}

const sizeHintText = (durationSec, resValue, quality) =>
  `预计文件大小 ≈ ${formatByteSize(estimateMp4Bytes(durationSec, mp4Bitrate(+resValue, quality)))}`;

/** 从提示文案里抽出所有 `h:mm:ss` / `mm:ss` 形态的时长，换算成秒。 */
const clockSeconds = (text) => (String(text).match(/\d+(?::\d{2})+/g) || [])
  .map((tok) => tok.split(':').reduce((acc, part) => acc * 60 + Number(part), 0));

/** 跑 resolveExportPlan()，抛错即以断言失败收场（形态比未处理异常更可读）。 */
function planOrFail(label) {
  try {
    return resolveExportPlan();
  } catch (err) {
    assert.fail(`${label}：resolveExportPlan() 不应抛错，实得 ${err && err.name}: ${err && err.message}`);
  }
  return null;
}

/* ==================================================== 静态源码取材工具 */

const readSrc = (...seg) => readFileSync(join(ROOT, ...seg), 'utf8');

/** 去掉块注释与行注释，避免注释里的字眼污染断言。 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const MP4_CODE = stripComments(readSrc('src', 'export', 'mp4.mjs'));
const PNG_CODE = stripComments(readSrc('src', 'export', 'png.mjs'));
const SINK_CODE = stripComments(readSrc('src', 'export', 'mp4-sink.mjs'));

/** 取一个顶层函数从签名到列 0 的收尾大括号之间的源码。 */
function topLevelBody(src, name) {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const end = rest.search(/\n\}\s*(?:\n|$)/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** 从 `{` 的下标出发做括号配对，返回 { open, end, body }。 */
function blockFrom(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { open, end: i, body: src.slice(open + 1, i) };
    }
  }
  return null;
}

/** 源码里全部 `try { ... }` 的区间。 */
function tryBlocks(src) {
  const out = [];
  for (const m of src.matchAll(/\btry\s*\{/g)) {
    const block = blockFrom(src, m.index + m[0].length - 1);
    if (block) out.push(block);
  }
  return out;
}

/** 包住下标 idx 的最内层 try 块。 */
function innermostTry(src, idx) {
  const hits = tryBlocks(src).filter((b) => b.open < idx && idx < b.end);
  hits.sort((a, b) => a.open - b.open);
  return hits.length ? hits[hits.length - 1] : null;
}

/** 紧跟某个 try 块的 catch 块体，没有 catch 时返回 null。 */
function catchBodyOf(src, block) {
  const tail = src.slice(block.end + 1);
  const m = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(tail);
  if (!m) return null;
  const inner = blockFrom(src, block.end + 1 + m[0].length - 1);
  return inner ? inner.body : null;
}

/** 空白压成单空格，让跨行写法也能被同一条正则命中。 */
const flat = (src) => src.replace(/\s+/g, ' ');

/** 条件里同时出现 trackPoints 与 length 的守卫。 */
const GUARD_WITH_LENGTH = /if\s*\([^{;]{0,200}trackPoints[^{;]{0,200}length[^{;]{0,200}\)/;
/** 条件里出现 trackPoints 的守卫（不论是否认空数组）。 */
const GUARD_ANY = /if\s*\([^{;]{0,200}trackPoints[^{;]{0,200}\)/;

/* ==================================================== G · sink 浏览器替身 */

/** 用户在保存框里改过的文件名，与 suggestedName 刻意不同。 */
const CHOSEN_NAME = '太湖-用户改过的名字.mp4';

function installSinkEnv({ handleName = CHOSEN_NAME } = {}) {
  const writable = {
    async write() {}, async close() {}, abort() {}, async seek() {}, async truncate() {},
  };
  const handle = { kind: 'file', name: handleName, async createWritable() { return writable; } };
  const windowStub = {
    async showSaveFilePicker() { return handle; },
    Mp4Muxer: {
      ArrayBufferTarget: class { constructor() { this.buffer = new Uint8Array(4).buffer; } },
      FileSystemWritableFileStreamTarget: class { constructor(stream) { this.stream = stream; } },
    },
  };

  const hadDoc = 'document' in globalThis;
  const prevDoc = globalThis.document;
  const hadWin = 'window' in globalThis;
  const prevWin = globalThis.window;
  globalThis.window = windowStub;
  globalThis.document = {
    createElement: () => ({ style: {}, click() {} }),
    body: { appendChild: (el) => el, removeChild: (el) => el },
  };

  return {
    handle,
    restore() {
      if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document;
      if (hadWin) globalThis.window = prevWin; else delete globalThis.window;
    },
  };
}

/* ================================================== A · 模式切换的选中态 */

test('exportHardening · A(模式选中态): 切到时间真实模式后 true 那个 label 独占 .active', () => {
  const env = setup({
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeModeEvenLabel: { className: 'seg-opt active' },
      mp4TimeModeTrueLabel: { className: 'seg-opt' },
    },
    timeMode: {
      available: true,
      range: { startMs: T0, endMs: T0 + 300_000, spanSec: 300, anchorCount: 2, totalCount: 2 },
      index: { startMs: T0, endMs: T0 + 300_000 },
    },
  });

  try {
    assert.equal(hasActive(env.els.mp4TimeModeEvenLabel), true, '前置：进场时选中态停在匀速那侧');

    updateTimeModeUI();

    assert.equal(hasActive(env.els.mp4TimeModeTrueLabel), true, 'true 那个 label 应当加上 .active');
    assert.equal(hasActive(env.els.mp4TimeModeEvenLabel), false, 'even 那个 label 应当去掉 .active');
  } finally {
    env.restore();
  }
});

test('exportHardening · A(模式选中态): 切回按距离匀速后 even 那个 label 独占 .active', () => {
  const env = setup({
    els: {
      mp4TimeModeEven: { checked: true },
      mp4TimeModeTrue: { checked: false },
      mp4TimeModeEvenLabel: { className: 'seg-opt' },
      mp4TimeModeTrueLabel: { className: 'seg-opt active' },
    },
  });

  try {
    assert.equal(hasActive(env.els.mp4TimeModeTrueLabel), true, '前置：进场时选中态停在真实时间那侧');

    updateTimeModeUI();

    assert.equal(hasActive(env.els.mp4TimeModeEvenLabel), true, 'even 那个 label 应当加上 .active');
    assert.equal(hasActive(env.els.mp4TimeModeTrueLabel), false, 'true 那个 label 应当去掉 .active');
  } finally {
    env.restore();
  }
});

test('exportHardening · A(模式选中态): 反复切换后任一时刻恰有一个 label 带 .active', () => {
  const range = { startMs: T0, endMs: T0 + 300_000, spanSec: 300, anchorCount: 2, totalCount: 2 };
  const env = setup({
    timeMode: { available: true, range, index: { startMs: range.startMs, endMs: range.endMs } },
  });

  try {
    for (const trueChecked of [true, false, true, true, false]) {
      env.els.mp4TimeModeTrue.checked = trueChecked;
      env.els.mp4TimeModeEven.checked = !trueChecked;

      updateTimeModeUI();

      const actives = [
        hasActive(env.els.mp4TimeModeEvenLabel),
        hasActive(env.els.mp4TimeModeTrueLabel),
      ];
      assert.deepEqual(
        actives,
        [!trueChecked, trueChecked],
        `radio 选中 ${trueChecked ? '真实时间' : '按距离匀速'} 时的 [even, true] 选中态`,
      );
      assert.equal(
        actives.filter(Boolean).length, 1,
        '.seg-opt.active 是纯 JS 驱动的，任一时刻只能有一个亮着',
      );
    }
  } finally {
    env.restore();
  }
});

test('exportHardening · A(模式选中态): 只增删 .active，label 上其它 class 原样保留', () => {
  const env = setup({
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeModeEvenLabel: { className: 'seg-opt seg-first active' },
      mp4TimeModeTrueLabel: { className: 'seg-opt seg-last' },
    },
    timeMode: {
      available: true,
      range: { startMs: T0, endMs: T0 + 300_000, spanSec: 300, anchorCount: 2, totalCount: 2 },
      index: { startMs: T0, endMs: T0 + 300_000 },
    },
  });

  try {
    updateTimeModeUI();

    assert.ok(env.els.mp4TimeModeEvenLabel.classList.contains('seg-opt'), 'seg-opt 应当保留');
    assert.ok(env.els.mp4TimeModeEvenLabel.classList.contains('seg-first'), 'seg-first 应当保留');
    assert.ok(env.els.mp4TimeModeTrueLabel.classList.contains('seg-opt'), 'seg-opt 应当保留');
    assert.ok(env.els.mp4TimeModeTrueLabel.classList.contains('seg-last'), 'seg-last 应当保留');
    assert.equal(hasActive(env.els.mp4TimeModeTrueLabel), true);
    assert.equal(hasActive(env.els.mp4TimeModeEvenLabel), false);
  } finally {
    env.restore();
  }
});

/* ============================================== B · 决策层复用消毒后的值 */

for (const scaleValue of ['', '0', '-2', 'abc', 'Infinity']) {
  test(`exportHardening · B(消毒复用): mp4TimeScale="${scaleValue}" 时不抛错且 scale 回落 1`, () => {
    const points = timedTrack(11, 30_000);          // 跨 300 秒
    const env = trueModeEnv(points, { mp4TimeScale: { value: scaleValue } });

    try {
      const win = currentExportWindow();
      assert.notEqual(win, null, '前置：currentExportWindow() 已经把非法缩放兜成 1');
      assert.equal(win.scale, 1);

      const plan = planOrFail(`mp4TimeScale="${scaleValue}"`);
      assert.equal(plan.mode, 'true', '窗口算得出来时仍是时间真实模式');
      assert.equal(plan.scale, 1, 'scale 应当取自已消毒的 win.scale');
      assert.equal(plan.scale, win.scale);
      assert.ok(Number.isFinite(plan.durationSec) && plan.durationSec > 0, '时长应当是有限正数');
      assert.ok(Number.isInteger(plan.frames) && plan.frames > 0, '帧数应当是正整数');
    } finally {
      env.restore();
    }
  });
}

for (const fpsValue of ['', '0', '-60', 'abc']) {
  test(`exportHardening · B(消毒复用): mp4TrueFps="${fpsValue}" 时不抛错且 fps 回落 30`, () => {
    const points = timedTrack(11, 30_000);          // 跨 300 秒
    const env = trueModeEnv(points, {
      mp4TrueFps: { value: fpsValue },
      mp4TimeScale: { value: '1' },
    });

    try {
      const win = currentExportWindow();
      assert.notEqual(win, null, '前置：currentExportWindow() 已经把非法帧率兜成 30');
      assert.equal(win.fps, 30);

      const plan = planOrFail(`mp4TrueFps="${fpsValue}"`);
      assert.equal(plan.mode, 'true');
      assert.equal(plan.fps, 30, 'fps 应当取自已消毒的 win.fps');
      assert.equal(plan.fps, win.fps);
      assert.equal(plan.frames, Math.max(1, Math.round(plan.durationSec * 30)), '帧数按回落后的 fps 重算');
    } finally {
      env.restore();
    }
  });
}

test('exportHardening · B(消毒复用): 两个控件同时清空也照常给出可用的时间真实计划', () => {
  const points = timedTrack(11, 30_000);
  const env = trueModeEnv(points, {
    mp4TimeScale: { value: '' },
    mp4TrueFps: { value: '' },
  });

  try {
    const plan = planOrFail('scale 与 fps 同时清空');
    assert.equal(plan.mode, 'true', '控件清空不该把导出降级成匀速');
    assert.equal(plan.scale, 1);
    assert.equal(plan.fps, 30);
    assert.ok(plan.timePlan, '时间真实模式必须带上 timePlan');
    assert.notEqual(plan.suggestedName, '轨迹动画.mp4', '文件名仍走时间真实模式那套');
  } finally {
    env.restore();
  }
});

test('exportHardening · B(消毒复用): 合法的 scale / fps 仍原样透传', () => {
  const points = timedTrack(11, 30_000);          // 跨 300 秒
  const env = trueModeEnv(points, {
    mp4TimeScale: { value: '2.5' },
    mp4TrueFps: { value: '24' },
  });

  try {
    const win = currentExportWindow();
    const plan = planOrFail('合法取值');

    assert.equal(plan.scale, 2.5);
    assert.equal(plan.fps, 24);
    assert.equal(plan.scale, win.scale, 'scale 与导出窗口一致');
    assert.equal(plan.fps, win.fps, 'fps 与导出窗口一致');
    assert.equal(plan.durationSec, clampMp4Duration(300 / 2.5, plan.maxDurationSec));
  } finally {
    env.restore();
  }
});

/* ================================================ C · 折叠后的时间轴口径 */

test('exportHardening · C(折叠时间轴): 折叠开启时输入框的 min / max / value 落在 index 端点', () => {
  const fx = gappedTrack();
  const env = setup({
    trackFiles: fx.files,
    trackPoints: fx.points,
    els: { mp4CollapseGaps: { checked: true } },
  });

  try {
    refreshTimeMode();

    const index = timeMode.index;
    assert.notEqual(index, null, '前置：带时间戳的两段轨迹应当建得出时间轴');
    assert.ok(
      timeMode.range.endMs - index.endMs > DAY_MS / 2,
      '前置：折叠后的时间轴终点应当比原始时间范围早一天量级',
    );

    assertNearMs(parseLocal(env.els.mp4TimeStart.min), index.startMs, 'mp4TimeStart.min');
    assertNearMs(parseLocal(env.els.mp4TimeStart.max), index.endMs, 'mp4TimeStart.max');
    assertNearMs(parseLocal(env.els.mp4TimeEnd.min), index.startMs, 'mp4TimeEnd.min');
    assertNearMs(parseLocal(env.els.mp4TimeEnd.max), index.endMs, 'mp4TimeEnd.max');
    assertNearMs(parseLocal(env.els.mp4TimeEnd.value), index.endMs, 'mp4TimeEnd.value');

    assertFarMs(parseLocal(env.els.mp4TimeEnd.max), timeMode.range.endMs, 'mp4TimeEnd.max 不该取原始时间范围的终点');
    assertFarMs(parseLocal(env.els.mp4TimeEnd.value), timeMode.range.endMs, 'mp4TimeEnd.value 不该取原始时间范围的终点');
  } finally {
    env.restore();
  }
});

test('exportHardening · C(折叠时间轴): 折叠开启时 currentExportWindow 的 clamp 按 index 端点', () => {
  const fx = gappedTrack();
  const env = setup({
    trackFiles: fx.files,
    trackPoints: fx.points,
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4CollapseGaps: { checked: true },
    },
  });

  try {
    refreshTimeMode();
    const index = timeMode.index;

    // 手动把终点填到原始时间范围那头（比折叠后的时间轴晚一天），应当被夹回 index 端点。
    env.els.mp4TimeStart.value = fmtLocal(index.startMs - 3_600_000);
    env.els.mp4TimeEnd.value = fmtLocal(timeMode.range.endMs);

    const win = currentExportWindow();
    assert.notEqual(win, null);
    assertNearMs(win.startMs, index.startMs, 'win.startMs');
    assertNearMs(win.endMs, index.endMs, 'win.endMs');
    assertFarMs(win.endMs, timeMode.range.endMs, 'win.endMs 不该夹到原始时间范围的终点');
    assert.ok(
      win.endMs - win.startMs < DAY_MS / 2,
      `折叠后的窗口跨度应当是两段自身的长度量级，实得 ${(win.endMs - win.startMs) / 1000} 秒`,
    );
  } finally {
    env.restore();
  }
});

test('exportHardening · C(折叠时间轴): 界面时长提示与实际导出计划算出的时长一致', () => {
  const fx = gappedTrack();
  const env = setup({
    trackFiles: fx.files,
    trackPoints: fx.points,
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4CollapseGaps: { checked: true },
      mp4TimeScale: { value: '1' },      // 缩放 1：视频时长与真实时间跨度相等
    },
  });

  try {
    refreshTimeMode();
    updateTimeModeUI();

    const plan = planOrFail('折叠开启');
    assert.equal(plan.mode, 'true', '前置：这组取值应当走时间真实模式');
    const planned = plan.timePlan.durationSec;
    assert.ok(planned < 600, `前置：折叠后实际导出的时长应当只有两段自身的长度，实得 ${planned} 秒`);

    const seconds = clockSeconds(env.els.mp4TrueDurationHint.textContent);
    assert.ok(
      seconds.length >= 1,
      `提示里应当出现时长，实得：${env.els.mp4TrueDurationHint.textContent}`,
    );
    for (const shown of seconds) {
      assert.ok(
        Math.abs(shown - planned) <= 1,
        `界面按折叠后的时间轴算数：提示里的 ${shown} 秒应当 ≈ 实际导出的 ${planned} 秒`
        + `（提示原文：${env.els.mp4TrueDurationHint.textContent}）`,
      );
    }
  } finally {
    env.restore();
  }
});

test('exportHardening · C(折叠时间轴): 体积估算同样按折叠后的时长算', () => {
  const fx = gappedTrack();
  const env = setup({
    windowStub: {},
    trackFiles: fx.files,
    trackPoints: fx.points,
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4CollapseGaps: { checked: true },
      mp4TimeScale: { value: '1' },
      exportRes: { value: '1080' },
      mp4Quality: { value: 'high' },
    },
  });

  try {
    refreshTimeMode();
    updateTimeModeUI();

    const plan = planOrFail('折叠开启');
    const expected = sizeHintText(
      clampMp4Duration(plan.timePlan.durationSec, MP4_MAX_DURATION_MEMORY), 1080, 'high',
    );
    assert.ok(
      env.els.mp4SizeHint.textContent.startsWith(expected),
      `体积应当按折叠后的 ${plan.timePlan.durationSec} 秒算，`
      + `期望以「${expected}」开头，实得「${env.els.mp4SizeHint.textContent}」`,
    );
  } finally {
    env.restore();
  }
});

test('exportHardening · C(折叠时间轴): timeMode.range 仍记录轨迹自身的原始时间范围', () => {
  const fx = gappedTrack();
  const env = setup({
    trackFiles: fx.files,
    trackPoints: fx.points,
    els: { mp4CollapseGaps: { checked: true } },
  });

  try {
    refreshTimeMode();

    assert.equal(timeMode.range.startMs, T0, 'range 起点仍是第一个点的真实时刻');
    assert.equal(timeMode.range.endMs, T0 + DAY_MS + 60_000, 'range 终点仍是最后一个点的真实时刻');
    assert.equal(timeMode.range.endMs - timeMode.range.startMs, DAY_MS + 60_000);
  } finally {
    env.restore();
  }
});

test('exportHardening · C(折叠时间轴): 单段不折叠时 index 与 range 端点相同，输入框取值不变', () => {
  const points = timedTrack(13, 60_000);            // 单段，跨 720 秒
  const env = setup({
    trackFiles: [asFile('ride.gpx', points)],
    trackPoints: points,
    els: { mp4CollapseGaps: { checked: false } },
  });

  try {
    refreshTimeMode();

    assert.equal(timeMode.index.startMs, timeMode.range.startMs, '前置：单段轨迹的两条时间轴端点相同');
    assert.equal(timeMode.index.endMs, timeMode.range.endMs);

    assertNearMs(parseLocal(env.els.mp4TimeStart.value), timeMode.index.startMs, 'mp4TimeStart.value');
    assertNearMs(parseLocal(env.els.mp4TimeEnd.value), timeMode.index.endMs, 'mp4TimeEnd.value');
    assert.equal(
      parseLocal(env.els.mp4TimeEnd.value) - parseLocal(env.els.mp4TimeStart.value),
      720_000,
      '起止之差就是轨迹跨度',
    );
  } finally {
    env.restore();
  }
});

/* ============================================ D · 静默降级成匀速的阻断 */

test('exportHardening · D(降级阻断): 时间真实模式下计划降级时在 createMp4Sink 之前就退出', () => {
  const body = topLevelBody(MP4_CODE, 'exportMp4');
  assert.ok(body, 'mp4.mjs 应当定义 exportMp4');

  const iSink = body.indexOf('createMp4Sink(');
  assert.ok(iSink >= 0, 'exportMp4 应当调用 createMp4Sink');

  const iGuard = body.indexOf('isTimeTrueMode(');
  assert.ok(
    iGuard >= 0,
    'exportMp4 应当判断「当前处于时间真实模式，计划却降级成了匀速」，避免静默导出匀速动画',
  );
  assert.ok(
    iGuard < iSink,
    '阻断必须在 createMp4Sink 之前——否则用户先被要求选保存位置，选完才发现导不了',
  );

  const branch = body.slice(Math.max(0, iGuard - 160), iSink);
  assert.match(branch, /plan\.mode/, '阻断条件应当同时看 plan.mode 是不是降级了');
  assert.match(branch, /setExportStatus\s*\(/, '阻断分支应当经 setExportStatus 说明算不出可用的导出时间窗口');
  assert.match(branch, /\breturn\b/, '阻断分支应当直接 return，不开始导出');
});

/* ================================== E · sink 建立到编码之间的无保护区 */

test('exportHardening · E(保护区间): buildFrameOpts 的调用点落在编码 try 内部', () => {
  const body = topLevelBody(MP4_CODE, 'exportMp4');
  assert.ok(body, 'mp4.mjs 应当定义 exportMp4');

  const iOpts = body.indexOf('buildFrameOpts(');
  assert.ok(iOpts >= 0, 'exportMp4 应当调用 buildFrameOpts 取帧参数');

  const block = innermostTry(body, iOpts);
  assert.ok(
    block,
    'buildFrameOpts 会调用带参数校验的投影函数，抛错时必须由 catch / finally 兜住，'
    + '所以它必须落在 try 内部',
  );
  assert.ok(
    block.body.includes('sink.finish('),
    '它应当与编码收尾同处一个 try，而不是另起一个只包自己的小 try',
  );

  const iSink = body.indexOf('createMp4Sink(');
  assert.ok(iSink >= 0 && iSink < block.open, 'sink 的建立仍在这个 try 之前');

  const tail = body.slice(block.end + 1);
  assert.match(tail, /^\s*catch\b/, '这个 try 应当带 catch');
  assert.match(tail, /\bfinally\s*\{/, '这个 try 应当带 finally，负责界面复位');
});

/* ================================== F · 取消保存框时归还一次性开关 */

test('exportHardening · F(开关归还): 取消保存框的早退分支把 forceNoBasemap 还回去', () => {
  const assignments = [...MP4_CODE.matchAll(/forceNoBasemap\s*=[^=]/g)];
  assert.ok(
    assignments.length >= 2,
    '「改用无底图导出」在流程开头被消费（置 false），取消保存框时这次导出并没有发生，'
    + `应当把它归还——即除了消费那一处，还要有一处还原赋值；实得 ${assignments.length} 处赋值`,
  );

  const iAbort = MP4_CODE.indexOf('AbortError');
  assert.ok(iAbort >= 0, '保存框被取消时抛的 AbortError 应当有专门判别分支');

  const branch = MP4_CODE.slice(Math.max(0, iAbort - 400), iAbort + 800);
  assert.match(
    branch,
    /forceNoBasemap\s*=[^=]/,
    '归还应当就发生在取消保存框的早退分支里',
  );
});

/* ===================================== G · 流式路径回传实际保存名 */

test('exportHardening · G(实际保存名): 流式分支把用户选定的文件名放进返回对象', async (t) => {
  const env = installSinkEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: '建议名.mp4', preferStream: true });

  assert.equal(sink.kind, 'stream', '前置条件：本环境应当走流式路径');
  assert.notEqual(CHOSEN_NAME, '建议名.mp4', '前置条件：实际保存名与建议名刻意不同');

  const key = Object.keys(sink).find((k) => sink[k] === CHOSEN_NAME);
  assert.ok(
    key,
    'showSaveFilePicker 只把 suggestedName 当建议，用户可以改名。sidecar 要与 MP4 同名，'
    + `所以流式分支应当回传 handle.name；实得字段：${JSON.stringify(Object.keys(sink))}`,
  );
});

test('exportHardening · G(实际保存名): 内存分支该字段为 null，文件名交给 finish(name)', async (t) => {
  const env = installSinkEnv();
  t.after(() => env.restore());

  const streamSink = await createMp4Sink({ suggestedName: '建议名.mp4', preferStream: true });
  const key = Object.keys(streamSink).find((k) => streamSink[k] === CHOSEN_NAME);
  assert.ok(key, '前置条件：流式分支应当先回传实际保存名');

  const memorySink = await createMp4Sink({ suggestedName: '建议名.mp4', preferStream: false });
  assert.equal(memorySink.kind, 'memory', '前置条件：这一路应当走内存路径');
  assert.ok(Object.hasOwn(memorySink, key), `内存分支也应当带上 ${key} 字段，调用方才好统一判空`);
  assert.strictEqual(memorySink[key], null, `内存分支的文件名由 finish(name) 决定，${key} 应当为 null`);
});

test('exportHardening · G(实际保存名): 用户没改名时回传的就是建议名本身', async (t) => {
  const env = installSinkEnv({ handleName: '建议名.mp4' });
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: '建议名.mp4', preferStream: true });

  assert.equal(sink.kind, 'stream');
  const values = Object.values(sink).filter((v) => typeof v === 'string');
  assert.ok(
    values.includes('建议名.mp4'),
    `回传的是 handle.name，不论用户改没改名都该出现在返回对象里；实得字符串字段：${JSON.stringify(values)}`,
  );
});

test('exportHardening · G(实际保存名): mp4.mjs 的 sidecar 名优先取 sink 回传的实际名', () => {
  const body = topLevelBody(MP4_CODE, 'exportMp4');
  assert.ok(body, 'mp4.mjs 应当定义 exportMp4');

  // 只扫函数体，模块路径里的 `./mp4-sink.mjs` 不算 sink 的字段。
  const known = new Set(['kind', 'target', 'fastStart', 'finish', 'abort']);
  const extras = [...new Set(
    [...body.matchAll(/(?<![\w$\-./])sink\s*\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  )].filter((name) => !known.has(name));

  assert.ok(
    extras.length > 0,
    'sidecar 文件名应当优先用 sink 回传的实际保存名（把扩展名换成 .json），'
    + `而不是只认 buildTimeTrueFilename 的结果；mp4.mjs 目前只读到 sink 的 ${[...known].join(' / ')}`,
  );

  for (const name of extras) {
    assert.match(
      SINK_CODE,
      new RegExp(`\\b${name}\\b`),
      `mp4.mjs 读的 sink.${name} 应当确实由 mp4-sink.mjs 产出`,
    );
  }

  assert.match(MP4_CODE, /buildTimeTrueFilename\s*\(/, '没有回传时仍要用 buildTimeTrueFilename 兜底');
  assert.match(MP4_CODE, /json/i, 'sidecar 应当是同名的 .json');
});

/* ================================= H · sidecar 失败不拖垮整次导出 */

test('exportHardening · H(sidecar 兜底): sidecar 的下载被单独的 try 包住，catch 不调 sink.abort()', () => {
  const body = topLevelBody(MP4_CODE, 'exportMp4');
  assert.ok(body, 'mp4.mjs 应当定义 exportMp4');

  const iSidecar = body.indexOf('downloadSidecar(');
  assert.ok(iSidecar >= 0, 'exportMp4 应当经 downloadSidecar 落 sidecar');

  const iFinish = body.indexOf('sink.finish(');
  assert.ok(iFinish >= 0 && iFinish < iSidecar, 'sidecar 应当在 MP4 落盘之后才下载');

  const block = innermostTry(body, iSidecar);
  assert.ok(
    block,
    '长时间导出结束后的程序化下载可能被浏览器拦下，sidecar 的下载应当有自己的 try/catch',
  );
  assert.ok(
    block.open > iFinish && !block.body.includes('sink.finish('),
    'sidecar 的 try 应当在 MP4 落盘之后单独开一个，而不是复用整个编码 try',
  );

  const catchBody = catchBodyOf(body, block);
  assert.ok(catchBody !== null, 'sidecar 的 try 应当配一个 catch');
  assert.ok(catchBody.trim().length > 0, 'catch 里应当在成功文案后追加一句提示，而不是完全静默');
  assert.ok(
    !/sink\s*\.\s*abort\s*\(/.test(catchBody),
    'MP4 已经落盘，sidecar 失败不该再去 abort 已经关好的输出端',
  );
  assert.ok(!/\bthrow\b/.test(catchBody), 'sidecar 失败不该往外抛，否则会被当成导出失败');
  assert.ok(
    !/导出失败/.test(catchBody),
    '视频好好躺在磁盘上时，界面不该报「导出失败」',
  );
});

/* ======================================== I · 空轨迹守卫贯彻到导出入口 */

for (const [label, code] of [['mp4.mjs', MP4_CODE], ['png.mjs', PNG_CODE]]) {
  test(`exportHardening · I(空轨迹守卫): ${label} 的轨迹守卫认空数组`, () => {
    const src = flat(code);
    // 用 assert.ok 而不是 assert.match：失败时只留一句说明，不把整份源码打进报告。
    assert.ok(GUARD_ANY.test(src), `${label} 应当有 state.trackPoints 的早退守卫`);
    const guards = [...src.matchAll(new RegExp(GUARD_ANY.source, 'g'))].map((m) => m[0]);
    assert.ok(
      GUARD_WITH_LENGTH.test(src),
      `${label} 的守卫应当同样认空数组（trackPoints.length === 0 时直接返回），与渲染层已有的约定一致；`
      + `实得守卫：${JSON.stringify(guards)}`,
    );
  });
}

/* ============================================ J · 体积估算按上限夹取 */

test('exportHardening · J(体积夹取): 流式不可用时体积按夹到 600 秒后的时长算', () => {
  const range = { startMs: T0, endMs: T0 + 1_200_000, spanSec: 1200, anchorCount: 2, totalCount: 2 };
  const env = setup({
    windowStub: {},                              // 不带 showSaveFilePicker → 流式写盘不可用
    timeMode: { available: true, range, index: { startMs: range.startMs, endMs: range.endMs } },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(range.startMs) },
      mp4TimeEnd: { value: fmtLocal(range.endMs) },
      mp4TimeScale: { value: '1' },              // 视频时长 1200 秒 > 600
      exportRes: { value: '1080' },
      mp4Quality: { value: 'high' },
    },
  });

  try {
    updateTimeModeUI();

    const clamped = clampMp4Duration(1200, MP4_MAX_DURATION_MEMORY);
    assert.equal(clamped, MP4_MAX_DURATION_MEMORY, '前置：1200 秒确实会被夹到内存上限');

    const text = env.els.mp4SizeHint.textContent;
    assert.ok(
      text.startsWith(sizeHintText(clamped, 1080, 'high')),
      `提示语说了会被截断，旁边的体积数字就该是截断后的，期望以「${sizeHintText(clamped, 1080, 'high')}」开头，`
      + `实得「${text}」`,
    );
    assert.ok(
      !text.startsWith(sizeHintText(1200, 1080, 'high')),
      '体积不该按夹取前的 1200 秒算',
    );
  } finally {
    env.restore();
  }
});

test('exportHardening · J(体积夹取): 流式可用时按 21600 秒上限夹取', () => {
  const spanMs = 30_000_000;                     // 30000 秒 > 21600
  const range = { startMs: T0, endMs: T0 + spanMs, spanSec: spanMs / 1000, anchorCount: 2, totalCount: 2 };
  const env = setup({
    windowStub: streamingWindow(),
    timeMode: { available: true, range, index: { startMs: range.startMs, endMs: range.endMs } },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(range.startMs) },
      mp4TimeEnd: { value: fmtLocal(range.endMs) },
      mp4TimeScale: { value: '1' },
      exportRes: { value: '1080' },
      mp4Quality: { value: 'medium' },
    },
  });

  try {
    updateTimeModeUI();

    const clamped = clampMp4Duration(30_000, MP4_MAX_DURATION_STREAM);
    assert.equal(clamped, MP4_MAX_DURATION_STREAM, '前置：30000 秒确实会被夹到流式上限');

    const text = env.els.mp4SizeHint.textContent;
    assert.ok(
      text.startsWith(sizeHintText(clamped, 1080, 'medium')),
      `上限应当随流式可用性取 21600 秒，期望以「${sizeHintText(clamped, 1080, 'medium')}」开头，实得「${text}」`,
    );
    assert.ok(
      !text.startsWith(sizeHintText(30_000, 1080, 'medium')),
      '体积不该按夹取前的 30000 秒算',
    );
  } finally {
    env.restore();
  }
});

test('exportHardening · J(体积夹取): 未超上限的时间真实窗口体积照旧按实际时长算', () => {
  const range = { startMs: T0, endMs: T0 + 900_000, spanSec: 900, anchorCount: 2, totalCount: 2 };
  const env = setup({
    windowStub: {},
    timeMode: { available: true, range, index: { startMs: range.startMs, endMs: range.endMs } },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(range.startMs) },
      mp4TimeEnd: { value: fmtLocal(range.endMs) },
      mp4TimeScale: { value: '3' },              // 900 / 3 = 300 秒，未超上限
      exportRes: { value: '1440' },
      mp4Quality: { value: 'medium' },
    },
  });

  try {
    updateTimeModeUI();
    assert.equal(env.els.mp4SizeHint.textContent, sizeHintText(300, 1440, 'medium'));
  } finally {
    env.restore();
  }
});

test('exportHardening · J(体积夹取): 匀速模式的体积仍按 clampMp4Duration 夹取', () => {
  const env = setup({
    windowStub: {},
    els: {
      mp4TimeModeEven: { checked: true },
      mp4TimeModeTrue: { checked: false },
      mp4Duration: { value: '99999' },
      exportRes: { value: '1080' },
      mp4Quality: { value: 'high' },
    },
  });

  try {
    updateTimeModeUI();
    assert.equal(
      env.els.mp4SizeHint.textContent,
      sizeHintText(clampMp4Duration(99999, MP4_MAX_DURATION_MEMORY), 1080, 'high'),
    );
  } finally {
    env.restore();
  }
});
