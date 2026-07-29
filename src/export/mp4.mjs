// 导出层 · MP4 动画导出（WebCodecs + vendored mp4-muxer）。
// Mp4Muxer 由 vendor/mp4-muxer.js 以 classic script 挂在全局，这里直接取用。
// 导出期间锁住产物切换、拦截关页、把 #expMp4 变成取消入口。
import { clampMp4Duration } from '../core/export-params.mjs';
import { renderFrame } from '../render/card.mjs';
import { state } from '../state.mjs';
import { $ } from '../dom.mjs';
import { exportState, setExportStatus, setExportKindLocked, showExportBlockedStatus } from './status.mjs';
import { onPreviewMapOverlay } from '../ui/map-panel.mjs';
import { stopPreviewPlay } from '../ui/preview.mjs';

const MP4_BITRATE={720:6e6,1080:12e6,1440:20e6};
// 让出主线程：MessageChannel 宏任务没有 setTimeout 的 4ms 钳制，后台标签页也不被节流
const mp4YieldChannel=new MessageChannel();
function mp4Yield(){
  return new Promise(r=>{ mp4YieldChannel.port1.onmessage=()=>r(); mp4YieldChannel.port2.postMessage(0); });
}
export function mp4Supported(){
  return 'VideoEncoder' in window && 'VideoFrame' in window &&
    typeof VideoEncoder.isConfigSupported==='function' && !!window.Mp4Muxer;
}
function buildFrameOpts(){
  return {
    radius:+$('radius').value,
    pad:+$('pad').value,
    lineWidth:+$('lineWidth').value,
    bgMode:$('mp4BgMode').value,
    pageColor:$('mp4PageColor').value,
    greenColor:$('mp4GreenColor').value,
    bgColor:$('bgColor').value,
    bgOpacity:+$('bgOpacity').value/100,
    lineColor:$('lineColor').value,
    showMarkers:$('showMarkers').checked,
    markerSize:+$('markerSize').value,
    startColor:$('startColor').value,
    endColor:$('endColor').value,
    dotColor:$('dotColor').value,
    dotSize:+$('dotSize').value,
    basemapImage: window.mapOverlayState ? window.mapOverlayState.basemapImage : null,
    mapCenter: window.mapOverlayState ? window.mapOverlayState.mapCenter : null,
    mapZoom: window.mapOverlayState ? window.mapOverlayState.mapZoom : null,
    spanPx: window.mapOverlayState ? window.mapOverlayState.spanPx : 0,
    contentSize: window.mapOverlayState ? window.mapOverlayState.contentSize : 1024,
    viewScale: window.mapOverlayState ? window.mapOverlayState.viewScale : 1,
    overlayMode: window.mapOverlayState ? window.mapOverlayState.overlayMode : 'none',
    overlayMaskOpacity: window.mapOverlayState ? window.mapOverlayState.overlayMaskOpacity : 0,
  };
}
async function pickMp4Codec(size,fps){
  const byRes={720:'avc1.42001f',1080:'avc1.420028',1440:'avc1.420033'};
  const primary=byRes[size]||'avc1.420028';
  const candidates=[...new Set([primary,'avc1.42001f','avc1.420028','avc1.420033'])];
  const bitrate=MP4_BITRATE[size]||1.2e7;
  for(const codec of candidates){
    try{
      const r=await VideoEncoder.isConfigSupported({codec,width:size,height:size,bitrate,framerate:fps});
      if(r&&r.supported) return codec;
    }catch(_){}
  }
  return null;
}
let mp4ExportInProgress = false;
let mp4CancelRequested = false;
function mp4BeforeUnloadHandler(e){
  e.preventDefault();
  e.returnValue = '';
  return '';
}
function setMp4BeforeUnloadGuard(active){
  if(active) window.addEventListener('beforeunload', mp4BeforeUnloadHandler);
  else window.removeEventListener('beforeunload', mp4BeforeUnloadHandler);
}
export function onExpMp4Click(){
  if(mp4ExportInProgress){ mp4CancelRequested = true; return; }
  exportMp4();
}
async function exportMp4(){
  stopPreviewPlay();
  const skipBasemap = exportState.forceNoBasemap;
  exportState.forceNoBasemap = false;
  if(!state.trackPoints||!mp4Supported()) return;
  const mapActive = $('mapOverlay').checked;
  if(mapActive && !skipBasemap && (!window.mapOverlayState || state.mapOverlayNeedsRefresh)){
    try { await onPreviewMapOverlay(); } catch(_) { /* onPreviewMapOverlay 已内部 catch，这里无 throw */ }
  }
  if(mapActive && !skipBasemap && !window.mapOverlayState){
    showExportBlockedStatus(exportMp4);
    return;
  }
  const btn=$('expMp4');
  const duration=clampMp4Duration(+$('mp4Duration').value);
  const fps=Math.max(1,+$('mp4Fps').value||30);
  const size=+$('exportRes').value||1080;
  const frames=Math.max(1,Math.round(duration*fps));
  const bitrate=MP4_BITRATE[size]||1.2e7;

  const savedOverlayState = window.mapOverlayState;
  let opts;
  try {
    if(skipBasemap) window.mapOverlayState = null;
    opts = buildFrameOpts();
  } finally {
    window.mapOverlayState = savedOverlayState;
  }

  const off=document.createElement('canvas');
  off.width=off.height=size;
  const offCtx=off.getContext('2d');

  mp4ExportInProgress = true;
  mp4CancelRequested = false;
  btn.textContent = '取消导出';
  $('expCard').disabled = true;
  $('expDot').disabled = true;
  setExportKindLocked(true);
  setMp4BeforeUnloadGuard(true);
  setExportStatus('', 'clear');
  $('mp4ProgressWrap').style.display='';
  $('mp4Progress').value=0; $('mp4Progress').max=frames;
  $('mp4ProgressV').textContent='0%';

  let encoder=null;
  let cancelled=false;
  try{
    const codec=await pickMp4Codec(size,fps);
    if(!codec) throw new Error('当前浏览器不支持所需的 H.264 编码，请使用最新版 Chrome / Edge，或较新版本的 Safari');

    const target=new Mp4Muxer.ArrayBufferTarget();
    const muxer=new Mp4Muxer.Muxer({ target, video:{ codec:'avc', width:size, height:size }, fastStart:'in-memory' });
    let encodeError=null;
    encoder=new VideoEncoder({
      output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),
      error:e=>{ encodeError=e; }
    });
    encoder.configure({ codec, width:size, height:size, bitrate, framerate:fps });

    for(let i=0;i<frames;i++){
      if(mp4CancelRequested){ cancelled=true; break; }
      if(encodeError) throw encodeError;
      const progress=frames>1 ? i/(frames-1) : 0;
      renderFrame(offCtx,size,progress,opts);
      const frame=new VideoFrame(off,{timestamp:Math.round(i*1e6/fps)});
      encoder.encode(frame,{keyFrame:i%fps===0});
      frame.close();
      $('mp4Progress').value=i+1;
      $('mp4ProgressV').textContent=Math.round(((i+1)/frames)*100)+'% ('+(i+1)+'/'+frames+')';
      // 背压：编码队列过深时等编码器消化，控制内存占用；否则只让出一个宏任务保持 UI 可响应
      while(encoder.encodeQueueSize>6){
        if('ondequeue' in encoder) await new Promise(r=>encoder.addEventListener('dequeue',r,{once:true}));
        else await new Promise(r=>setTimeout(r,4));
      }
      await mp4Yield();
    }

    if(cancelled){
      setExportStatus('已取消','info');
      return;
    }

    await encoder.flush();
    if(encodeError) throw encodeError;
    muxer.finalize();

    const blob=new Blob([target.buffer],{type:'video/mp4'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download='轨迹动画.mp4';
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);

    setExportStatus('已下载「轨迹动画.mp4」','success');
  }catch(err){
    console.error(err);
    setExportStatus('导出失败：'+(err&&err.message?err.message:String(err)),'error');
  }finally{
    if(encoder&&encoder.state&&encoder.state!=='closed'){ try{encoder.close();}catch(_){} }
    mp4ExportInProgress = false;
    mp4CancelRequested = false;
    btn.textContent = '导出 MP4';
    $('expCard').disabled = !state.trackPoints;
    $('expDot').disabled = !state.trackPoints;
    setExportKindLocked(false);
    $('mp4ProgressWrap').style.display='none';
    setMp4BeforeUnloadGuard(false);
  }
}
