// 导出层 · MP4 导出决策：读控件算出这次导出的全部参数，再由 mp4.mjs 接到编码循环上。
// 决策与编码循环分家，是为了让「这次导出到底导什么」这件事可以脱离 WebCodecs 单独验证。
import { progressAtTime } from '../core/track-time.mjs';
import { clampMp4Duration, mp4Bitrate } from '../core/export-params.mjs';
import { buildTimeTrueFilename, buildSidecarMeta } from '../core/export-meta.mjs';
import { streamSinkSupported, MP4_MAX_DURATION_STREAM, MP4_MAX_DURATION_MEMORY } from './mp4-sink.mjs';
import { buildTimeTruePlan } from './mp4-opts.mjs';
import { timeMode, isTimeTrueMode, currentExportWindow } from '../ui/time-mode.mjs';
import { state } from '../state.mjs';
import { $ } from '../dom.mjs';

export function resolveExportPlan() {
  // 分辨率经 + 转成数值：mp4Bitrate 按数值查表，字符串会落进「size 非法」分支。
  const size = +$('exportRes').value || 1080;
  const quality = $('mp4Quality').value;
  const bitrate = mp4Bitrate(size, quality);
  // 流式写盘把时长上限从内存容量里解放出来，两条路径的上限差一个量级。
  const preferStream = streamSinkSupported();
  const maxDurationSec = preferStream ? MP4_MAX_DURATION_STREAM : MP4_MAX_DURATION_MEMORY;
  const base = { size, quality, bitrate, maxDurationSec, preferStream };

  const win = isTimeTrueMode() ? currentExportWindow() : null;
  if (win) {
    // 各段在拼接后点序列里的起始索引：首段为 0，第 k 段为前 k 段点数之和。
    const files = Array.isArray(state.trackFiles) ? state.trackFiles : [];
    const segmentStarts = [];
    let acc = 0;
    for (const f of files) {
      segmentStarts.push(acc);
      acc += f && Array.isArray(f.points) ? f.points.length : 0;
    }
    const timePlan = buildTimeTruePlan({
      points: state.trackPoints,
      segmentStarts,
      collapseSegmentGaps: win.collapseSegmentGaps,
      startMs: win.startMs,
      endMs: win.endMs,
      scale: +$('mp4TimeScale').value,
      fps: +$('mp4TrueFps').value,
    });
    if (timePlan) {
      // 帧数按夹取后的时长重算：超上限时这次导出被截断，而不是溢出成装不下的文件。
      const durationSec = clampMp4Duration(timePlan.durationSec, maxDurationSec);
      return {
        ...base,
        mode: 'true',
        fps: win.fps,
        frames: Math.max(1, Math.round(durationSec * win.fps)),
        durationSec,
        suggestedName: buildTimeTrueFilename(timePlan.t0Ms, win.scale, 'mp4'),
        timePlan,
        t0Ms: timePlan.t0Ms,
        scale: win.scale,
      };
    }
  }

  const fps = Math.max(1, +$('mp4Fps').value || 30);
  const durationSec = clampMp4Duration(+$('mp4Duration').value, maxDurationSec);
  return {
    ...base,
    mode: 'even',
    fps,
    frames: Math.max(1, Math.round(durationSec * fps)),
    durationSec,
    suggestedName: '轨迹动画.mp4',
    timePlan: null,
    t0Ms: null,
    scale: 1,
  };
}

export function frameProgress(plan, i) {
  if (!plan) return 0;
  // 时间真实模式下进度由真实时刻决定：骑行者停下休息时连续多帧落在同一进度上。
  if (plan.mode === 'true') {
    const tp = plan.timePlan;
    return tp ? progressAtTime(tp.index, tp.frameTimeMs(i)) : 0;
  }
  return plan.frames > 1 ? i / (plan.frames - 1) : 0;
}

export function formatEta(remainingSec) {
  if (!Number.isFinite(remainingSec) || remainingSec < 0) return '';
  if (remainingSec < 60) return `剩余约 ${Math.ceil(remainingSec)} 秒`;
  if (remainingSec < 3600) {
    let min = Math.floor(remainingSec / 60);
    let sec = Math.round(remainingSec % 60);
    if (sec === 60) { min += 1; sec = 0; }
    return `剩余约 ${min} 分 ${sec} 秒`;
  }
  let hour = Math.floor(remainingSec / 3600);
  let min = Math.round((remainingSec % 3600) / 60);
  if (min === 60) { hour += 1; min = 0; }
  return `剩余约 ${hour} 小时 ${min} 分`;
}

export function buildExportSidecar(plan, extra) {
  if (!plan || plan.mode !== 'true' || !Number.isFinite(plan.t0Ms)) return null;
  const e = extra || {};
  return buildSidecarMeta({
    t0Ms: plan.t0Ms,
    scale: plan.scale,
    fps: plan.fps,
    durationSec: plan.durationSec,
    frames: plan.frames,
    resolution: plan.size,
    quality: plan.quality,
    bitrate: plan.bitrate,
    trackStartMs: e.trackStartMs,
    trackEndMs: e.trackEndMs,
    sourceFiles: e.sourceFiles,
    collapsedSegmentGaps: e.collapsedSegmentGaps,
  });
}
