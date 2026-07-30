// ==================== WGS84 → GCJ-02 坐标转换（国测局公式） ====================
// 用于国内地图底图（高德/腾讯/Google 中国）叠加：GPS 是 WGS84，国内地图渲染在 GCJ-02
// 加密坐标系，二者境内偏差 100-500m，必须做转换后再投到地图像素。
// 境外坐标不适用国测局偏移，原样返回。
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function gcjOutOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function gcjTransformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  ret += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return ret;
}

function gcjTransformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  ret += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return ret;
}

export function wgs84ToGcj02(lng, lat) {
  if (typeof lng !== 'number' || !Number.isFinite(lng) || typeof lat !== 'number' || !Number.isFinite(lat)) {
    throw new TypeError('wgs84ToGcj02: lng/lat must be finite numbers');
  }
  if (gcjOutOfChina(lng, lat)) return { lng, lat };

  const x = lng - 105, y = lat - 35;
  let dLat = gcjTransformLat(x, y);
  let dLng = gcjTransformLng(x, y);

  const radLat = lat * Math.PI / 180;
  const magic = 1 - GCJ_EE * Math.sin(radLat) * Math.sin(radLat);
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (GCJ_A / sqrtMagic * Math.cos(radLat) * Math.PI);

  return { lng: lng + dLng, lat: lat + dLat };
}
