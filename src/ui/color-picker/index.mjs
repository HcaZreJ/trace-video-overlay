// 界面层 · 自定义取色器 · 装配入口：界面状态、状态同步链路、色块与 popup 的接线。
// 这里的 state 是取色器自身的界面状态（当前颜色、拖拽中的滑块、popup 内的元素引用），
// 与 src/state.mjs 的应用状态互不相干；对外以 pickerState 之名供同目录的兄弟模块使用。
import { parseHex, formatHex, rgbToHsv, hsvToRgb } from '../../core/color.mjs';
import { buildPopup, positionPopup } from './popup.mjs';
import { drawSvPanel, drawHueBar, updateCursors, updateSwatchPreview } from './canvas.mjs';
import { readSavedMode, renderMode, updateInputs, setPickerMode } from './inputs.mjs';

const COLOR_INPUT_IDS = ['bgColor','lineColor','startColor','endColor','dotColor','mp4PageColor','mp4GreenColor'];
export const SV_W = 236, SV_H = 160, HUE_W = 236, HUE_H = 12;

const state = {
  popup: null,
  svCanvas: null, svCtx: null, svCursor: null,
  hueCanvas: null, hueCtx: null, hueCursor: null,
  swatchPreview: null,
  modeTabs: null,
  inputsWrap: null,
  eyedropperBtn: null,
  targetInput: null,
  swatch: null,
  mode: 'hex',
  currentRgb: { r: 0, g: 0, b: 0 },
  currentHsv: { h: 0, s: 0, v: 0 },
  dragging: null,
  open: false,
};
export { state as pickerState };

function ensurePopup(){ if (!state.popup) buildPopup(); }

function applyState(opts){
  const skipInputs = opts && opts.skipInputs;
  drawSvPanel();
  updateCursors();
  updateSwatchPreview();
  if (!skipInputs) updateInputs();
  const hex = formatHex(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
  if (state.swatch) state.swatch.style.background = hex;
  if (state.targetInput) {
    state.targetInput.value = hex;
    state.targetInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function syncFromRgb(rgb, opts){
  const r = Math.max(0, Math.min(255, Math.round(rgb.r)));
  const g = Math.max(0, Math.min(255, Math.round(rgb.g)));
  const b = Math.max(0, Math.min(255, Math.round(rgb.b)));
  state.currentRgb = { r, g, b };
  const hsv = rgbToHsv(r, g, b);
  if (hsv.s > 0) state.currentHsv.h = hsv.h;
  state.currentHsv.s = hsv.s;
  state.currentHsv.v = hsv.v;
  applyState(opts);
}

export function syncFromHsv(hsv, opts){
  const h = ((hsv.h % 360) + 360) % 360;
  const s = Math.max(0, Math.min(1, hsv.s));
  const v = Math.max(0, Math.min(1, hsv.v));
  state.currentHsv = { h, s, v };
  state.currentRgb = hsvToRgb(h, s, v);
  applyState(opts);
}

function openPicker(targetInput, swatch){
  ensurePopup();
  state.targetInput = targetInput;
  state.swatch = swatch;
  state.open = true;
  state.mode = readSavedMode();
  let rgb;
  try { rgb = parseHex(targetInput.value); } catch (_) { rgb = { r: 0, g: 0, b: 0 }; }
  state.currentRgb = { r: rgb.r, g: rgb.g, b: rgb.b };
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  state.currentHsv = { h: hsv.h, s: hsv.s, v: hsv.v };
  state.popup.hidden = false;
  renderMode();
  drawHueBar();
  drawSvPanel();
  positionPopup();
  updateCursors();
  updateSwatchPreview();
}

export function closePicker(commit){
  if (!state.open) return;
  const doCommit = commit !== false;
  state.popup.hidden = true;
  state.open = false;
  const t = state.targetInput;
  state.targetInput = null;
  state.swatch = null;
  state.dragging = null;
  if (doCommit && t) {
    t.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function initColorPickers(){
  COLOR_INPUT_IDS.forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    if (input.dataset.cpWired === '1') return;
    input.dataset.cpWired = '1';
    input.classList.add('native-color-hidden');
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'cp-swatch';
    swatch.dataset.cpTarget = id;
    swatch.style.background = input.value;
    const aria = input.getAttribute('aria-label');
    swatch.setAttribute('aria-label', (aria || id) + ' 选色');
    swatch.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (state.open && state.targetInput === input) { closePicker(true); return; }
      if (state.open) closePicker(true);
      openPicker(input, swatch);
    });
    input.parentNode.insertBefore(swatch, input);
    // Sync swatch background when downstream code programmatically changes input.value
    input.addEventListener('input', () => { swatch.style.background = input.value; });
  });
}

// 浏览器手测钩子
window.__cpInit = initColorPickers;
window.__cpOpen = openPicker;
window.__cpClose = closePicker;
window.__cpSetMode = setPickerMode;
