// 界面层 · 轨迹面板的两条提示带：解析失败提示与删除后的撤销提示。
// 撤销把文件插回原位后交给 recomputeTrack 重算，5 秒无操作自动收起。
import { state } from '../state.mjs';
import { $ } from '../dom.mjs';
import { recomputeTrack } from './track-panel.mjs';

export function clearTrackErrors(){
  const el=$('trackErrors');
  el.style.display='none';
  el.textContent='';
}
export function showTrackErrors(failedNames){
  const el=$('trackErrors');
  el.textContent='';
  el.style.color='#ff453a';
  const title=document.createElement('div');
  title.textContent='解析失败：'+failedNames.join('、');
  el.appendChild(title);
  const help=document.createElement('div');
  help.style.marginTop='4px';
  help.textContent='支持 gpx/kml/tcx/fit/geojson/csv；行者/Strava/佳明等 App 的活动详情页都能导出 GPX';
  el.appendChild(help);
  const closeBtn=document.createElement('button');
  closeBtn.type='button';
  closeBtn.className='status-btn';
  closeBtn.style.marginTop='6px';
  closeBtn.textContent='关闭';
  closeBtn.addEventListener('click',clearTrackErrors);
  el.appendChild(closeBtn);
  el.style.display='';
}
let trackUndoTimer=null;
export function clearTrackUndo(){
  if(trackUndoTimer){ clearTimeout(trackUndoTimer); trackUndoTimer=null; }
  const el=$('trackUndo');
  el.style.display='none';
  el.textContent='';
}
export function showTrackUndo(removedFile,removedIndex){
  clearTrackUndo();
  const el=$('trackUndo');
  el.textContent=`已移除「${removedFile.name}」 `;
  const undoBtn=document.createElement('button');
  undoBtn.type='button';
  undoBtn.className='status-btn';
  undoBtn.textContent='撤销';
  undoBtn.addEventListener('click',()=>{
    clearTrackUndo();
    state.trackFiles=[...state.trackFiles.slice(0,removedIndex),removedFile,...state.trackFiles.slice(removedIndex)];
    recomputeTrack();
  });
  el.appendChild(undoBtn);
  el.style.display='';
  trackUndoTimer=setTimeout(clearTrackUndo,5000);
}
