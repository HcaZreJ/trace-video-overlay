// 卡片渲染：renderCard（页面预览与 PNG 导出）与 renderFrame（MP4 逐帧）渲染同构，
// 同住一个文件让「改一个就同步另一个」这条约束在一屏内可见。
// renderCard 用 $ 直接读控件当前值，renderFrame 的参数全部来自 opts；两者都从 state 读轨迹。
import { projectTrack, pointAtProgress } from '../core/geo.mjs';
import { computeOverlayScale, computeBasemapDrawRect, projectTrackOnAmap } from '../core/amap.mjs';
import { dotGeometry } from '../core/export-params.mjs';
import { state, CARD_SIZE } from '../state.mjs';
import { $ } from '../dom.mjs';
import { hexToRgba, strokePath, drawMarker } from './primitives.mjs';

export function renderCard(canvas,size,opts={}){
  const ctx=canvas.getContext('2d');
  canvas.width=canvas.height=size;
  ctx.clearRect(0,0,size,size);
  // 空轨迹数组与 null 同判：解析器对无法识别的文件产出空点数组，拼接后可能得到 []
  if(!state.trackPoints||state.trackPoints.length===0){
    const emptyScale=size/CARD_SIZE;
    ctx.save();
    ctx.fillStyle='#8a93a2';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.font=`${Math.round(20*emptyScale)}px -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif`;
    ctx.fillText('拖入轨迹文件，或点击这里选择文件',size/2,size/2-14*emptyScale);
    if($('loadSample')&&!$('loadSample').hidden){
      ctx.font=`${Math.round(15*emptyScale)}px -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif`;
      ctx.fillText('也可以先载入示例轨迹',size/2,size/2+14*emptyScale);
    }
    ctx.restore();
    return;
  }
  const scale=size/CARD_SIZE;
  const radius=+$('radius').value*scale;
  const pad=+$('pad').value*scale;
  const lineWidth=+$('lineWidth').value*scale;

  const overlay=window.mapOverlayState;
  if(overlay){
    // 地图 overlay 模式：底图与轨迹共享同一 world→canvas 仿射变换 k，对齐靠数学保证。
    const k = computeOverlayScale(overlay.spanPx, size, pad, overlay.viewScale);
    const rect = computeBasemapDrawRect(size, overlay.contentSize, k);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(0,0,size,size,radius); ctx.clip();
    // 底色垫在底图之下：取景缩放 <1 露出的边界处显示底色（含透明度，PNG 导出直接保留）
    ctx.fillStyle=hexToRgba($('bgColor').value,+$('bgOpacity').value/100);
    ctx.fillRect(0,0,size,size);
    ctx.drawImage(overlay.basemapImage, rect.x, rect.y, rect.w, rect.h);
    if(overlay.overlayMode==='mask'){
      ctx.fillStyle=`rgba(0,0,0,${overlay.overlayMaskOpacity})`;
      ctx.fillRect(0,0,size,size);
    }
    const proj = projectTrackOnAmap(state.trackPoints,size,overlay.mapCenter,overlay.mapZoom,k);
    strokePath(ctx,proj,$('lineColor').value,lineWidth);
    if($('showMarkers').checked){
      const mr=+$('markerSize').value*scale;
      drawMarker(ctx,proj.points[0],$('startColor').value,mr);
      drawMarker(ctx,proj.points.at(-1),$('endColor').value,mr);
    }
    if(opts.previewDot){
      const p = pointAtProgress(proj.points, opts.previewProgress ?? 0.5);
      if(p){
        const d = +$('dotSize').value * scale;
        const g = dotGeometry(d);
        ctx.save();
        ctx.shadowColor='rgba(0,0,0,.45)'; ctx.shadowBlur=g.shadowBlur; ctx.shadowOffsetY=g.shadowOffsetY;
        ctx.beginPath(); ctx.arc(p.x, p.y, g.outerR, 0, Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
        ctx.restore();
        ctx.beginPath(); ctx.arc(p.x, p.y, g.coreR, 0, Math.PI*2); ctx.fillStyle=$('dotColor').value; ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.beginPath(); ctx.roundRect(0,0,size,size,radius); ctx.clip();
  ctx.fillStyle=hexToRgba($('bgColor').value,+$('bgOpacity').value/100);
  ctx.fillRect(0,0,size,size);

  const proj=projectTrack(state.trackPoints,size-2*pad);
  ctx.save(); ctx.translate(pad,pad);
  strokePath(ctx,proj,$('lineColor').value,lineWidth);
  if($('showMarkers').checked){
    const mr=+$('markerSize').value*scale;
    drawMarker(ctx,proj.points[0],$('startColor').value,mr);
    drawMarker(ctx,proj.points.at(-1),$('endColor').value,mr);
  }
  if(opts.previewDot){
    const p = pointAtProgress(proj.points, opts.previewProgress ?? 0.5);
    if(p){
      const d = +$('dotSize').value * scale;
      const g = dotGeometry(d);
      ctx.save();
      ctx.shadowColor='rgba(0,0,0,.45)'; ctx.shadowBlur=g.shadowBlur; ctx.shadowOffsetY=g.shadowOffsetY;
      ctx.beginPath(); ctx.arc(p.x, p.y, g.outerR, 0, Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(p.x, p.y, g.coreR, 0, Math.PI*2); ctx.fillStyle=$('dotColor').value; ctx.fill();
    }
  }
  ctx.restore();
  ctx.restore();
}
// 逐帧渲染（MP4 导出用）：整帧不透明背景 + 全线常显 + 定位点走到 progress 处。
// 复用 projectTrack/strokePath/drawMarker/pointAtProgress；参数全部来自 opts（便于逐帧/离屏，不读 DOM）。
// opts.proj 给出预投影结果（{points,fullSize}）时原样采用，跳过本函数内的投影计算；
// 缺省时自行投影。分支与来源的匹配由调用方保证。
export function renderFrame(ctx,size,progress,opts){
  const scale=size/CARD_SIZE;
  const radius=opts.radius*scale, pad=opts.pad*scale, lineWidth=opts.lineWidth*scale;

  ctx.clearRect(0,0,size,size);
  // 空轨迹数组与 null 同判：与 renderCard 的守卫同构
  if(!state.trackPoints||state.trackPoints.length===0) return;

  // 背景第一层：整帧不透明（MP4 无 alpha，避免透出黑）
  ctx.fillStyle=(opts.bgMode==='green')?opts.greenColor:opts.pageColor;
  ctx.fillRect(0,0,size,size);

  ctx.save();
  let proj;
  if(opts.bgMode!=='green'&&opts.basemapImage){
    // 卡片模式 + 地图底图：底图与轨迹共享同一 world→canvas 仿射变换 k，对齐靠数学保证。
    const k = computeOverlayScale(opts.spanPx, size, pad, opts.viewScale);
    const rect = computeBasemapDrawRect(size, opts.contentSize, k);
    ctx.beginPath(); ctx.roundRect(0,0,size,size,radius); ctx.clip();
    // 底色垫在底图之下：与 renderCard 同构，取景缩放 <1 露出的边界处显示底色
    ctx.fillStyle=hexToRgba(opts.bgColor,opts.bgOpacity);
    ctx.fillRect(0,0,size,size);
    ctx.drawImage(opts.basemapImage, rect.x, rect.y, rect.w, rect.h);
    if(opts.overlayMode==='mask'){
      ctx.fillStyle=`rgba(0,0,0,${opts.overlayMaskOpacity})`;
      ctx.fillRect(0,0,size,size);
    }
    proj = opts.proj ?? projectTrackOnAmap(state.trackPoints,size,opts.mapCenter,opts.mapZoom,k);
  } else {
    if(opts.bgMode!=='green'){
      // 卡片模式：圆角裁剪 + 叠半透明卡片底，线路/标记/定位点都画在圆角内
      ctx.beginPath(); ctx.roundRect(0,0,size,size,radius); ctx.clip();
      ctx.fillStyle=hexToRgba(opts.bgColor,opts.bgOpacity);
      ctx.fillRect(0,0,size,size);
    }
    proj=opts.proj ?? projectTrack(state.trackPoints,size-2*pad);
    ctx.translate(pad,pad);
  }
  if(proj.points?.length){
    strokePath(ctx,proj,opts.lineColor,lineWidth);
    if(opts.showMarkers){
      const mr=opts.markerSize*scale;
      drawMarker(ctx,proj.points[0],opts.startColor,mr);
      drawMarker(ctx,proj.points.at(-1),opts.endColor,mr);
    }
    // 定位点：仿 renderDot（白环 + 彩色心 + 阴影），直径随 dotSize*scale
    const p=pointAtProgress(proj.points,progress);
    if(p){
      const d=opts.dotSize*scale;
      const g=dotGeometry(d);
      ctx.save();
      ctx.shadowColor='rgba(0,0,0,.45)'; ctx.shadowBlur=g.shadowBlur; ctx.shadowOffsetY=g.shadowOffsetY;
      ctx.beginPath(); ctx.arc(p.x,p.y,g.outerR,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(p.x,p.y,g.coreR,0,Math.PI*2); ctx.fillStyle=opts.dotColor; ctx.fill();
    }
  }
  ctx.restore();
}
