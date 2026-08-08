// 单元 exportMeta 的全量测试：文件名编码与 sidecar 元数据的跨 repo 契约。
// 跑法：node --test tests/hidden/exportMeta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTimeTrueFilename, buildSidecarMeta } from '../../src/core/export-meta.mjs';

// 契约固定的 sidecar 字段名全集（跨 repo 约定，逐字符）。
const SIDECAR_KEYS = [
  'schema',
  't0Epoch',
  't0Iso',
  'scale',
  'fps',
  'durationSec',
  'frames',
  'resolution',
  'quality',
  'bitrate',
  'trackStartIso',
  'trackEndIso',
  'sourceFiles',
  'collapsedSegmentGaps',
];

// 测试名里用的可读标签，保证每个用例名唯一。
function label(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return `string("${value}")`;
  if (Number.isNaN(value)) return 'NaN';
  return String(value);
}

// 一份字段齐全的入参，测试内按需覆写单个字段。
function fullMetaInput(overrides = {}) {
  return {
    t0Ms: 1782374599000,
    scale: 1,
    fps: 30,
    durationSec: 12,
    frames: 360,
    resolution: 1080,
    quality: 'high',
    bitrate: 8000000,
    trackStartMs: 1782374000000,
    trackEndMs: 1782378000000,
    sourceFiles: ['ride-a.gpx', 'ride-b.gpx'],
    collapsedSegmentGaps: true,
    ...overrides,
  };
}

// ─────────────────────────── buildTimeTrueFilename ───────────────────────────

test('exportMeta · buildTimeTrueFilename(文件名编码): 整数 scale 不带小数点', () => {
  // 1 / 10 / 60 都应写成纯整数，不出现 "1.0" 这类形式。
  assert.equal(buildTimeTrueFilename(1782374599000, 1, 'mp4'), '轨迹动画_t1782374599_s1.mp4');
  assert.equal(buildTimeTrueFilename(1782374599000, 10, 'mp4'), '轨迹动画_t1782374599_s10.mp4');
  assert.equal(buildTimeTrueFilename(1782374599000, 60, 'mp4'), '轨迹动画_t1782374599_s60.mp4');
});

test('exportMeta · buildTimeTrueFilename(文件名编码): 非整数 scale 去掉尾随零', () => {
  // 2.50 在源码里即 2.5；期望最短十进制表示，不出现 "2.50" / "0.50"。
  assert.equal(buildTimeTrueFilename(1782374599000, 2.5, 'mp4'), '轨迹动画_t1782374599_s2.5.mp4');
  assert.equal(buildTimeTrueFilename(1782374599000, 2.50, 'mp4'), '轨迹动画_t1782374599_s2.5.mp4');
  assert.equal(buildTimeTrueFilename(1782374599000, 1.5, 'mp4'), '轨迹动画_t1782374599_s1.5.mp4');
});

test('exportMeta · buildTimeTrueFilename(文件名编码): 小于 1 的 scale 保留前导零', () => {
  assert.equal(buildTimeTrueFilename(1782374599000, 0.5, 'mp4'), '轨迹动画_t1782374599_s0.5.mp4');
  assert.equal(buildTimeTrueFilename(1782374599000, 0.25, 'mp4'), '轨迹动画_t1782374599_s0.25.mp4');
  assert.equal(buildTimeTrueFilename(1782374599000, 0.1, 'mp4'), '轨迹动画_t1782374599_s0.1.mp4');
});

test('exportMeta · buildTimeTrueFilename(文件名编码): epochSec 向下取整而非四舍五入', () => {
  // 带毫秒余数时秒数被截断：.999 也不进位。
  assert.equal(buildTimeTrueFilename(1782374599999, 1, 'mp4'), '轨迹动画_t1782374599_s1.mp4');
  assert.equal(buildTimeTrueFilename(1782374599750, 1, 'mp4'), '轨迹动画_t1782374599_s1.mp4');
  assert.equal(buildTimeTrueFilename(1782374599001, 1, 'mp4'), '轨迹动画_t1782374599_s1.mp4');
  assert.equal(buildTimeTrueFilename(1782374600000, 1, 'mp4'), '轨迹动画_t1782374600_s1.mp4');
});

test('exportMeta · buildTimeTrueFilename(文件名编码): t0Ms 为 0 得 epoch 0', () => {
  assert.equal(buildTimeTrueFilename(0, 1, 'mp4'), '轨迹动画_t0_s1.mp4');
});

test('exportMeta · buildTimeTrueFilename(文件名编码): 负 t0Ms 按 Math.floor 向负无穷取整', () => {
  // Math.floor(-1500 / 1000) === -2（非 -1）。
  assert.equal(buildTimeTrueFilename(-1500, 1, 'mp4'), '轨迹动画_t-2_s1.mp4');
  assert.equal(buildTimeTrueFilename(-1000, 1, 'mp4'), '轨迹动画_t-1_s1.mp4');
});

test('exportMeta · buildTimeTrueFilename(文件名编码): ext 原样接在单个点之后', () => {
  // ext 不带前导点，函数负责补且只补一个点；大小写原样保留。
  assert.equal(buildTimeTrueFilename(1700000000123, 1, 'json'), '轨迹动画_t1700000000_s1.json');
  assert.equal(buildTimeTrueFilename(1700000000123, 1, 'MP4'), '轨迹动画_t1700000000_s1.MP4');
  assert.equal(buildTimeTrueFilename(1700000000123, 1, 'webm'), '轨迹动画_t1700000000_s1.webm');
});

for (const bad of [Number.NaN, Infinity, -Infinity, undefined, null, 'abc', {}]) {
  test(`exportMeta · buildTimeTrueFilename(文件名编码): t0Ms 非有限数 ${label(bad)} 抛 RangeError`, () => {
    assert.throws(
      () => buildTimeTrueFilename(bad, 1, 'mp4'),
      {
        name: 'RangeError',
        message: 'buildTimeTrueFilename: t0Ms must be a finite number',
      },
    );
  });
}

for (const bad of [0, -1, -0.5, Number.NaN, Infinity, -Infinity, undefined, null, 'abc']) {
  test(`exportMeta · buildTimeTrueFilename(文件名编码): scale 非正有限数 ${label(bad)} 抛 RangeError`, () => {
    assert.throws(
      () => buildTimeTrueFilename(1782374599000, bad, 'mp4'),
      {
        name: 'RangeError',
        message: 'buildTimeTrueFilename: scale must be a positive finite number',
      },
    );
  });
}

for (const bad of ['', 123, null, undefined, ['mp4'], {}, true]) {
  test(`exportMeta · buildTimeTrueFilename(文件名编码): ext 非空字符串以外的 ${label(bad)} 抛 TypeError`, () => {
    assert.throws(
      () => buildTimeTrueFilename(1782374599000, 1, bad),
      {
        name: 'TypeError',
        message: 'buildTimeTrueFilename: ext must be a non-empty string',
      },
    );
  });
}

// ───────────────────────────── buildSidecarMeta ──────────────────────────────

test('exportMeta · buildSidecarMeta(导出元数据): 字段名集合精确等于契约全集', () => {
  // 既不缺字段也不多出字段——下游 Python 工具照这个集合读。
  const out = buildSidecarMeta(fullMetaInput());
  assert.deepEqual(Object.keys(out).slice().sort(), SIDECAR_KEYS.slice().sort());
});

test('exportMeta · buildSidecarMeta(导出元数据): schema 字面量逐字符固定', () => {
  const out = buildSidecarMeta(fullMetaInput());
  assert.equal(out.schema, 'trace-video-overlay/time-true-export@1');
});

test('exportMeta · buildSidecarMeta(导出元数据): 入参多余字段不进产物', () => {
  const out = buildSidecarMeta(fullMetaInput({ amapKey: 'secret', extra: 42 }));
  assert.deepEqual(Object.keys(out).slice().sort(), SIDECAR_KEYS.slice().sort());
  assert.equal('amapKey' in out, false);
  assert.equal('extra' in out, false);
});

test('exportMeta · buildSidecarMeta(导出元数据): 数值与描述字段原样透传', () => {
  const out = buildSidecarMeta(fullMetaInput({
    scale: 2.5,
    fps: 60,
    durationSec: 7.5,
    frames: 450,
    resolution: 2160,
    quality: 'low',
    bitrate: 1234567,
  }));
  assert.equal(out.scale, 2.5);
  assert.equal(out.fps, 60);
  assert.equal(out.durationSec, 7.5);
  assert.equal(out.frames, 450);
  assert.equal(out.resolution, 2160);
  assert.equal(out.quality, 'low');
  assert.equal(out.bitrate, 1234567);
});

test('exportMeta · buildSidecarMeta(导出元数据): t0Epoch 与 t0Iso 指向同一时刻', () => {
  // 带毫秒余数：t0Iso 保留毫秒，t0Epoch 向下取整到秒。
  const out = buildSidecarMeta(fullMetaInput({ t0Ms: 1782374599750 }));
  assert.equal(out.t0Epoch, 1782374599);
  assert.equal(out.t0Iso, '2026-06-25T08:03:19.750Z');
  assert.equal(Math.floor(Date.parse(out.t0Iso) / 1000), out.t0Epoch);
});

test('exportMeta · buildSidecarMeta(导出元数据): t0Ms 为 0 得 epoch 0 与 1970 ISO', () => {
  const out = buildSidecarMeta(fullMetaInput({ t0Ms: 0 }));
  assert.equal(out.t0Epoch, 0);
  assert.equal(out.t0Iso, '1970-01-01T00:00:00.000Z');
});

test('exportMeta · buildSidecarMeta(导出元数据): trackStartIso / trackEndIso 来自轨迹毫秒时刻', () => {
  const out = buildSidecarMeta(fullMetaInput({
    trackStartMs: 946684800000,
    trackEndMs: 1700000000123,
  }));
  assert.equal(out.trackStartIso, '2000-01-01T00:00:00.000Z');
  assert.equal(out.trackEndIso, '2023-11-14T22:13:20.123Z');
});

test('exportMeta · buildSidecarMeta(导出元数据): 可选字段全部缺失时取缺省值', () => {
  const out = buildSidecarMeta({
    t0Ms: 1782374599000,
    scale: 1,
    fps: 30,
    durationSec: 12,
    frames: 360,
    resolution: 1080,
    quality: 'high',
    bitrate: 8000000,
  });
  assert.deepEqual(out.sourceFiles, []);
  assert.equal(out.collapsedSegmentGaps, false);
  assert.equal(out.trackStartIso, null);
  assert.equal(out.trackEndIso, null);
  assert.deepEqual(Object.keys(out).slice().sort(), SIDECAR_KEYS.slice().sort());
});

for (const bad of [undefined, null, Number.NaN, Infinity, -Infinity, 'not-a-time']) {
  test(`exportMeta · buildSidecarMeta(导出元数据): trackStartMs / trackEndMs 为 ${label(bad)} 时两个 Iso 均为 null`, () => {
    const out = buildSidecarMeta(fullMetaInput({ trackStartMs: bad, trackEndMs: bad }));
    assert.equal(out.trackStartIso, null);
    assert.equal(out.trackEndIso, null);
  });
}

test('exportMeta · buildSidecarMeta(导出元数据): 单侧轨迹时刻缺失只影响该侧', () => {
  const out = buildSidecarMeta(fullMetaInput({ trackStartMs: 1782374000000, trackEndMs: undefined }));
  assert.equal(out.trackStartIso, '2026-06-25T07:53:20.000Z');
  assert.equal(out.trackEndIso, null);
});

test('exportMeta · buildSidecarMeta(导出元数据): sourceFiles 保留拼接顺序', () => {
  const out = buildSidecarMeta(fullMetaInput({
    sourceFiles: ['第一段.gpx', 'second.fit', 'third.tcx'],
  }));
  assert.deepEqual(out.sourceFiles, ['第一段.gpx', 'second.fit', 'third.tcx']);
});

test('exportMeta · buildSidecarMeta(导出元数据): 显式传入的空数组与布尔值原样保留', () => {
  const out = buildSidecarMeta(fullMetaInput({ sourceFiles: [], collapsedSegmentGaps: false }));
  assert.deepEqual(out.sourceFiles, []);
  assert.equal(out.collapsedSegmentGaps, false);

  const collapsed = buildSidecarMeta(fullMetaInput({ collapsedSegmentGaps: true }));
  assert.equal(collapsed.collapsedSegmentGaps, true);
});

test('exportMeta · buildSidecarMeta(导出元数据): 产物可 JSON 序列化且往返后字段不变', () => {
  const out = buildSidecarMeta(fullMetaInput());
  const roundTrip = JSON.parse(JSON.stringify(out));
  assert.deepEqual(roundTrip, out);
  assert.equal(typeof JSON.stringify(out), 'string');
});

for (const bad of [null, undefined, 42, 'meta', [], true, Number.NaN]) {
  test(`exportMeta · buildSidecarMeta(导出元数据): 入参非对象 ${label(bad)} 抛 TypeError`, () => {
    assert.throws(
      () => buildSidecarMeta(bad),
      {
        name: 'TypeError',
        message: 'buildSidecarMeta: meta must be an object',
      },
    );
  });
}

for (const bad of [Number.NaN, Infinity, -Infinity, undefined, null, 'abc']) {
  test(`exportMeta · buildSidecarMeta(导出元数据): t0Ms 非有限数 ${label(bad)} 抛 RangeError`, () => {
    assert.throws(
      () => buildSidecarMeta(fullMetaInput({ t0Ms: bad })),
      {
        name: 'RangeError',
        message: 'buildSidecarMeta: t0Ms must be a finite number',
      },
    );
  });
}

// ─────────────────────────── 两条通道的一致性 ────────────────────────────

test('exportMeta · exportMeta(端到端): 文件名里的 t 段与 sidecar.t0Epoch 一致', () => {
  const t0Ms = 1782374599750;
  const scale = 2.5;
  const videoName = buildTimeTrueFilename(t0Ms, scale, 'mp4');
  const jsonName = buildTimeTrueFilename(t0Ms, scale, 'json');
  const meta = buildSidecarMeta(fullMetaInput({ t0Ms, scale }));

  assert.equal(videoName, '轨迹动画_t1782374599_s2.5.mp4');
  assert.equal(jsonName, '轨迹动画_t1782374599_s2.5.json');
  assert.equal(videoName.replace(/\.mp4$/, ''), jsonName.replace(/\.json$/, ''));
  assert.equal(videoName.includes(`_t${meta.t0Epoch}_`), true);
  assert.equal(videoName.includes(`_s${meta.scale}.`), true);
});
