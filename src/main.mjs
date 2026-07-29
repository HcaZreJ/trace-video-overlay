// 应用入口 · 装配：把界面各面板的行为接到 DOM 事件上，跑首屏初始化。
// 面板逻辑本身在 ui/ 下，这里只关心接线与初始化顺序。
import {
  parseHex,
  formatHex,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
} from './core/color.mjs';
import { clampMp4Duration } from './core/export-params.mjs';
import { fetchAmapBasemap } from './basemap/fetch.mjs';
import { state } from './state.mjs';
import { $ } from './dom.mjs';
import { updateExportKindUI } from './export/status.mjs';
import { exportCard, exportDot } from './export/png.mjs';
import { mp4Supported, onExpMp4Click } from './export/mp4.mjs';
import {
  previewPlaying,
  render,
  startPreviewPlay,
  stopPreviewPlay,
  updatePreviewScrubLabel,
} from './ui/preview.mjs';
import {
  setMapStatus,
  markOverlayNeedsRefresh,
  scheduleMapAutoFetch,
  onPreviewMapOverlay,
  updateBgModeUI,
  updateMapModeFieldsUI,
} from './ui/map-panel.mjs';
import { setTrackGate, loadTrackFiles, trackFileAction } from './ui/track-panel.mjs';
import { bind, initColorHexLabels } from './ui/controls.mjs';

// 地图 overlay 状态：null 表示未开启（默认）。开启时字段：
// { basemapImage, mapCenter, mapZoom, spanPx, contentSize, viewScale,
//   overlayMode: 'none'|'mask', overlayMaskOpacity: 0..1 }
// 挂在 window 上（而非纯 let 局部变量）便于浏览器控制台手测
window.mapOverlayState = null;

/* ==================== 事件绑定与首屏初始化 ==================== */
$('previewPlay').addEventListener('click', () => {
  if(previewPlaying) stopPreviewPlay(); else startPreviewPlay();
});
$('previewProgress').addEventListener('input', () => {
  if(previewPlaying) stopPreviewPlay();
  state.previewProgress = (+$('previewProgress').value) / 1000;
  render();
});
$('mapPreview').addEventListener('click', onPreviewMapOverlay);
const drop=$('drop');
drop.onclick=()=>$('file').click();
drop.addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){
    e.preventDefault();
    $('file').click();
  }
});
$('file').onchange=e=>{ if(e.target.files.length) loadTrackFiles(Array.from(e.target.files)); e.target.value=''; };
// 页面级拖放防御：dragover/drop 一律 preventDefault，避免拖到 #drop 以外（尤其预览画布）时
// 浏览器直接打开文件、丢光页面状态；drop 一律收敛到这一份逻辑处理，不与 #drop 重复触发。
const cardbox=document.querySelector('.cardbox');
// 空状态下画布本身就是第二个「载入轨迹」入口；有轨迹后画布只是预览，点击不再选文件
cardbox.addEventListener('click',()=>{ if(state.trackPoints) return; $('file').click(); });
const setDropHighlight=on=>{ drop.classList.toggle('over',on); cardbox.classList.toggle('over',on); };
const onDragHover=e=>{ e.preventDefault(); setDropHighlight(true); };
const onDragLeave=e=>{ e.preventDefault(); setDropHighlight(false); };
['dragover','dragenter'].forEach(ev=>{ window.addEventListener(ev,onDragHover); document.addEventListener(ev,onDragHover); });
window.addEventListener('dragleave',onDragLeave);
document.addEventListener('dragleave',onDragLeave);
window.addEventListener('drop',e=>e.preventDefault());
document.addEventListener('drop',e=>{
  e.preventDefault();
  setDropHighlight(false);
  if(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length) loadTrackFiles(Array.from(e.dataTransfer.files));
});
$('fileList').addEventListener('click',e=>{ const b=e.target.closest('button[data-act]'); if(b) trackFileAction(b.dataset.act,+b.dataset.i); });

bind('lineWidth','lineWidthV');
bind('bgOpacity','bgOpacityV');
bind('radius','radiusV');
bind('pad','padV');
bind('dotSize','dotSizeV');
bind('markerSize','markerSizeV');
bind('mapMaskOpacity','mapMaskOpacityV', v=>{ if(window.mapOverlayState) window.mapOverlayState.overlayMaskOpacity = v/100; });
bind('mapViewScale','mapViewScaleV', v=>{ if(window.mapOverlayState) window.mapOverlayState.viewScale = v; });
['lineColor','bgColor','startColor','endColor','dotColor','showMarkers'].forEach(id=>$(id).addEventListener('input',render));

initColorHexLabels();

$('expCard').onclick=exportCard;
$('expDot').onclick=exportDot;
$('expMp4').onclick=onExpMp4Click;
$('exportRes').addEventListener('change',render);
$('mp4Duration').addEventListener('input',updatePreviewScrubLabel);
$('mp4Duration').addEventListener('change',()=>{
  $('mp4Duration').value = clampMp4Duration(+$('mp4Duration').value);
  updatePreviewScrubLabel();
});
$('mp4BgMode').addEventListener('change',()=>{
  const green=$('mp4BgMode').value==='green';
  $('mp4PageColorField').style.display=green?'none':'';
  $('mp4GreenColorField').style.display=green?'':'none';
});
// 产物选择存 localStorage，页面加载时读回，缺省 png
$('exportKindMp4').checked = (()=>{ try { return localStorage.getItem('exportKind')==='mp4'; } catch(_){ return false; } })();
$('exportKindPng').checked = !$('exportKindMp4').checked;
document.querySelectorAll('input[name=exportKind]').forEach(el => el.addEventListener('change', updateExportKindUI));

// 地图 overlay 控件
// storage 被禁用（Safari 隐私模式、cookie 被阻断、跨站 iframe）时读写会抛，
// 这两处都在初始化路径上，不兜住会让后面的 setTrackGate / render 整段不执行。
const savedKey = (()=>{ try { return localStorage.getItem('amap_key') || ''; } catch(_){ return ''; } })();
$('amapKey').value = savedKey;
$('amapKey').addEventListener('input', () => {
  const trimmed = $('amapKey').value.trim();
  try {
    if(trimmed) localStorage.setItem('amap_key', trimmed);
    else localStorage.removeItem('amap_key');
  } catch(_){ /* storage 被禁用：key 只在本次会话有效 */ }
  markOverlayNeedsRefresh();
  scheduleMapAutoFetch();
});
$('mapTraffic').addEventListener('change', () => {
  markOverlayNeedsRefresh();
  scheduleMapAutoFetch();
});
$('mapOverlay').addEventListener('change', () => {
  const on = $('mapOverlay').checked;
  updateBgModeUI();
  $('amapKey').disabled = !on;
  $('mapTraffic').disabled = !on;
  $('mapMaskOpacity').disabled = !on;
  $('mapMaskOpacityV').disabled = !on;
  $('mapViewScale').disabled = !on;
  $('mapViewScaleV').disabled = !on;
  document.querySelectorAll('input[name=mapOverlayMode]').forEach(el => el.disabled = !on);
  $('mapPreview').disabled = !on;
  if(on){
    const key = ($('amapKey').value || '').trim();
    if(!state.trackPoints || state.trackPoints.length === 0){
      setMapStatus('请先载入轨迹', 'info');
    } else if(key){
      onPreviewMapOverlay();
    } else {
      setMapStatus('填写高德 key 后自动加载底图', 'info');
    }
  } else {
    window.mapOverlayState = null;
    state.mapOverlayNeedsRefresh = false;
    setMapStatus('', 'clear');
    render();
  }
});
document.querySelectorAll('input[name=bgMode]').forEach(el => {
  el.addEventListener('change', () => {
    const mapMode = $('bgModeMap').checked;
    $('mapOverlay').checked = mapMode;
    $('mapOverlay').dispatchEvent(new Event('change'));
  });
});
document.querySelectorAll('input[name=mapOverlayMode]').forEach(el => {
  el.addEventListener('change', () => {
    updateMapModeFieldsUI();
    if(window.mapOverlayState){
      window.mapOverlayState.overlayMode = document.querySelector('input[name=mapOverlayMode]:checked').value;
      render();
    }
  });
});
updateBgModeUI();
updateMapModeFieldsUI();
updateExportKindUI();
updatePreviewScrubLabel();
if(!mp4Supported()) $('mp4UnsupportedHint').style.display='';
setTrackGate(false);
window.addEventListener('resize', render);
render();
window.fetchAmapBasemap = fetchAmapBasemap; // for manual browser testing

/* ==================== 自定义 Color Picker ==================== */
(() => {
  const COLOR_INPUT_IDS = ['bgColor','lineColor','startColor','endColor','dotColor','mp4PageColor','mp4GreenColor'];
  const SV_W = 236, SV_H = 160, HUE_W = 236, HUE_H = 12;
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

  function readSavedMode(){
    try { const v = localStorage.getItem('colorPickerMode'); if(v==='hex'||v==='rgb'||v==='hsl') return v; } catch(_){}
    return 'hex';
  }

  function buildPopup(){
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

  function ensurePopup(){ if (!state.popup) buildPopup(); }

  function drawSvPanel(){
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

  function drawHueBar(){
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

  function updateCursors(){
    const svRect = state.svCanvas.getBoundingClientRect();
    const hueRect = state.hueCanvas.getBoundingClientRect();
    const svW = svRect.width || SV_W;
    const svH = svRect.height || SV_H;
    const hueW = hueRect.width || HUE_W;
    state.svCursor.style.left = (state.currentHsv.s * svW) + 'px';
    state.svCursor.style.top = ((1 - state.currentHsv.v) * svH) + 'px';
    state.hueCursor.style.left = ((state.currentHsv.h / 360) * hueW) + 'px';
  }

  function updateSwatchPreview(){
    const hex = formatHex(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
    state.swatchPreview.style.background = hex;
  }

  function renderMode(){
    state.modeTabs.querySelectorAll('.seg-opt').forEach(opt => {
      const radio = opt.querySelector('input[type=radio]');
      if (radio.value === state.mode) { opt.classList.add('active'); radio.checked = true; }
      else { opt.classList.remove('active'); radio.checked = false; }
    });
    const wrap = state.inputsWrap;
    wrap.innerHTML = '';
    if (state.mode === 'hex') {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.maxLength = 7;
      inp.className = 'cp-hex-input';
      inp.setAttribute('aria-label', 'HEX 颜色值');
      inp.value = formatHex(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
      inp.addEventListener('input', () => {
        let v = inp.value.trim();
        if (v && v[0] !== '#') v = '#' + v;
        try {
          const rgb = parseHex(v);
          inp.classList.remove('cp-invalid');
          syncFromRgb(rgb, { skipInputs: true });
        } catch (_) {
          inp.classList.add('cp-invalid');
        }
      });
      inp.addEventListener('blur', () => {
        inp.value = formatHex(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
        inp.classList.remove('cp-invalid');
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      wrap.appendChild(inp);
    } else if (state.mode === 'rgb') {
      ['R','G','B'].forEach((label, i) => {
        const key = ['r','g','b'][i];
        const g = document.createElement('div');
        g.className = 'cp-input-group';
        const lab = document.createElement('label');
        lab.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0'; inp.max = '255'; inp.step = '1';
        inp.setAttribute('aria-label', label + ' 分量');
        inp.value = state.currentRgb[key];
        inp.dataset.channel = key;
        inp.addEventListener('input', () => {
          let n = parseFloat(inp.value);
          if (!Number.isFinite(n)) return;
          n = Math.max(0, Math.min(255, Math.round(n)));
          const rgb = { r: state.currentRgb.r, g: state.currentRgb.g, b: state.currentRgb.b };
          rgb[key] = n;
          syncFromRgb(rgb, { skipInputs: true });
        });
        g.appendChild(lab); g.appendChild(inp); wrap.appendChild(g);
      });
    } else {
      const hsl0 = rgbToHsl(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
      ['H','S','L'].forEach((label, i) => {
        const key = ['h','s','l'][i];
        const g = document.createElement('div');
        g.className = 'cp-input-group';
        const lab = document.createElement('label');
        lab.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = '1';
        if (key === 'h') { inp.min = '0'; inp.max = '359'; }
        else { inp.min = '0'; inp.max = '100'; }
        inp.setAttribute('aria-label', label + ' 分量');
        inp.value = hsl0[key];
        inp.dataset.channel = key;
        inp.addEventListener('input', () => {
          let n = parseFloat(inp.value);
          if (!Number.isFinite(n)) return;
          const cur = rgbToHsl(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
          cur[key] = n;
          const rgb = hslToRgb(cur.h, cur.s, cur.l);
          if (key === 'h') state.currentHsv.h = ((n % 360) + 360) % 360;
          syncFromRgb(rgb, { skipInputs: true });
        });
        g.appendChild(lab); g.appendChild(inp); wrap.appendChild(g);
      });
    }
  }

  function updateInputs(){
    const wrap = state.inputsWrap;
    if (state.mode === 'hex') {
      const inp = wrap.querySelector('input');
      if (inp && document.activeElement !== inp) {
        inp.value = formatHex(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
        inp.classList.remove('cp-invalid');
      }
    } else if (state.mode === 'rgb') {
      wrap.querySelectorAll('input').forEach(inp => {
        if (document.activeElement === inp) return;
        inp.value = state.currentRgb[inp.dataset.channel];
      });
    } else {
      const hsl = rgbToHsl(state.currentRgb.r, state.currentRgb.g, state.currentRgb.b);
      wrap.querySelectorAll('input').forEach(inp => {
        if (document.activeElement === inp) return;
        inp.value = hsl[inp.dataset.channel];
      });
    }
  }

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

  function syncFromRgb(rgb, opts){
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

  function syncFromHsv(hsv, opts){
    const h = ((hsv.h % 360) + 360) % 360;
    const s = Math.max(0, Math.min(1, hsv.s));
    const v = Math.max(0, Math.min(1, hsv.v));
    state.currentHsv = { h, s, v };
    state.currentRgb = hsvToRgb(h, s, v);
    applyState(opts);
  }

  function setPickerMode(mode){
    if (mode !== 'hex' && mode !== 'rgb' && mode !== 'hsl') return;
    state.mode = mode;
    try { localStorage.setItem('colorPickerMode', mode); } catch (_) {}
    renderMode();
  }

  function positionPopup(){
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

  function closePicker(commit){
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

  function initColorPickers(){
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

  initColorPickers();
  window.__cpInit = initColorPickers;
  window.__cpOpen = openPicker;
  window.__cpClose = closePicker;
  window.__cpSetMode = setPickerMode;
})();

/* ==================== 示例轨迹 ==================== */
$('loadSample').addEventListener('click', async () => {
  try{
    const resp = await fetch('sample-ride.gpx');
    if(!resp.ok) throw new Error('sample fetch failed');
    const blob = await resp.blob();
    const file = new File([blob], 'sample-ride.gpx', { type: 'application/gpx+xml' });
    await loadTrackFiles([file]);
  }catch(err){
    console.error(err);
  }
});
(async () => {
  try{
    const resp = await fetch('sample-ride.gpx', { method: 'HEAD' });
    if(resp && resp.ok) $('loadSample').hidden = false;
  }catch(_){ /* file:// 或网络失败：保持隐藏 */ }
})();
