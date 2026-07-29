// 界面层 · 地图底图面板：状态条、底图拉取的节流与去重、底图相关控件的显隐联动。
// 底图数据本身挂在 window.mapOverlayState 上，渲染与导出两层都从那里读。
import { fetchAmapBasemap } from '../basemap/fetch.mjs';
import { state } from '../state.mjs';
import { $ } from '../dom.mjs';
import { render } from './preview.mjs';

/* ==================== 地图 overlay UI ==================== */
export function setMapStatus(msg, kind){
  const el = $('mapOverlayStatus');
  if(!msg || kind === 'clear'){ el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = '';
  el.textContent = msg;
  el.style.color = kind === 'error' ? '#ff453a' : kind === 'warn' ? '#ff9f0a' : kind === 'ok' ? '#34c759' : 'var(--dim)';
}
export function markOverlayNeedsRefresh(){
  state.mapOverlayNeedsRefresh = true;
}
let mapFetchInFlight = false;
let mapFetchPending = false;
let mapAutoFetchTimer = null;
export function scheduleMapAutoFetch(){
  if(mapAutoFetchTimer) clearTimeout(mapAutoFetchTimer);
  mapAutoFetchTimer = setTimeout(() => {
    mapAutoFetchTimer = null;
    const key = ($('amapKey').value || '').trim();
    if($('mapOverlay').checked && key && state.trackPoints && state.trackPoints.length){
      onPreviewMapOverlay();
    }
  }, 600);
}
export async function onPreviewMapOverlay(){
  const key = ($('amapKey').value || '').trim();
  if(!key){ setMapStatus('请先填写高德 API Key', 'error'); return; }
  if(!state.trackPoints || state.trackPoints.length === 0){ setMapStatus('请先载入轨迹', 'error'); return; }
  if(mapFetchInFlight){ mapFetchPending = true; return; }
  mapFetchInFlight = true;
  const btn = $('mapPreview');
  btn.disabled = true; setMapStatus('正在拉取底图…', 'info');
  try {
    const result = await fetchAmapBasemap({
      pointsWgs84: state.trackPoints,
      key,
      traffic: $('mapTraffic').checked ? 1 : undefined,
    });
    window.mapOverlayState = {
      basemapImage: result.image,
      mapCenter: result.center,
      mapZoom: result.zoom,
      spanPx: result.spanPx,
      contentSize: result.contentSize,
      viewScale: +$('mapViewScale').value,
      overlayMode: document.querySelector('input[name=mapOverlayMode]:checked').value,
      overlayMaskOpacity: (+$('mapMaskOpacity').value) / 100,
    };
    state.mapOverlayNeedsRefresh = false;
    setMapStatus(`✓ 底图已加载（缩放级别 ${result.zoom}）`, 'ok');
    render();
  } catch(err){
    window.mapOverlayState = null;
    const msg = (err && err.code === 'amap_api_error') ? err.message : `底图加载失败：${err && err.message ? err.message : err}`;
    setMapStatus(msg, 'error');
    render();
  } finally {
    btn.disabled = false;
    mapFetchInFlight = false;
    if(mapFetchPending){
      mapFetchPending = false;
      onPreviewMapOverlay();
    }
  }
}
export function updateBgModeUI(){
  const mapMode = $('bgModeMap').checked;
  $('bgModeSolidLabel').classList.toggle('active', !mapMode);
  $('bgModeMapLabel').classList.toggle('active', mapMode);
  $('bgMapFields').style.display = mapMode ? '' : 'none';
}
export function updateMapModeFieldsUI(){
  const maskMode = document.querySelector('input[name=mapOverlayMode]:checked').value === 'mask';
  $('mapMaskOpacityField').style.display = maskMode ? '' : 'none';
}
