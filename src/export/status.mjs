// 导出层 · 状态与产物切换。
// 吸底条的状态提示（含成功 6 秒自动清除）、底图缺失时的重试引导，
// 以及贴图 PNG / 动画 MP4 两种产物的参数面板与按钮显隐。
// exportState 持有 png.mjs 与 mp4.mjs 共读共写的一次性覆盖开关：
// ES module 的导入绑定只读，只有对象属性才能跨模块既读又写。
import { $ } from '../dom.mjs';

// 产物切换：贴图 PNG = 卡片 + 定位点两张图，动画 MP4 = 一段动画。
// 这里只管参数面板与吸底条按钮的显隐；按钮的 disabled 由轨迹状态与 MP4 导出互斥逻辑各自维护，
// 隐藏的按钮保持它原本的 disabled 值不变。
export function updateExportKindUI(){
  const mp4Kind = $('exportKindMp4').checked;
  $('exportKindPngLabel').classList.toggle('active', !mp4Kind);
  $('exportKindMp4Label').classList.toggle('active', mp4Kind);
  $('exportPngFields').style.display = mp4Kind ? 'none' : '';
  $('exportMp4Fields').style.display = mp4Kind ? '' : 'none';
  $('expCard').style.display = mp4Kind ? 'none' : '';
  $('expDot').style.display = mp4Kind ? 'none' : '';
  $('expMp4').style.display = mp4Kind ? '' : 'none';
  try { localStorage.setItem('exportKind', mp4Kind ? 'mp4' : 'png'); } catch(_){ /* storage 被禁用：偏好不持久化，界面照常 */ }
}
// 导出进行中锁住产物切换：承载「取消导出」的按钮就是 #expMp4，切走会让用户失去唯一的取消入口。
export function setExportKindLocked(locked){
  document.querySelectorAll('input[name=exportKind]').forEach(el => el.disabled = locked);
}

// 一次性覆盖：由「改用无底图导出」设置，被下一次 exportCard/exportMp4 消费后立即清零；
// 不改变 mapOverlay/segmented 的勾选状态，只让本次导出临时按无底图路径渲染。
export const exportState = { forceNoBasemap: false };
let exportStatusClearTimer = null;
export function setExportStatus(msg, kind){
  const el = $('exportStatus');
  if(exportStatusClearTimer){ clearTimeout(exportStatusClearTimer); exportStatusClearTimer = null; }
  if(!msg || kind === 'clear'){ el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = '';
  const prefix = kind === 'success' ? '✓ ' : kind === 'error' ? '✕ ' : '';
  el.textContent = prefix + msg;
  el.style.color = kind === 'success' ? '#34c759' : kind === 'error' ? '#ff453a' : 'var(--dim)';
  if(kind === 'success'){
    exportStatusClearTimer = setTimeout(() => {
      el.style.display = 'none'; el.textContent = ''; exportStatusClearTimer = null;
    }, 6000);
  }
}
export function showExportBlockedStatus(retryFn){
  if(exportStatusClearTimer){ clearTimeout(exportStatusClearTimer); exportStatusClearTimer = null; }
  const el = $('exportStatus');
  el.style.display = '';
  el.style.color = '#ff453a';
  el.innerHTML = '✕ 地图底图缺失，导出已中止<br>'+
    '<button type="button" class="status-btn" id="exportRetryBtn">重试</button>'+
    '<button type="button" class="status-btn" id="exportNoBasemapBtn">改用无底图导出</button>';
  $('exportRetryBtn').addEventListener('click', () => { setExportStatus('', 'clear'); retryFn(); });
  $('exportNoBasemapBtn').addEventListener('click', () => { setExportStatus('', 'clear'); exportState.forceNoBasemap = true; retryFn(); });
}
