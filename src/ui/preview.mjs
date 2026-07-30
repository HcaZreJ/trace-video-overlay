// 界面层 · 预览：卡片与定位点的实时预览渲染，以及扫拨条的动画播放。
// 播放态是本模块私有的，只有 previewPlaying 对外可读，供入口的播放按钮判断当前该起还是该停。
import { clampMp4Duration } from '../core/export-params.mjs';
import { renderCard } from '../render/card.mjs';
import { renderDot } from '../render/dot.mjs';
import { state, CARD_SIZE } from '../state.mjs';
import { $ } from '../dom.mjs';
import { setMapStatus } from './map-panel.mjs';

/* ==================== 渲染 ==================== */
export function render(){
  try {
    renderCard($('card'),CARD_SIZE,{previewDot:true, previewProgress: state.previewProgress});
  } catch(err) {
    console.error(err);
    setMapStatus(`渲染失败：${err.message}`,'error');
  }
  const dotExportPx = Math.round(+$('dotSize').value * (+$('exportRes').value||1080) / CARD_SIZE);
  renderDot($('dot'), dotExportPx);
  // 内联小预览：把 dotSize 的取值域 8–160 线性映射进 32px 棋盘格盒子（6–28px），随滑杆实时变化
  const dispPx = Math.round(6 + (+$('dotSize').value - 8) / (160 - 8) * (28 - 6));
  $('dot').style.width = $('dot').style.height = dispPx + 'px';
}

/* ==================== 动画预览播放（扫拨条所见即所得） ==================== */
export let previewPlaying = false;
let previewPlayRafId = null;
let previewPlayLastTs = null;
function previewPlayStep(ts){
  if(!previewPlaying) return;
  if(previewPlayLastTs !== null){
    const dt = ts - previewPlayLastTs;
    const durationMs = clampMp4Duration(+$('mp4Duration').value) * 1000;
    let p = state.previewProgress + dt / durationMs;
    p = p % 1;
    state.previewProgress = p;
    $('previewProgress').value = Math.round(state.previewProgress * 1000);
    render();
  }
  previewPlayLastTs = ts;
  previewPlayRafId = requestAnimationFrame(previewPlayStep);
}
export function startPreviewPlay(){
  if(previewPlaying) return;
  previewPlaying = true;
  previewPlayLastTs = null;
  $('previewPlay').textContent = '⏸';
  $('previewPlay').setAttribute('aria-pressed','true');
  previewPlayRafId = requestAnimationFrame(previewPlayStep);
}
export function stopPreviewPlay(){
  previewPlaying = false;
  if(previewPlayRafId !== null){ cancelAnimationFrame(previewPlayRafId); previewPlayRafId = null; }
  previewPlayLastTs = null;
  $('previewPlay').textContent = '▶';
  $('previewPlay').setAttribute('aria-pressed','false');
}
export function updatePreviewScrubLabel(){
  $('previewScrubLabel').textContent = `动画预览 · ${clampMp4Duration(+$('mp4Duration').value)} 秒`;
}
