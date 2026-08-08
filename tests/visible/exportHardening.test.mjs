// exportHardening · 导出链路加固（visible 样例）
//
// 这里是三条代表性用例：A（模式切换控件的选中态）、B（决策层复用已消毒的窗口取值）、
// G（sink 回传用户实际选定的文件名）。完整覆盖在 hidden 用例里。
//
// 全部函数读 DOM，Node 里注入假 document / window。`$` 是 `id => document.getElementById(id)`，
// 箭头函数体内才求值，所以模块 import 在 Node 里安全，逐个用例设定替身即可。
// 每个用例自己装卸替身与 state / timeMode，测试之间无共享可变状态、不依赖执行顺序。

import test from 'node:test';
import assert from 'node:assert/strict';

import { timeMode, updateTimeModeUI } from '../../src/ui/time-mode.mjs';
import { resolveExportPlan } from '../../src/export/mp4-plan.mjs';
import { createMp4Sink } from '../../src/export/mp4-sink.mjs';
import { state } from '../../src/state.mjs';

/* ------------------------------------------------------------- 假 DOM */

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
function setup({ els: overrides = {}, trackFiles = [], trackPoints = [], timeMode: tm = {}, windowStub = {} } = {}) {
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

/* --------------------------------------------------------- 时间轴夹具 */

const pad2 = (n) => String(n).padStart(2, '0');

/** 毫秒时间戳 → `YYYY-MM-DDTHH:mm:ss`（本地时区分量）。 */
const fmtLocal = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/** 秒对齐的锚点时刻，保证 datetime-local 的秒级精度能无损往返。 */
const T0 = Date.UTC(2024, 4, 1, 2, 0, 0);

const P = (i, timeMs) => ({ lng: 120 + i * 0.0015, lat: 30 + i * 0.0011, time: timeMs });

/** n 个点、每点间隔 stepMs 的带时间戳轨迹。 */
const timedTrack = (n, stepMs, t0 = T0) => Array.from({ length: n }, (_, i) => P(i, t0 + i * stepMs));

/** 时间轴就绪、起止取轨迹两端的一整套时间真实模式环境。 */
function trueModeEnv(points, overrides = {}) {
  const startMs = points[0].time;
  const endMs = points[points.length - 1].time;
  return setup({
    trackFiles: [{ name: 'ride.gpx', format: 'gpx', points }],
    trackPoints: points,
    timeMode: {
      available: true,
      range: { startMs, endMs, spanSec: (endMs - startMs) / 1000, anchorCount: points.length, totalCount: points.length },
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

/* --------------------------------------------------- G · sink 浏览器替身 */

/** 用户在保存框里改过的文件名，与 suggestedName 刻意不同。 */
const CHOSEN_NAME = '太湖-用户改过的名字.mp4';

function installSinkEnv() {
  const writable = {
    async write() {}, async close() {}, abort() {}, async seek() {}, async truncate() {},
  };
  const handle = { kind: 'file', name: CHOSEN_NAME, async createWritable() { return writable; } };
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
  globalThis.document = { createElement: () => ({ style: {}, click() {} }), body: { appendChild: (el) => el, removeChild: (el) => el } };

  return {
    handle,
    restore() {
      if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document;
      if (hadWin) globalThis.window = prevWin; else delete globalThis.window;
    },
  };
}

/* ======================================================== A · 模式选中态 */

test('exportHardening · A(模式选中态): 时间真实模式下只有 true 那个 label 带 .active', () => {
  const env = setup({
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      // 进场时选中态还停在匀速那侧，updateTimeModeUI 要把它搬过去。
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
    updateTimeModeUI();

    assert.equal(hasActive(env.els.mp4TimeModeTrueLabel), true, '时间真实那个 label 应当加上 .active');
    assert.equal(hasActive(env.els.mp4TimeModeEvenLabel), false, '匀速那个 label 应当去掉 .active');
  } finally {
    env.restore();
  }
});

/* ==================================================== B · 复用消毒后的值 */

test('exportHardening · B(消毒复用): mp4TimeScale 清空时 resolveExportPlan 不抛错且 scale 回落 1', () => {
  const points = timedTrack(11, 30_000);          // 跨 300 秒
  const env = trueModeEnv(points, { mp4TimeScale: { value: '' } });

  try {
    let plan;
    try {
      plan = resolveExportPlan();
    } catch (err) {
      assert.fail(`控件清空只是非法输入，决策层应当用 currentExportWindow() 消毒后的值，`
        + `不该抛错。实得 ${err && err.name}: ${err && err.message}`);
    }

    assert.equal(plan.mode, 'true', '窗口算得出来时仍是时间真实模式');
    assert.equal(plan.scale, 1, 'scale 应当回落到 1');
    assert.ok(Number.isFinite(plan.durationSec) && plan.durationSec > 0, '时长应当是有限正数');
  } finally {
    env.restore();
  }
});

/* ================================================== G · sink 回传保存名 */

test('exportHardening · G(sink 回传): 流式分支带上用户实际选定的文件名，内存分支该字段为 null', async (t) => {
  const env = installSinkEnv();
  t.after(() => env.restore());

  const streamSink = await createMp4Sink({ suggestedName: '建议名.mp4', preferStream: true });
  assert.equal(streamSink.kind, 'stream', '前置条件：本环境应当走流式路径');

  // 字段叫什么由实现定，用例只认「返回对象里带着 handle.name」。
  const key = Object.keys(streamSink).find((k) => streamSink[k] === CHOSEN_NAME);
  assert.ok(
    key,
    `流式分支应当把 handle.name（${CHOSEN_NAME}）回传给调用方，供 sidecar 同名落盘；`
    + `实得字段：${JSON.stringify(Object.keys(streamSink))}`,
  );

  const memorySink = await createMp4Sink({ suggestedName: '建议名.mp4', preferStream: false });
  assert.equal(memorySink.kind, 'memory', '前置条件：这一路应当走内存路径');
  assert.ok(Object.hasOwn(memorySink, key), `内存分支也应当带上 ${key} 字段`);
  assert.strictEqual(memorySink[key], null, `内存分支的文件名由 finish(name) 决定，${key} 应当为 null`);
});
