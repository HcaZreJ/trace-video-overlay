import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wgs84ToGcj02 } from '../../src/core/gcj02.mjs';

/**
 * 断言 actual 是一个 {lng,lat} 均为数值、且与 expected 在给定容差内相等的坐标点，
 * 同时确认结果不含 NaN。
 */
function approxEqualPoint(actual, expected, epsilon = 0.0002) {
  assert.ok(
    actual && typeof actual.lng === 'number' && typeof actual.lat === 'number',
    `expected a point object with numeric lng/lat, got ${JSON.stringify(actual)}`
  );
  assert.ok(!Number.isNaN(actual.lng) && !Number.isNaN(actual.lat), 'point must not contain NaN');
  assert.ok(
    Math.abs(actual.lng - expected.lng) < epsilon,
    `lng mismatch: got ${actual.lng}, expected ${expected.lng} (epsilon ${epsilon})`
  );
  assert.ok(
    Math.abs(actual.lat - expected.lat) < epsilon,
    `lat mismatch: got ${actual.lat}, expected ${expected.lat} (epsilon ${epsilon})`
  );
}

/** 断言境外坐标被原样返回（无任何浮点误差，完全相等）。 */
function assertIdentity(actual, lng, lat) {
  assert.ok(
    actual && typeof actual.lng === 'number' && typeof actual.lat === 'number',
    `expected a point object with numeric lng/lat, got ${JSON.stringify(actual)}`
  );
  assert.equal(actual.lng, lng, 'expected lng to be returned unchanged for an out-of-China point');
  assert.equal(actual.lat, lat, 'expected lat to be returned unchanged for an out-of-China point');
}

/** 断言境内坐标发生了合理量级（非零、非离谱）的偏移。 */
function assertOffsetApplied(actual, lng, lat, { minMagnitude = 1e-6, maxMagnitude = 0.02 } = {}) {
  assert.ok(
    actual && typeof actual.lng === 'number' && typeof actual.lat === 'number',
    `expected a point object with numeric lng/lat, got ${JSON.stringify(actual)}`
  );
  const dLng = Math.abs(actual.lng - lng);
  const dLat = Math.abs(actual.lat - lat);
  assert.ok(
    dLng > minMagnitude || dLat > minMagnitude,
    `expected a non-trivial offset for an in-China point (${lng}, ${lat}), got identical output`
  );
  assert.ok(
    dLng < maxMagnitude && dLat < maxMagnitude,
    `offset magnitude implausibly large: dLng=${dLng}, dLat=${dLat}`
  );
}

// ---------------------------------------------------------------------------
// 表格权威参考点：国内已知点，偏移后应落在参考值附近
// ---------------------------------------------------------------------------

test('wgs84ToGcj02 天安门 转换结果与国测局公式参考值一致', () => {
  const result = wgs84ToGcj02(116.397428, 39.90923);
  approxEqualPoint(result, { lng: 116.403672, lat: 39.910634 }, 0.0002);
});

test('wgs84ToGcj02 上海东方明珠 转换结果与国测局公式参考值一致', () => {
  const result = wgs84ToGcj02(121.499718, 31.239703);
  approxEqualPoint(result, { lng: 121.504151, lat: 31.237689 }, 0.0002);
});

test('wgs84ToGcj02 广州塔 转换结果与国测局公式参考值一致', () => {
  const result = wgs84ToGcj02(113.32452, 23.106414);
  approxEqualPoint(result, { lng: 113.329941, lat: 23.103812 }, 0.0002);
});

// ---------------------------------------------------------------------------
// 自选境内点：只校验契约（确实发生偏移、量级合理），不锁定具体数值
// ---------------------------------------------------------------------------

const SELF_CHOSEN_INLAND_POINTS = [
  { name: '成都', lng: 104.065735, lat: 30.659462 },
  { name: '西安', lng: 108.940174, lat: 34.341568 },
  { name: '乌鲁木齐（新疆西部）', lng: 87.616848, lat: 43.825592 },
  { name: '哈尔滨（东北）', lng: 126.642464, lat: 45.756967 },
  { name: '三亚（海南，低纬度）', lng: 109.508268, lat: 18.247872 },
  { name: '喀什（新疆，接近西边界）', lng: 75.989863, lat: 39.470627 },
  { name: '香港（境内 bbox 内，会被偏移）', lng: 114.174006, lat: 22.293564 },
];

for (const { name, lng, lat } of SELF_CHOSEN_INLAND_POINTS) {
  test(`wgs84ToGcj02 ${name}（境内自选点）应发生合理量级的偏移`, () => {
    const result = wgs84ToGcj02(lng, lat);
    assertOffsetApplied(result, lng, lat, { minMagnitude: 1e-5, maxMagnitude: 0.02 });
  });
}

// ---------------------------------------------------------------------------
// 境内边界过渡：outOfChina 判定的四条边界，内侧应偏移、外侧应原样
// ---------------------------------------------------------------------------

const BOUNDARY_CASES = [
  { name: '纬度下界内侧 (lat=1.0 > 0.8293)', lng: 110, lat: 1.0, inside: true },
  { name: '纬度下界外侧 (lat=0.5 < 0.8293)', lng: 110, lat: 0.5, inside: false },
  { name: '纬度上界内侧 (lat=55.5 < 55.8271)', lng: 110, lat: 55.5, inside: true },
  { name: '纬度上界外侧 (lat=56.0 > 55.8271)', lng: 110, lat: 56.0, inside: false },
  { name: '经度下界内侧 (lng=72.5 > 72.004)', lng: 72.5, lat: 40, inside: true },
  { name: '经度下界外侧 (lng=71.5 < 72.004)', lng: 71.5, lat: 40, inside: false },
  { name: '经度上界内侧 (lng=137.5 < 137.8347)', lng: 137.5, lat: 40, inside: true },
  { name: '经度上界外侧 (lng=138.5 > 137.8347)', lng: 138.5, lat: 40, inside: false },
];

for (const { name, lng, lat, inside } of BOUNDARY_CASES) {
  test(`wgs84ToGcj02 境内/境外边界过渡 - ${name}`, () => {
    const result = wgs84ToGcj02(lng, lat);
    if (inside) {
      assertOffsetApplied(result, lng, lat, { minMagnitude: 1e-6, maxMagnitude: 0.02 });
    } else {
      assertIdentity(result, lng, lat);
    }
  });
}

// ---------------------------------------------------------------------------
// 中国境外多方向：一律原样返回，不加密
// ---------------------------------------------------------------------------

const OUT_OF_CHINA_POINTS = [
  { name: '纽约', lng: -74.005974, lat: 40.712776 },
  { name: '东京', lng: 139.6917, lat: 35.6895 },
  { name: '伦敦', lng: -0.1276, lat: 51.5072 },
  { name: '悉尼（南半球）', lng: 151.2093, lat: -33.8688 },
  { name: '赤道原点 (0,0)', lng: 0, lat: 0 },
  { name: '接近北极 (0,89)', lng: 0, lat: 89 },
];

for (const { name, lng, lat } of OUT_OF_CHINA_POINTS) {
  test(`wgs84ToGcj02 境外点 - ${name} 原样返回`, () => {
    const result = wgs84ToGcj02(lng, lat);
    assertIdentity(result, lng, lat);
  });
}

// ---------------------------------------------------------------------------
// 参数顺序误用：lat 落在无效范围时按境外判定原样返回，而不是额外强制校验报错
// ---------------------------------------------------------------------------

test('wgs84ToGcj02 lng/lat 颠倒调用时按越界判定原样返回、不抛错', () => {
  // 若把 (lat=39.9, lng=116.4) 误当成 (lng, lat) 传入，第二个参数 116.4 会被当作纬度，
  // 超出合法纬度范围 [0.8293, 55.8271]，函数应按“境外”处理，原样返回，而非抛出校验错误。
  const result = wgs84ToGcj02(39.9, 116.4);
  assertIdentity(result, 39.9, 116.4);
});

// ---------------------------------------------------------------------------
// 纯函数性质：确定性与调用间无共享状态
// ---------------------------------------------------------------------------

test('wgs84ToGcj02 相同输入多次调用返回完全一致的结果（确定性）', () => {
  const first = wgs84ToGcj02(116.397428, 39.90923);
  const second = wgs84ToGcj02(116.397428, 39.90923);
  assert.deepEqual(second, first);
});

test('wgs84ToGcj02 交替调用不同输入时互不影响（无共享状态）', () => {
  const beijing1 = wgs84ToGcj02(116.397428, 39.90923);
  const shanghai = wgs84ToGcj02(121.499718, 31.239703);
  const beijing2 = wgs84ToGcj02(116.397428, 39.90923);
  assert.deepEqual(
    beijing2,
    beijing1,
    'interleaved calls with a different input must not change the result for the original input'
  );
  assert.notDeepEqual(shanghai, beijing1);
});

// ---------------------------------------------------------------------------
// 返回结构：必须是含 lng/lat 数值字段的对象，不是数组
// ---------------------------------------------------------------------------

test('wgs84ToGcj02 返回值是含 lng/lat 数值字段的普通对象而非数组', () => {
  const result = wgs84ToGcj02(116.397428, 39.90923);
  assert.equal(Array.isArray(result), false, 'result must not be an array');
  assert.equal(typeof result, 'object');
  assert.equal(typeof result.lng, 'number');
  assert.equal(typeof result.lat, 'number');
});

// ---------------------------------------------------------------------------
// 非数字输入：一律抛出 TypeError
// ---------------------------------------------------------------------------

const INVALID_INPUTS = [
  { name: 'lng 为 NaN', lng: NaN, lat: 39.90923 },
  { name: 'lat 为 NaN', lng: 116.397428, lat: NaN },
  { name: 'lng 为 undefined', lng: undefined, lat: 39.90923 },
  { name: 'lat 为 undefined', lng: 116.397428, lat: undefined },
  { name: 'lng 为 null', lng: null, lat: 39.90923 },
  { name: 'lat 为 null', lng: 116.397428, lat: null },
  { name: 'lng 为字符串', lng: '116.397428', lat: 39.90923 },
  { name: 'lat 为字符串', lng: 116.397428, lat: '39.90923' },
];

for (const { name, lng, lat } of INVALID_INPUTS) {
  test(`wgs84ToGcj02 非数字输入抛出 TypeError - ${name}`, () => {
    assert.throws(() => wgs84ToGcj02(lng, lat), TypeError);
  });
}
