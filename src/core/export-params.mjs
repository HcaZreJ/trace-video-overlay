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

const MP4_DURATION_DEFAULT = 6;
const MP4_DURATION_MIN = 1;
const MP4_DURATION_MAX_FALLBACK = 600;

const MP4_BITRATE_TABLE = {
  high: { 720: 6e6, 1080: 12e6, 1440: 20e6 },
  medium: { 720: 3e6, 1080: 6e6, 1440: 10e6 },
  low: { 720: 1.5e6, 1080: 3e6, 1440: 5e6 },
};

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

// clampMp4Duration：MP4 导出时长的合法化（下限 1 秒，上限由 maxSec 给出、缺省 600，
// 非法输入回默认 6）。
export function clampMp4Duration(value, maxSec) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MP4_DURATION_DEFAULT;
  const upper =
    typeof maxSec === 'number' && Number.isFinite(maxSec) && maxSec >= MP4_DURATION_MIN
      ? maxSec
      : MP4_DURATION_MAX_FALLBACK;
  return Math.min(Math.max(value, MP4_DURATION_MIN), upper);
}

// mp4Bitrate：分辨率 × 画质档位 → 码率（bps）。
export function mp4Bitrate(size, quality) {
  const col = size === 720 || size === 1080 || size === 1440 ? size : 1080;
  const row = quality === 'high' || quality === 'medium' || quality === 'low' ? quality : 'high';
  return MP4_BITRATE_TABLE[row][col];
}

// estimateMp4Bytes：时长 × 码率 → 预计文件字节数。
export function estimateMp4Bytes(durationSec, bitrate) {
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0) return 0;
  if (typeof bitrate !== 'number' || !Number.isFinite(bitrate) || bitrate < 0) return 0;
  return Math.ceil((durationSec * bitrate) / 8);
}

// formatByteSize：字节数 → 人类可读体积字符串。
export function formatByteSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${BYTE_UNITS[unit]}`;
}
