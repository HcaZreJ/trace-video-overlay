// ==================== 导出元数据：文件名编码与 sidecar ====================
// 跨 repo 消费契约的物理载体：MP4 文件名编码 _t<epochSec>_s<scale>，
// 同名 .json sidecar 记录完整参数供 roughcut 的 render_pip.py 读取。

const SIDECAR_SCHEMA = 'trace-video-overlay/time-true-export@1';

// buildTimeTrueFilename：轨迹动画_t<epochSec>_s<scaleStr>.<ext>
export function buildTimeTrueFilename(t0Ms, scale, ext) {
  if (!Number.isFinite(t0Ms)) {
    throw new RangeError('buildTimeTrueFilename: t0Ms must be a finite number');
  }
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('buildTimeTrueFilename: scale must be a positive finite number');
  }
  if (typeof ext !== 'string' || ext.length === 0) {
    throw new TypeError('buildTimeTrueFilename: ext must be a non-empty string');
  }
  const epochSec = Math.floor(t0Ms / 1000);
  const scaleStr = String(scale);
  return `轨迹动画_t${epochSec}_s${scaleStr}.${ext}`;
}

// buildSidecarMeta：同名 .json sidecar 的字段集，字段名是跨 repo 契约。
export function buildSidecarMeta(meta) {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    throw new TypeError('buildSidecarMeta: meta must be an object');
  }
  if (!Number.isFinite(meta.t0Ms)) {
    throw new RangeError('buildSidecarMeta: t0Ms must be a finite number');
  }
  const toIso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  return {
    schema: SIDECAR_SCHEMA,
    t0Epoch: Math.floor(meta.t0Ms / 1000),
    t0Iso: new Date(meta.t0Ms).toISOString(),
    scale: meta.scale,
    fps: meta.fps,
    durationSec: meta.durationSec,
    frames: meta.frames,
    resolution: meta.resolution,
    quality: meta.quality,
    bitrate: meta.bitrate,
    trackStartIso: toIso(meta.trackStartMs),
    trackEndIso: toIso(meta.trackEndMs),
    sourceFiles: Array.isArray(meta.sourceFiles) ? meta.sourceFiles.slice() : [],
    collapsedSegmentGaps: Boolean(meta.collapsedSegmentGaps),
  };
}
