// ==================== 本地时区的时刻格式化与解析 ====================
// datetime-local 控件、扫拨条标签、导出成功文案都按本地墙钟显示时刻。
// 这里是零浏览器 API 的纯函数，Node 直接单测——时区往返是本模块最需要被盯住的地方。

// toLocalInputValue：毫秒 epoch → datetime-local 的取值 `YYYY-MM-DDTHH:mm:ss`。
export function toLocalInputValue(ms) {
  throw new Error('NotImplementedError: toLocalInputValue');
}

// parseLocalInputValue：`YYYY-MM-DDTHH:mm[:ss[.sss]]` → 毫秒 epoch，按本地时区解析。
export function parseLocalInputValue(text) {
  throw new Error('NotImplementedError: parseLocalInputValue');
}

// formatLocalHms：毫秒 epoch → `HH:MM:SS`（本地分量，补零）。
export function formatLocalHms(ms) {
  throw new Error('NotImplementedError: formatLocalHms');
}

// formatLocalIso：毫秒 epoch → `YYYY-MM-DD HH:MM:SS`（本地分量）。
export function formatLocalIso(ms) {
  throw new Error('NotImplementedError: formatLocalIso');
}
