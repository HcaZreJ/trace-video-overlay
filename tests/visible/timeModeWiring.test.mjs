/**
 * timeModeWiring · 装配接线的静态断言（样例）
 *
 * 断言对象是 src/main.mjs 与 src/ui/track-panel.mjs 的源码文本。
 * main.mjs 是自上而下执行的装配脚本，import 它会立刻触碰 DOM 与 localStorage，
 * 因此这里读源码做结构断言，不加载模块。
 *
 * 断言对空白、引号、参数写法宽容：先折叠连续空白，再用正则匹配「某个 id 与
 * addEventListener 出现在同一段调用里，且该调用的处理体内出现了某个函数名」这类结构特征。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers/source.mjs';

const MAIN = readFileSync(join(ROOT, 'src/main.mjs'), 'utf8');

/* ==================== 源码扫描小工具 ==================== */

/** 连续空白折叠成单空格并裁剪两端，让断言对换行与缩进宽容。 */
const collapse = s => s.replace(/\s+/g, ' ').trim();

/** 跳过从 i 处（引号字符）开始的字符串/模板字面量，返回收尾引号的下标。 */
function skipString(js, i) {
  const q = js[i];
  for (let j = i + 1; j < js.length; j++) {
    if (js[j] === '\\') { j++; continue; }
    if (js[j] === q) return j;
  }
  return js.length - 1;
}

/** i 处是注释时跳过它，返回注释末字符的下标；不是注释时原样返回 i。 */
function skipComment(js, i) {
  if (js[i] !== '/') return i;
  if (js[i + 1] === '/') { const n = js.indexOf('\n', i); return n < 0 ? js.length - 1 : n; }
  if (js[i + 1] === '*') { const n = js.indexOf('*/', i + 2); return n < 0 ? js.length - 1 : n + 1; }
  return i;
}

/** 从 openIdx（open 字符处）起做括号配对，跳过字符串与注释；找不到配对返回 -1。 */
function matchPair(js, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < js.length; i++) {
    const c = js[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(js, i); continue; }
    if (c === '/') { const j = skipComment(js, i); if (j !== i) { i = j; continue; } }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 具名函数（或箭头常量）的函数体文本；找不到返回 null。 */
function functionBody(js, name) {
  const fnAt = js.search(new RegExp(`function\\s+${name}\\s*\\(`));
  let open = -1;
  if (fnAt >= 0) {
    const pClose = matchPair(js, js.indexOf('(', fnAt), '(', ')');
    if (pClose < 0) return null;
    open = js.indexOf('{', pClose);
  } else {
    const varAt = js.search(new RegExp(`(?:const|let|var)\\s+${name}\\s*=`));
    if (varAt < 0) return null;
    const arrow = js.indexOf('=>', varAt);
    if (arrow < 0) return null;
    open = js.indexOf('{', arrow);
  }
  if (open < 0) return null;
  const close = matchPair(js, open, '{', '}');
  return close < 0 ? null : js.slice(open + 1, close);
}

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'await', 'new', 'of', 'in', 'do', 'else', 'delete', 'void',
]);

/**
 * 把片段展开成「这个处理最终会调用到哪些函数」的文本：
 *   - 处理器以函数引用传入（addEventListener('change', render) / .onclick = run）时，
 *     等同于处理里调用了它，补一条 `name()`；
 *   - 片段里调用到的本地具名函数，展开一层函数体，覆盖「处理逻辑写在具名函数里」的写法。
 */
function expand(js, text) {
  const names = new Set();
  let out = text;

  for (const re of [
    /addEventListener\s*\(\s*[^,]+,\s*([A-Za-z_$][\w$]*)\s*[,)]/g,
    /\.\s*on[a-z]+\s*=\s*([A-Za-z_$][\w$]*)\s*[;,\n]/g,
  ]) {
    for (const m of text.matchAll(re)) out += `\n${m[1]}()`;
  }

  for (const m of out.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  for (const n of names) {
    if (KEYWORDS.has(n)) continue;
    const body = functionBody(js, n);
    if (body) out += '\n' + body;
  }
  return out;
}

/** id 在源码里的字面量形态：'id' / "id" / '#id'。 */
const idAnchor = id => new RegExp(`['"]#?${id}['"]`, 'g');

const MAX_GAP = 240;

/**
 * 抓手所在语句的起点：向前找最近的 `;`、`}` 或上一处 addEventListener，最多回溯 400 字符。
 * 停在语句边界，隔壁那条绑定的事件名就不会串进本条的判定窗口。
 */
function statementStart(js, idx) {
  const floor = Math.max(0, idx - 400);
  const head = js.slice(floor, idx);
  const stops = [head.lastIndexOf(';'), head.lastIndexOf('}'), head.lastIndexOf('addEventListener')];
  return floor + Math.max(...stops) + 1;
}

/**
 * 找出与某个抓手（id 字面量 / 选择器片段）关联的全部 addEventListener 调用。
 * 每项给出两段文本：
 *   near —— 抓手所在语句的起点到调用收尾，用来找事件名
 *           （`for (const ev of ['input','change']) …` 这类写法里事件名写在抓手之前）
 *   call —— 抓手到调用收尾，用来找处理体内的函数名
 */
function findBindings(js, anchor, id) {
  const out = [];
  const seen = new Set();
  const push = idx => {
    const ael = js.indexOf('addEventListener', idx);
    if (ael < 0 || ael - idx > MAX_GAP) return;
    const open = js.indexOf('(', ael);
    if (open < 0) return;
    const close = matchPair(js, open, '(', ')');
    if (close < 0 || seen.has(ael)) return;
    seen.add(ael);
    out.push({
      near: js.slice(statementStart(js, idx), close + 1),
      call: js.slice(idx, close + 1),
    });
  };

  for (const m of js.matchAll(anchor)) push(m.index);

  // 兜底：`const el = $('id')` 先取元素、后经变量名绑定的写法
  if (!out.length && id) {
    const decl = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^;\\n]*['"]#?${id}['"]`);
    const m = decl.exec(js);
    if (m) for (const u of js.matchAll(new RegExp(`\\b${m[1]}\\b`, 'g'))) push(u.index);
  }
  return out;
}

/** 把片段里引用到的数组常量（`const TIME_EVENTS = ['input', 'change']`）就地展开。 */
function resolveArrays(js, text) {
  let out = text;
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    if (KEYWORDS.has(m[1])) continue;
    const decl = new RegExp(`(?:const|let|var)\\s+${m[1]}\\s*=\\s*\\[([^\\]]*)\\]`).exec(js);
    if (decl) out += '\n' + decl[1];
  }
  return out;
}

/** 断言某个事件源被接上，且事件名与目标函数名都到位。 */
function assertWired(js, { label, anchor, id, events, fns }) {
  const found = findBindings(js, anchor, id);
  assert.ok(found.length > 0, `${label}：源码里应当存在一处把它接到 addEventListener 上的片段`);

  const nearText = collapse(found.map(b => resolveArrays(js, b.near)).join('\n'));
  for (const ev of events) {
    assert.match(nearText, new RegExp(`['"]${ev}['"]`), `${label}：应当绑定 ${ev} 事件`);
  }

  const callText = collapse(found.map(b => expand(js, b.call)).join('\n'));
  for (const fn of fns) {
    assert.match(callText, new RegExp(`\\b${fn}\\s*\\(`), `${label}：处理里应当调用 ${fn}()`);
  }
}

/* ==================== 用例 ==================== */

test('timeModeWiring · main(装配): 从 ./ui/time-mode.mjs 导入 refreshTimeMode 与 updateTimeModeUI', () => {
  const specifiers = [];
  for (const m of MAIN.matchAll(/import\s+([^;]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (/time-mode\.mjs$/.test(m[2])) specifiers.push(...m[1].replace(/[{}]/g, ' ').split(','));
  }
  const names = specifiers.map(s => collapse(s.split(/\bas\b/)[0]));

  assert.ok(names.includes('refreshTimeMode'), 'main.mjs 应当从 ./ui/time-mode.mjs 导入 refreshTimeMode');
  assert.ok(names.includes('updateTimeModeUI'), 'main.mjs 应当从 ./ui/time-mode.mjs 导入 updateTimeModeUI');
});

test('timeModeWiring · main(装配): #mp4CollapseGaps 的 change 走 refreshTimeMode 重建时间轴', () => {
  assertWired(MAIN, {
    label: '#mp4CollapseGaps',
    anchor: idAnchor('mp4CollapseGaps'),
    id: 'mp4CollapseGaps',
    events: ['change'],
    fns: ['refreshTimeMode', 'updateTimeModeUI', 'updatePreviewScrubLabel'],
  });
});

test('timeModeWiring · main(装配): 首屏初始化在 updateExportKindUI 与 updatePreviewScrubLabel 之间跑时间模式', () => {
  // 首屏初始化是一串裸调用语句：从 updateExportKindUI() 到 updatePreviewScrubLabel()
  // 之间不出现 =>、function、addEventListener，以此把初始化段与事件处理体区分开。
  const regions = [];
  for (const m of MAIN.matchAll(/updateExportKindUI\s*\(\s*\)/g)) {
    const rest = MAIN.slice(m.index, m.index + 600);
    const endRel = rest.search(/updatePreviewScrubLabel\s*\(\s*\)/);
    if (endRel < 0) continue;
    const between = rest.slice(0, endRel);
    if (/=>|\bfunction\b|addEventListener/.test(between)) continue;
    regions.push(between);
  }
  assert.ok(
    regions.length > 0,
    '应当存在一段首屏初始化：updateExportKindUI() 之后紧跟着 updatePreviewScrubLabel()'
  );

  const ok = regions.some(r => {
    const refresh = r.search(/refreshTimeMode\s*\(\s*\)/);
    const update = r.search(/updateTimeModeUI\s*\(\s*\)/);
    return refresh >= 0 && update >= 0 && refresh < update;
  });
  assert.ok(
    ok,
    '首屏初始化应当在 updateExportKindUI() 与 updatePreviewScrubLabel() 之间依次调用 '
      + 'refreshTimeMode() 与 updateTimeModeUI()'
  );
});
