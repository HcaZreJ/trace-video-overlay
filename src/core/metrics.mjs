import { trackDistanceKm } from './geo.mjs';

// ==================== 运动指标（时长/均速/配速/爬升） ====================
// 轨迹点可带 time(毫秒 epoch) 与 ele(米)。能算出则返回数值，缺数据返回 null。
// 运动时长(秒)：逐段累加，但跳过速度低于阈值的停顿段（等红灯/休息/过夜），与两步路/Strava 的"运动耗时"一致。
export function trackDurationSec(points){
  if(!points||points.length<2) return null;
  const R=6371000,toR=Math.PI/180,MIN_SPEED=0.5; // m/s
  let moving=0, any=false;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(typeof a.time!=='number'||typeof b.time!=='number') continue;
    const dt=(b.time-a.time)/1000; if(dt<=0) continue;
    any=true;
    const dLat=(b.lat-a.lat)*toR,dLng=(b.lng-a.lng)*toR;
    const h=Math.sin(dLat/2)**2+Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLng/2)**2;
    const dd=2*R*Math.asin(Math.sqrt(h));
    if(dd/dt>=MIN_SPEED) moving+=dt;
  }
  return any?moving:null;
}
export function avgSpeedKmh(points){
  const sec=trackDurationSec(points); if(!sec||sec<=0) return null;
  return trackDistanceKm(points)/(sec/3600);
}
export function paceSecPerKm(points){
  const sec=trackDurationSec(points), km=trackDistanceKm(points);
  if(!sec||!km||km<=0) return null;
  return sec/km;
}
// 总爬升(米)：先对海拔做移动平均平滑(窗口±win)去高频抖动，再用迟滞阈值累计上升。
// 纯累加/纯阈值都会因 GPS 海拔噪声虚高数倍；平滑+阈值更接近运动 App。
// 仍无法等同气压计+专有算法，多日/导出差异时可手改。
export function elevationGainM(points, win=5, threshold=5){
  const e=(points||[]).map(p=>p.ele).filter(v=>typeof v==='number');
  if(e.length<2) return null;
  const sm=e.map((_,i)=>{
    let s=0,n=0; const lo=Math.max(0,i-win),hi=Math.min(e.length-1,i+win);
    for(let j=lo;j<=hi;j++){ s+=e[j]; n++; }
    return s/n;
  });
  let gain=0, ref=sm[0];
  for(let i=1;i<sm.length;i++){
    if(sm[i]-ref>=threshold){ gain+=sm[i]-ref; ref=sm[i]; }
    else if(sm[i]<ref){ ref=sm[i]; }
  }
  return Math.round(gain);
}
export function formatDuration(sec){
  if(sec==null) return null;
  sec=Math.round(sec);
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
export function formatPace(secPerKm){
  if(secPerKm==null) return null;
  let m=Math.floor(secPerKm/60), s=Math.round(secPerKm%60);
  if(s===60){ m+=1; s=0; }
  return `${m}'${String(s).padStart(2,'0')}"`;
}
