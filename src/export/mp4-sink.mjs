// 导出层 · MP4 输出端：流式写盘与全内存两条封装路径，外加 sidecar 落盘。
// 流式路径把编码结果直接写进用户选定的文件，时长不再受内存约束；
// 浏览器缺少 File System Access API 时回落到全内存路径并保留 600 秒上限。

// 时长上限：流式 6 小时，内存 600 秒。
export const MP4_MAX_DURATION_STREAM = 21600;
export const MP4_MAX_DURATION_MEMORY = 600;

export function streamSinkSupported() {
  if (typeof window === 'undefined' || !window) return false;
  if (typeof window.showSaveFilePicker !== 'function') return false;
  return !!(window.Mp4Muxer && window.Mp4Muxer.FileSystemWritableFileStreamTarget);
}

// Blob → 一次性 <a download> 点击，1 秒后释放 object URL。
function triggerBlobDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function createMp4Sink(options) {
  const { suggestedName, preferStream } = options || {};
  if (preferStream && streamSinkSupported()) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }],
    });
    const writable = await handle.createWritable();
    const target = new window.Mp4Muxer.FileSystemWritableFileStreamTarget(writable);
    return {
      kind: 'stream',
      target,
      fastStart: false,
      // 文件名在保存框选定时已确定，这里只收尾可写流。
      async finish() {
        await writable.close();
      },
      // 中止本就发生在错误路径上，吞掉次生错误以保留首因。
      async abort() {
        try {
          await writable.abort();
        } catch (_) { /* 忽略 */ }
      },
    };
  }
  const target = new window.Mp4Muxer.ArrayBufferTarget();
  return {
    kind: 'memory',
    target,
    fastStart: 'in-memory',
    async finish(name) {
      triggerBlobDownload(new Blob([target.buffer], { type: 'video/mp4' }), name);
    },
    async abort() { /* 内存路径无需收尾 */ },
  };
}

export function downloadSidecar(meta, name) {
  const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
  triggerBlobDownload(blob, name);
}
