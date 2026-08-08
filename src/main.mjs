// 应用入口 · 装配：把界面各面板的行为接到 DOM 事件上，跑首屏初始化。
// 面板逻辑本身在 ui/ 下，这里只关心接线与初始化顺序。
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
import { refreshTimeMode, updateTimeModeUI } from './ui/time-mode.mjs';
import { bind, initColorHexLabels } from './ui/controls.mjs';
import { initColorPickers } from './ui/color-picker/index.mjs';

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
  updatePreviewScrubLabel(); render(); // 时间真实模式下标签显示的是当前进度对应的真实时刻
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
const timeUI=()=>{ updatePreviewScrubLabel(); updateTimeModeUI(); }; // 导出参数改了：预览刻度与时长/体积提示一起刷
$('exportRes').addEventListener('change',()=>{ render(); updateTimeModeUI(); });
$('mp4Duration').addEventListener('input',timeUI);
$('mp4Duration').addEventListener('change',()=>{ $('mp4Duration').value = clampMp4Duration(+$('mp4Duration').value); timeUI(); });
for(const ev of ['input','change']) for(const id of ['mp4TimeStart','mp4TimeEnd','mp4TimeScale']) $(id).addEventListener(ev,timeUI);
$('mp4TrueFps').addEventListener('change',timeUI);
$('mp4Quality').addEventListener('change',()=>updateTimeModeUI());
$('mp4CollapseGaps').addEventListener('change',()=>{ refreshTimeMode(); timeUI(); }); // 折叠改的是时间轴本身，索引要重建
document.querySelectorAll('input[name=mp4TimeMode]').forEach(el=>el.addEventListener('change',()=>{ timeUI(); render(); }));
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
refreshTimeMode(); updateTimeModeUI();
updatePreviewScrubLabel();
if(!mp4Supported()) $('mp4UnsupportedHint').style.display='';
setTrackGate(false);
window.addEventListener('resize', render);
render();
initColorPickers();
window.fetchAmapBasemap = fetchAmapBasemap; // for manual browser testing

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
