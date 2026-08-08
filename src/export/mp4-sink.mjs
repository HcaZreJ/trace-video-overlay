// 导出层 · MP4 输出端：流式写盘与全内存两条封装路径，外加 sidecar 落盘。
// 流式路径把编码结果直接写进用户选定的文件，时长不再受内存约束；
// 浏览器缺少 File System Access API 时回落到全内存路径并保留 600 秒上限。

// 时长上限：流式 6 小时，内存 600 秒。
export const MP4_MAX_DURATION_STREAM = 21600;
export const MP4_MAX_DURATION_MEMORY = 600;

export function streamSinkSupported() {
  throw new Error('NotImplementedError: streamSinkSupported');
}

export async function createMp4Sink(options) {
  throw new Error('NotImplementedError: createMp4Sink');
}

export function downloadSidecar(meta, name) {
  throw new Error('NotImplementedError: downloadSidecar');
}
