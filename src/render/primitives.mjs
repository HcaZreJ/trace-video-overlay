// 画笔原语：hexToRgba 拼 rgba 颜色串，strokePath 沿投影点描线，drawMarker 画起终点标记。
// 三者只收参数往 2D context 上画，不读 state、不读 DOM。
export function hexToRgba(hex,alpha){
  const n=parseInt(hex.slice(1),16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
}
export function strokePath(ctx,proj,color,width){
  ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.beginPath(); ctx.moveTo(proj.points[0].x,proj.points[0].y);
  for(let i=1;i<proj.points.length;i++) ctx.lineTo(proj.points[i].x,proj.points[i].y);
  ctx.stroke();
}
export function drawMarker(ctx,pt,color,size){
  const r=size/2;
  ctx.beginPath(); ctx.arc(pt.x,pt.y,r,0,Math.PI*2);
  ctx.fillStyle=color; ctx.fill();
  ctx.lineWidth=Math.max(2,size*0.175); ctx.strokeStyle='#fff'; ctx.stroke();
}
