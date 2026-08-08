// 导出层 · MP4 帧参数：renderFrame 的 opts 快照（含预投影）与时间真实的帧时刻映射。
// 预投影让逐帧渲染不必重算轨迹投影——一次导出可达数十万帧，这是主要热点。
import { projectTrack } from '../core/geo.mjs';
import { computeOverlayScale, projectTrackOnAmap } from '../core/amap.mjs';
import { buildTimeIndex } from '../core/track-time.mjs';
import { state, CARD_SIZE } from '../state.mjs';
import { $ } from '../dom.mjs';

export function buildFrameOpts(options) {
  throw new Error('NotImplementedError: buildFrameOpts');
}

export function buildTimeTruePlan(params) {
  throw new Error('NotImplementedError: buildTimeTruePlan');
}
