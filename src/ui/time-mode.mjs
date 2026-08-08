// 界面层 · 时间真实模式：轨迹时间轴状态、模式切换的显隐联动、导出窗口取值。
// timeMode 是跨模块共享的可变状态：ui/preview 与 export/mp4 都读它，
// ES module 的导入绑定只读，所以挂成对象属性。
import { trackTimeRange, buildTimeIndex } from '../core/track-time.mjs';
import { clampMp4Duration, mp4Bitrate, estimateMp4Bytes, formatByteSize } from '../core/export-params.mjs';
import { state } from '../state.mjs';
import { $ } from '../dom.mjs';

export const timeMode = {
  index: null,      // buildTimeIndex 的结果，null 表示当前轨迹没有可用时间轴
  range: null,      // trackTimeRange 的结果
  available: false, // 当前轨迹是否支持时间真实模式
};

export function refreshTimeMode() {
  throw new Error('NotImplementedError: refreshTimeMode');
}

export function isTimeTrueMode() {
  throw new Error('NotImplementedError: isTimeTrueMode');
}

export function updateTimeModeUI() {
  throw new Error('NotImplementedError: updateTimeModeUI');
}

export function currentExportWindow() {
  throw new Error('NotImplementedError: currentExportWindow');
}
