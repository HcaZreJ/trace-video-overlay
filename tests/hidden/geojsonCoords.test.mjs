import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGeoJSONCoords } from '../../src/parse/geojson.mjs';

/**
 * 断言 actual 是点数组，且逐个与 expected 一致。
 * expected 元素带 `ele` key 时要求实际点**自有** `ele` key；
 * 不带时要求实际点**完全不存在** `ele` key（`Object.hasOwn` 判定，而非 `=== undefined`）。
 */
function assertPoints(actual, expected) {
  assert.ok(Array.isArray(actual), `expected an Array, got ${typeof actual}`);
  assert.equal(
    actual.length,
    expected.length,
    `point count mismatch: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
  );
  for (let i = 0; i < expected.length; i++) {
    const pt = actual[i];
    const exp = expected[i];
    assert.ok(pt && typeof pt === 'object', `point[${i}] must be an object, got ${pt}`);
    assert.equal(pt.lng, exp.lng, `point[${i}].lng mismatch`);
    assert.equal(pt.lat, exp.lat, `point[${i}].lat mismatch`);
    if (Object.hasOwn(exp, 'ele')) {
      assert.ok(Object.hasOwn(pt, 'ele'), `point[${i}] must own key 'ele'`);
      if (typeof exp.ele === 'number' && Number.isNaN(exp.ele)) {
        assert.ok(Number.isNaN(pt.ele), `point[${i}].ele must be NaN, got ${pt.ele}`);
      } else {
        assert.equal(pt.ele, exp.ele, `point[${i}].ele mismatch`);
      }
    } else {
      assert.equal(
        Object.hasOwn(pt, 'ele'),
        false,
        `point[${i}] must not own key 'ele', got ele=${pt.ele}`
      );
    }
  }
}

/** 构造一个最小的 LineString 几何对象。 */
function lineString(coordinates) {
  return { type: 'LineString', coordinates };
}

/** 构造一个最小的 MultiLineString 几何对象。 */
function multiLineString(coordinates) {
  return { type: 'MultiLineString', coordinates };
}

/** 构造一个包裹 geometry 的 Feature。 */
function feature(geometry) {
  return { type: 'Feature', properties: {}, geometry };
}

/** 构造一个 FeatureCollection。 */
function featureCollection(features) {
  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// falsy 输入：一律返回空数组
// ---------------------------------------------------------------------------

const FALSY_INPUTS = [
  { name: 'null', value: null },
  { name: 'undefined', value: undefined },
  { name: '数字 0', value: 0 },
  { name: '空字符串', value: '' },
  { name: 'false', value: false },
  { name: 'NaN', value: NaN },
];

for (const { name, value } of FALSY_INPUTS) {
  test(`geojsonCoords: falsy 输入返回空数组 - ${name}`, () => {
    const out = extractGeoJSONCoords(value);
    assert.ok(Array.isArray(out), `expected an Array, got ${typeof out}`);
    assertPoints(out, []);
  });
}

// ---------------------------------------------------------------------------
// 无关对象：不含 type/features/geometry/geometries 时产出零点
// ---------------------------------------------------------------------------

test('geojsonCoords: 空对象与非折线 type 产出零点', () => {
  assertPoints(extractGeoJSONCoords({}), []);
  assertPoints(extractGeoJSONCoords({ type: 'Point', coordinates: [1, 2] }), []);
  assertPoints(extractGeoJSONCoords({ type: 'Polygon', coordinates: [[[1, 2], [3, 4]]] }), []);
  assertPoints(extractGeoJSONCoords(feature(null)), []);
});

// ---------------------------------------------------------------------------
// LineString 正常路径
// ---------------------------------------------------------------------------

test('geojsonCoords: 顶层 LineString 按顺序产出全部二维点', () => {
  const out = extractGeoJSONCoords(
    lineString([
      [-122.4, 37.8],
      [0, 0],
      [180, -90],
      [116.397428, 39.90923],
    ])
  );
  assertPoints(out, [
    { lng: -122.4, lat: 37.8 },
    { lng: 0, lat: 0 },
    { lng: 180, lat: -90 },
    { lng: 116.397428, lat: 39.90923 },
  ]);
});

test('geojsonCoords: LineString 的 coordinates 为空数组时产出零点', () => {
  assertPoints(extractGeoJSONCoords(lineString([])), []);
});

// ---------------------------------------------------------------------------
// MultiLineString 正常路径
// ---------------------------------------------------------------------------

test('geojsonCoords: MultiLineString 按线序、线内点序扁平化产出', () => {
  const out = extractGeoJSONCoords(
    multiLineString([
      [
        [1, 1],
        [2, 2],
      ],
      [
        [3, 3],
        [4, 4],
        [5, 5],
      ],
    ])
  );
  assertPoints(out, [
    { lng: 1, lat: 1 },
    { lng: 2, lat: 2 },
    { lng: 3, lat: 3 },
    { lng: 4, lat: 4 },
    { lng: 5, lat: 5 },
  ]);
});

test('geojsonCoords: MultiLineString 的 coordinates 为空数组时产出零点', () => {
  assertPoints(extractGeoJSONCoords(multiLineString([])), []);
});

test('geojsonCoords: MultiLineString 各线的三维坐标分别带 ele', () => {
  const out = extractGeoJSONCoords(
    multiLineString([
      [
        [1, 1, 10],
        [2, 2],
      ],
      [[3, 3, -5]],
    ])
  );
  assertPoints(out, [
    { lng: 1, lat: 1, ele: 10 },
    { lng: 2, lat: 2 },
    { lng: 3, lat: 3, ele: -5 },
  ]);
});

// ---------------------------------------------------------------------------
// ele 的取舍：第三位必须是 number 才带 ele，key 的有无是硬约束
// ---------------------------------------------------------------------------

const ELE_PRESENT_CASES = [
  { name: '正整数 123', third: 123, expected: 123 },
  { name: '零 0', third: 0, expected: 0 },
  { name: '负数 -12.5', third: -12.5, expected: -12.5 },
  { name: '小数 0.5', third: 0.5, expected: 0.5 },
  { name: 'Infinity', third: Infinity, expected: Infinity },
  { name: '-Infinity', third: -Infinity, expected: -Infinity },
  { name: 'NaN（typeof 仍是 number）', third: NaN, expected: NaN },
];

for (const { name, third, expected } of ELE_PRESENT_CASES) {
  test(`geojsonCoords: 第三位为 number 时点带 ele - ${name}`, () => {
    const out = extractGeoJSONCoords(lineString([[1, 2, third]]));
    assertPoints(out, [{ lng: 1, lat: 2, ele: expected }]);
  });
}

const ELE_ABSENT_CASES = [
  { name: '字符串 "300"', third: '300' },
  { name: 'null', third: null },
  { name: 'undefined', third: undefined },
  { name: '布尔 true', third: true },
  { name: '布尔 false', third: false },
  { name: '对象 {}', third: {} },
  { name: '数组 [1]', third: [1] },
];

for (const { name, third } of ELE_ABSENT_CASES) {
  test(`geojsonCoords: 第三位非 number 时点不存在 ele key - ${name}`, () => {
    const out = extractGeoJSONCoords(lineString([[1, 2, third]]));
    assertPoints(out, [{ lng: 1, lat: 2 }]);
  });
}

test('geojsonCoords: 二维坐标产出的点不存在 ele key', () => {
  const [pt] = extractGeoJSONCoords(lineString([[7, 8]]));
  assert.equal(Object.hasOwn(pt, 'ele'), false, "2D coord must not produce an 'ele' key");
  assert.equal('ele' in pt, false, "'ele' must not be reachable via the 'in' operator either");
});

test('geojsonCoords: 坐标长度 > 3 时取第三位为 ele 并忽略其后元素', () => {
  const out = extractGeoJSONCoords(
    lineString([
      [1, 2, 30, 1700000000],
      [3, 4, 40, 1700000001, 'extra'],
    ])
  );
  assertPoints(out, [
    { lng: 1, lat: 2, ele: 30 },
    { lng: 3, lat: 4, ele: 40 },
  ]);
});

test('geojsonCoords: 产出的点仅含 lng/lat(/ele)，不携带额外 key', () => {
  const [twoD, threeD] = extractGeoJSONCoords(
    lineString([
      [1, 2],
      [3, 4, 5],
    ])
  );
  assert.deepEqual(Object.keys(twoD).sort(), ['lat', 'lng']);
  assert.deepEqual(Object.keys(threeD).sort(), ['ele', 'lat', 'lng']);
});

// ---------------------------------------------------------------------------
// 坐标长度不足：跳过该坐标，其余照常产出
// ---------------------------------------------------------------------------

test('geojsonCoords: 长度 < 2 的坐标被跳过，其余坐标照常产出', () => {
  const out = extractGeoJSONCoords(
    lineString([
      [],
      [1],
      [10, 20],
      [],
      [30, 40, 50],
      [2],
    ])
  );
  assertPoints(out, [
    { lng: 10, lat: 20 },
    { lng: 30, lat: 40, ele: 50 },
  ]);
});

test('geojsonCoords: 全部坐标长度不足时产出零点', () => {
  assertPoints(extractGeoJSONCoords(lineString([[], [1], []])), []);
  assertPoints(extractGeoJSONCoords(multiLineString([[[], [9]], [[]]])), []);
});

// ---------------------------------------------------------------------------
// 畸形 coordinates：非数组时不产点、不抛错
// ---------------------------------------------------------------------------

const BAD_COORDINATES = [
  { name: 'undefined', value: undefined },
  { name: 'null', value: null },
  { name: '对象 {}', value: {} },
  { name: '对象 {0:[1,2],length:1}', value: { 0: [1, 2], length: 1 } },
  { name: '字符串 "1,2"', value: '1,2' },
  { name: '数字 5', value: 5 },
  { name: 'true', value: true },
];

for (const { name, value } of BAD_COORDINATES) {
  test(`geojsonCoords: LineString 的 coordinates 非数组时不产点且不抛错 - ${name}`, () => {
    let out;
    assert.doesNotThrow(() => {
      out = extractGeoJSONCoords({ type: 'LineString', coordinates: value });
    });
    assertPoints(out, []);
  });

  test(`geojsonCoords: MultiLineString 的 coordinates 非数组时不产点且不抛错 - ${name}`, () => {
    let out;
    assert.doesNotThrow(() => {
      out = extractGeoJSONCoords({ type: 'MultiLineString', coordinates: value });
    });
    assertPoints(out, []);
  });
}

// ---------------------------------------------------------------------------
// 畸形 features / geometries：真值但非数组时跳过该分支
// ---------------------------------------------------------------------------

const TRUTHY_NON_ARRAY = [
  { name: '对象 {}', value: {} },
  { name: '字符串 "x"', value: 'x' },
  { name: '数字 123', value: 123 },
  { name: 'true', value: true },
  { name: '函数', value: () => {} },
];

for (const { name, value } of TRUTHY_NON_ARRAY) {
  test(`geojsonCoords: features 为真值但非数组时跳过且不抛错 - ${name}`, () => {
    let out;
    assert.doesNotThrow(() => {
      out = extractGeoJSONCoords({ type: 'FeatureCollection', features: value });
    });
    assertPoints(out, []);
  });

  test(`geojsonCoords: geometries 为真值但非数组时跳过且不抛错 - ${name}`, () => {
    let out;
    assert.doesNotThrow(() => {
      out = extractGeoJSONCoords({ type: 'GeometryCollection', geometries: value });
    });
    assertPoints(out, []);
  });
}

test('geojsonCoords: features 非数组但 geometry 有效时仍产出 geometry 的点', () => {
  const out = extractGeoJSONCoords({
    features: 'not-an-array',
    geometry: lineString([
      [1, 2, 3],
      [4, 5],
    ]),
  });
  assertPoints(out, [
    { lng: 1, lat: 2, ele: 3 },
    { lng: 4, lat: 5 },
  ]);
});

test('geojsonCoords: features 数组中混有 falsy 元素时跳过它们', () => {
  const out = extractGeoJSONCoords(
    featureCollection([
      null,
      feature(lineString([[1, 1]])),
      undefined,
      0,
      feature(lineString([[2, 2, 22]])),
      false,
    ])
  );
  assertPoints(out, [
    { lng: 1, lat: 1 },
    { lng: 2, lat: 2, ele: 22 },
  ]);
});

test('geojsonCoords: features 为空数组、geometries 为空数组时产出零点', () => {
  assertPoints(extractGeoJSONCoords(featureCollection([])), []);
  assertPoints(extractGeoJSONCoords({ type: 'GeometryCollection', geometries: [] }), []);
});

// ---------------------------------------------------------------------------
// 嵌套与组合结构
// ---------------------------------------------------------------------------

test('geojsonCoords: FeatureCollection 多 Feature 按 feature 顺序、线内点序展开', () => {
  const out = extractGeoJSONCoords(
    featureCollection([
      feature(
        lineString([
          [1, 1],
          [2, 2, 20],
        ])
      ),
      feature(
        multiLineString([
          [[3, 3, 30]],
          [
            [4, 4],
            [5, 5],
          ],
        ])
      ),
    ])
  );
  assertPoints(out, [
    { lng: 1, lat: 1 },
    { lng: 2, lat: 2, ele: 20 },
    { lng: 3, lat: 3, ele: 30 },
    { lng: 4, lat: 4 },
    { lng: 5, lat: 5 },
  ]);
});

test('geojsonCoords: GeometryCollection 内混放 LineString 与 MultiLineString', () => {
  const out = extractGeoJSONCoords({
    type: 'GeometryCollection',
    geometries: [
      lineString([
        [1, 1],
        [2, 2],
      ]),
      multiLineString([
        [[3, 3, 33]],
        [[4, 4]],
      ]),
      { type: 'Point', coordinates: [9, 9] },
      lineString([[5, 5, 0]]),
    ],
  });
  assertPoints(out, [
    { lng: 1, lat: 1 },
    { lng: 2, lat: 2 },
    { lng: 3, lat: 3, ele: 33 },
    { lng: 4, lat: 4 },
    { lng: 5, lat: 5, ele: 0 },
  ]);
});

test('geojsonCoords: Feature 的 geometry 为 GeometryCollection 时递归下钻', () => {
  const out = extractGeoJSONCoords(
    featureCollection([
      feature({
        type: 'GeometryCollection',
        geometries: [lineString([[1, 2, 3]]), lineString([[4, 5]])],
      }),
    ])
  );
  assertPoints(out, [
    { lng: 1, lat: 2, ele: 3 },
    { lng: 4, lat: 5 },
  ]);
});

test('geojsonCoords: FeatureCollection 内嵌 FeatureCollection 时深层递归', () => {
  const out = extractGeoJSONCoords(
    featureCollection([
      feature(lineString([[1, 1]])),
      featureCollection([
        feature(lineString([[2, 2, 20]])),
        featureCollection([feature(lineString([[3, 3]]))]),
      ]),
      feature(lineString([[4, 4, 40]])),
    ])
  );
  assertPoints(out, [
    { lng: 1, lat: 1 },
    { lng: 2, lat: 2, ele: 20 },
    { lng: 3, lat: 3 },
    { lng: 4, lat: 4, ele: 40 },
  ]);
});

test('geojsonCoords: 同时含 features 与 geometry 时两条路径的点都产出且 features 在前', () => {
  const out = extractGeoJSONCoords({
    features: [feature(lineString([[1, 1, 11]]))],
    geometry: lineString([[2, 2]]),
  });
  assertPoints(out, [
    { lng: 1, lat: 1, ele: 11 },
    { lng: 2, lat: 2 },
  ]);
});

test('geojsonCoords: 同一对象命中 LineString / features / geometry / geometries 时按 2→4→5→6 顺序产出', () => {
  const out = extractGeoJSONCoords({
    type: 'LineString',
    coordinates: [[1, 1, 10]],
    features: [lineString([[2, 2]])],
    geometry: lineString([[3, 3, 30]]),
    geometries: [lineString([[4, 4]])],
  });
  assertPoints(out, [
    { lng: 1, lat: 1, ele: 10 },
    { lng: 2, lat: 2 },
    { lng: 3, lat: 3, ele: 30 },
    { lng: 4, lat: 4 },
  ]);
});

test('geojsonCoords: MultiLineString 对象同时带 geometry 时两处的点都产出', () => {
  const out = extractGeoJSONCoords({
    type: 'MultiLineString',
    coordinates: [[[1, 1]], [[2, 2, 22]]],
    geometry: multiLineString([[[3, 3]]]),
  });
  assertPoints(out, [
    { lng: 1, lat: 1 },
    { lng: 2, lat: 2, ele: 22 },
    { lng: 3, lat: 3 },
  ]);
});

test('geojsonCoords: geometry 链式嵌套（geometry.geometry.LineString）逐层下钻', () => {
  const out = extractGeoJSONCoords({
    geometry: { geometry: lineString([[1, 2, 3], [4, 5]]) },
  });
  assertPoints(out, [
    { lng: 1, lat: 2, ele: 3 },
    { lng: 4, lat: 5 },
  ]);
});

// ---------------------------------------------------------------------------
// 规模、纯度与确定性
// ---------------------------------------------------------------------------

test('geojsonCoords: 大规模坐标（1000 点）全部按序产出且 ele 正确', () => {
  const coords = [];
  for (let i = 0; i < 1000; i++) {
    coords.push(i % 2 === 0 ? [i, i + 0.5, i * 2] : [i, i + 0.5]);
  }
  const out = extractGeoJSONCoords(lineString(coords));
  assert.equal(out.length, 1000);
  assert.equal(out[0].lng, 0);
  assert.equal(out[0].lat, 0.5);
  assert.equal(out[0].ele, 0);
  assert.equal(Object.hasOwn(out[1], 'ele'), false, 'odd-index 2D coord must not own ele');
  assert.equal(out[999].lng, 999);
  assert.equal(out[999].lat, 999.5);
  assert.equal(Object.hasOwn(out[999], 'ele'), false);
  assert.equal(out[998].ele, 1996);
});

test('geojsonCoords: 不改动输入对象（纯函数）', () => {
  const geojson = featureCollection([
    feature(
      lineString([
        [1, 2, 3],
        [4, 5],
      ])
    ),
  ]);
  const snapshot = JSON.stringify(geojson);
  extractGeoJSONCoords(geojson);
  assert.equal(JSON.stringify(geojson), snapshot, 'input GeoJSON must not be mutated');
});

test('geojsonCoords: 重复调用结果一致且每次返回全新数组（无共享累积状态）', () => {
  const geojson = featureCollection([
    feature(
      lineString([
        [1, 2, 3],
        [4, 5],
      ])
    ),
  ]);
  const first = extractGeoJSONCoords(geojson);
  const second = extractGeoJSONCoords(geojson);
  assert.deepEqual(second, first, 'repeated calls must yield equal results');
  assert.notEqual(second, first, 'each call must return a fresh array instance');
  assert.equal(second.length, 2, 'results must not accumulate across calls');

  // 交替调用不同输入互不影响
  const other = extractGeoJSONCoords(lineString([[9, 9]]));
  assert.equal(other.length, 1);
  const third = extractGeoJSONCoords(geojson);
  assert.deepEqual(third, first);
});
