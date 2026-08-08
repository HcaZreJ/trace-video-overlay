// 界面层 · 时间真实模式：轨迹时间轴状态、模式切换的显隐联动、导出窗口取值。
// timeMode 是跨模块共享的可变状态：ui/preview 与 export/mp4 都读它，
// ES module 的导入绑定只读，所以挂成对象属性。
import { trackTimeRange, buildTimeIndex } from '../core/track-time.mjs';
import { clampMp4Duration, mp4Bitrate, estimateMp4Bytes, formatByteSize } from '../core/export-params.mjs';
import { streamSinkSupported, MP4_MAX_DURATION_STREAM, MP4_MAX_DURATION_MEMORY } from '../export/mp4-sink.mjs';
import { state } from '../state.mjs';
import { $ } from '../dom.mjs';

export const timeMode = {
  index: null,      // buildTimeIndex 的结果，null 表示当前轨迹没有可用时间轴
  range: null,      // trackTimeRange 的结果
  available: false, // 当前轨迹是否支持时间真实模式
};

const pad2 = (n) => String(n).padStart(2, '0');

// 毫秒时间戳 → datetime-local 的取值 `YYYY-MM-DDTHH:mm:ss`，按本地时区的时间分量拼。
function toLocalInputValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// datetime-local 的取值（不带时区后缀）→ 毫秒时间戳，按本地时区解析；解析不出为 NaN。
function parseLocalInputValue(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
    .exec(String(text == null ? '' : text).trim());
  if (!m) return NaN;
  const ms = m[7] ? +String(m[7]).padEnd(3, '0') : 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, ms).getTime();
}

// 秒数 → 人读时钟串：不足一小时 `M:SS`，超过则 `H:MM:SS`。
function formatClock(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return '—';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

// 轨迹变化（载入 / 删除 / 重排）后重算时间轴并同步可用性。
export function refreshTimeMode() {
  const points = state.trackPoints;
  const files = Array.isArray(state.trackFiles) ? state.trackFiles : [];

  // 各段在拼接后点序列里的起始索引：首段为 0，第 k 段为前 k 段点数之和。
  const segmentStarts = [];
  let acc = 0;
  for (const f of files) {
    segmentStarts.push(acc);
    acc += f && Array.isArray(f.points) ? f.points.length : 0;
  }

  timeMode.range = trackTimeRange(points);
  timeMode.index = buildTimeIndex(points, {
    segmentStarts,
    collapseSegmentGaps: $('mp4CollapseGaps').checked,
  });
  timeMode.available = timeMode.range !== null && timeMode.index !== null;

  const trueRadio = $('mp4TimeModeTrue');
  const hint = $('mp4TimeModeHint');
  if (timeMode.available) {
    trueRadio.disabled = false;
    hint.textContent = '';
    hint.style.display = 'none';
  } else {
    const empty = !Array.isArray(points) || points.length === 0;
    trueRadio.disabled = true;
    if (trueRadio.checked) {
      trueRadio.checked = false;
      $('mp4TimeModeEven').checked = true;
    }
    hint.textContent = empty
      ? '先载入轨迹'
      : timeMode.range === null
        ? '这条轨迹的点不带时间戳，只能按距离匀速导出'
        : '这条轨迹带时间戳的点不足两个，只能按距离匀速导出';
    hint.style.display = '';
  }

  // 段间空隙只在多文件拼接时才存在。
  $('mp4CollapseGapsField').style.display = files.length > 1 ? '' : 'none';

  if (timeMode.available) {
    // 界面窗口按 timeMode.index 的端点取值：折叠开启后实际生效的是折叠过的时间轴，
    // 被折叠掉的空隙不该出现在可选范围里。
    const startText = toLocalInputValue(timeMode.index.startMs);
    const endText = toLocalInputValue(timeMode.index.endMs);
    const startEl = $('mp4TimeStart');
    const endEl = $('mp4TimeEnd');
    startEl.min = startText;
    startEl.max = endText;
    startEl.value = startText;
    endEl.min = startText;
    endEl.max = endText;
    endEl.value = endText;
  }
}

// radio 选中与轨迹可用两者都真才算时间真实模式：轨迹换成不带时间戳的之后，
// 即便 radio 还留在 true 上也回落到按距离匀速。
export function isTimeTrueMode() {
  return !!($('mp4TimeModeTrue').checked && timeMode.available);
}

// 两种模式的参数面板互斥显示，并共用画质与体积估算。
// 这里只改 style.display，不碰任何 disabled——可用性与显隐是两条互不相交的通道。
export function updateTimeModeUI() {
  const timeTrue = isTimeTrueMode();
  $('mp4TrueFields').style.display = timeTrue ? '' : 'none';
  $('mp4EvenFields').style.display = timeTrue ? 'none' : '';
  // .seg-opt 的选中态纯 JS 驱动，样式表里没有 :checked 兜底规则。
  $('mp4TimeModeEvenLabel')?.classList.toggle('active', !timeTrue);
  $('mp4TimeModeTrueLabel')?.classList.toggle('active', timeTrue);

  // 上限随流式可用性变化，与实际导出取同一个值。
  const maxDurationSec = streamSinkSupported() ? MP4_MAX_DURATION_STREAM : MP4_MAX_DURATION_MEMORY;
  let durationSec;  // 提示语里的视频时长：照实说，超限与否由下面的说明文案表达
  let sizeSec;      // 体积估算用的时长：与实际导出一致地按上限夹取
  if (timeTrue) {
    const win = currentExportWindow();
    if (win) {
      const realSec = (win.endMs - win.startMs) / 1000;
      durationSec = realSec / win.scale;
      sizeSec = clampMp4Duration(durationSec, maxDurationSec);
      $('mp4TrueDurationHint').textContent =
        `视频时长 ${formatClock(durationSec)} · 真实时间 ${formatClock(realSec)}`;
    } else {
      durationSec = 0;
      sizeSec = 0;
      $('mp4TrueDurationHint').textContent = '视频时长 —（起止时刻无效，请调整时间范围）';
    }
  } else {
    durationSec = clampMp4Duration(+$('mp4Duration').value, maxDurationSec);
    sizeSec = durationSec;
  }

  // 分辨率经 + 转成数值：mp4Bitrate 按数值查表，字符串会落进「size 非法」分支。
  const bitrate = mp4Bitrate(+$('exportRes').value, $('mp4Quality').value);
  let sizeText = `预计文件大小 ≈ ${formatByteSize(estimateMp4Bytes(sizeSec, bitrate))}`;
  if (timeTrue && durationSec > MP4_MAX_DURATION_MEMORY && !streamSinkSupported()) {
    sizeText += `（当前浏览器一次最多导出 ${MP4_MAX_DURATION_MEMORY} 秒，请缩小时间范围或调大时间缩放）`;
  }
  $('mp4SizeHint').textContent = sizeText;
}

// 界面上的起止时刻 → 导出窗口；非时间真实模式或时刻无效时为 null。
export function currentExportWindow() {
  if (!isTimeTrueMode()) return null;
  const range = timeMode.range;
  if (!range) return null;
  // 边界取折叠后实际生效的那条时间轴，与 buildTimeTruePlan 的 clamp 基准一致。
  const index = timeMode.index || {};
  const lowMs = Number.isFinite(index.startMs) ? index.startMs : range.startMs;
  const highMs = Number.isFinite(index.endMs) ? index.endMs : range.endMs;

  let startMs = parseLocalInputValue($('mp4TimeStart').value);
  let endMs = parseLocalInputValue($('mp4TimeEnd').value);
  if (!Number.isFinite(startMs)) startMs = lowMs;
  if (!Number.isFinite(endMs)) endMs = highMs;
  startMs = Math.min(Math.max(startMs, lowMs), highMs);
  endMs = Math.min(Math.max(endMs, lowMs), highMs);
  if (startMs >= endMs) return null;

  let scale = +$('mp4TimeScale').value;
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  let fps = +$('mp4TrueFps').value;
  if (!Number.isFinite(fps) || fps <= 0) fps = 30;

  return { startMs, endMs, scale, fps, collapseSegmentGaps: !!$('mp4CollapseGaps').checked };
}
