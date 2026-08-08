// 单元 previewScrub · 扫拨条时间轴（可见样例）
//
// 覆盖两件事：匀速模式下扫拨条文案与推进速度维持既有行为；时间真实模式下
// 文案显示当前扫拨位置的本地时刻，播放按导出窗口推导出的视频时长推进。
//
// 运行：node --test tests/visible/previewScrub.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../../src/state.mjs';
import { timeAtProgress } from '../../src/core/track-time.mjs';
import { clampMp4Duration } from '../../src/core/export-params.mjs';
import { timeMode, currentExportWindow } from '../../src/ui/time-mode.mjs';
import {
  render,
  previewPlaying,
  startPreviewPlay,
  stopPreviewPlay,
  updatePreviewScrubLabel,
} from '../../src/ui/preview.mjs';

// ---------------------------------------------------------------- 假 Canvas ---

/** 任意属性读出来都能继续被调用/取值的兜底对象，供 mock ctx 的方法返回值使用。 */
function flexibleResult() {
  const store = { width: 0, height: 0, data: [] };
  return new Proxy(store, {
    get(t, p) {
      if (typeof p === 'symbol') return t[p];
      if (p in t) return t[p];
      return () => flexibleResult();
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
}

/** 记录调用的 2D context 替身：任意方法名都能调，赋值属性可读回。 */
function createCtx() {
  const calls = [];
  const store = {};
  return new Proxy(store, {
    get(t, p) {
      if (typeof p === 'symbol') return t[p];
      if (p === '__calls') return calls;
      if (p in t) return t[p];
      return (...args) => {
        calls.push({ name: p, args });
        return flexibleResult();
      };
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
}

// ------------------------------------------------------------------ 假 DOM ---

function createElement(id) {
  const attrs = new Map();
  const ctx = createCtx();
  const el = {
    id,
    tagName: 'DIV',
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    disabled: false,
    hidden: false,
    width: 600,
    height: 600,
    style: {},
    dataset: {},
    children: [],
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) {
        const on = f === undefined ? !this._s.has(c) : !!f;
        if (on) this._s.add(c); else this._s.delete(c);
        return on;
      },
    },
    getContext: () => ctx,
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    setAttribute: (n, v) => { attrs.set(n, String(v)); },
    removeAttribute: (n) => { attrs.delete(n); },
    hasAttribute: (n) => attrs.has(n),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    appendChild(c) { el.children.push(c); return c; },
    append(...cs) { el.children.push(...cs); },
    replaceChildren(...cs) { el.children.length = 0; el.children.push(...cs); },
    remove() {},
    focus() {},
    blur() {},
    click() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect: () => ({
      x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600,
    }),
    toDataURL: () => 'data:image/png;base64,',
    __attrs: attrs,
    __ctx: ctx,
  };
  ctx.canvas = el;
  return el;
}

/** 让 render() 能画完整一帧的样式输入初值；用例可用 `values` 覆盖。 */
const STYLE_VALUES = {
  dotSize: '18',
  dotColor: '#ff3b30',
  exportRes: '1080',
  radius: '6',
  pad: '24',
  lineWidth: '4',
  bgColor: '#ffffff',
  bgOpacity: '100',
  lineColor: '#1e88e5',
};

/**
 * 装上假 document 与假 requestAnimationFrame。
 * 元素按 id 懒创建，`values` / `checked` 指定初值，其余取 `defaultValue`。
 */
function installHarness({ values = {}, checked = {}, defaultValue = '' } = {}) {
  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    raf: globalThis.requestAnimationFrame,
    caf: globalThis.cancelAnimationFrame,
    dpr: globalThis.devicePixelRatio,
  };
  const initial = { ...STYLE_VALUES, ...values };
  const els = new Map();
  const getById = (id) => {
    if (!els.has(id)) {
      const el = createElement(id);
      el.value = Object.prototype.hasOwnProperty.call(initial, id)
        ? String(initial[id])
        : String(defaultValue);
      el.checked = Object.prototype.hasOwnProperty.call(checked, id) ? !!checked[id] : false;
      els.set(id, el);
    }
    return els.get(id);
  };

  const frames = [];
  const cancelled = [];
  let nextId = 1;

  globalThis.document = {
    getElementById: getById,
    createElement: (tag) => createElement(`<${tag}>`),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: createElement('body'),
    documentElement: createElement('html'),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return nextId++; };
  globalThis.cancelAnimationFrame = (id) => { cancelled.push(id); };
  globalThis.devicePixelRatio = 1;

  return {
    el: getById,
    elements: els,
    frames,
    cancelled,
    label: () => getById('previewScrubLabel').textContent,
    scrub: () => Number(getById('previewProgress').value),
    /** 手动执行一个待跑的 rAF 回调，传入指定时间戳。 */
    step(ts) {
      const cb = frames.shift();
      assert.equal(typeof cb, 'function', `期望存在待执行的 rAF 回调（ts=${ts}）`);
      cb(ts);
    },
    restore() {
      globalThis.document = saved.document;
      globalThis.window = saved.window;
      globalThis.requestAnimationFrame = saved.raf;
      globalThis.cancelAnimationFrame = saved.caf;
      globalThis.devicePixelRatio = saved.dpr;
    },
  };
}

// ------------------------------------------------------------- 场景装配 ---

/** 造一条 [startMs, endMs] 线性对应里程的时间索引（timeAtProgress 的入参形状）。 */
function makeIndex(startMs, endMs, totalLen = 1000) {
  return {
    anchorTimes: [startMs, endMs],
    anchorLens: [0, totalLen],
    totalLen,
    startMs,
    endMs,
    droppedCount: 0,
  };
}

function setup(opts = {}) {
  const h = installHarness(opts);
  state.trackFiles = [];
  state.trackPoints = opts.trackPoints ?? null;
  state.previewProgress = opts.progress ?? 0;
  timeMode.index = opts.index ?? null;
  timeMode.range = opts.range ?? null;
  timeMode.available = opts.available ?? false;
  return h;
}

function teardown(h) {
  try {
    stopPreviewPlay();
  } catch {
    /* 播放态清理失败不该盖掉用例本身的断言错误 */
  }
  h.restore();
  state.trackFiles = [];
  state.trackPoints = null;
  state.previewProgress = 0;
  timeMode.index = null;
  timeMode.range = null;
  timeMode.available = false;
}

/** 时间真实模式的一套完整装配：勾上开关、给出时间索引与导出窗口。 */
function setupTimeTrue({ startMs, endMs, scale, duration = 6, progress = 0, index, range }) {
  return setup({
    values: {
      mp4Duration: String(duration),
      mp4TimeScale: scale === undefined ? '' : String(scale),
    },
    checked: { mp4TimeModeTrue: true },
    available: true,
    range: range === undefined ? { startMs, endMs, spanSec: (endMs - startMs) / 1000 } : range,
    index: index === undefined ? makeIndex(startMs, endMs) : index,
    progress,
  });
}

/** 本地时区的 HH:MM:SS（各两位、补前导零）。 */
function localHms(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const BASE_MS = new Date(2024, 0, 15, 8, 0, 0, 0).getTime(); // 本地 2024-01-15 08:00:00

// ------------------------------------------------------------------ 用例 ---

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 匀速模式沿用「动画预览 · N 秒」文案', () => {
  const h = setup({ values: { mp4Duration: '12' } });
  try {
    state.previewProgress = 0.42;
    updatePreviewScrubLabel();
    assert.equal(h.label(), `动画预览 · ${clampMp4Duration(12)} 秒`);
    assert.equal(h.label(), '动画预览 · 12 秒');
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 时间真实模式显示本地时刻与视频时长', () => {
  const start = BASE_MS;
  const end = BASE_MS + 60_000; // 窗口 60 秒、scale 1 → 视频 60 秒
  const h = setupTimeTrue({ startMs: start, endMs: end, scale: 1, duration: 6, progress: 0.5 });
  try {
    const win = currentExportWindow();
    assert.ok(win, '前置条件：时间真实模式下导出窗口应可用');
    const videoSec = (win.endMs - win.startMs) / 1000 / win.scale;
    assert.equal(videoSec, 60);

    const ms = timeAtProgress(timeMode.index, state.previewProgress);
    assert.equal(typeof ms, 'number');

    updatePreviewScrubLabel();
    assert.equal(h.label(), `动画预览 · ${localHms(ms)} · 共 60 秒`);
    // 时长取自导出窗口而非 mp4Duration（后者是 6）
    assert.ok(!h.label().includes('共 6 秒'), `时长应来自导出窗口：${h.label()}`);
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 两种模式各按自己的时长推进，每帧同步扫拨条', () => {
  // 匀速模式：10 秒跑完一圈 → 1000ms 推进 0.1；每帧写回扫拨条。
  // 匀速的标签不随进度变化，逐帧刷不刷新它在结果上不可观测，因此不做断言。
  const uniform = setup({ values: { mp4Duration: '10' } });
  try {
    startPreviewPlay();
    assert.equal(previewPlaying, true);

    uniform.step(1000); // 首帧只记录时间戳，不推进
    assert.equal(uniform.scrub(), 0);
    uniform.step(2000); // dt = 1000ms

    assert.ok(
      Math.abs(state.previewProgress - 0.1) < 1e-9,
      `匀速 10 秒时 1000ms 应推进 0.1，实际 ${state.previewProgress}`,
    );
    assert.equal(uniform.scrub(), Math.round(state.previewProgress * 1000));
  } finally {
    teardown(uniform);
  }

  // 时间真实模式：窗口 60 秒 / scale 1 → 视频 60 秒，与 mp4Duration=6 不同。
  const trueMode = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000,
    scale: 1,
    duration: 6,
    progress: 0,
  });
  try {
    startPreviewPlay();
    trueMode.step(1000);
    const p0 = state.previewProgress;
    trueMode.step(2000); // dt = 1000ms

    const advanced = state.previewProgress - p0;
    assert.ok(
      Math.abs(advanced - 1 / 60) < 1e-9,
      `1000ms 应推进 1/60，实际 ${advanced}（按 mp4Duration=6 会是 ${1 / 6}）`,
    );
    assert.equal(trueMode.scrub(), Math.round(state.previewProgress * 1000));

    const ms = timeAtProgress(timeMode.index, state.previewProgress);
    assert.ok(
      trueMode.label().includes(localHms(ms)),
      `标签里的时刻应跟着走到 ${localHms(ms)}，实际 ${trueMode.label()}`,
    );
    assert.doesNotThrow(() => render());
  } finally {
    teardown(trueMode);
  }
});
