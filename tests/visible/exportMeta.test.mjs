// 单元 exportMeta 的样例测试：文件名编码 + sidecar 元数据构造。
// 跑法：node --test tests/visible/exportMeta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTimeTrueFilename, buildSidecarMeta } from '../../src/core/export-meta.mjs';

test('exportMeta · buildTimeTrueFilename(文件名编码): 整数 scale 的标准文件名', () => {
  // 契约示例：轨迹动画_t<epochSec>_s<scaleStr>.<ext>
  assert.equal(
    buildTimeTrueFilename(1782374599000, 1, 'mp4'),
    '轨迹动画_t1782374599_s1.mp4',
  );
});

test('exportMeta · buildTimeTrueFilename(文件名编码): 非整数 scale 用最短十进制表示', () => {
  // 2.5 保留一位小数、0.5 保留前导零、10 不带小数点。
  assert.equal(
    buildTimeTrueFilename(1782374599000, 2.5, 'mp4'),
    '轨迹动画_t1782374599_s2.5.mp4',
  );
  assert.equal(
    buildTimeTrueFilename(1782374599000, 0.5, 'json'),
    '轨迹动画_t1782374599_s0.5.json',
  );
});

test('exportMeta · buildSidecarMeta(导出元数据): 完整入参产出全部契约字段', () => {
  const meta = buildSidecarMeta({
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
  });

  assert.deepEqual(meta, {
    schema: 'trace-video-overlay/time-true-export@1',
    t0Epoch: 1782374599,
    t0Iso: '2026-06-25T08:03:19.000Z',
    scale: 1,
    fps: 30,
    durationSec: 12,
    frames: 360,
    resolution: 1080,
    quality: 'high',
    bitrate: 8000000,
    trackStartIso: '2026-06-25T07:53:20.000Z',
    trackEndIso: '2026-06-25T09:00:00.000Z',
    sourceFiles: ['ride-a.gpx', 'ride-b.gpx'],
    collapsedSegmentGaps: true,
  });
});
