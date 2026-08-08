// 导出参数（时长上限参数化 · 画质码率 · 体积估算）的样例测试。
// 锚定值全部照 spec 的表格手工推导。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampMp4Duration,
  mp4Bitrate,
  estimateMp4Bytes,
  formatByteSize,
} from '../../src/core/export-params.mjs';

test('exportParams · clampMp4Duration(时长上限): 上限可由调用方传入，单参仍按 600 收口', () => {
  // 流式写盘通道 6 小时 = 21600 秒：区间内原样返回，超出压到自定义上限。
  assert.equal(clampMp4Duration(1800, 21600), 1800);
  assert.equal(clampMp4Duration(99999, 21600), 21600);
  // 下限恒为 1，与是否传上限无关。
  assert.equal(clampMp4Duration(0.25, 21600), 1);
  // 单参调用保持既有事实：上限 600。
  assert.equal(clampMp4Duration(9999), 600);
  assert.equal(clampMp4Duration(6), 6);
});

test('exportParams · mp4Bitrate(画质码率): 三档画质 × 三档分辨率查表', () => {
  assert.equal(mp4Bitrate(720, 'high'), 6e6);
  assert.equal(mp4Bitrate(1080, 'medium'), 6e6);
  assert.equal(mp4Bitrate(1440, 'low'), 5e6);
  // 非法入参回落到 1080 / high 这一格。
  assert.equal(mp4Bitrate(undefined, undefined), 12e6);
});

test('exportParams · estimateMp4Bytes + formatByteSize(体积估算): 秒数 × 码率换算成人类可读体积', () => {
  // 1590 秒 @ 20 Mbps = 1590 * 20e6 / 8 = 3_975_000_000 字节。
  const bytes = estimateMp4Bytes(1590, mp4Bitrate(1440, 'high'));
  assert.equal(bytes, 3975000000);
  // 3_975_000_000 / 1024^3 = 3.702… → 保留 1 位小数。
  assert.equal(formatByteSize(bytes), '3.7 GB');
  // 整除到整数量级时去掉多余的 .0。
  assert.equal(formatByteSize(1024 ** 3), '1 GB');
});
