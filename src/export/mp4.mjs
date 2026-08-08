// 导出层 · MP4 动画导出（WebCodecs + vendored mp4-muxer）。
// Mp4Muxer 由 vendor/mp4-muxer.js 以 classic script 挂在全局，这里直接取用。
// 导出期间锁住产物切换、拦截关页、把 #expMp4 变成取消入口。
import { buildTimeTrueFilename } from '../core/export-meta.mjs';
import { renderFrame } from '../render/card.mjs';
import { state } from '../state.mjs';
import { $ } from '../dom.mjs';
import { createMp4Sink, downloadSidecar } from './mp4-sink.mjs';
import { resolveExportPlan, frameProgress, formatEta, buildExportSidecar } from './mp4-plan.mjs';
import { buildFrameOpts } from './mp4-opts.mjs';
import { exportState, setExportStatus, setExportKindLocked, showExportBlockedStatus } from './status.mjs';
import { timeMode, isTimeTrueMode, currentExportWindow } from '../ui/time-mode.mjs';
import { onPreviewMapOverlay } from '../ui/map-panel.mjs';
import { stopPreviewPlay } from '../ui/preview.mjs';

// 让出主线程：MessageChannel 宏任务没有 setTimeout 的 4ms 钳制，后台标签页也不被节流
const mp4YieldChannel=new MessageChannel();
function mp4Yield(){
  return new Promise(r=>{ mp4YieldChannel.port1.onmessage=()=>r(); mp4YieldChannel.port2.postMessage(0); });
}
export function mp4Supported(){
  return 'VideoEncoder' in window && 'VideoFrame' in window &&
    typeof VideoEncoder.isConfigSupported==='function' && !!window.Mp4Muxer;
}
async function pickMp4Codec(size,fps,bitrate){
  const byRes={720:'avc1.42001f',1080:'avc1.420028',1440:'avc1.420033'};
  const primary=byRes[size]||'avc1.420028';
  const candidates=[...new Set([primary,'avc1.42001f','avc1.420028','avc1.420033'])];
  for(const codec of candidates){
    try{
      const r=await VideoEncoder.isConfigSupported({codec,width:size,height:size,bitrate,framerate:fps});
      if(r&&r.supported) return codec;
    }catch(_){}
  }
  return null;
}
// 毫秒时间戳 → 本地时区的 ISO 形态时刻，供成功文案写明动画起点。
function localIsoText(ms){
  return new Date(ms-new Date(ms).getTimezoneOffset()*6e4).toISOString().slice(0,19).replace('T',' ');
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
  // 解析器对无法识别的文件产出空点数组，拼接后可能得到 []：与渲染层一样认空数组。
  if(!state.trackPoints||state.trackPoints.length===0||!mp4Supported()) return;
  const plan = resolveExportPlan();
  // 时间真实模式却拿不到时间真实计划：在弹保存框之前就停下并说清原因，不静默降级成匀速。
  if(isTimeTrueMode()&&plan.mode!=='true'){
    setExportStatus('导出已中止：算不出可用的导出时间窗口，请检查起始与结束时刻','error');
    return;
  }

  // 保存框要求 user activation：产物出口抢在补拉底图的网络请求之前建立，
  // 先等别的异步会让手势过期，浏览器随即拒绝弹出保存框。
  let sink;
  try{
    sink = await createMp4Sink({ suggestedName: plan.suggestedName, preferStream: plan.preferStream });
  }catch(err){
    // 用户在保存框点取消：这次导出没有发生，归还一次性的无底图开关，界面维持原样。
    if(err&&err.name==='AbortError'){ exportState.forceNoBasemap = skipBasemap; return; }
    setExportStatus('导出失败：'+(err&&err.message?err.message:String(err)),'error');
    return;
  }

  const mapActive = $('mapOverlay').checked;
  if(mapActive && !skipBasemap && (!window.mapOverlayState || state.mapOverlayNeedsRefresh)){
    try { await onPreviewMapOverlay(); } catch(_) { /* onPreviewMapOverlay 已内部 catch，这里无 throw */ }
  }
  if(mapActive && !skipBasemap && !window.mapOverlayState){
    await sink.abort();
    showExportBlockedStatus(exportMp4);
    return;
  }
  const btn=$('expMp4');
  const size=plan.size;
  const fps=plan.fps;
  const frames=plan.frames;

  let encoder=null;
  let cancelled=false;
  try{
    // 帧参数快照会走带参数校验的投影：连同界面锁定一并纳入 try，
    // 抛错时才能走到 sink.abort() 与 finally 的界面复位。
    const opts=buildFrameOpts({ skipBasemap, size: plan.size });
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
    $('mp4Eta').textContent='';

    const codec=await pickMp4Codec(size,fps,plan.bitrate);
    if(!codec) throw new Error('当前浏览器不支持所需的 H.264 编码，请使用最新版 Chrome / Edge，或较新版本的 Safari');

    const muxer=new Mp4Muxer.Muxer({ target:sink.target, video:{ codec:'avc', width:size, height:size }, fastStart:sink.fastStart });
    let encodeError=null;
    encoder=new VideoEncoder({
      output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),
      error:e=>{ encodeError=e; }
    });
    encoder.configure({ codec, width:size, height:size, bitrate:plan.bitrate, framerate:fps });

    const startedAt=Date.now();
    for(let i=0;i<frames;i++){
      if(mp4CancelRequested){ cancelled=true; break; }
      if(encodeError) throw encodeError;
      const progress=frameProgress(plan,i);
      renderFrame(offCtx,size,progress,opts);
      const frame=new VideoFrame(off,{timestamp:Math.round(i*1e6/fps)});
      encoder.encode(frame,{keyFrame:i%fps===0});
      frame.close();
      const done=i+1;
      $('mp4Progress').value=done;
      $('mp4ProgressV').textContent=Math.round((done/frames)*100)+'% ('+done+'/'+frames+')';
      // 剩余时间按已完成帧的平均耗时外推；首帧之前没有耗时样本，留空串不显示
      const elapsed=(Date.now()-startedAt)/1000;
      $('mp4Eta').textContent = elapsed>0 ? formatEta(elapsed/done*(frames-done)) : '';
      // 背压：编码队列过深时等编码器消化，控制内存占用；否则只让出一个宏任务保持 UI 可响应
      while(encoder.encodeQueueSize>6){
        if('ondequeue' in encoder) await new Promise(r=>encoder.addEventListener('dequeue',r,{once:true}));
        else await new Promise(r=>setTimeout(r,4));
      }
      await mp4Yield();
    }

    if(cancelled){
      await sink.abort();
      setExportStatus('已取消','info');
      return;
    }

    await encoder.flush();
    if(encodeError) throw encodeError;
    muxer.finalize();
    await sink.finish(plan.suggestedName);

    // 保存框只把 suggestedName 当建议，用户可以改名：文案与 sidecar 都跟实际保存名走。
    const savedName=sink.savedName||plan.suggestedName;
    if(plan.mode==='true'){
      const win=currentExportWindow();
      // MP4 已经落盘，sidecar 失败只在成功文案后追加一句提示，不改写成导出失败。
      let note='';
      try{
        downloadSidecar(buildExportSidecar(plan,{
          trackStartMs: timeMode.range ? timeMode.range.startMs : null,
          trackEndMs: timeMode.range ? timeMode.range.endMs : null,
          sourceFiles: (Array.isArray(state.trackFiles)?state.trackFiles:[]).map(f=>f&&f.name),
          collapsedSegmentGaps: !!(win&&win.collapseSegmentGaps),
        }), sink.savedName ? sink.savedName.replace(/\.[^.]*$/,'')+'.json'
          : buildTimeTrueFilename(plan.t0Ms, plan.scale, 'json'));
      }catch(e){ console.error(e); note=' · 元数据文件未能保存'; }
      setExportStatus(`已导出「${savedName}」· 起点 ${localIsoText(plan.t0Ms)} · 缩放 ${plan.scale}${note}`,'success');
    }else{
      setExportStatus(`已下载「${savedName}」`,'success');
    }
  }catch(err){
    console.error(err);
    await sink.abort();
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
    $('mp4Eta').textContent='';
    setMp4BeforeUnloadGuard(false);
  }
}
