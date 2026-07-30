// 界面层 · 取色器 popup：DOM 结构构建、面板与色相条的指针事件接线、相对色块的定位。
import { parseHex } from '../../core/color.mjs';
import { pickerState as state, SV_W, SV_H, HUE_W, HUE_H, syncFromHsv, syncFromRgb, closePicker } from './index.mjs';
import { setPickerMode } from './inputs.mjs';

export function buildPopup(){
  const popup = document.createElement('div');
  popup.className = 'cp-popup';
  popup.setAttribute('role','dialog');
  popup.setAttribute('aria-label','颜色选择器');
  popup.hidden = true;
  popup.innerHTML =
    '<div class="cp-sv"><canvas class="cp-sv-canvas"></canvas><div class="cp-sv-cursor"></div></div>' +
    '<div class="cp-hue"><canvas class="cp-hue-canvas"></canvas><div class="cp-hue-cursor"></div></div>' +
    '<div class="cp-tools">' +
      '<button type="button" class="cp-eyedropper" title="吸管" aria-label="吸管取色">🎯</button>' +
      '<div class="cp-swatch-preview" aria-hidden="true"></div>' +
    '</div>' +
    '<div class="segmented cp-mode-tabs" role="radiogroup" aria-label="颜色表达模式">' +
      '<label class="seg-opt"><input type="radio" name="cp-mode" value="hex">HEX</label>' +
      '<label class="seg-opt"><input type="radio" name="cp-mode" value="rgb">RGB</label>' +
      '<label class="seg-opt"><input type="radio" name="cp-mode" value="hsl">HSL</label>' +
    '</div>' +
    '<div class="cp-inputs"></div>';
  document.body.appendChild(popup);

  state.popup = popup;
  state.svCanvas = popup.querySelector('.cp-sv-canvas');
  state.svCanvas.width = SV_W; state.svCanvas.height = SV_H;
  state.svCtx = state.svCanvas.getContext('2d');
  state.svCursor = popup.querySelector('.cp-sv-cursor');
  state.hueCanvas = popup.querySelector('.cp-hue-canvas');
  state.hueCanvas.width = HUE_W; state.hueCanvas.height = HUE_H;
  state.hueCtx = state.hueCanvas.getContext('2d');
  state.hueCursor = popup.querySelector('.cp-hue-cursor');
  state.swatchPreview = popup.querySelector('.cp-swatch-preview');
  state.modeTabs = popup.querySelector('.cp-mode-tabs');
  state.inputsWrap = popup.querySelector('.cp-inputs');
  state.eyedropperBtn = popup.querySelector('.cp-eyedropper');

  // Prevent focus loss inside popup from closing it
  popup.addEventListener('mousedown', (e) => {
    if (e.target === state.svCanvas || e.target === state.hueCanvas) return;
    // allow input focus but stop bubbling to document outside-click handler
    e.stopPropagation();
  });

  // SV panel drag
  const onSvPointer = (clientX, clientY) => {
    const rect = state.svCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const s = rect.width > 0 ? x / rect.width : 0;
    const v = rect.height > 0 ? 1 - y / rect.height : 1;
    syncFromHsv({ h: state.currentHsv.h, s, v });
  };
  state.svCanvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    state.dragging = 'sv';
    onSvPointer(e.clientX, e.clientY);
  });

  // Hue drag
  const onHuePointer = (clientX) => {
    const rect = state.hueCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const h = rect.width > 0 ? (x / rect.width) * 360 : 0;
    const clampedH = h >= 360 ? 359.999 : h;
    syncFromHsv({ h: clampedH, s: state.currentHsv.s, v: state.currentHsv.v });
  };
  state.hueCanvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    state.dragging = 'hue';
    onHuePointer(e.clientX);
  });

  document.addEventListener('mousemove', (e) => {
    if (state.dragging === 'sv') onSvPointer(e.clientX, e.clientY);
    else if (state.dragging === 'hue') onHuePointer(e.clientX);
  });
  document.addEventListener('mouseup', () => { state.dragging = null; });

  // Mode tabs
  state.modeTabs.addEventListener('change', (e) => {
    const r = e.target;
    if (r && r.name === 'cp-mode') setPickerMode(r.value);
  });

  // Eyedropper
  if ('EyeDropper' in window) {
    state.eyedropperBtn.style.display = '';
    state.eyedropperBtn.addEventListener('click', async () => {
      try {
        const result = await new window.EyeDropper().open();
        const rgb = parseHex(result.sRGBHex);
        syncFromRgb(rgb);
      } catch (_) { /* 用户取消或错误：安静返回 */ }
    });
  } else {
    state.eyedropperBtn.style.display = 'none';
  }

  // Outside click / ESC
  document.addEventListener('mousedown', (e) => {
    if (!state.open) return;
    if (state.popup.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.cp-swatch')) return;
    closePicker(true);
  });
  document.addEventListener('keydown', (e) => {
    if (state.open && e.key === 'Escape') { e.preventDefault(); closePicker(true); }
  });
  window.addEventListener('resize', () => { if (state.open) positionPopup(); });
  window.addEventListener('scroll', () => { if (state.open) positionPopup(); }, true);
}

export function positionPopup(){
  const popup = state.popup;
  const swatch = state.swatch;
  if (!swatch) return;
  const rect = swatch.getBoundingClientRect();
  popup.style.left = '0px'; popup.style.top = '0px';
  const popW = popup.offsetWidth;
  const popH = popup.offsetHeight;
  const gap = 6;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + gap;
  if (left - window.scrollX + popW > vw - 8) {
    left = rect.right + window.scrollX - popW;
  }
  if (left - window.scrollX < 8) left = window.scrollX + 8;
  if (top - window.scrollY + popH > vh - 8) {
    const above = rect.top + window.scrollY - popH - gap;
    if (above - window.scrollY > 8) top = above;
  }
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}
