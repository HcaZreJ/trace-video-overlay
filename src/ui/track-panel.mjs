// 界面层 · 轨迹面板：文件载入、合并重算、文件列表与增删排序，以及有无轨迹的 gate 态。
// recomputeTrack 是这一层的中枢：state.trackFiles 变动后一律经它回到一致状态。
import { trackDistanceKm } from '../core/geo.mjs';
import { concatTrackPoints, reorderTrackFiles } from '../core/track-files.mjs';
import { parseTrackFile } from '../parse/index.mjs';
import { state } from '../state.mjs';
import { $ } from '../dom.mjs';
import { mp4Supported } from '../export/mp4.mjs';
import { render, stopPreviewPlay, updatePreviewScrubLabel } from './preview.mjs';
import { refreshTimeMode, updateTimeModeUI } from './time-mode.mjs';
import { setMapStatus, markOverlayNeedsRefresh, onPreviewMapOverlay } from './map-panel.mjs';
import { clearTrackErrors, showTrackErrors, clearTrackUndo, showTrackUndo } from './track-errors.mjs';

export function setTrackGate(hasTrack){
  // body.has-track 供舞台外的元素（示例轨迹链接、空状态画布光标）按轨迹状态改样式
  document.body.classList.toggle('has-track',hasTrack);
  document.querySelectorAll('[data-gate]').forEach(el=>{
    el.classList.toggle('needs-track',!hasTrack);
    // inert 下沉到 .step-body：整块设 inert 会把区标题和「载入轨迹后可用」也移出无障碍树，
    // 而空状态下这两句正是解释「为什么这里是空的」的唯一文字
    const inertTarget=el.querySelector(':scope > .step-body')||el;
    inertTarget.inert=!hasTrack;
    if(hasTrack) el.removeAttribute('aria-disabled'); else el.setAttribute('aria-disabled','true');
  });
  const hint=$('trackGateHint');
  if(hint) hint.style.display=hasTrack?'none':'';
}
export async function loadTrackFiles(files){
  clearTrackErrors();
  let added=0; const failed=[];
  for(const file of files){
    try{
      const r=await parseTrackFile(file);
      if(r){ state.trackFiles.push({name:file.name,format:r.format,points:r.points}); added++; }
      else failed.push(file.name);
    }catch(_){ failed.push(file.name); }
  }
  if(failed.length) showTrackErrors(failed);
  if(added){ clearTrackUndo(); recomputeTrack(); }
}
export function recomputeTrack(){
  state.trackPoints=concatTrackPoints(state.trackFiles);
  if(!state.trackPoints){ clearTrack(); return; }
  const km=trackDistanceKm(state.trackPoints);
  $('info').innerHTML=`合并 <b>${state.trackFiles.length}</b> 个文件 · <b>${state.trackPoints.length}</b> 个轨迹点 · 约 <b>${km.toFixed(1)}</b> km`;
  $('expCard').disabled=false;
  $('expDot').disabled=false;
  if(mp4Supported()) $('expMp4').disabled=false;
  $('previewScrub').style.display='';
  setTrackGate(true);
  renderFileList();
  if($('mapOverlay').checked){
    // 换轨迹后旧底图与新轨迹不再对应：立即降级为无底图渲染，有 key 则自动重新拉取
    window.mapOverlayState=null;
    const key=($('amapKey').value||'').trim();
    if(key){ onPreviewMapOverlay(); }
    else { setMapStatus('填写高德 key 后自动加载底图','info'); }
  }
  render();
  markOverlayNeedsRefresh();
  // 换了轨迹，时间轴要重建；扫拨条标签在时间真实模式下显示的时刻依赖这个索引，一并刷新
  refreshTimeMode();
  updateTimeModeUI();
  updatePreviewScrubLabel();
}
function renderFileList(){
  const el=$('fileList'); el.textContent='';
  state.trackFiles.forEach((f,i)=>{
    const row=document.createElement('div'); row.className='file-row';
    const idx=document.createElement('span'); idx.className='file-idx'; idx.textContent=String(i+1);
    const name=document.createElement('span'); name.className='file-name'; name.textContent=f.name; name.setAttribute('title',f.name);
    const meta=document.createElement('span'); meta.className='file-meta'; meta.textContent=`${f.format} · ${f.points.length} 点`;
    const btns=document.createElement('span'); btns.className='file-btns';
    const upBtn=document.createElement('button');
    upBtn.type='button'; upBtn.dataset.act='up'; upBtn.dataset.i=String(i); upBtn.textContent='↑';
    upBtn.setAttribute('aria-label',`上移 ${f.name}`);
    if(i===0) upBtn.disabled=true;
    const downBtn=document.createElement('button');
    downBtn.type='button'; downBtn.dataset.act='down'; downBtn.dataset.i=String(i); downBtn.textContent='↓';
    downBtn.setAttribute('aria-label',`下移 ${f.name}`);
    if(i===state.trackFiles.length-1) downBtn.disabled=true;
    const delBtn=document.createElement('button');
    delBtn.type='button'; delBtn.dataset.act='del'; delBtn.dataset.i=String(i); delBtn.textContent='✕';
    delBtn.setAttribute('aria-label',`删除 ${f.name}`);
    btns.appendChild(upBtn); btns.appendChild(downBtn); btns.appendChild(delBtn);
    row.appendChild(idx); row.appendChild(name); row.appendChild(meta); row.appendChild(btns);
    el.appendChild(row);
  });
}
export function trackFileAction(act,i){
  if(act==='del'){
    const removedFile=state.trackFiles[i];
    state.trackFiles=reorderTrackFiles(state.trackFiles,act,i);
    recomputeTrack();
    if(removedFile) showTrackUndo(removedFile,i);
    return;
  }
  clearTrackUndo();
  state.trackFiles=reorderTrackFiles(state.trackFiles,act,i);
  recomputeTrack();
}
function clearTrack(){
  state.trackFiles=[]; state.trackPoints=null;
  stopPreviewPlay();
  $('previewScrub').style.display='none';
  $('info').innerHTML='尚未载入轨迹';
  $('expCard').disabled=true;
  $('expDot').disabled=true;
  $('expMp4').disabled=true;
  setTrackGate(false);
  renderFileList();
  render();
  refreshTimeMode();
  updateTimeModeUI();
  updatePreviewScrubLabel();
}
