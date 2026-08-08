// timeFormatCore · 本地时刻格式化与分段起点提取（visible 样例）
//
// 时区约定：本文件的所有时刻都由 `new Date(年, 月索引, 日, 时, 分, 秒)` 构造，
// 它落在测试机的本地时区上；被测函数也按本地分量输出。两端用同一套本地分量，
// 因此断言与测试机时区无关。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toLocalInputValue,
  parseLocalInputValue,
  formatLocalHms,
  formatLocalIso,
} from '../../src/core/time-format.mjs';
import { segmentStartIndices, concatTrackPoints } from '../../src/core/track-files.mjs';

test('timeFormatCore · toLocalInputValue / formatLocalHms / formatLocalIso 按本地分量补零输出', () => {
  // 本地时刻 2024-01-05 09:07:03（月/日/时/分/秒都是个位数，验补零）
  const ms = new Date(2024, 0, 5, 9, 7, 3).getTime();

  assert.equal(toLocalInputValue(ms), '2024-01-05T09:07:03');
  assert.equal(formatLocalHms(ms), '09:07:03');
  assert.equal(formatLocalIso(ms), '2024-01-05 09:07:03');
});

test('timeFormatCore · parseLocalInputValue 解析三种形态，并与 toLocalInputValue 往返一致', () => {
  assert.equal(
    parseLocalInputValue('2024-01-05T09:07'),
    new Date(2024, 0, 5, 9, 7, 0, 0).getTime(),
    '分钟精度：秒与毫秒按 0',
  );
  assert.equal(
    parseLocalInputValue('2024-01-05T09:07:03'),
    new Date(2024, 0, 5, 9, 7, 3, 0).getTime(),
    '秒精度：毫秒按 0',
  );
  assert.equal(
    parseLocalInputValue('2024-01-05T09:07:03.456'),
    new Date(2024, 0, 5, 9, 7, 3, 456).getTime(),
    '毫秒精度',
  );

  // 秒对齐的时间戳往返回到自身
  const ms = new Date(2024, 6, 15, 8, 30, 45).getTime();
  assert.equal(parseLocalInputValue(toLocalInputValue(ms)), ms);

  // 格式不匹配返回 NaN
  assert.ok(Number.isNaN(parseLocalInputValue('not-a-time')));
});

test('timeFormatCore · segmentStartIndices 给出各段在拼接序列里的起始下标', () => {
  const files = [
    { name: 'a.gpx', format: 'gpx', points: [{ lat: 1, lon: 11 }, { lat: 2, lon: 12 }, { lat: 3, lon: 13 }] },
    { name: 'b.gpx', format: 'gpx', points: [{ lat: 4, lon: 14 }, { lat: 5, lon: 15 }] },
    { name: 'c.gpx', format: 'gpx', points: [{ lat: 6, lon: 16 }, { lat: 7, lon: 17 }, { lat: 8, lon: 18 }, { lat: 9, lon: 19 }] },
  ];

  assert.deepEqual(segmentStartIndices(files), [0, 3, 5]);
  assert.deepEqual(segmentStartIndices([]), []);

  // 与 concatTrackPoints 配套：starts[k] 就是第 k 段第一个点在拼接结果里的下标
  const starts = segmentStartIndices(files);
  const concat = concatTrackPoints(files);
  for (let k = 0; k < files.length; k += 1) {
    assert.equal(concat[starts[k]].lat, files[k].points[0].lat, `第 ${k} 段起点的 lat`);
    assert.equal(concat[starts[k]].lon, files[k].points[0].lon, `第 ${k} 段起点的 lon`);
  }
});
