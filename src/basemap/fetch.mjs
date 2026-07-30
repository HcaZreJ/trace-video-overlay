import { computeAmapUrlForTrack } from '../core/amap.mjs';
import { diagnoseAmapApiError } from './diagnose.mjs';
import { loadImageFromBlob, loadImageDirect } from './image.mjs';

// ==================== 高德静图 fetch 层 ====================
// 浏览器运行时：fetch + JSON 诊断 + Image 兜底 + 内存缓存 + 15s 超时。
// 恒 size=1024、scale=2；静图内容视野恒等于 1024 世界像素 → contentSize=1024。
const amapBasemapCache = new Map();
async function fetchBasemapViaHttp(url){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  let looksJson = contentType.includes('json');
  let peeked = null;
  if(!looksJson){
    try {
      peeked = await resp.clone().text();
      if(peeked.trim().startsWith('{')) looksJson = true;
    } catch(_){ /* 二进制内容可能无法安全解码为文本，忽略即可 */ }
  }
  if(looksJson){
    let data = null;
    try { data = JSON.parse(peeked != null ? peeked : await resp.text()); } catch(_){ /* 非合法 JSON，走通用失败分支 */ }
    if(data && data.info && data.info !== 'OK') throw diagnoseAmapApiError(data.info, data.infocode);
    const err = new Error('fetchAmapBasemap: unexpected JSON response');
    err.code = 'fetch_failed';
    throw err;
  }
  const blob = await resp.blob();
  return loadImageFromBlob(blob);
}
export async function fetchAmapBasemap({ pointsWgs84, key, traffic }){
  const { url, center, zoom, spanPx } = computeAmapUrlForTrack(pointsWgs84, 1024, key, 2, traffic);
  if(amapBasemapCache.has(url)) return { image: amapBasemapCache.get(url), center, zoom, spanPx, contentSize: 1024, url };
  let image;
  try {
    image = await fetchBasemapViaHttp(url);
  } catch(err) {
    if(err && err.code === 'amap_api_error') throw err;
    try {
      image = await loadImageDirect(url);
    } catch(_fallbackErr){
      const finalErr = new Error('底图加载失败：网络问题或跨域受限');
      finalErr.code = 'fetch_failed';
      throw finalErr;
    }
  }
  amapBasemapCache.set(url, image);
  return { image, center, zoom, spanPx, contentSize: 1024, url };
}
