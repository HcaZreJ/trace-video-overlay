import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFIT } from './fit.mjs';

const u32 = v => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const u16 = v => [v & 0xff, (v >> 8) & 0xff];
// 手工构造最小合法 FIT：header + record 定义消息 + N 个数据消息
function buildFIT(recs) {
  const def = [0x40, 0x00, 0x00, 0x14, 0x00, 0x04, 253, 0x04, 0x86, 0, 0x04, 0x85, 1, 0x04, 0x85, 2, 0x02, 0x84];
  const data = [];
  for (const r of recs) data.push(0x00, ...u32(r.t), ...u32(r.lat_sc >>> 0), ...u32(r.lng_sc >>> 0), ...u16(r.alt));
  const body = [...def, ...data];
  const header = [0x0e, 0x20, 0x00, 0x00, ...u32(body.length), 0x2e, 0x46, 0x49, 0x54, 0x00, 0x00];
  return new Uint8Array([...header, ...body]);
}

test('parseFIT: 解析 record 的经纬度/海拔/时间', () => {
  const SEMI = 180 / 2 ** 31;
  const lat_sc = Math.round(31 / SEMI), lng_sc = Math.round(120 / SEMI);
  const fit = buildFIT([
    { t: 1000000000, lat_sc, lng_sc, alt: 3000 },          // ele = 3000/5-500 = 100
    { t: 1000000002, lat_sc: lat_sc + 1000, lng_sc: lng_sc + 1000, alt: 3010 },
  ]);
  const pts = parseFIT(fit);
  assert.equal(pts.length, 2);
  assert.ok(Math.abs(pts[0].lat - 31) < 0.001, `lat ${pts[0].lat}`);
  assert.ok(Math.abs(pts[0].lng - 120) < 0.001, `lng ${pts[0].lng}`);
  assert.equal(pts[0].ele, 100);
  assert.equal(pts[0].time, (1000000000 + 631065600) * 1000);
});
test('parseFIT: 跳过无效坐标 (0x7FFFFFFF)', () => {
  const lat_sc = Math.round(31 / (180 / 2 ** 31));
  const fit = buildFIT([
    { t: 1, lat_sc: 0x7FFFFFFF, lng_sc: 0x7FFFFFFF, alt: 3000 },
    { t: 2, lat_sc, lng_sc: lat_sc, alt: 3000 },
  ]);
  assert.equal(parseFIT(fit).length, 1);
});
test('parseFIT: 非 FIT 数据返回空数组', () => {
  assert.deepEqual(parseFIT(new Uint8Array([1, 2, 3, 4, 5])), []);
});
