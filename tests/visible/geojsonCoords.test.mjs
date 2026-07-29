import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGeoJSONCoords } from '../../core.mjs';

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

test('geojsonCoords: FeatureCollection → Feature → LineString 的二维坐标按顺序产出且不带 ele', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [120.1, 30.1],
            [120.2, 30.2],
            [120.3, 30.3],
          ],
        },
      },
    ],
  };
  assertPoints(extractGeoJSONCoords(geojson), [
    { lng: 120.1, lat: 30.1 },
    { lng: 120.2, lat: 30.2 },
    { lng: 120.3, lat: 30.3 },
  ]);
});

test('geojsonCoords: 三维坐标产出带 ele 的点，二维坐标不带 ele key', () => {
  const geojson = {
    type: 'LineString',
    coordinates: [
      [1, 2, 300],
      [3, 4],
      [5, 6, 0],
    ],
  };
  assertPoints(extractGeoJSONCoords(geojson), [
    { lng: 1, lat: 2, ele: 300 },
    { lng: 3, lat: 4 },
    { lng: 5, lat: 6, ele: 0 },
  ]);
});

test('geojsonCoords: 输入为 null / undefined 时返回空数组', () => {
  assertPoints(extractGeoJSONCoords(null), []);
  assertPoints(extractGeoJSONCoords(undefined), []);
});
