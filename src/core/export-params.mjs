// ==================== 定位点几何 / MP4 参数 ====================
// dotGeometry：以「彩色核直径」为唯一尺寸语义，导出定位点绘制所需的全部几何量。
export function dotGeometry(size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    throw new RangeError('dotGeometry: size must be a positive finite number');
  }
  const coreR = size / 2;
  const ringW = size * 0.15;
  const outerR = coreR + ringW;
  const shadowBlur = size * 0.104;
  const shadowOffsetY = size * 0.026;
  const pad = Math.ceil(size * 0.26);
  const full = size + 2 * pad;
  return { coreR, ringW, outerR, pad, full, shadowBlur, shadowOffsetY };
}

// clampMp4Duration：MP4 导出时长的合法化（[1,600] 秒，非法输入回默认 6）。
export function clampMp4Duration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 6;
  return Math.min(600, Math.max(1, value));
}
