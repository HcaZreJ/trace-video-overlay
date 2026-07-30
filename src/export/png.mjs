// 导出层 · PNG：卡片与定位点两张图。
// canvas.toBlob 出图，走临时 <a download> 落盘，1 秒后回收 object URL。
import { renderCard } from '../render/card.mjs';
import { renderDot } from '../render/dot.mjs';
import { state, CARD_SIZE } from '../state.mjs';
import { $ } from '../dom.mjs';
import { exportState, setExportStatus, showExportBlockedStatus } from './status.mjs';
import { onPreviewMapOverlay } from '../ui/map-panel.mjs';

function download(canvas,filename,onDone){
  canvas.toBlob(blob=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=filename;
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    if(onDone) onDone();
  },'image/png');
}

export async function exportCard(){
  const skipBasemap = exportState.forceNoBasemap;
  exportState.forceNoBasemap = false;
  if(!state.trackPoints) return;
  const mapActive = $('mapOverlay').checked;
  if(mapActive && !skipBasemap && (!window.mapOverlayState || state.mapOverlayNeedsRefresh)){
    try { await onPreviewMapOverlay(); } catch(_) { /* onPreviewMapOverlay 已内部 catch，这里无 throw */ }
  }
  if(mapActive && !skipBasemap && !window.mapOverlayState){
    showExportBlockedStatus(exportCard);
    return;
  }
  const savedOverlayState = window.mapOverlayState;
  const c=document.createElement('canvas');
  try {
    if(skipBasemap) window.mapOverlayState = null;
    renderCard(c,+$('exportRes').value||1080);
  } catch(err) {
    console.error(err);
    setExportStatus(`导出失败：${err.message}`,'error');
    return;
  } finally {
    window.mapOverlayState = savedOverlayState;
  }
  download(c,'轨迹卡片.png',()=>setExportStatus('已下载「轨迹卡片.png」','success'));
}
export function exportDot(){
  if(!state.trackPoints) return;
  const off=document.createElement('canvas');
  const dotExportPx = Math.round(+$('dotSize').value * (+$('exportRes').value||1080) / CARD_SIZE);
  try {
    renderDot(off, dotExportPx);
  } catch(err) {
    console.error(err);
    setExportStatus(`导出失败：${err.message}`,'error');
    return;
  }
  download(off,'定位点.png',()=>setExportStatus('已下载「定位点.png」','success'));
}
