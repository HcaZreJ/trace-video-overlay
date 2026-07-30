// 定位点渲染：独立画布上的白环 + 彩色心 + 阴影，画布尺寸由 dotGeometry 给出。
import { dotGeometry } from '../core/export-params.mjs';
import { $ } from '../dom.mjs';

export function renderDot(canvas,size){
  const ctx=canvas.getContext('2d');
  const g = dotGeometry(size);
  canvas.width=canvas.height=g.full;
  ctx.clearRect(0,0,g.full,g.full);
  const c=g.full/2;
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.45)'; ctx.shadowBlur=g.shadowBlur; ctx.shadowOffsetY=g.shadowOffsetY;
  ctx.beginPath(); ctx.arc(c,c,g.outerR,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(c,c,g.coreR,0,Math.PI*2); ctx.fillStyle=$('dotColor').value; ctx.fill();
}
