import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mercatorX, mercatorY, smoothTrack, projectTrack,
  extractGeoJSONCoords, extractTextCoords, crc32, buildStoreZip, trackDistanceKm,
  trackDurationSec, avgSpeedKmh, paceSecPerKm, elevationGainM, formatDuration, formatPace,
  layoutTextBlockX, concatTrackPoints, reorderTrackFiles,
} from './core.mjs';

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

// ==================== CRC32 ====================
test('crc32: 标准测试向量 "123456789" = 0xCBF43926', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});
test('crc32: 空输入为 0', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
});

// ==================== ZIP ====================
test('buildStoreZip: 产出可被系统 unzip 校验并解出原内容', () => {
  const enc = new TextEncoder();
  const files = [
    { name: 'a.txt', data: enc.encode('hello 旅图') },
    { name: 'pic_2.txt', data: enc.encode('second file content') },
  ];
  const zip = buildStoreZip(files);
  // 头部签名
  assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4b);
  assert.equal(zip[2], 0x03); assert.equal(zip[3], 0x04);

  const dir = mkdtempSync(join(tmpdir(), 'ziptest-'));
  const zipPath = join(dir, 'out.zip');
  writeFileSync(zipPath, zip);
  // 完整性校验
  const t = execSync(`unzip -t ${zipPath}`).toString();
  assert.ok(/No errors detected/.test(t), 'unzip -t 应无错误');
  // 内容比对
  const c1 = execSync(`unzip -p ${zipPath} a.txt`).toString();
  assert.equal(c1, 'hello 旅图');
  const c2 = execSync(`unzip -p ${zipPath} pic_2.txt`).toString();
  assert.equal(c2, 'second file content');
});

// ==================== 文字块水平布局（位置 / 对齐 解耦） ====================
// 每行实际绘制区间 [left,right]：textAlign 决定 x 是行的左/中/右锚点。
function lineExtents(res, widths) {
  return res.lines.map((ln, i) => {
    const w = widths[i];
    const left = ln.textAlign === 'left' ? ln.x : ln.textAlign === 'center' ? ln.x - w / 2 : ln.x - w;
    return { left, right: left + w };
  });
}
const _W = 1000, _PAD = 60;
const _COMBOS = [];
for (const hpos of ['left', 'center', 'right'])
  for (const align of ['left', 'center', 'right']) _COMBOS.push({ hpos, align });

test('layoutTextBlockX: 任意 位置×对齐 每行都落在 [pad, width-pad] 内（修复越界 bug）', () => {
  const widths = [300, 120, 260, 80];
  for (const c of _COMBOS) {
    const res = layoutTextBlockX(widths, { ...c, pad: _PAD, width: _W });
    for (const e of lineExtents(res, widths)) {
      assert.ok(e.left >= _PAD - 1e-6, `${c.hpos}+${c.align}: left ${e.left} < pad`);
      assert.ok(e.right <= _W - _PAD + 1e-6, `${c.hpos}+${c.align}: right ${e.right} > width-pad`);
    }
  }
});
test('layoutTextBlockX: 靠左 → 块左缘贴 pad，左对齐行锚在 pad', () => {
  const res = layoutTextBlockX([300, 120], { hpos: 'left', align: 'left', pad: _PAD, width: _W });
  assert.equal(res.blockX0, _PAD);
  assert.equal(res.lines[0].x, _PAD);
  assert.equal(res.lines[0].textAlign, 'left');
});
test('layoutTextBlockX: 靠右+右对齐 → 块右缘贴 width-pad', () => {
  const res = layoutTextBlockX([300, 120], { hpos: 'right', align: 'right', pad: _PAD, width: _W });
  assert.equal(res.blockX0 + res.blockWidth, _W - _PAD);
  assert.equal(res.lines[0].x, _W - _PAD);
  assert.equal(res.lines[0].textAlign, 'right');
});
test('layoutTextBlockX: 靠左+居中 → 围绕块中心，窄行不越左界（旧 bug 场景）', () => {
  const res = layoutTextBlockX([300, 80], { hpos: 'left', align: 'center', pad: _PAD, width: _W });
  const center = _PAD + 150; // 块=[pad,pad+300]
  assert.equal(res.lines[0].x, center);
  assert.equal(res.lines[0].textAlign, 'center');
  assert.ok(center - 40 >= _PAD); // 窄行(80)左缘
});
test('layoutTextBlockX: 居中 → 块整体居中', () => {
  const res = layoutTextBlockX([300], { hpos: 'center', align: 'center', pad: _PAD, width: _W });
  assert.equal(res.blockX0, (_W - 300) / 2);
  assert.equal(res.lines[0].x, _W / 2);
});
test('layoutTextBlockX: 空行列表不崩溃', () => {
  const res = layoutTextBlockX([], { hpos: 'left', align: 'left', pad: _PAD, width: _W });
  assert.equal(res.blockWidth, 0);
  assert.deepEqual(res.lines, []);
});
test('layoutTextBlockX: 行宽超出可用宽 → 块宽夹到 avail 且仍居内', () => {
  for (const c of _COMBOS) {
    const res = layoutTextBlockX([5000], { ...c, pad: _PAD, width: _W });
    assert.equal(res.blockWidth, _W - 2 * _PAD);
    assert.ok(res.blockX0 >= _PAD - 1e-6);
    assert.ok(res.blockX0 + res.blockWidth <= _W - _PAD + 1e-6);
  }
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
