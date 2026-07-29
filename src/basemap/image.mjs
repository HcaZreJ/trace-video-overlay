// ==================== 底图 Image 解码 ====================
// 两条解码路径：loadImageFromBlob 解 fetch 拿到的二进制，loadImageDirect 用 <img> 直连兜底。
// 失败与超时（15s）统一抛 err.code=fetch_failed。
export function loadImageFromBlob(blob){
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const err = new Error('fetchAmapBasemap: failed to decode basemap image');
      err.code = 'fetch_failed';
      reject(err);
    };
    img.src = objectUrl;
  });
}
export function loadImageDirect(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;
    const timer = setTimeout(() => {
      if(settled) return;
      settled = true;
      img.src = '';
      const err = new Error('fetchAmapBasemap: timed out loading basemap image');
      err.code = 'fetch_failed';
      reject(err);
    }, 15000);
    img.onload = () => {
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      const err = new Error('fetchAmapBasemap: failed to load basemap image');
      err.code = 'fetch_failed';
      reject(err);
    };
    img.src = url;
  });
}
