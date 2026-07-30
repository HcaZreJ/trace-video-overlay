// 界面层 · 取色器画布：SV 面板与色相条的绘制，以及游标位置、预览色块底色的刷新。
import { formatHex, hsvToRgb } from '../../core/color.mjs';
import { pickerState as state, SV_W, SV_H, HUE_W, HUE_H } from './index.mjs';

export function drawSvPanel(){
  const ctx = state.svCtx;
  const pure = hsvToRgb(state.currentHsv.h, 1, 1);
  ctx.fillStyle = 'rgb(' + pure.r + ',' + pure.g + ',' + pure.b + ')';
  ctx.fillRect(0, 0, SV_W, SV_H);
  const gradS = ctx.createLinearGradient(0, 0, SV_W, 0);
  gradS.addColorStop(0, 'rgba(255,255,255,1)');
  gradS.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradS;
  ctx.fillRect(0, 0, SV_W, SV_H);
  const gradV = ctx.createLinearGradient(0, 0, 0, SV_H);
  gradV.addColorStop(0, 'rgba(0,0,0,0)');
  gradV.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = gradV;
  ctx.fillRect(0, 0, SV_W, SV_H);
}

export function drawHueBar(){
  const ctx = state.hueCtx;
  const grad = ctx.createLinearGradient(0, 0, HUE_W, 0);
  grad.addColorStop(0, 'rgb(255,0,0)');
  grad.addColorStop(1/6, 'rgb(255,255,0)');
  grad.addColorStop(2/6, 'rgb(0,255,0)');
  grad.addColorStop(3/6, 'rgb(0,255,255)');
  grad.addColorStop(4/6, 'rgb(0,0,255)');
  grad.addColorStop(5/6, 'rgb(255,0,255)');
  grad.addColorStop(1, 'rgb(255,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, HUE_W, HUE_H);
}

export function updateCursors(){
  const svRect = state.svCanvas.getBoundingClientRect();
  const hueRect = state.hueCanvas.getBoundingClientRect();
  const svW = svRect.width || SV_W;
  const svH = svRect.height || SV_H;
  const hueW = hueRect.width || HUE_W;
  state.svCursor.style.left = (state.currentHsv.s * svW) + 'px';
  state.svCursor.style.top = ((1 - state.currentHsv.v) * svH) + 'px';
  state.hueCursor.style.left = ((state.currentHsv.h / 360) * hueW) + 'px';
}

export function updateSwatchPreview(){
  const hex = formatHex(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
  state.swatchPreview.style.background = hex;
}
