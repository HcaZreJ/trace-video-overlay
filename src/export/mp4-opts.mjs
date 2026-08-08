// 导出层 · MP4 帧参数：renderFrame 的 opts 快照（含预投影）与时间真实的帧时刻映射。
// 预投影让逐帧渲染不必重算轨迹投影——一次导出可达数十万帧，这是主要热点。
import { projectTrack } from '../core/geo.mjs';
import { computeOverlayScale, projectTrackOnAmap } from '../core/amap.mjs';
import { buildTimeIndex } from '../core/track-time.mjs';
import { state, CARD_SIZE } from '../state.mjs';
import { $ } from '../dom.mjs';

export function buildFrameOpts({ skipBasemap, size }) {
  // skipBasemap 时整组地图字段直接取缺省值，调用方无需临时改写 window.mapOverlayState
  const overlay = skipBasemap ? null : window.mapOverlayState;
  const opts = {
    radius: +$('radius').value,
    pad: +$('pad').value,
    lineWidth: +$('lineWidth').value,
    bgMode: $('mp4BgMode').value,
    pageColor: $('mp4PageColor').value,
    greenColor: $('mp4GreenColor').value,
    bgColor: $('bgColor').value,
    bgOpacity: +$('bgOpacity').value / 100,
    lineColor: $('lineColor').value,
    showMarkers: $('showMarkers').checked,
    markerSize: +$('markerSize').value,
    startColor: $('startColor').value,
    endColor: $('endColor').value,
    dotColor: $('dotColor').value,
    dotSize: +$('dotSize').value,
    basemapImage: overlay ? overlay.basemapImage : null,
    mapCenter: overlay ? overlay.mapCenter : null,
    mapZoom: overlay ? overlay.mapZoom : null,
    spanPx: overlay ? overlay.spanPx : 0,
    contentSize: overlay ? overlay.contentSize : 1024,
    viewScale: overlay ? overlay.viewScale : 1,
    overlayMode: overlay ? overlay.overlayMode : 'none',
    overlayMaskOpacity: overlay ? overlay.overlayMaskOpacity : 0,
    proj: null,
  };

  // 投影在整个导出期间是常量，预先算一次；分支条件与 renderFrame 逐字对应
  const points = state.trackPoints;
  if (points && points.length > 0) {
    const padPx = opts.pad * size / CARD_SIZE;
    if (opts.bgMode !== 'green' && opts.basemapImage) {
      const k = computeOverlayScale(opts.spanPx, size, padPx, opts.viewScale);
      opts.proj = projectTrackOnAmap(points, size, opts.mapCenter, opts.mapZoom, k);
    } else {
      opts.proj = projectTrack(points, size - 2 * padPx);
    }
  }
  return opts;
}

export function buildTimeTruePlan(params) {
  if (!params || typeof params !== 'object') {
    throw new TypeError('buildTimeTruePlan: params must be an object');
  }
  const { points, segmentStarts, collapseSegmentGaps, startMs, endMs, scale, fps } = params;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('buildTimeTruePlan: scale must be a positive finite number');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('buildTimeTruePlan: fps must be a positive finite number');
  }

  const index = buildTimeIndex(points, { segmentStarts, collapseSegmentGaps });
  if (!index) return null;

  const clamp = (v, fallback) => (
    Number.isFinite(v) ? Math.min(index.endMs, Math.max(index.startMs, v)) : fallback
  );
  const t0Ms = clamp(startMs, index.startMs);
  const t1Ms = clamp(endMs, index.endMs);
  if (t1Ms <= t0Ms) return null;

  const durationSec = (t1Ms - t0Ms) / 1000 / scale;
  const frames = Math.max(1, Math.round(durationSec * fps));
  // 动画第 x 秒对应真实时刻 t0 + x * scale * 1000，第 0 帧严格落在窗口起点
  const frameTimeMs = (i) => t0Ms + (i / fps) * scale * 1000;

  return { index, t0Ms, t1Ms, durationSec, frames, frameTimeMs };
}
