// ==================== 轨迹时间轴：时刻 ↔ 进度换算 ====================
// 累计弧长一律用墨卡托平面距离，与 pointAtProgress 所用的画布像素弧长同度量：
// 画布坐标是墨卡托坐标的等比仿射变换，两者的弧长比例严格相等。
import { mercatorX, mercatorY } from './geo.mjs';

const hasTime = (p) => !!p && typeof p.time === 'number' && Number.isFinite(p.time);

export function trackTimeRange(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  let startMs = Infinity;
  let endMs = -Infinity;
  let anchorCount = 0;
  for (const p of points) {
    if (!hasTime(p)) continue;
    anchorCount++;
    if (p.time < startMs) startMs = p.time;
    if (p.time > endMs) endMs = p.time;
  }
  if (anchorCount === 0) return null;

  return {
    startMs,
    endMs,
    spanSec: (endMs - startMs) / 1000,
    anchorCount,
    totalCount: points.length,
  };
}

export function buildTimeIndex(points, opts) {
  if (!Array.isArray(points) || points.length < 2) return null;

  // 1. 全部点累计墨卡托平面弧长（缺时间戳的点同样贡献弧长）
  const cumLen = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] || {};
    const b = points[i] || {};
    const d = Math.hypot(mercatorX(b.lng) - mercatorX(a.lng), mercatorY(b.lat) - mercatorY(a.lat));
    cumLen.push(cumLen[i - 1] + d);
  }
  const totalLen = cumLen[points.length - 1];

  // 2. 带有效时间戳的点收集成锚点，保持索引顺序
  const anchors = [];
  for (let i = 0; i < points.length; i++) {
    if (hasTime(points[i])) anchors.push({ idx: i, time: points[i].time, len: cumLen[i] });
  }
  if (anchors.length === 0) return null;

  // 2.5 段间空隙折叠：每段首锚点接到上一段末锚点 + 1ms，整段及其后统一平移
  const segmentStarts = opts && opts.segmentStarts;
  if (Array.isArray(segmentStarts) && segmentStarts.length > 1 && opts.collapseSegmentGaps === true) {
    let segPtr = 0;
    let shift = 0;
    let prevSeg = -1;
    let prevTime = 0;
    for (const a of anchors) {
      while (segPtr + 1 < segmentStarts.length && segmentStarts[segPtr + 1] <= a.idx) segPtr++;
      if (prevSeg !== -1 && segPtr !== prevSeg) shift = prevTime + 1 - a.time;
      a.time += shift;
      prevSeg = segPtr;
      prevTime = a.time;
    }
  }

  // 3. 强制时间严格递增，倒退的锚点丢弃
  const anchorTimes = [];
  const anchorLens = [];
  let droppedCount = 0;
  for (const a of anchors) {
    if (anchorTimes.length === 0 || a.time > anchorTimes[anchorTimes.length - 1]) {
      anchorTimes.push(a.time);
      anchorLens.push(a.len);
    } else {
      droppedCount++;
    }
  }
  if (anchorTimes.length < 2) return null;

  return {
    anchorTimes,
    anchorLens,
    totalLen,
    startMs: anchorTimes[0],
    endMs: anchorTimes[anchorTimes.length - 1],
    droppedCount,
  };
}

export function progressAtTime(index, tMs) {
  if (!index) return 0;
  if (!(index.totalLen > 0)) return 0;
  if (!Number.isFinite(tMs)) return 0;
  if (tMs <= index.startMs) return 0;
  if (tMs >= index.endMs) return 1;

  const times = index.anchorTimes;
  const lens = index.anchorLens;
  if (!Array.isArray(times) || !Array.isArray(lens) || times.length < 2) return 0;

  // times[lo] <= tMs < times[lo + 1]
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= tMs) lo = mid; else hi = mid;
  }

  const span = times[lo + 1] - times[lo];
  const f = span > 0 ? (tMs - times[lo]) / span : 0;
  const len = lens[lo] + f * (lens[lo + 1] - lens[lo]);
  const progress = len / index.totalLen;
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

export function timeAtProgress(index, progress) {
  if (!index) return null;
  if (!(index.totalLen > 0)) return index.startMs;
  if (!Number.isFinite(progress)) return index.startMs;
  if (progress <= 0) return index.startMs;
  if (progress >= 1) return index.endMs;

  const times = index.anchorTimes;
  const lens = index.anchorLens;
  if (!Array.isArray(times) || !Array.isArray(lens) || times.length < 2) return index.startMs;

  const target = progress * index.totalLen;
  const last = lens.length - 1;
  if (lens[last] < target) return times[last];

  // 最小的 k 使 lens[k] >= target —— 平台上取最早的时间
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lens[mid] >= target) hi = mid; else lo = mid + 1;
  }
  if (lo === 0) return times[0];

  const span = lens[lo] - lens[lo - 1];
  const f = span > 0 ? (target - lens[lo - 1]) / span : 1;
  return times[lo - 1] + f * (times[lo] - times[lo - 1]);
}
