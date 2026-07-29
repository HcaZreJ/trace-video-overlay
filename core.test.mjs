import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mercatorX, mercatorY, smoothTrack, projectTrack, trackDistanceKm,
} from './src/core/geo.mjs';
import {
  trackDurationSec, avgSpeedKmh, paceSecPerKm, elevationGainM, formatDuration, formatPace,
} from './src/core/metrics.mjs';
import { concatTrackPoints, reorderTrackFiles } from './src/core/track-files.mjs';
import { extractGeoJSONCoords } from './src/parse/geojson.mjs';
import { extractTextCoords } from './src/parse/csv.mjs';

// ==================== 运动指标 ====================
test('trackDurationSec(运动时长): 扣除停顿段', () => {
  const pts = [
    { lng: 0, lat: 0, time: 0 },
    { lng: 0, lat: 0.001, time: 60_000 },    // 移动 ~111m/60s → 计入 60s
    { lng: 0, lat: 0.001, time: 660_000 },   // 原地停 600s → 不计
    { lng: 0, lat: 0.002, time: 720_000 },   // 移动 ~111m/60s → 计入 60s
  ];
  assert.equal(trackDurationSec(pts), 120);
});
test('trackDurationSec: 无时间戳返回 null', () => {
  assert.equal(trackDurationSec([{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }]), null);
});
test('formatDuration: hh:mm:ss 格式', () => {
  assert.equal(formatDuration(8520), '2:22:00');
  assert.equal(formatDuration(2880), '0:48:00');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(null), null);
});
test('avgSpeedKmh: 距离÷时长', () => {
  const pts = [{ lng: 0, lat: 0, time: 0 }, { lng: 1, lat: 0, time: 3600_000 }]; // 111.19km / 1h
  assert.ok(Math.abs(avgSpeedKmh(pts) - 111.19) < 0.5, `实际 ${avgSpeedKmh(pts)}`);
});
test('avgSpeedKmh: 无时间返回 null', () => {
  assert.equal(avgSpeedKmh([{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }]), null);
});
test('paceSecPerKm: 10km/50min ≈ 300 s/km', () => {
  const pts = [{ lng: 0, lat: 0, time: 0 }, { lng: 0, lat: 0.0899322, time: 3000_000 }];
  assert.ok(Math.abs(paceSecPerKm(pts) - 300) < 5, `实际 ${paceSecPerKm(pts)}`);
});
test('formatPace: 配速格式', () => {
  assert.equal(formatPace(330), `5'30"`);
  assert.equal(formatPace(300), `5'00"`);
  assert.equal(formatPace(null), null);
});
test('elevationGainM: 单调爬升 ≈ 总上升', () => {
  const pts = Array.from({ length: 101 }, (_, i) => ({ ele: 100 + i })); // 100→200
  const g = elevationGainM(pts);
  assert.ok(g > 80 && g < 110, `实际 ${g}`);
});
test('elevationGainM: 高频噪声被平滑去除(≈0)', () => {
  const pts = Array.from({ length: 40 }, (_, i) => ({ ele: 100 + (i % 2) * 3 })); // 100/103 震荡
  assert.ok(elevationGainM(pts) < 15, `实际 ${elevationGainM(pts)}`);
});
test('elevationGainM: 无海拔返回 null', () => {
  assert.equal(elevationGainM([{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }]), null);
});

// ==================== trackDistanceKm ====================
test('trackDistanceKm: 空/单点为 0', () => {
  assert.equal(trackDistanceKm([]), 0);
  assert.equal(trackDistanceKm([{ lng: 1, lat: 1 }]), 0);
});
test('trackDistanceKm: 赤道经度 1° ≈ 111.2km', () => {
  const d = trackDistanceKm([{ lng: 0, lat: 0 }, { lng: 1, lat: 0 }]);
  assert.ok(Math.abs(d - 111.19) < 0.5, `实际 ${d}`);
});
test('trackDistanceKm: 纬度 1° ≈ 111.2km', () => {
  const d = trackDistanceKm([{ lng: 0, lat: 0 }, { lng: 0, lat: 1 }]);
  assert.ok(Math.abs(d - 111.19) < 0.5, `实际 ${d}`);
});
test('trackDistanceKm: 北京→上海 ≈ 1067km', () => {
  const d = trackDistanceKm([{ lng: 116.4, lat: 39.9 }, { lng: 121.5, lat: 31.2 }]);
  assert.ok(Math.abs(d - 1067) < 25, `实际 ${d}`);
});
test('trackDistanceKm: 多段累加等于分段和', () => {
  const a = { lng: 0, lat: 0 }, b = { lng: 0.5, lat: 0.3 }, c = { lng: 1, lat: 0.1 };
  const total = trackDistanceKm([a, b, c]);
  const seg = trackDistanceKm([a, b]) + trackDistanceKm([b, c]);
  assert.ok(Math.abs(total - seg) < 1e-9, `total=${total} seg=${seg}`);
});

// ==================== Mercator ====================
test('mercator: 原点映射为 0', () => {
  assert.equal(mercatorX(0), 0);
  assert.ok(Math.abs(mercatorY(0)) < 1e-6);
});
test('mercator: 经度线性、180° 为半周长', () => {
  const expect180 = Math.PI * 6378137;
  assert.ok(Math.abs(mercatorX(180) - expect180) < 1);
  assert.ok(Math.abs(mercatorX(90) - expect180 / 2) < 1);
});
test('mercator: 纬度随纬度单调递增', () => {
  assert.ok(mercatorY(60) > mercatorY(30));
  assert.ok(mercatorY(30) > mercatorY(0));
  assert.ok(mercatorY(0) > mercatorY(-30));
});

// ==================== smoothTrack ====================
test('smoothTrack: 稀疏点被加密到接近目标数', () => {
  const pts = [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }, { lng: 2, lat: 0 }, { lng: 3, lat: 1 }, { lng: 4, lat: 0 }];
  const out = smoothTrack(pts, 500);
  assert.ok(out.length > pts.length, '应被加密');
  assert.ok(out.length >= 400 && out.length <= 600, `点数应接近 500，实际 ${out.length}`);
});
test('smoothTrack: 已足够密集则原样返回', () => {
  const pts = Array.from({ length: 600 }, (_, i) => ({ lng: i, lat: i }));
  assert.equal(smoothTrack(pts, 500), pts);
});
test('smoothTrack: 少于 3 点原样返回', () => {
  const pts = [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }];
  assert.equal(smoothTrack(pts, 500), pts);
});
test('smoothTrack: 保留首尾端点', () => {
  const pts = [{ lng: 10, lat: 20 }, { lng: 11, lat: 22 }, { lng: 13, lat: 21 }, { lng: 15, lat: 25 }];
  const out = smoothTrack(pts, 500);
  assert.ok(Math.abs(out[0].lng - 10) < 0.01 && Math.abs(out[0].lat - 20) < 0.01, '首点保持');
  assert.ok(Math.abs(out[out.length - 1].lng - 15) < 1e-9 && Math.abs(out[out.length - 1].lat - 25) < 1e-9, '末点精确保持');
});

// ==================== projectTrack ====================
test('projectTrack: 所有点落在画布内 [0, fullSize]', () => {
  const pts = [{ lng: 116.0, lat: 39.9 }, { lng: 116.4, lat: 40.1 }, { lng: 116.8, lat: 39.8 }, { lng: 117.0, lat: 40.3 }];
  const { points, fullSize } = projectTrack(pts, 2400);
  assert.equal(fullSize, 2400);
  for (const p of points) {
    assert.ok(p.x >= 0 && p.x <= 2400, `x 越界: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 2400, `y 越界: ${p.y}`);
  }
});
test('projectTrack: 保持长宽比，不拉伸（横向轨迹横向更宽）', () => {
  // 东西跨度大、南北跨度小的轨迹
  const pts = [{ lng: 100, lat: 30 }, { lng: 110, lat: 30.2 }, { lng: 120, lat: 29.9 }, { lng: 130, lat: 30.1 }];
  const { points } = projectTrack(pts, 2400);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  assert.ok(xSpan > ySpan * 3, `横向轨迹应明显更宽: xSpan=${xSpan.toFixed(0)} ySpan=${ySpan.toFixed(0)}`);
});
test('projectTrack: 含 padding，主轴不贴满边缘', () => {
  const pts = [{ lng: 100, lat: 30 }, { lng: 110, lat: 30.2 }, { lng: 120, lat: 29.9 }, { lng: 130, lat: 30.1 }];
  const { points } = projectTrack(pts, 2400);
  const xs = points.map(p => p.x);
  assert.ok(Math.min(...xs) > 1, '左侧应有 padding');
  assert.ok(Math.max(...xs) < 2399, '右侧应有 padding');
});

// ==================== GeoJSON ====================
test('extractGeoJSONCoords: LineString', () => {
  const g = { type: 'LineString', coordinates: [[1, 2], [3, 4], [5, 6]] };
  assert.deepEqual(extractGeoJSONCoords(g), [{ lng: 1, lat: 2 }, { lng: 3, lat: 4 }, { lng: 5, lat: 6 }]);
});
test('extractGeoJSONCoords: MultiLineString', () => {
  const g = { type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]], [[5, 6]]] };
  assert.equal(extractGeoJSONCoords(g).length, 3);
});
test('extractGeoJSONCoords: FeatureCollection 嵌套', () => {
  const g = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[10, 20], [30, 40]] } }] };
  assert.deepEqual(extractGeoJSONCoords(g), [{ lng: 10, lat: 20 }, { lng: 30, lat: 40 }]);
});
test('extractGeoJSONCoords: 无几何返回空', () => {
  assert.deepEqual(extractGeoJSONCoords({ type: 'Point', coordinates: [1, 2] }), []);
});

// ==================== 文本坐标 ====================
test('extractTextCoords: lat,lng 顺序（上海，lng>90）', () => {
  const out = extractTextCoords('31.23,121.47\n31.24,121.48');
  assert.deepEqual(out[0], { lng: 121.47, lat: 31.23 });
});
test('extractTextCoords: lng,lat 顺序（经度在前）', () => {
  const out = extractTextCoords('121.47,31.23');
  assert.deepEqual(out[0], { lng: 121.47, lat: 31.23 });
});
test('extractTextCoords: 都在 ±90 内默认 lat,lng', () => {
  const out = extractTextCoords('30.1,40.2');
  assert.deepEqual(out[0], { lng: 40.2, lat: 30.1 });
});

// ==================== GeoJSON GeometryCollection ====================
test('extractGeoJSONCoords: 提取 GeometryCollection 内的多条 LineString', () => {
  const gc = { type: 'GeometryCollection', geometries: [
    { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
    { type: 'LineString', coordinates: [[3, 3], [4, 4]] },
  ] };
  assert.equal(extractGeoJSONCoords(gc).length, 4);
  // Feature 套 GeometryCollection 也要能提取
  assert.equal(extractGeoJSONCoords({ type: 'Feature', geometry: gc }).length, 4);
});
test('extractGeoJSONCoords: 现有写法不回退', () => {
  assert.equal(extractGeoJSONCoords({ type: 'LineString', coordinates: [[1, 1], [2, 2]] }).length, 2);
  assert.equal(extractGeoJSONCoords({ type: 'MultiLineString', coordinates: [[[1, 1], [2, 2]], [[3, 3], [4, 4]]] }).length, 4);
  assert.equal(extractGeoJSONCoords({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } },
  ] }).length, 2);
  // properties 里的 geometries 键不应被误读
  assert.equal(extractGeoJSONCoords({ type: 'Feature', properties: { geometries: [{ type: 'LineString', coordinates: [[9, 9], [9, 9]] }] }, geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } }).length, 2);
});

// ==================== concatTrackPoints（多轨迹文件首尾拼接） ====================
test('concatTrackPoints: 空数组返回 null', () => {
  assert.equal(concatTrackPoints([]), null);
});

test('concatTrackPoints: 单文件返回其 points，内容与顺序不变', () => {
  const points = [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }, { lng: 3, lat: 3 }];
  const trackFiles = [{ name: 'a.gpx', format: 'gpx', points }];
  assert.deepEqual(concatTrackPoints(trackFiles), points);
});

test('concatTrackPoints: 多文件按数组顺序首尾拼接', () => {
  const p1 = [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }];
  const p2 = [{ lng: 2, lat: 2 }, { lng: 3, lat: 3 }];
  const p3 = [{ lng: 4, lat: 4 }];
  const trackFiles = [
    { name: 'f1.gpx', format: 'gpx', points: p1 },
    { name: 'f2.gpx', format: 'gpx', points: p2 },
    { name: 'f3.gpx', format: 'gpx', points: p3 },
  ];
  const result = concatTrackPoints(trackFiles);
  assert.deepEqual(result, [...p1, ...p2, ...p3]);
  assert.deepEqual(result[0], p1[0], '首元素应是首文件首点');
  assert.deepEqual(result[result.length - 1], p3[p3.length - 1], '末元素应是末文件末点');
  assert.equal(result.length, p1.length + p2.length + p3.length, '总点数=各文件点数之和');
});

test('concatTrackPoints: 不去重、不做接缝处理——边界重复坐标原样保留', () => {
  const shared = { lng: 10, lat: 20 };
  const p1 = [{ lng: 0, lat: 0 }, { ...shared }];
  const p2 = [{ ...shared }, { lng: 30, lat: 40 }];
  const trackFiles = [
    { name: 'f1.gpx', format: 'gpx', points: p1 },
    { name: 'f2.gpx', format: 'gpx', points: p2 },
  ];
  const result = concatTrackPoints(trackFiles);
  assert.equal(result.length, 4, '重复坐标不应被去重');
  assert.deepEqual(result, [...p1, ...p2]);
});

test('concatTrackPoints: 完整保留点的所有字段(ele/time)', () => {
  const p1 = [{ lng: 1, lat: 1, ele: 100, time: 1000 }];
  const p2 = [{ lng: 2, lat: 2, ele: 200, time: 2000 }];
  const trackFiles = [
    { name: 'f1.gpx', format: 'gpx', points: p1 },
    { name: 'f2.gpx', format: 'gpx', points: p2 },
  ];
  const result = concatTrackPoints(trackFiles);
  assert.deepEqual(result, [
    { lng: 1, lat: 1, ele: 100, time: 1000 },
    { lng: 2, lat: 2, ele: 200, time: 2000 },
  ]);
});

test('concatTrackPoints: 单文件 points 为空数组 → 返回空数组而非 null', () => {
  const trackFiles = [{ name: 'empty.gpx', format: 'gpx', points: [] }];
  const result = concatTrackPoints(trackFiles);
  assert.notEqual(result, null, 'trackFiles 非空时不应返回 null');
  assert.deepEqual(result, []);
});

test('concatTrackPoints: 某文件 points 为空，其余正常拼接，空文件贡献 0 点', () => {
  const p1 = [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }];
  const p3 = [{ lng: 5, lat: 5 }];
  const trackFiles = [
    { name: 'f1.gpx', format: 'gpx', points: p1 },
    { name: 'f2.gpx', format: 'gpx', points: [] },
    { name: 'f3.gpx', format: 'gpx', points: p3 },
  ];
  const result = concatTrackPoints(trackFiles);
  assert.deepEqual(result, [...p1, ...p3]);
  assert.equal(result.length, 3);
});

test('concatTrackPoints: 不修改入参 trackFiles 及其 points 数组', () => {
  const trackFiles = [
    { name: 'f1.gpx', format: 'gpx', points: [{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }] },
    { name: 'f2.gpx', format: 'gpx', points: [{ lng: 2, lat: 2 }] },
  ];
  const snapshot = structuredClone(trackFiles);
  concatTrackPoints(trackFiles);
  assert.deepEqual(trackFiles, snapshot, '调用后入参应与调用前快照一致');
});

// ==================== reorderTrackFiles（文件列表重排/删除） ====================
function fileStub(name) { return { name, format: 'gpx', points: [{ lng: 0, lat: 0 }] }; }

test('reorderTrackFiles: del 移除指定索引', () => {
  const files = [fileStub('a'), fileStub('b'), fileStub('c')];
  const result = reorderTrackFiles(files, 'del', 1);
  assert.deepEqual(result, [fileStub('a'), fileStub('c')]);
});

test('reorderTrackFiles: up 交换 i 与 i-1', () => {
  const files = [fileStub('a'), fileStub('b'), fileStub('c')];
  const result = reorderTrackFiles(files, 'up', 1);
  assert.deepEqual(result, [fileStub('b'), fileStub('a'), fileStub('c')]);
});

test('reorderTrackFiles: up 在 i===0 时内容不变（首项不能再上移）', () => {
  const files = [fileStub('a'), fileStub('b'), fileStub('c')];
  const result = reorderTrackFiles(files, 'up', 0);
  assert.deepEqual(result, files);
});

test('reorderTrackFiles: down 交换 i 与 i+1', () => {
  const files = [fileStub('a'), fileStub('b'), fileStub('c')];
  const result = reorderTrackFiles(files, 'down', 1);
  assert.deepEqual(result, [fileStub('a'), fileStub('c'), fileStub('b')]);
});

test('reorderTrackFiles: down 在末项时内容不变（末项不能再下移）', () => {
  const files = [fileStub('a'), fileStub('b'), fileStub('c')];
  const result = reorderTrackFiles(files, 'down', files.length - 1);
  assert.deepEqual(result, files);
});

test('reorderTrackFiles: 未知 act 返回内容相同的新数组，不抛异常', () => {
  const files = [fileStub('a'), fileStub('b')];
  const result = reorderTrackFiles(files, 'unknown-action', 0);
  assert.deepEqual(result, files);
});

test('reorderTrackFiles: i 越界(负数)时内容不变', () => {
  const files = [fileStub('a'), fileStub('b'), fileStub('c')];
  assert.deepEqual(reorderTrackFiles(files, 'up', -1), files);
  assert.deepEqual(reorderTrackFiles(files, 'down', -1), files);
});

test('reorderTrackFiles: i 越界(>=length)时内容不变', () => {
  const files = [fileStub('a'), fileStub('b'), fileStub('c')];
  assert.deepEqual(reorderTrackFiles(files, 'up', files.length), files);
  assert.deepEqual(reorderTrackFiles(files, 'down', files.length + 5), files);
});

test('reorderTrackFiles: 单元素数组 up/down 内容不变', () => {
  const files = [fileStub('only')];
  assert.deepEqual(reorderTrackFiles(files, 'up', 0), files);
  assert.deepEqual(reorderTrackFiles(files, 'down', 0), files);
});

test('reorderTrackFiles: del 唯一元素返回空数组', () => {
  const files = [fileStub('only')];
  const result = reorderTrackFiles(files, 'del', 0);
  assert.deepEqual(result, []);
});

test('reorderTrackFiles: del 越界索引时内容不变', () => {
  const files = [fileStub('a'), fileStub('b')];
  assert.deepEqual(reorderTrackFiles(files, 'del', 5), files);
  assert.deepEqual(reorderTrackFiles(files, 'del', -1), files);
});

test('reorderTrackFiles: 返回值是新数组引用，且不修改入参', () => {
  const files = [fileStub('a'), fileStub('b'), fileStub('c')];
  const snapshot = structuredClone(files);

  const delResult = reorderTrackFiles(files, 'del', 1);
  assert.notEqual(delResult, files, 'del 结果应是新数组引用');
  assert.deepEqual(files, snapshot, 'del 调用后不应修改入参');

  const upResult = reorderTrackFiles(files, 'up', 1);
  assert.notEqual(upResult, files, 'up 结果应是新数组引用');
  assert.deepEqual(files, snapshot, 'up 调用后不应修改入参');

  const downResult = reorderTrackFiles(files, 'down', 0);
  assert.notEqual(downResult, files, 'down 结果应是新数组引用');
  assert.deepEqual(files, snapshot, 'down 调用后不应修改入参');

  const unknownResult = reorderTrackFiles(files, 'noop', 0);
  assert.notEqual(unknownResult, files, '未知 act 结果也应是新数组引用');
  assert.deepEqual(files, snapshot, '未知 act 调用后不应修改入参');
});
