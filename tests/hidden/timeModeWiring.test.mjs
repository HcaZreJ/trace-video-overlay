/**
 * timeModeWiring · 装配接线的静态断言
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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, listAppModulePaths } from '../helpers/source.mjs';

const MAIN_PATH = join(ROOT, 'src/main.mjs');
const PANEL_PATH = join(ROOT, 'src/ui/track-panel.mjs');
const TIME_MODE_PATH = join(ROOT, 'src/ui/time-mode.mjs');

const MAIN = readFileSync(MAIN_PATH, 'utf8');
const PANEL = readFileSync(PANEL_PATH, 'utf8');

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
function assertWired(js, { label, anchor, id, events = [], fns = [], anyEvents = [] }) {
  const found = findBindings(js, anchor, id);
  assert.ok(found.length > 0, `${label}：源码里应当存在一处把它接到 addEventListener 上的片段`);

  const nearText = collapse(found.map(b => resolveArrays(js, b.near)).join('\n'));
  for (const ev of events) {
    assert.match(nearText, new RegExp(`['"]${ev}['"]`), `${label}：应当绑定 ${ev} 事件`);
  }
  if (anyEvents.length) {
    assert.match(
      nearText,
      new RegExp(`['"](${anyEvents.join('|')})['"]`),
      `${label}：应当绑定 ${anyEvents.join(' 或 ')} 事件`
    );
  }

  const callText = collapse(found.map(b => expand(js, b.call)).join('\n'));
  for (const fn of fns) {
    assert.match(callText, new RegExp(`\\b${fn}\\s*\\(`), `${label}：处理里应当调用 ${fn}()`);
  }
}

/**
 * 某个 id 在事件 ev 上是否有绑定。两种写法都算：
 *   `$('id').addEventListener('ev', …)` 与 `$('id').onev = …`。
 */
function isBound(js, id, ev) {
  if (new RegExp(`['"]#?${id}['"]\\s*\\)?\\s*\\.\\s*on${ev}\\s*=`).test(js)) return true;
  const found = findBindings(js, idAnchor(id), id);
  return found.some(b => new RegExp(`['"]${ev}['"]`).test(b.near));
}

/** 某个模块 import 自某个来源的全部具名符号。 */
function importedFrom(js, sourceRe) {
  const names = [];
  for (const m of js.matchAll(/import\s+([^;]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (!sourceRe.test(m[2])) continue;
    for (const part of m[1].replace(/[{}]/g, ' ').split(',')) {
      const name = collapse(part.split(/\bas\b/)[0]);
      if (name) names.push(name);
    }
  }
  return names;
}

/** 一个模块 import 到的全部来源路径。 */
function importSources(js) {
  return [...js.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);
}

/** 文件行数（尾随换行不计）。 */
const lineCount = src => src.replace(/\n+$/, '').split('\n').length;

/** 首屏初始化段：updateExportKindUI() 到 updatePreviewScrubLabel() 之间的裸调用序列。 */
function initRegions(js) {
  const regions = [];
  for (const m of js.matchAll(/updateExportKindUI\s*\(\s*\)/g)) {
    const rest = js.slice(m.index, m.index + 600);
    const endRel = rest.search(/updatePreviewScrubLabel\s*\(\s*\)/);
    if (endRel < 0) continue;
    const between = rest.slice(0, endRel);
    if (/=>|\bfunction\b|addEventListener/.test(between)) continue;
    regions.push(between);
  }
  return regions;
}

/* ==================== 1 · main.mjs 的 import ==================== */

test('timeModeWiring · main(装配): 从 ./ui/time-mode.mjs 导入 refreshTimeMode 与 updateTimeModeUI', () => {
  const names = importedFrom(MAIN, /time-mode\.mjs$/);
  assert.ok(names.length > 0, 'main.mjs 应当从 ./ui/time-mode.mjs 导入');
  for (const fn of ['refreshTimeMode', 'updateTimeModeUI']) {
    assert.ok(names.includes(fn), `main.mjs 应当从 ./ui/time-mode.mjs 导入 ${fn}，实际导入：${names.join(', ')}`);
  }
});

test('timeModeWiring · main(装配): time-mode 的导入来源是 ./ui/ 下的相对路径', () => {
  const sources = importSources(MAIN).filter(s => /time-mode\.mjs$/.test(s));
  assert.ok(sources.length > 0, 'main.mjs 应当 import time-mode.mjs');
  for (const s of sources) {
    assert.match(s, /^\.\/ui\/time-mode\.mjs$/, `入口对同层模块用 ./ui/ 相对路径，实际：${s}`);
  }
});

/* ==================== 2 · 时间模式控件的事件接线 ==================== */

test('timeModeWiring · main(装配): input[name=mp4TimeMode] 的 change 接上三件事', () => {
  assert.match(
    MAIN,
    /name[^\n]{0,16}mp4TimeMode/i,
    'main.mjs 应当按 name=mp4TimeMode 取到两个模式 radio'
  );
  assertWired(MAIN, {
    label: 'input[name=mp4TimeMode]',
    anchor: /mp4TimeMode/g,
    events: ['change'],
    fns: ['updateTimeModeUI', 'updatePreviewScrubLabel', 'render'],
  });
});

for (const id of ['mp4TimeStart', 'mp4TimeEnd', 'mp4TimeScale']) {
  test(`timeModeWiring · main(装配): #${id} 的 input 与 change 都刷新时间模式界面`, () => {
    assertWired(MAIN, {
      label: `#${id}`,
      anchor: idAnchor(id),
      id,
      events: ['input', 'change'],
      fns: ['updateTimeModeUI', 'updatePreviewScrubLabel'],
    });
  });
}

test('timeModeWiring · main(装配): #mp4TrueFps 的 change 刷新时间模式界面与刻度文案', () => {
  assertWired(MAIN, {
    label: '#mp4TrueFps',
    anchor: idAnchor('mp4TrueFps'),
    id: 'mp4TrueFps',
    events: ['change'],
    fns: ['updateTimeModeUI', 'updatePreviewScrubLabel'],
  });
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

test('timeModeWiring · main(装配): 接线用的 id 字面量都能在 index.html 里落地', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const ids = [
    'mp4TimeStart', 'mp4TimeEnd', 'mp4TimeScale',
    'mp4TrueFps', 'mp4CollapseGaps', 'mp4Quality', 'mp4Duration', 'exportRes',
  ];
  for (const id of ids) {
    assert.match(MAIN, idAnchor(id), `main.mjs 应当接上 #${id}`);
    assert.match(html, new RegExp(`id=['"]${id}['"]`), `index.html 里应当存在 #${id}`);
  }
  assert.match(
    html,
    /name=['"]mp4TimeMode['"]/,
    'index.html 里应当存在 name="mp4TimeMode" 的模式 radio'
  );
});

test('timeModeWiring · main(装配): #mp4Quality 的 change 刷新体积估算', () => {
  assertWired(MAIN, {
    label: '#mp4Quality',
    anchor: idAnchor('mp4Quality'),
    id: 'mp4Quality',
    events: ['change'],
    fns: ['updateTimeModeUI'],
  });
});

test('timeModeWiring · main(装配): #exportRes 既有的 render 保留，另加 updateTimeModeUI', () => {
  assertWired(MAIN, {
    label: '#exportRes',
    anchor: idAnchor('exportRes'),
    id: 'exportRes',
    events: ['change'],
    fns: ['render', 'updateTimeModeUI'],
  });
});

test('timeModeWiring · main(装配): #mp4Duration 既有绑定之后追加 updateTimeModeUI', () => {
  assertWired(MAIN, {
    label: '#mp4Duration',
    anchor: idAnchor('mp4Duration'),
    id: 'mp4Duration',
    anyEvents: ['input', 'change'],
    fns: ['updateTimeModeUI'],
  });
});

/* ==================== 3 · 首屏初始化 ==================== */

test('timeModeWiring · main(初始化): refreshTimeMode 与 updateTimeModeUI 夹在既有两句之间', () => {
  const regions = initRegions(MAIN);
  assert.ok(
    regions.length > 0,
    '应当存在一段首屏初始化：updateExportKindUI() 之后跟着 updatePreviewScrubLabel()'
  );
  const hit = regions.filter(
    r => /refreshTimeMode\s*\(\s*\)/.test(r) && /updateTimeModeUI\s*\(\s*\)/.test(r)
  );
  assert.ok(
    hit.length > 0,
    '首屏初始化应当在 updateExportKindUI() 与 updatePreviewScrubLabel() 之间调用 '
      + 'refreshTimeMode() 与 updateTimeModeUI()'
  );
});

test('timeModeWiring · main(初始化): 先 refreshTimeMode 算时间轴，后 updateTimeModeUI 定界面', () => {
  const regions = initRegions(MAIN);
  assert.ok(regions.length > 0, '应当存在一段首屏初始化');
  const ok = regions.some(r => {
    const refresh = r.search(/refreshTimeMode\s*\(\s*\)/);
    const update = r.search(/updateTimeModeUI\s*\(\s*\)/);
    return refresh >= 0 && update >= 0 && refresh < update;
  });
  assert.ok(ok, '时间轴先算出来，界面才知道该显示哪个面板：refreshTimeMode() 应当排在 updateTimeModeUI() 之前');
});

/* ==================== 4 · track-panel.mjs 的两处出口 ==================== */

test('timeModeWiring · track-panel: 从 ./time-mode.mjs 导入 refreshTimeMode 与 updateTimeModeUI', () => {
  const names = importedFrom(PANEL, /time-mode\.mjs$/);
  assert.ok(names.length > 0, 'track-panel.mjs 应当从 ./time-mode.mjs 导入');
  for (const fn of ['refreshTimeMode', 'updateTimeModeUI']) {
    assert.ok(
      names.includes(fn),
      `track-panel.mjs 应当导入 ${fn}，实际导入：${names.join(', ')}`
    );
  }
});

test('timeModeWiring · track-panel: recomputeTrack 末尾刷新时间模式', () => {
  const body = functionBody(PANEL, 'recomputeTrack');
  assert.ok(body, 'track-panel.mjs 里应当能取到 recomputeTrack 的函数体');
  const flat = collapse(body);

  assert.match(flat, /\brefreshTimeMode\s*\(/, 'recomputeTrack 应当调用 refreshTimeMode()');
  assert.match(flat, /\bupdateTimeModeUI\s*\(/, 'recomputeTrack 应当调用 updateTimeModeUI()');
  assert.ok(
    flat.search(/\brefreshTimeMode\s*\(/) < flat.search(/\bupdateTimeModeUI\s*\(/),
    'recomputeTrack 里应当先 refreshTimeMode() 后 updateTimeModeUI()'
  );
  assert.ok(
    flat.search(/\bconcatTrackPoints\s*\(/) < flat.search(/\brefreshTimeMode\s*\(/),
    '时间轴刷新应当排在轨迹点重算之后'
  );
});

test('timeModeWiring · track-panel: clearTrack 清空后让时间真实模式回落', () => {
  const body = functionBody(PANEL, 'clearTrack');
  assert.ok(body, 'track-panel.mjs 里应当能取到 clearTrack 的函数体');
  const flat = collapse(body);

  assert.match(flat, /\brefreshTimeMode\s*\(/, 'clearTrack 应当调用 refreshTimeMode()');
  assert.match(flat, /\bupdateTimeModeUI\s*\(/, 'clearTrack 应当调用 updateTimeModeUI()');
  assert.ok(
    flat.search(/\brefreshTimeMode\s*\(/) < flat.search(/\bupdateTimeModeUI\s*\(/),
    'clearTrack 里应当先 refreshTimeMode() 后 updateTimeModeUI()'
  );
});

test('timeModeWiring · track-panel: recomputeTrack 既有的中枢逻辑逐条仍在', () => {
  const body = functionBody(PANEL, 'recomputeTrack');
  assert.ok(body, 'track-panel.mjs 里应当能取到 recomputeTrack 的函数体');
  const flat = collapse(body);
  for (const fn of ['concatTrackPoints', 'setTrackGate', 'render']) {
    assert.match(flat, new RegExp(`\\b${fn}\\s*\\(`), `recomputeTrack 应当保留对 ${fn}() 的调用`);
  }
});

/* ==================== 5 · 依赖方向与无环 ==================== */

test('timeModeWiring · 依赖方向: 没有任何模块反向导入入口 main.mjs', () => {
  const offenders = [];
  for (const path of listAppModulePaths()) {
    const rel = path.slice(ROOT.length + 1);
    if (rel === join('src', 'main.mjs')) continue;
    for (const source of importSources(readFileSync(path, 'utf8'))) {
      if (/(^|\/)main\.mjs$/.test(source)) offenders.push(`${rel} → ${source}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `main.mjs 是装配入口，依赖只能从它流向各层：\n${offenders.join('\n')}`
  );
});

test('timeModeWiring · 依赖方向: time-mode.mjs 不导入 track-panel.mjs，两者不成环', () => {
  assert.ok(existsSync(TIME_MODE_PATH), 'src/ui/time-mode.mjs 应当存在');
  const sources = importSources(readFileSync(TIME_MODE_PATH, 'utf8'));
  const cyclic = sources.filter(s => /track-panel\.mjs$/.test(s));
  assert.deepEqual(
    cyclic,
    [],
    `track-panel.mjs 导入 time-mode.mjs，反向导入会成环：${cyclic.join(', ')}`
  );
});

/* ==================== 6 · 既有绑定与文件约束未被破坏 ==================== */

for (const id of ['expMp4', 'expCard', 'expDot']) {
  test(`timeModeWiring · main(既有): #${id} 的 click 绑定仍在`, () => {
    assert.ok(isBound(MAIN, id, 'click'), `#${id} 的 click 绑定应当保留在 main.mjs 里`);
  });
}

test('timeModeWiring · main(既有): input[name=exportKind] 的 change 绑定仍在', () => {
  assertWired(MAIN, { label: 'input[name=exportKind]', anchor: /exportKind/g, events: ['change'] });
});

test('timeModeWiring · main(既有): #previewProgress 的 input 绑定仍在', () => {
  assert.ok(
    isBound(MAIN, 'previewProgress', 'input'),
    '#previewProgress 的 input 绑定应当保留在 main.mjs 里'
  );
});

test('timeModeWiring · 文件约束: main.mjs 与 track-panel.mjs 都在 200 行以内', () => {
  const mainLines = lineCount(MAIN);
  const panelLines = lineCount(PANEL);
  assert.ok(mainLines <= 200, `src/main.mjs 应当控制在 200 行以内，实际 ${mainLines} 行`);
  assert.ok(panelLines <= 200, `src/ui/track-panel.mjs 应当控制在 200 行以内，实际 ${panelLines} 行`);
});

test('timeModeWiring · 文件约束: 改动后的两个文件通过语法闸门', () => {
  for (const path of [MAIN_PATH, PANEL_PATH]) {
    const rel = path.slice(ROOT.length + 1);
    try {
      execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`${rel} 存在语法错误：${String(err.stderr || err.message).trim()}`);
    }
  }
});

test('timeModeWiring · track-panel(轨迹变动): 重算与清空后都刷新扫拨条标签', () => {
  // 时间真实模式下扫拨条标签显示的是当前进度对应的真实时刻，它依赖时间索引。
  // 换一条轨迹后索引重建，标签必须跟着刷新，否则会停在上一条轨迹的时刻上。
  for (const fn of ['recomputeTrack', 'clearTrack']) {
    const body = functionBody(PANEL, fn);
    assert.ok(body, `track-panel.mjs 应当定义 ${fn}`);
    assert.match(
      expand(PANEL, body),
      /updatePreviewScrubLabel\s*\(/,
      `${fn} 里应当调 updatePreviewScrubLabel，让标签跟上新的时间索引`,
    );
  }
});
