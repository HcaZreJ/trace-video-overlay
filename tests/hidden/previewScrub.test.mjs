// 单元 previewScrub · 扫拨条时间轴（完整覆盖）
//
// 契约：
//   updatePreviewScrubLabel()
//     匀速模式  → `动画预览 · ${clampMp4Duration(+$('mp4Duration').value)} 秒`
//     时间真实  → `动画预览 · HH:MM:SS · 共 N 秒`（本地时刻 + 导出窗口推导的视频时长）
//     降级      → 索引/窗口缺失时退回匀速文案，不抛错
//   逐帧推进（rAF 回调）
//     匀速模式  → progress += dt / (clampMp4Duration(...) * 1000)
//     时间真实  → progress += dt / (videoSec * 1000)，videoSec = (endMs-startMs)/1000/scale
//     两者都 % 1 回绕、写回 $('previewProgress').value、render()、刷新标签
//
// 运行：node --test tests/hidden/previewScrub.test.mjs

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

/** 停顿型索引：前 1/2 里程只花 10% 时间，后半程慢——用来验证时刻不是线性映射。 */
function makePausedIndex(startMs, endMs) {
  const span = endMs - startMs;
  return {
    anchorTimes: [startMs, startMs + Math.round(span * 0.1), endMs],
    anchorLens: [0, 500, 1000],
    totalLen: 1000,
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
function setupTimeTrue({
  startMs, endMs, scale, duration = 6, progress = 0, index, range, trackPoints = null,
}) {
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
    trackPoints,
  });
}

/** 本地时区的 HH:MM:SS（各两位、补前导零）。 */
function localHms(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ariaPressedOf(el) {
  const attr = el.__attrs.get('aria-pressed');
  if (attr !== undefined) return attr;
  if (typeof el.ariaPressed === 'string') return el.ariaPressed;
  return null;
}

function ariaPressedElements(h) {
  return [...h.elements.values()].filter((el) => ariaPressedOf(el) !== null);
}

const NEAR = 1e-9;
const BASE_MS = new Date(2024, 0, 15, 8, 0, 0, 0).getTime(); // 本地 2024-01-15 08:00:00

// =========================================================== 标签 · 匀速 ===

for (const raw of ['12', '6', '10', '', 'abc', '0', '-5', '900', '3.7']) {
  test(`previewScrub · updatePreviewScrubLabel(扫拨标签): 匀速模式 mp4Duration=${JSON.stringify(raw)} 走 clampMp4Duration`, () => {
    const h = setup({ values: { mp4Duration: raw } });
    try {
      state.previewProgress = 0.37;
      updatePreviewScrubLabel();
      assert.equal(h.label(), `动画预览 · ${clampMp4Duration(+raw)} 秒`);
    } finally {
      teardown(h);
    }
  });
}

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 匀速文案与扫拨位置无关', () => {
  const h = setup({ values: { mp4Duration: '20' } });
  try {
    const seen = new Set();
    for (const p of [0, 0.37, 0.5, 1]) {
      state.previewProgress = p;
      updatePreviewScrubLabel();
      seen.add(h.label());
    }
    assert.deepEqual([...seen], ['动画预览 · 20 秒']);
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 有时间数据但开关未勾时仍是匀速文案', () => {
  const h = setup({
    values: { mp4Duration: '15' },
    checked: { mp4TimeModeTrue: false },
    available: true,
    range: { startMs: BASE_MS, endMs: BASE_MS + 60_000, spanSec: 60 },
    index: makeIndex(BASE_MS, BASE_MS + 60_000),
    progress: 0.5,
  });
  try {
    updatePreviewScrubLabel();
    assert.equal(h.label(), '动画预览 · 15 秒');
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): timeMode.available 为 false 时按匀速文案', () => {
  const h = setup({
    values: { mp4Duration: '9' },
    checked: { mp4TimeModeTrue: true },
    available: false,
    range: { startMs: BASE_MS, endMs: BASE_MS + 60_000, spanSec: 60 },
    index: makeIndex(BASE_MS, BASE_MS + 60_000),
    progress: 0.5,
  });
  try {
    assert.doesNotThrow(() => updatePreviewScrubLabel());
    assert.equal(h.label(), '动画预览 · 9 秒');
  } finally {
    teardown(h);
  }
});

// ====================================================== 标签 · 时间真实 ===

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 时间真实模式给出「时刻 · 共 N 秒」', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000,
    scale: 1,
    duration: 6,
    progress: 0.5,
  });
  try {
    const win = currentExportWindow();
    assert.ok(win, '前置条件：导出窗口应可用');
    const videoSec = (win.endMs - win.startMs) / 1000 / win.scale;
    assert.equal(videoSec, 60, '前置条件：视频时长应为 60 秒');

    const ms = timeAtProgress(timeMode.index, 0.5);
    assert.equal(typeof ms, 'number', '前置条件：timeAtProgress 应给出时刻');

    updatePreviewScrubLabel();
    assert.equal(h.label(), `动画预览 · ${localHms(ms)} · 共 60 秒`);
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 时长取自导出窗口而非 mp4Duration', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 120_000, // 窗口 120 秒
    scale: 2, // → 视频 60 秒
    duration: 6,
    progress: 0.25,
  });
  try {
    const win = currentExportWindow();
    assert.ok(win, '前置条件：导出窗口应可用');
    assert.equal(win.scale, 2, '前置条件：mp4TimeScale 应生效');
    assert.equal((win.endMs - win.startMs) / 1000 / win.scale, 60);

    updatePreviewScrubLabel();
    assert.ok(h.label().includes('共 60 秒'), `标签应含窗口时长：${h.label()}`);
    assert.ok(!h.label().includes('共 6 秒'), `标签不应用 mp4Duration：${h.label()}`);
    assert.ok(!h.label().includes('共 120 秒'), `标签应按 scale 折算：${h.label()}`);
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 视频时长非整数秒时按整秒显示', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 91_000, // 窗口 91 秒
    scale: 2, // → 视频 45.5 秒
    duration: 6,
    progress: 0.5,
  });
  try {
    const win = currentExportWindow();
    assert.ok(win, '前置条件：导出窗口应可用');
    assert.equal((win.endMs - win.startMs) / 1000 / win.scale, 45.5, '前置条件：视频时长应为 45.5 秒');

    updatePreviewScrubLabel();
    const m = h.label().match(/共\s*(\S+)\s*秒/);
    assert.ok(m, `标签应含「共 N 秒」：${h.label()}`);
    assert.match(m[1], /^\d+$/, `时长应取整显示，实际 ${m[1]}`);
    assert.ok(
      Math.abs(Number(m[1]) - 45.5) <= 0.5,
      `取整后的时长应贴近 45.5，实际 ${m[1]}`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 时刻随扫拨位置移动且与 timeAtProgress 一致', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 3_600_000, // 一小时
    scale: 1,
    duration: 6,
  });
  try {
    const labels = [];
    for (const p of [0, 0.25, 0.5, 1]) {
      state.previewProgress = p;
      updatePreviewScrubLabel();
      const ms = timeAtProgress(timeMode.index, p);
      assert.ok(
        h.label().includes(localHms(ms)),
        `progress=${p} 时标签应含 ${localHms(ms)}，实际 ${h.label()}`,
      );
      labels.push(h.label());
    }
    assert.equal(new Set(labels).size, 4, `四个扫拨位置应给出四个不同时刻：${labels.join(' | ')}`);
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 停顿轨迹的时刻按真实时间而非里程线性映射', () => {
  const start = BASE_MS;
  const end = BASE_MS + 600_000; // 10 分钟
  const h = setupTimeTrue({
    startMs: start,
    endMs: end,
    scale: 1,
    duration: 6,
    index: makePausedIndex(start, end),
    progress: 0.5,
  });
  try {
    const ms = timeAtProgress(timeMode.index, 0.5);
    assert.equal(typeof ms, 'number');
    // 一半里程只花了 10% 时间：时刻应明显早于窗口中点
    assert.ok(ms - start < (end - start) / 2, '前置条件：停顿索引应让半程时刻偏早');

    updatePreviewScrubLabel();
    assert.ok(h.label().includes(localHms(ms)), `标签应含 ${localHms(ms)}，实际 ${h.label()}`);
    assert.ok(
      !h.label().includes(localHms(start + (end - start) / 2)),
      `时刻不应是窗口中点：${h.label()}`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 时分秒各补两位前导零', () => {
  const single = new Date(2024, 0, 15, 5, 6, 7, 0).getTime(); // 本地 05:06:07
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000,
    scale: 1,
    duration: 6,
    // 零长度索引：totalLen 为 0 时任何 progress 都落在 startMs，时刻因此恒定。
    // 端点本身不退化成同一时刻——导出窗口按索引端点夹取，start === end 会让窗口算不出来。
    index: {
      anchorTimes: [single],
      anchorLens: [0],
      totalLen: 0,
      startMs: single,
      endMs: single + 60_000,
      droppedCount: 0,
    },
    progress: 0.73,
  });
  try {
    assert.equal(timeAtProgress(timeMode.index, 0.73), single, '前置条件：退化索引应回落到 startMs');
    updatePreviewScrubLabel();
    assert.equal(localHms(single), '05:06:07');
    assert.ok(h.label().includes('05:06:07'), `时分秒应补零：${h.label()}`);
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): progress 为 0 与 1 的端点时刻取窗口两端', () => {
  const start = BASE_MS;
  const end = BASE_MS + 1_800_000; // 30 分钟
  const h = setupTimeTrue({ startMs: start, endMs: end, scale: 1, duration: 6 });
  try {
    state.previewProgress = 0;
    updatePreviewScrubLabel();
    assert.ok(h.label().includes(localHms(start)), `起点应为 ${localHms(start)}，实际 ${h.label()}`);

    state.previewProgress = 1;
    updatePreviewScrubLabel();
    assert.ok(h.label().includes(localHms(end)), `终点应为 ${localHms(end)}，实际 ${h.label()}`);
  } finally {
    teardown(h);
  }
});

// ========================================================== 标签 · 降级 ===

test('previewScrub · updatePreviewScrubLabel(扫拨标签): timeMode.index 为 null 时退回匀速文案', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000,
    scale: 1,
    duration: 8,
    index: null,
    progress: 0.5,
  });
  try {
    assert.equal(timeMode.index, null, '前置条件：索引应为 null');
    assert.doesNotThrow(() => updatePreviewScrubLabel());
    assert.equal(h.label(), '动画预览 · 8 秒');
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 导出窗口为 null 时退回匀速文案', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000,
    scale: 1,
    duration: 11,
    range: null,
    progress: 0.5,
  });
  try {
    assert.equal(currentExportWindow(), null, '前置条件：导出窗口应为 null');
    assert.doesNotThrow(() => updatePreviewScrubLabel());
    assert.equal(h.label(), '动画预览 · 11 秒');
  } finally {
    teardown(h);
  }
});

test('previewScrub · updatePreviewScrubLabel(扫拨标签): 时间窗口零跨度时退回匀速文案', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS,
    scale: 1,
    duration: 7,
    range: { startMs: BASE_MS, endMs: BASE_MS, spanSec: 0 },
    index: makeIndex(BASE_MS, BASE_MS, 0),
    progress: 0.5,
  });
  try {
    assert.doesNotThrow(() => updatePreviewScrubLabel());
    assert.equal(h.label(), '动画预览 · 7 秒');
  } finally {
    teardown(h);
  }
});

// ==================================================== 逐帧推进 · 匀速 ===

test('previewScrub · 逐帧推进(rAF): 匀速模式 10 秒时长 1000ms 推进 0.1，首帧只记录', () => {
  const h = setup({ values: { mp4Duration: '10' } });
  try {
    startPreviewPlay();
    h.step(1000);
    assert.ok(Math.abs(state.previewProgress - 0) < NEAR, '首帧应只记录时间戳，不推进');
    h.step(2000);
    assert.ok(
      Math.abs(state.previewProgress - 0.1) < NEAR,
      `1000ms 应推进 0.1，实际 ${state.previewProgress}`,
    );
    h.step(2500);
    assert.ok(
      Math.abs(state.previewProgress - 0.15) < NEAR,
      `再 500ms 应到 0.15，实际 ${state.previewProgress}`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 匀速模式 mp4Duration 非法值按 clampMp4Duration 推进', () => {
  const h = setup({ values: { mp4Duration: 'abc' } });
  try {
    const dur = clampMp4Duration(+'abc');
    startPreviewPlay();
    h.step(1000);
    h.step(2000);
    assert.ok(
      Math.abs(state.previewProgress - 1000 / (dur * 1000)) < NEAR,
      `应按 clampMp4Duration=${dur} 推进，实际 ${state.previewProgress}`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 匀速模式进度超过 1 时回绕到 [0,1)', () => {
  const h = setup({ values: { mp4Duration: '10' } });
  try {
    startPreviewPlay();
    h.step(1000);
    state.previewProgress = 0.95;
    h.step(2000);
    const expected = (0.95 + 0.1) % 1;
    assert.ok(state.previewProgress >= 0 && state.previewProgress < 1, '回绕后应落在 [0,1)');
    assert.ok(
      Math.abs(state.previewProgress - expected) < NEAR,
      `应回绕到 ${expected}，实际 ${state.previewProgress}`,
    );
  } finally {
    teardown(h);
  }
});

// 匀速模式的标签是「动画预览 · N 秒」，不随进度变化，所以逐帧刷不刷新它在结果上
// 不可观测，这里只断言扫拨条 value 的同步（那才是逐帧真正要做的事）。
test('previewScrub · 逐帧推进(rAF): 匀速模式每帧同步扫拨条 value', () => {
  const h = setup({ values: { mp4Duration: '10' } });
  try {
    startPreviewPlay();
    h.step(0);
    for (const ts of [500, 1200, 3000]) {
      h.step(ts);
      assert.equal(h.scrub(), Math.round(state.previewProgress * 1000), `ts=${ts} 扫拨条应同步`);
    }
  } finally {
    teardown(h);
  }
});

// =============================================== 逐帧推进 · 时间真实 ===

test('previewScrub · 逐帧推进(rAF): 时间真实模式按窗口时长而非 mp4Duration 推进', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000, // 视频 60 秒
    scale: 1,
    duration: 6, // 匀速时长故意不同
  });
  try {
    const win = currentExportWindow();
    assert.ok(win, '前置条件：导出窗口应可用');
    const videoSec = (win.endMs - win.startMs) / 1000 / win.scale;
    assert.equal(videoSec, 60);
    assert.notEqual(videoSec, clampMp4Duration(6), '前置条件：两种时长应不同');

    startPreviewPlay();
    h.step(1000);
    const p0 = state.previewProgress;
    h.step(2000);
    const advanced = state.previewProgress - p0;
    assert.ok(
      Math.abs(advanced - 1 / 60) < NEAR,
      `1000ms 应推进 1/60，实际 ${advanced}（按 mp4Duration=6 会是 ${1 / 6}）`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 时间真实模式 scale 减半视频时长使每帧推进翻倍', () => {
  const measure = (scale) => {
    const h = setupTimeTrue({
      startMs: BASE_MS,
      endMs: BASE_MS + 120_000,
      scale,
      duration: 6,
    });
    try {
      const win = currentExportWindow();
      assert.ok(win, `前置条件：scale=${scale} 时导出窗口应可用`);
      assert.equal(win.scale, scale, `前置条件：mp4TimeScale=${scale} 应生效`);
      startPreviewPlay();
      h.step(1000);
      const p0 = state.previewProgress;
      h.step(2000);
      return {
        advanced: state.previewProgress - p0,
        videoSec: (win.endMs - win.startMs) / 1000 / win.scale,
      };
    } finally {
      teardown(h);
    }
  };

  const one = measure(1); // 视频 120 秒
  const two = measure(2); // 视频 60 秒
  assert.equal(one.videoSec, 120);
  assert.equal(two.videoSec, 60);
  assert.ok(Math.abs(one.advanced - 1 / 120) < NEAR, `scale=1 应推进 1/120，实际 ${one.advanced}`);
  assert.ok(Math.abs(two.advanced - 1 / 60) < NEAR, `scale=2 应推进 1/60，实际 ${two.advanced}`);
  assert.ok(
    Math.abs(two.advanced - one.advanced * 2) < NEAR,
    `视频时长减半时每帧推进应翻倍：${one.advanced} → ${two.advanced}`,
  );
});

test('previewScrub · 逐帧推进(rAF): 时间真实模式多帧累计按窗口时长线性叠加', () => {
  const h = setupTimeTrue({ startMs: BASE_MS, endMs: BASE_MS + 300_000, scale: 1, duration: 6 });
  try {
    startPreviewPlay();
    h.step(0);
    const p0 = state.previewProgress;
    for (const ts of [1000, 2000, 3000]) h.step(ts);
    assert.ok(
      Math.abs(state.previewProgress - (p0 + 3 / 300)) < NEAR,
      `3 帧共 3000ms 应推进 3/300，实际 ${state.previewProgress - p0}`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 时间真实模式进度超过 1 时回绕到 [0,1)', () => {
  const h = setupTimeTrue({ startMs: BASE_MS, endMs: BASE_MS + 60_000, scale: 1, duration: 6 });
  try {
    startPreviewPlay();
    h.step(1000);
    state.previewProgress = 0.99;
    h.step(2000);
    const expected = (0.99 + 1 / 60) % 1;
    assert.ok(state.previewProgress >= 0 && state.previewProgress < 1, '回绕后应落在 [0,1)');
    assert.ok(
      Math.abs(state.previewProgress - expected) < NEAR,
      `应回绕到 ${expected}，实际 ${state.previewProgress}`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 时间真实模式每帧同步扫拨条并刷新时刻标签', () => {
  const h = setupTimeTrue({ startMs: BASE_MS, endMs: BASE_MS + 60_000, scale: 1, duration: 6 });
  try {
    startPreviewPlay();
    h.step(0);
    const labels = [];
    for (const ts of [5000, 10_000, 15_000]) {
      h.step(ts);
      assert.equal(h.scrub(), Math.round(state.previewProgress * 1000), `ts=${ts} 扫拨条应同步`);
      const ms = timeAtProgress(timeMode.index, state.previewProgress);
      assert.ok(
        h.label().includes(localHms(ms)),
        `ts=${ts} 标签应跟到 ${localHms(ms)}，实际 ${h.label()}`,
      );
      labels.push(h.label());
    }
    assert.equal(new Set(labels).size, labels.length, `逐帧时刻应各不相同：${labels.join(' | ')}`);
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 时间真实模式首帧只记录时间戳', () => {
  const h = setupTimeTrue({ startMs: BASE_MS, endMs: BASE_MS + 60_000, scale: 1, duration: 6 });
  try {
    startPreviewPlay();
    h.step(12_345);
    assert.ok(Math.abs(state.previewProgress - 0) < NEAR, '首帧不应推进');
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 两帧时间戳相同则进度不变', () => {
  const h = setupTimeTrue({ startMs: BASE_MS, endMs: BASE_MS + 60_000, scale: 1, duration: 6 });
  try {
    startPreviewPlay();
    h.step(1000);
    state.previewProgress = 0.4;
    h.step(1000);
    assert.ok(Math.abs(state.previewProgress - 0.4) < NEAR, `dt=0 不应推进，实际 ${state.previewProgress}`);
  } finally {
    teardown(h);
  }
});

// ============================================ 逐帧推进 · 窗口异常降级 ===

test('previewScrub · 逐帧推进(rAF): 导出窗口为 null 时按匀速时长推进且不抛', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000,
    scale: 1,
    duration: 10,
    range: null,
  });
  try {
    assert.equal(currentExportWindow(), null, '前置条件：导出窗口应为 null');
    startPreviewPlay();
    h.step(1000);
    assert.doesNotThrow(() => h.step(2000));
    assert.ok(
      Math.abs(state.previewProgress - 0.1) < NEAR,
      `应回落到 mp4Duration=10 的推进量 0.1，实际 ${state.previewProgress}`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): 时间窗口零跨度时按匀速时长推进且不抛', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS,
    scale: 1,
    duration: 20,
    range: { startMs: BASE_MS, endMs: BASE_MS, spanSec: 0 },
    index: makeIndex(BASE_MS, BASE_MS, 0),
  });
  try {
    startPreviewPlay();
    h.step(1000);
    assert.doesNotThrow(() => h.step(2000));
    assert.ok(
      Number.isFinite(state.previewProgress),
      `进度应保持有限数，实际 ${state.previewProgress}`,
    );
    assert.ok(
      Math.abs(state.previewProgress - 0.05) < NEAR,
      `应回落到 mp4Duration=20 的推进量 0.05，实际 ${state.previewProgress}`,
    );
  } finally {
    teardown(h);
  }
});

test('previewScrub · 逐帧推进(rAF): timeMode.index 为 null 时仍能逐帧推进且不抛', () => {
  const h = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000,
    scale: 1,
    duration: 6,
    index: null,
  });
  try {
    startPreviewPlay();
    h.step(1000);
    assert.doesNotThrow(() => h.step(2000));
    assert.ok(state.previewProgress >= 0 && state.previewProgress < 1, '进度应落在 [0,1)');
    assert.ok(Number.isFinite(state.previewProgress), '进度应为有限数');
  } finally {
    teardown(h);
  }
});

// =========================================================== 播放态语义 ===

test('previewScrub · 播放态: start/stop 切换 previewPlaying、按钮文案与 aria-pressed', () => {
  const h = setup({ values: { mp4Duration: '10' } });
  try {
    assert.equal(previewPlaying, false, '初始应为停止态');

    startPreviewPlay();
    assert.equal(previewPlaying, true, 'start 后应为播放态');
    assert.ok(h.frames.length >= 1, 'start 应排入一个 rAF 回调');

    const pressed = ariaPressedElements(h).filter((el) => ariaPressedOf(el) === 'true');
    assert.equal(pressed.length, 1, `播放中应有且仅有一个 aria-pressed="true" 的按钮，实际 ${pressed.length} 个`);
    const btn = pressed[0];
    const playingText = btn.textContent;
    assert.notEqual(playingText, '', '播放中按钮应有文案');

    stopPreviewPlay();
    assert.equal(previewPlaying, false, 'stop 后应为停止态');
    assert.equal(ariaPressedOf(btn), 'false', '停止后 aria-pressed 应为 false');
    assert.notEqual(btn.textContent, playingText, '停止后按钮文案应与播放中不同');
  } finally {
    teardown(h);
  }
});

test('previewScrub · 播放态: 时间真实模式下播放态语义与匀速模式一致', () => {
  const h = setupTimeTrue({ startMs: BASE_MS, endMs: BASE_MS + 60_000, scale: 1, duration: 6 });
  try {
    startPreviewPlay();
    assert.equal(previewPlaying, true);
    h.step(1000);
    h.step(2000);
    assert.ok(h.frames.length >= 1, '每帧应继续排下一帧');
    stopPreviewPlay();
    assert.equal(previewPlaying, false);
  } finally {
    teardown(h);
  }
});

// ================================================================ 渲染 ===

test('previewScrub · 逐帧推进(rAF): 有轨迹时两种模式各驱动数帧都不抛', () => {
  const points = [
    { lat: 30.0, lon: 120.0, time: BASE_MS },
    { lat: 30.001, lon: 120.001, time: BASE_MS + 20_000 },
    { lat: 30.002, lon: 120.003, time: BASE_MS + 60_000 },
  ];

  const uniform = setup({ values: { mp4Duration: '10' }, trackPoints: points });
  try {
    assert.doesNotThrow(() => render());
    startPreviewPlay();
    assert.doesNotThrow(() => {
      uniform.step(0);
      uniform.step(1000);
      uniform.step(2000);
    });
  } finally {
    teardown(uniform);
  }

  const trueMode = setupTimeTrue({
    startMs: BASE_MS,
    endMs: BASE_MS + 60_000,
    scale: 1,
    duration: 6,
    trackPoints: points,
  });
  try {
    trueMode.el('previewScrubLabel'); // 预先建好标签元素
    assert.doesNotThrow(() => render());
    startPreviewPlay();
    assert.doesNotThrow(() => {
      trueMode.step(0);
      trueMode.step(1000);
      trueMode.step(2000);
    });
    assert.equal(trueMode.scrub(), Math.round(state.previewProgress * 1000));
  } finally {
    teardown(trueMode);
  }
});
