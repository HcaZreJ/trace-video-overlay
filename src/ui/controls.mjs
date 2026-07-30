// 界面层 · 通用控件范式：slider ↔ number 双向同步的 bind，以及颜色输入右侧的 hex 灰字。
import { $ } from '../dom.mjs';
import { render } from './preview.mjs';

// 选项联动：field 范式 —— slider ↔ number 双向同步 + render；数值格式按 slider 的 step 小数位推导。
const stepDecimals=step=>{ const s=String(step==null?'1':step); const i=s.indexOf('.'); return i<0?0:s.length-i-1; };
export const bind=(id,vid,after)=>{
  const el=$(id), num=$(vid);
  const decimals=stepDecimals(el.step);
  const fmt=v=>decimals?(+v).toFixed(decimals):String(+v);
  const fromSlider=()=>{ num.value=fmt(el.value); if(after)after(+el.value); render(); };
  const fromNumber=()=>{
    let v=parseFloat(num.value);
    if(!Number.isFinite(v)) v=parseFloat(el.value);
    v=Math.min(parseFloat(el.max),Math.max(parseFloat(el.min),v));
    el.value=v; num.value=fmt(v);
    if(after)after(v);
    render();
  };
  el.addEventListener('input',fromSlider);
  num.addEventListener('input',fromNumber);
  num.addEventListener('change',fromNumber);
  fromSlider();
};

// 颜色行右侧的 hex 灰字：文本恒等于对应 <input type="color"> 的当前值（大写）。
function syncColorHexLabel(id){
  const input=document.getElementById(id);
  const out=document.querySelector('[data-hex-for="'+id+'"]');
  if(!input||!out) return;
  out.textContent=String(input.value||'').toUpperCase();
}
export function initColorHexLabels(){
  document.querySelectorAll('input[type=color]').forEach(input=>{
    input.addEventListener('input',()=>syncColorHexLabel(input.id));
    input.addEventListener('change',()=>syncColorHexLabel(input.id));
    syncColorHexLabel(input.id);
  });
}
