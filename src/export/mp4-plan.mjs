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
  throw new Error('NotImplementedError: resolveExportPlan');
}

export function frameProgress(plan, i) {
  throw new Error('NotImplementedError: frameProgress');
}

export function formatEta(remainingSec) {
  throw new Error('NotImplementedError: formatEta');
}

export function buildExportSidecar(plan, extra) {
  throw new Error('NotImplementedError: buildExportSidecar');
}
