// ==================== 本地时区的时刻格式化与解析 ====================
// datetime-local 控件、扫拨条标签、导出成功文案都按本地墙钟显示时刻。
// 这里是零浏览器 API 的纯函数，Node 直接单测——时区往返是本模块最需要被盯住的地方。

const pad2 = (n) => String(n).padStart(2, '0');
const pad4 = (n) => String(n).padStart(4, '0');

// 毫秒 epoch → Date；非有限数与 Date 值域外的数都给 null，由各格式化函数回落成空串。
function localDate(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

// toLocalInputValue：毫秒 epoch → datetime-local 的取值 `YYYY-MM-DDTHH:mm:ss`。
export function toLocalInputValue(ms) {
  const d = localDate(ms);
  if (!d) return '';
  return `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// parseLocalInputValue：`YYYY-MM-DDTHH:mm[:ss[.sss]]` → 毫秒 epoch，按本地时区解析。
// 正则锚定首尾：datetime-local 的取值不带时区后缀，带后缀或纯日期串都属格式不匹配。
export function parseLocalInputValue(text) {
  if (typeof text !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text.trim());
  if (!m) return NaN;
  const frac = m[7] ? +m[7].padEnd(3, '0') : 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, frac).getTime();
}

// formatLocalHms：毫秒 epoch → `HH:MM:SS`（本地分量，补零）。
export function formatLocalHms(ms) {
  const d = localDate(ms);
  if (!d) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// formatLocalIso：毫秒 epoch → `YYYY-MM-DD HH:MM:SS`（本地分量）。
export function formatLocalIso(ms) {
  const d = localDate(ms);
  if (!d) return '';
  return `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + ` ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
