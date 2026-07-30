// ==================== 纯文本 / CSV 坐标提取 ====================
export function extractTextCoords(text) {
  const lines = text.trim().split(/[\n\r]+/);
  const coords = [];
  for (const line of lines) {
    const parts = line.trim().split(/[,;\t\s]+/);
    if (parts.length >= 2) {
      const a = parseFloat(parts[0]), b = parseFloat(parts[1]);
      if (!isNaN(a) && !isNaN(b)) {
        // 纬度物理范围 [-90,90]，经度 [-180,180]。
        // 若某数 |.|>90 必为经度，据此定序；都在 [-90,90] 内则默认 "lat,lng"（最常见）。
        if (Math.abs(a) > 90) coords.push({ lng: a, lat: b });
        else if (Math.abs(b) > 90) coords.push({ lng: b, lat: a });
        else coords.push({ lng: b, lat: a });
      }
    }
  }
  return coords;
}
