// 界面层 · 取色器数值输入：HEX/RGB/HSL 三段输入框的渲染与回填，模式切换记忆于 localStorage。
import { parseHex, formatHex, rgbToHsl, hslToRgb } from '../../core/color.mjs';
import { pickerState as state, syncFromRgb } from './index.mjs';

export function readSavedMode(){
  try { const v = localStorage.getItem('colorPickerMode'); if(v==='hex'||v==='rgb'||v==='hsl') return v; } catch(_){}
  return 'hex';
}

export function renderMode(){
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

export function updateInputs(){
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

export function setPickerMode(mode){
  if (mode !== 'hex' && mode !== 'rgb' && mode !== 'hsl') return;
  state.mode = mode;
  try { localStorage.setItem('colorPickerMode', mode); } catch (_) {}
  renderMode();
}
