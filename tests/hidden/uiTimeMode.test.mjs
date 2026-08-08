// uiTimeMode · 时间真实模式的界面状态与联动（hidden 全面用例）
//
// 全部函数读 DOM，Node 里注入假 document。`$` 是 `id => document.getElementById(id)`，
// 箭头函数体内才求值，所以模块 import 在 Node 里安全，逐个用例设定替身即可。
//
// 时区：`datetime-local` 按本地时区解析与格式化，断言一律写成往返一致或相对关系，
// 不写死任何带时区含义的字符串。

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
import { buildTimeIndex, trackTimeRange } from '../../src/core/track-time.mjs';
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
 * 每个用例自己 setup + finally restore，测试之间无共享可变状态、不依赖执行顺序。
 */
function setup({
  els: overrides = {},
  trackFiles = [],
  trackPoints = [],
  timeMode: tm = {},
  windowStub = {},
} = {}) {
  const els = {};
  for (const id of ELEMENT_IDS) {
    els[id] = makeEl({ ...(DEFAULTS[id] || {}), ...(overrides[id] || {}) });
  }

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

  const prevTimeMode = { ...timeMode };
  timeMode.index = null;
  timeMode.range = null;
  timeMode.available = false;
  Object.assign(timeMode, tm);

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

/** 毫秒时间戳 → `YYYY-MM-DDTHH:mm`（本地时区分量，分钟精度）。 */
const fmtLocalMinute = (ms) => fmtLocal(ms).slice(0, 16);

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

/** n 个不带任何时间戳的点。 */
const plainTrack = (n) => Array.from({ length: n }, (_, i) => P(i));

const asFile = (name, points) => ({ name, format: 'gpx', points });

const sizeHintText = (durationSec, resValue, quality) =>
  `预计文件大小 ≈ ${formatByteSize(estimateMp4Bytes(durationSec, mp4Bitrate(+resValue, quality)))}`;

const OVERFLOW_NOTE = '当前浏览器一次最多导出 600 秒';

/** 从提示文案里抽出所有 `h:mm:ss` / `mm:ss` 形态的时长，换算成秒。 */
const clockSeconds = (text) => (String(text).match(/\d+(?::\d{2})+/g) || [])
  .map((tok) => tok.split(':').reduce((acc, part) => acc * 60 + Number(part), 0));

/* =============================================== refreshTimeMode: 可用态 */

test('uiTimeMode · refreshTimeMode(时间轴刷新): 带时间戳的轨迹填好 range/index 并放开 radio', () => {
  const points = timedTrack(11, 45_000);          // 跨度 450 秒
  const range = trackTimeRange(points);
  const env = setup({ trackFiles: [asFile('ride.gpx', points)], trackPoints: points });

  try {
    refreshTimeMode();

    assert.deepEqual(timeMode.range, range);
    assert.notEqual(timeMode.index, null);
    assert.equal(timeMode.index.startMs, range.startMs);
    assert.equal(timeMode.index.endMs, range.endMs);
    assert.equal(timeMode.available, true);

    assert.equal(env.els.mp4TimeModeTrue.disabled, false);
    assert.equal(env.els.mp4TimeModeHint.textContent, '');
    assert.equal(env.els.mp4TimeModeHint.style.display, 'none');
  } finally {
    env.restore();
  }
});

test('uiTimeMode · refreshTimeMode(时间轴刷新): 起止时刻的 value 与 min/max 按本地时区往返一致', () => {
  const points = timedTrack(7, 120_000);          // 跨度 720 秒
  const range = trackTimeRange(points);
  const env = setup({ trackFiles: [asFile('ride.gpx', points)], trackPoints: points });

  try {
    refreshTimeMode();

    assert.equal(parseLocal(env.els.mp4TimeStart.value), range.startMs);
    assert.equal(parseLocal(env.els.mp4TimeEnd.value), range.endMs);
    assert.equal(parseLocal(env.els.mp4TimeStart.min), range.startMs);
    assert.equal(parseLocal(env.els.mp4TimeStart.max), range.endMs);
    assert.equal(parseLocal(env.els.mp4TimeEnd.min), range.startMs);
    assert.equal(parseLocal(env.els.mp4TimeEnd.max), range.endMs);

    // 相对关系同样成立：起止之差就是轨迹跨度。
    assert.equal(
      parseLocal(env.els.mp4TimeEnd.value) - parseLocal(env.els.mp4TimeStart.value),
      720_000,
    );
  } finally {
    env.restore();
  }
});

test('uiTimeMode · refreshTimeMode(时间轴刷新): 始终改写 timeMode 的属性而不重新赋值绑定', () => {
  const points = timedTrack(5, 60_000);
  const env = setup({ trackFiles: [asFile('ride.gpx', points)], trackPoints: points });
  const before = timeMode;

  try {
    refreshTimeMode();
    assert.equal(timeMode, before, 'timeMode 必须是同一个对象，供 preview / mp4 共读');
  } finally {
    env.restore();
  }
});

/* ============================================= refreshTimeMode: 不可用态 */

for (const [label, trackPoints] of [['null', null], ['空数组', []]]) {
  test(`uiTimeMode · refreshTimeMode(不可用原因): trackPoints 为${label} → 先载入轨迹`, () => {
    const env = setup({ trackFiles: [], trackPoints });

    try {
      refreshTimeMode();                       // 空轨迹不抛错，走「不可用」分支

      assert.equal(timeMode.range, null);
      assert.equal(timeMode.index, null);
      assert.equal(timeMode.available, false);

      assert.equal(env.els.mp4TimeModeTrue.disabled, true);
      assert.equal(env.els.mp4TimeModeHint.textContent, '先载入轨迹');
      assert.equal(env.els.mp4TimeModeHint.style.display, '');
    } finally {
      env.restore();
    }
  });
}

test('uiTimeMode · refreshTimeMode(不可用原因): 轨迹一个时间戳都没有 → 不带时间戳文案', () => {
  const points = plainTrack(8);
  const env = setup({ trackFiles: [asFile('route.gpx', points)], trackPoints: points });

  try {
    refreshTimeMode();

    assert.equal(timeMode.range, null, '没有任何锚点时 trackTimeRange 返回 null');
    assert.equal(timeMode.available, false);

    assert.equal(env.els.mp4TimeModeTrue.disabled, true);
    assert.equal(
      env.els.mp4TimeModeHint.textContent,
      '这条轨迹的点不带时间戳，只能按距离匀速导出',
    );
    assert.equal(env.els.mp4TimeModeHint.style.display, '');
  } finally {
    env.restore();
  }
});

test('uiTimeMode · refreshTimeMode(不可用原因): 只有一个点带时间戳 → 锚点不足文案', () => {
  const points = [P(0, T0), P(1), P(2), P(3)];
  const env = setup({ trackFiles: [asFile('mixed.gpx', points)], trackPoints: points });

  try {
    refreshTimeMode();

    assert.notEqual(timeMode.range, null, '有一个锚点时 range 非 null');
    assert.equal(timeMode.index, null, '锚点不足两个时建不出时间轴');
    assert.equal(timeMode.available, false);

    assert.equal(env.els.mp4TimeModeTrue.disabled, true);
    assert.equal(
      env.els.mp4TimeModeHint.textContent,
      '这条轨迹带时间戳的点不足两个，只能按距离匀速导出',
    );
    assert.equal(env.els.mp4TimeModeHint.style.display, '');
  } finally {
    env.restore();
  }
});

test('uiTimeMode · refreshTimeMode(自动回落): 换成不带时间戳的轨迹后 radio 切回匀速', () => {
  const points = plainTrack(6);
  const env = setup({
    trackFiles: [asFile('route.gpx', points)],
    trackPoints: points,
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
    },
  });

  try {
    refreshTimeMode();

    assert.equal(env.els.mp4TimeModeTrue.checked, false, '时间真实 radio 被取消选中');
    assert.equal(env.els.mp4TimeModeEven.checked, true, '选择回落到按距离匀速');
    assert.equal(env.els.mp4TimeModeTrue.disabled, true);
    assert.equal(isTimeTrueMode(), false);
  } finally {
    env.restore();
  }
});

test('uiTimeMode · refreshTimeMode(自动回落): 轨迹仍可用时保留用户已选的时间真实模式', () => {
  const points = timedTrack(9, 30_000);
  const env = setup({
    trackFiles: [asFile('ride.gpx', points)],
    trackPoints: points,
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
    },
  });

  try {
    refreshTimeMode();

    assert.equal(timeMode.available, true);
    assert.equal(env.els.mp4TimeModeTrue.checked, true, '可用时不动用户的选择');
    assert.equal(env.els.mp4TimeModeEven.checked, false);
  } finally {
    env.restore();
  }
});

/* ==================================== refreshTimeMode: 分段与折叠开关 */

test('uiTimeMode · refreshTimeMode(分段起点): segmentStarts 由各文件点数累计，折叠开关产生可观测差异', () => {
  const segA = [P(0, T0), P(1, T0 + 60_000), P(2, T0 + 120_000)];
  const segB = [P(3, T0 + 7_200_000), P(4, T0 + 7_260_000), P(5, T0 + 7_320_000)];
  const points = [...segA, ...segB];
  const files = [asFile('a.gpx', segA), asFile('b.gpx', segB)];

  const expectedCollapsed = buildTimeIndex(points, {
    segmentStarts: [0, 3], collapseSegmentGaps: true,
  });
  const expectedRaw = buildTimeIndex(points, {
    segmentStarts: [0, 3], collapseSegmentGaps: false,
  });
  assert.notEqual(
    expectedCollapsed.endMs, expectedRaw.endMs,
    '夹具前提：折叠与不折叠必须给出不同的 endMs',
  );

  const openEnv = setup({
    trackFiles: files, trackPoints: points,
    els: { mp4CollapseGaps: { checked: true } },
  });
  try {
    refreshTimeMode();
    assert.equal(timeMode.index.endMs, expectedCollapsed.endMs, '折叠开启：段间 2 小时空隙被压掉');
    assert.ok(
      timeMode.index.endMs - timeMode.index.startMs < 300_000,
      '折叠后的时间轴跨度应收缩到两段自身的长度量级',
    );
    assert.equal(timeMode.range.endMs, T0 + 7_320_000, 'range 仍是原始时间范围，不受折叠影响');
  } finally {
    openEnv.restore();
  }

  const closedEnv = setup({
    trackFiles: files, trackPoints: points,
    els: { mp4CollapseGaps: { checked: false } },
  });
  try {
    refreshTimeMode();
    assert.equal(timeMode.index.endMs, expectedRaw.endMs);
    assert.equal(timeMode.index.endMs - timeMode.index.startMs, 7_320_000);
  } finally {
    closedEnv.restore();
  }
});

for (const [label, fileCount, expected] of [
  ['无文件', 0, 'none'],
  ['单文件', 1, 'none'],
  ['两个文件', 2, ''],
  ['三个文件', 3, ''],
]) {
  test(`uiTimeMode · refreshTimeMode(折叠开关显隐): ${label} → display "${expected}"`, () => {
    const files = Array.from({ length: fileCount }, (_, k) =>
      asFile(`seg${k}.gpx`, timedTrack(3, 30_000, T0 + k * 600_000)));
    const points = files.flatMap((f) => f.points);
    const env = setup({ trackFiles: files, trackPoints: points });

    try {
      refreshTimeMode();
      assert.equal(env.els.mp4CollapseGapsField.style.display, expected);
    } finally {
      env.restore();
    }
  });
}

/* ================================================== isTimeTrueMode */

for (const [checked, available, expected] of [
  [true, true, true],
  [true, false, false],
  [false, true, false],
  [false, false, false],
]) {
  test(`uiTimeMode · isTimeTrueMode(双条件): checked=${checked} available=${available} → ${expected}`, () => {
    const env = setup({
      els: {
        mp4TimeModeEven: { checked: !checked },
        mp4TimeModeTrue: { checked },
      },
      timeMode: {
        available,
        range: available ? { startMs: T0, endMs: T0 + 60_000, spanSec: 60, anchorCount: 2, totalCount: 2 } : null,
        index: available ? {} : null,
      },
    });

    try {
      assert.equal(isTimeTrueMode(), expected);
    } finally {
      env.restore();
    }
  });
}

/* ================================================ updateTimeModeUI: 显隐 */

test('uiTimeMode · updateTimeModeUI(面板显隐): 时间真实模式显 true 面板、隐 even 面板', () => {
  const range = { startMs: T0, endMs: T0 + 300_000, spanSec: 300, anchorCount: 2, totalCount: 2 };
  const env = setup({
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4EvenFields: { style: { display: '' } },
      mp4TrueFields: { style: { display: 'none' } },
    },
  });

  try {
    updateTimeModeUI();
    assert.equal(env.els.mp4TrueFields.style.display, '');
    assert.equal(env.els.mp4EvenFields.style.display, 'none');
  } finally {
    env.restore();
  }
});

test('uiTimeMode · updateTimeModeUI(面板显隐): 匀速模式显 even 面板、隐 true 面板', () => {
  const env = setup({
    els: {
      mp4TimeModeEven: { checked: true },
      mp4TimeModeTrue: { checked: false },
      mp4EvenFields: { style: { display: 'none' } },
      mp4TrueFields: { style: { display: '' } },
    },
  });

  try {
    updateTimeModeUI();
    assert.equal(env.els.mp4EvenFields.style.display, '');
    assert.equal(env.els.mp4TrueFields.style.display, 'none');
  } finally {
    env.restore();
  }
});

test('uiTimeMode · updateTimeModeUI(通道分离): 只改 style.display，不碰任何元素的 disabled', () => {
  const range = { startMs: T0, endMs: T0 + 300_000, spanSec: 300, anchorCount: 2, totalCount: 2 };
  const env = setup({
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true, disabled: false },
      mp4Duration: { value: '30', disabled: true },
      mp4TrueFps: { value: '30', disabled: true },
      mp4Quality: { value: 'high', disabled: false },
      exportRes: { value: '1080', disabled: true },
      mp4TimeScale: { value: '1', disabled: false },
      mp4CollapseGaps: { disabled: true },
    },
  });

  try {
    const before = Object.fromEntries(ELEMENT_IDS.map((id) => [id, env.els[id].disabled]));
    updateTimeModeUI();
    const after = Object.fromEntries(ELEMENT_IDS.map((id) => [id, env.els[id].disabled]));
    assert.deepEqual(after, before, '可用性与显隐是两条互不相交的通道');
  } finally {
    env.restore();
  }
});

/* ========================================== updateTimeModeUI: 时长提示 */

for (const [label, spanMs, scale, videoSec, realSec] of [
  ['缩放 1 时两者相等', 450_000, '1', 450, 450],
  ['缩放 2 时视频时长减半', 900_000, '2', 450, 900],
  ['缩放 0.5 时视频时长翻倍', 120_000, '0.5', 240, 120],
]) {
  test(`uiTimeMode · updateTimeModeUI(时长提示): ${label}`, () => {
    const range = { startMs: T0, endMs: T0 + spanMs, spanSec: spanMs / 1000, anchorCount: 2, totalCount: 2 };
    const env = setup({
      timeMode: { available: true, range, index: {} },
      els: {
        mp4TimeModeEven: { checked: false },
        mp4TimeModeTrue: { checked: true },
        mp4TimeStart: { value: fmtLocal(range.startMs) },
        mp4TimeEnd: { value: fmtLocal(range.endMs) },
        mp4TimeScale: { value: scale },
      },
    });

    try {
      updateTimeModeUI();

      const text = env.els.mp4TrueDurationHint.textContent;
      assert.match(text, /视频时长/);
      assert.match(text, /真实时间/);

      const seconds = clockSeconds(text);
      assert.ok(seconds.length >= 2, `提示里应出现视频时长与真实时间两个时刻，实得：${text}`);
      assert.equal(seconds[0], videoSec, '第一个时刻是视频时长');
      assert.equal(seconds[1], realSec, '第二个时刻是它对应的真实时间跨度');
      assert.equal(seconds[0] === seconds[1], videoSec === realSec);
    } finally {
      env.restore();
    }
  });
}

test('uiTimeMode · updateTimeModeUI(时长提示): 导出窗口为 null 时写占位说明而非崩溃', () => {
  const range = { startMs: T0, endMs: T0 + 300_000, spanSec: 300, anchorCount: 2, totalCount: 2 };
  const env = setup({
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      // 起点晚于终点 → currentExportWindow() 返回 null
      mp4TimeStart: { value: fmtLocal(range.endMs) },
      mp4TimeEnd: { value: fmtLocal(range.startMs) },
    },
  });

  try {
    assert.equal(currentExportWindow(), null, '夹具前提：这组取值确实推不出窗口');
    updateTimeModeUI();                        // 窗口为 null 时也不该崩

    const text = env.els.mp4TrueDurationHint.textContent;
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, '占位说明应当可读，不能留空');
    assert.doesNotMatch(text, /NaN|undefined|Infinity/, '占位说明不能漏出计算残渣');
  } finally {
    env.restore();
  }
});

/* ========================================== updateTimeModeUI: 体积估算 */

for (const [res, quality, durationInput] of [
  ['1080', 'high', '30'],
  ['1080', 'medium', '60'],
  ['1440', 'low', '12'],
  ['720', 'high', '45'],
]) {
  test(`uiTimeMode · updateTimeModeUI(体积估算): 匀速模式 ${res}/${quality}/${durationInput}s`, () => {
    const env = setup({
      els: {
        mp4TimeModeEven: { checked: true },
        mp4TimeModeTrue: { checked: false },
        mp4Duration: { value: durationInput },
        exportRes: { value: res },
        mp4Quality: { value: quality },
      },
    });

    try {
      updateTimeModeUI();
      assert.equal(
        env.els.mp4SizeHint.textContent,
        sizeHintText(clampMp4Duration(+durationInput), res, quality),
      );
    } finally {
      env.restore();
    }
  });
}

test('uiTimeMode · updateTimeModeUI(体积估算): exportRes 的字符串值必须先转数值才查得到 720 档码率', () => {
  const env = setup({
    els: {
      mp4TimeModeEven: { checked: true },
      mp4TimeModeTrue: { checked: false },
      mp4Duration: { value: '60' },
      exportRes: { value: '720' },          // DOM 的真实形态就是字符串
      mp4Quality: { value: 'high' },
    },
  });

  try {
    updateTimeModeUI();

    const expected720 = sizeHintText(60, 720, 'high');
    const wrong1080 = sizeHintText(60, 1080, 'high');
    assert.notEqual(expected720, wrong1080, '夹具前提：720 与 1080 两档体积不同');
    assert.equal(env.els.mp4SizeHint.textContent, expected720);
  } finally {
    env.restore();
  }
});

test('uiTimeMode · updateTimeModeUI(体积估算): 匀速模式的时长经 clampMp4Duration 夹取', () => {
  const env = setup({
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
    assert.equal(env.els.mp4SizeHint.textContent, sizeHintText(clampMp4Duration(99999), 1080, 'high'));
  } finally {
    env.restore();
  }
});

test('uiTimeMode · updateTimeModeUI(体积估算): 时间真实模式按缩放后的视频时长算', () => {
  const range = { startMs: T0, endMs: T0 + 900_000, spanSec: 900, anchorCount: 2, totalCount: 2 };
  const env = setup({
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(range.startMs) },
      mp4TimeEnd: { value: fmtLocal(range.endMs) },
      mp4TimeScale: { value: '3' },           // 900 / 3 = 300 秒
      exportRes: { value: '1440' },
      mp4Quality: { value: 'medium' },
      mp4Duration: { value: '12' },           // 匀速时长在这条路径上不参与计算
    },
  });

  try {
    updateTimeModeUI();
    assert.equal(env.els.mp4SizeHint.textContent, sizeHintText(300, 1440, 'medium'));
  } finally {
    env.restore();
  }
});

/* ========================================== updateTimeModeUI: 超限提示 */

test('uiTimeMode · updateTimeModeUI(超限提示): 视频时长超 600 秒且流式不可用时追加说明', () => {
  const range = { startMs: T0, endMs: T0 + 1_200_000, spanSec: 1200, anchorCount: 2, totalCount: 2 };
  const env = setup({
    windowStub: {},                            // 不带 showSaveFilePicker → 流式写盘不可用
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(range.startMs) },
      mp4TimeEnd: { value: fmtLocal(range.endMs) },
      mp4TimeScale: { value: '1' },            // 视频时长 1200 秒 > 600
      exportRes: { value: '1080' },
      mp4Quality: { value: 'high' },
    },
  });

  try {
    updateTimeModeUI();
    const text = env.els.mp4SizeHint.textContent;
    assert.ok(text.startsWith(sizeHintText(1200, 1080, 'high')), `体积文案在前，实得：${text}`);
    assert.match(text, new RegExp(OVERFLOW_NOTE));
    assert.match(text, /请缩小时间范围或调大时间缩放/);
  } finally {
    env.restore();
  }
});

test('uiTimeMode · updateTimeModeUI(超限提示): 视频时长在 600 秒以内时不追加说明', () => {
  const range = { startMs: T0, endMs: T0 + 1_200_000, spanSec: 1200, anchorCount: 2, totalCount: 2 };
  const env = setup({
    windowStub: {},
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(range.startMs) },
      mp4TimeEnd: { value: fmtLocal(range.endMs) },
      mp4TimeScale: { value: '4' },            // 1200 / 4 = 300 秒
      exportRes: { value: '1080' },
      mp4Quality: { value: 'high' },
    },
  });

  try {
    updateTimeModeUI();
    const text = env.els.mp4SizeHint.textContent;
    assert.equal(text, sizeHintText(300, 1080, 'high'));
    assert.doesNotMatch(text, new RegExp(OVERFLOW_NOTE));
  } finally {
    env.restore();
  }
});

/* ============================================== currentExportWindow */

test('uiTimeMode · currentExportWindow(前置条件): 非时间真实模式返回 null', () => {
  const range = { startMs: T0, endMs: T0 + 300_000, spanSec: 300, anchorCount: 2, totalCount: 2 };
  const env = setup({
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: true },
      mp4TimeModeTrue: { checked: false },
      mp4TimeStart: { value: fmtLocal(range.startMs) },
      mp4TimeEnd: { value: fmtLocal(range.endMs) },
    },
  });

  try {
    assert.equal(currentExportWindow(), null);
  } finally {
    env.restore();
  }
});

test('uiTimeMode · currentExportWindow(前置条件): radio 停在 true 但轨迹不可用时返回 null', () => {
  const env = setup({
    timeMode: { available: false, range: null, index: null },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
    },
  });

  try {
    assert.equal(isTimeTrueMode(), false);
    assert.equal(currentExportWindow(), null);
  } finally {
    env.restore();
  }
});

test('uiTimeMode · currentExportWindow(往返一致): 自定义子区间按本地时区解析回原始毫秒', () => {
  const range = { startMs: T0, endMs: T0 + 450_000, spanSec: 450, anchorCount: 2, totalCount: 2 };
  const wantStart = T0 + 60_000;
  const wantEnd = T0 + 300_000;
  const env = setup({
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(wantStart) },
      mp4TimeEnd: { value: fmtLocalMinute(wantEnd) },   // 分钟精度的取值同样要认
    },
  });

  try {
    const win = currentExportWindow();
    assert.notEqual(win, null);
    assert.equal(win.startMs, wantStart);
    assert.equal(win.endMs, wantEnd);
    assert.equal(win.endMs - win.startMs, 240_000);
  } finally {
    env.restore();
  }
});

for (const [label, startValue, endValue] of [
  ['两端都为空', '', ''],
  ['起点为空', '', null],
  ['终点解析不出有效时刻', null, 'not-a-time'],
]) {
  test(`uiTimeMode · currentExportWindow(空值回落): ${label} → 取轨迹时间范围的对应端`, () => {
    const range = { startMs: T0, endMs: T0 + 600_000, spanSec: 600, anchorCount: 2, totalCount: 2 };
    const env = setup({
      timeMode: { available: true, range, index: {} },
      els: {
        mp4TimeModeEven: { checked: false },
        mp4TimeModeTrue: { checked: true },
        mp4TimeStart: { value: startValue === null ? fmtLocal(range.startMs) : startValue },
        mp4TimeEnd: { value: endValue === null ? fmtLocal(range.endMs) : endValue },
      },
    });

    try {
      const win = currentExportWindow();
      assert.notEqual(win, null);
      assert.equal(win.startMs, range.startMs);
      assert.equal(win.endMs, range.endMs);
    } finally {
      env.restore();
    }
  });
}

test('uiTimeMode · currentExportWindow(clamp): 越界的起止被夹回轨迹时间范围内', () => {
  const range = { startMs: T0, endMs: T0 + 600_000, spanSec: 600, anchorCount: 2, totalCount: 2 };
  const env = setup({
    timeMode: { available: true, range, index: {} },
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeStart: { value: fmtLocal(range.startMs - 3_600_000) },
      mp4TimeEnd: { value: fmtLocal(range.endMs + 3_600_000) },
    },
  });

  try {
    const win = currentExportWindow();
    assert.notEqual(win, null);
    assert.equal(win.startMs, range.startMs);
    assert.equal(win.endMs, range.endMs);
  } finally {
    env.restore();
  }
});

for (const [label, startMs, endMs] of [
  ['起点等于终点', T0 + 120_000, T0 + 120_000],
  ['起点晚于终点', T0 + 300_000, T0 + 60_000],
]) {
  test(`uiTimeMode · currentExportWindow(空窗口): ${label} → 返回 null`, () => {
    const range = { startMs: T0, endMs: T0 + 600_000, spanSec: 600, anchorCount: 2, totalCount: 2 };
    const env = setup({
      timeMode: { available: true, range, index: {} },
      els: {
        mp4TimeModeEven: { checked: false },
        mp4TimeModeTrue: { checked: true },
        mp4TimeStart: { value: fmtLocal(startMs) },
        mp4TimeEnd: { value: fmtLocal(endMs) },
      },
    });

    try {
      assert.equal(currentExportWindow(), null);
    } finally {
      env.restore();
    }
  });
}

for (const [scaleValue, expected] of [
  ['', 1], ['0', 1], ['abc', 1], ['-2', 1], ['Infinity', 1],
  ['1', 1], ['2.5', 2.5], ['0.5', 0.5], ['100', 100],
]) {
  test(`uiTimeMode · currentExportWindow(scale 回落): mp4TimeScale="${scaleValue}" → ${expected}`, () => {
    const range = { startMs: T0, endMs: T0 + 600_000, spanSec: 600, anchorCount: 2, totalCount: 2 };
    const env = setup({
      timeMode: { available: true, range, index: {} },
      els: {
        mp4TimeModeEven: { checked: false },
        mp4TimeModeTrue: { checked: true },
        mp4TimeScale: { value: scaleValue },
      },
    });

    try {
      const win = currentExportWindow();
      assert.notEqual(win, null);
      assert.equal(win.scale, expected);
    } finally {
      env.restore();
    }
  });
}

for (const [fpsValue, expected] of [
  ['', 30], ['0', 30], ['abc', 30], ['-60', 30],
  ['24', 24], ['30', 30], ['60', 60],
]) {
  test(`uiTimeMode · currentExportWindow(fps 回落): mp4TrueFps="${fpsValue}" → ${expected}`, () => {
    const range = { startMs: T0, endMs: T0 + 600_000, spanSec: 600, anchorCount: 2, totalCount: 2 };
    const env = setup({
      timeMode: { available: true, range, index: {} },
      els: {
        mp4TimeModeEven: { checked: false },
        mp4TimeModeTrue: { checked: true },
        mp4TrueFps: { value: fpsValue },
      },
    });

    try {
      const win = currentExportWindow();
      assert.notEqual(win, null);
      assert.equal(win.fps, expected);
    } finally {
      env.restore();
    }
  });
}

for (const checked of [true, false]) {
  test(`uiTimeMode · currentExportWindow(折叠透传): mp4CollapseGaps.checked=${checked}`, () => {
    const range = { startMs: T0, endMs: T0 + 600_000, spanSec: 600, anchorCount: 2, totalCount: 2 };
    const env = setup({
      timeMode: { available: true, range, index: {} },
      els: {
        mp4TimeModeEven: { checked: false },
        mp4TimeModeTrue: { checked: true },
        mp4CollapseGaps: { checked },
      },
    });

    try {
      const win = currentExportWindow();
      assert.notEqual(win, null);
      assert.equal(win.collapseSegmentGaps, checked);
    } finally {
      env.restore();
    }
  });
}

test('uiTimeMode · currentExportWindow(端到端): refreshTimeMode 填好的起止时刻直接读回轨迹范围端点', () => {
  const points = timedTrack(13, 60_000);          // 跨度 720 秒
  const range = trackTimeRange(points);
  const env = setup({
    trackFiles: [asFile('ride.gpx', points)],
    trackPoints: points,
    els: {
      mp4TimeModeEven: { checked: false },
      mp4TimeModeTrue: { checked: true },
      mp4TimeScale: { value: '1.5' },
      mp4TrueFps: { value: '24' },
      mp4CollapseGaps: { checked: false },
    },
  });

  try {
    refreshTimeMode();
    const win = currentExportWindow();

    assert.notEqual(win, null);
    assert.equal(win.startMs, range.startMs);
    assert.equal(win.endMs, range.endMs);
    assert.equal(win.scale, 1.5);
    assert.equal(win.fps, 24);
    assert.equal(win.collapseSegmentGaps, false);
  } finally {
    env.restore();
  }
});
