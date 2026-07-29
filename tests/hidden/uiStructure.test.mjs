import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readCss, readJs, readInlineScripts } from '../helpers/source.mjs';

/* ==================== index.html 三段切分（style / body HTML / 内联 script） ==================== */

const INDEX_PATH = fileURLToPath(new URL('../../index.html', import.meta.url));
const SRC = readFileSync(INDEX_PATH, 'utf8');

/** 连续空白折叠成单空格并裁剪两端，让断言对换行与缩进宽容。 */
const collapse = s => s.replace(/\s+/g, ' ').trim();

/** 取 <body>…</body> 内的标记，剔除 <script> 段，只留 HTML。 */
function extractBodyHtml(src) {
  const m = src.match(/<body\b[^>]*>([\s\S]*?)<\/body>/);
  assert.ok(m, 'index.html 应当含有 <body>…</body>');
  return m[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
}

const CSS = readCss();
const INLINE_SCRIPTS = readInlineScripts(SRC);
const JS = readJs();
const HTML = extractBodyHtml(SRC);

/* ==================== HTML / JS 抽取小工具 ==================== */

/** 取 HTML 里某个属性的全部取值（`id`、`for`、`class` 等）。 */
function attrValues(html, attr) {
  const re = new RegExp(`(?<![-\\w])${attr}=["']([^"']*)["']`, 'g');
  return [...html.matchAll(re)].map(m => m[1]);
}

/** 取单个标签字符串上某个属性的值；无该属性返回 null。 */
function attrOf(tag, attr) {
  const m = tag.match(new RegExp(`(?<![-\\w])${attr}=["']([^"']*)["']`));
  return m ? m[1] : null;
}

/** 取带某个 id 的起始标签（含全部属性）。 */
function tagWithId(id) {
  const m = HTML.match(new RegExp(`<[a-zA-Z][^>]*(?<![-\\w])id=["']${id}["'][^>]*>`));
  return m ? m[0] : null;
}

/** HTML 里全部起始标签。 */
const ALL_TAGS = [...HTML.matchAll(/<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g)].map(m => m[0]);

/** 取 class 列表含某个类名的全部起始标签。 */
function tagsWithClass(cls) {
  return ALL_TAGS.filter(t => (attrOf(t, 'class') || '').split(/\s+/).includes(cls));
}

/** 取标签名为 name 的全部起始标签。 */
function tagsNamed(name) {
  return ALL_TAGS.filter(t => new RegExp(`^<${name}\\b`, 'i').test(t));
}

/** 从内联 script 里按大括号配对切出某个具名函数的函数体。 */
function functionBody(js, name) {
  const start = js.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (start < 0) return null;
  const open = js.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') {
      depth--;
      if (depth === 0) return js.slice(open + 1, i);
    }
  }
  return null;
}

const HTML_ID_LIST = attrValues(HTML, 'id');
const HTML_IDS = new Set(HTML_ID_LIST);

/** 内联 script 里 `$('id')` 引用到的全部字面量 id。 */
const DOLLAR_REFS = [...new Set([...JS.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]))];

/** 内联 script 里 `getElementById('id')` 引用到的全部字面量 id。 */
const GEBI_REFS = [
  ...new Set([...JS.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])),
];

/** 运行时才创建、允许缺席于 HTML 的 id。 */
const DYNAMIC_IDS = new Set(['exportRetryBtn', 'exportNoBasemapBtn']);

/** 基线 id 清单（66 个）：允许新增，不允许减少。 */
const BASELINE_IDS = collapse(`
  loadSample card previewScrub previewScrubLabel previewPlay previewProgress info dot
  drop trackGateHint file fileList trackErrors trackUndo bgModeSegmented bgModeSolidLabel
  bgModeSolid bgModeMapLabel bgModeMap mapOverlay bgColor bgOpacity bgOpacityV bgMapFields
  amapKey mapTraffic mapMaskOpacityField mapMaskOpacity mapMaskOpacityV mapViewScale
  mapViewScaleV mapPreview mapOverlayStatus radius radiusV pad padV lineColor lineWidth
  lineWidthV showMarkers startColor endColor markerSize markerSizeV dotColor dotSize dotSizeV
  exportRes mp4UnsupportedHint mp4Duration mp4Fps mp4BgMode mp4PageColorField mp4PageColor
  mp4GreenColorField mp4GreenColor mp4ProgressWrap mp4ProgressV mp4Progress exportStatus
  expCard expDot expMp4 exportRetryBtn exportNoBasemapBtn
`).split(' ');

/* ==================== 0 · 切分自检 ==================== */

test('uiStructure: index.html 切成 style / body HTML / 内联 script 三段', () => {
  assert.ok(CSS.length > 500, `<style> 段应当非空，实际长度 ${CSS.length}`);
  assert.ok(HTML.length > 500, `<body> 段应当非空，实际长度 ${HTML.length}`);
  assert.equal(INLINE_SCRIPTS.length, 1, '页面应当只有一段内联 script');
  assert.ok(JS.length > 5000, `内联 script 应当非空，实际长度 ${JS.length}`);
  assert.ok(!/<script\b/.test(HTML), 'HTML 段里不应当残留 <script> 标记');

  const muxerAt = SRC.indexOf('<script src="mp4-muxer.js">');
  assert.ok(muxerAt > -1, 'mp4-muxer.js 应当以外部 script 引入');
  assert.ok(
    SRC.indexOf(JS.slice(0, 80)) > muxerAt,
    '内联 script 应当位于 <script src="mp4-muxer.js"> 之后'
  );
});

/* ==================== 1 · script 的 id 引用都能落地 ==================== */

test('uiStructure: 内联 script 里每个 $(\'id\') 都能在 HTML 里找到对应元素', () => {
  assert.ok(DOLLAR_REFS.length >= 40, `$('id') 抽取应当非空，实际只抽到 ${DOLLAR_REFS.length} 个`);

  const missing = DOLLAR_REFS.filter(id => !DYNAMIC_IDS.has(id) && !HTML_IDS.has(id));
  assert.deepEqual(missing, [], `$() 引用了 HTML 中不存在的 id：${missing.join(', ')}`);
});

test('uiStructure: 内联 script 里每个 getElementById(\'id\') 字面量都能在 HTML 里找到', () => {
  const missing = GEBI_REFS.filter(id => !DYNAMIC_IDS.has(id) && !HTML_IDS.has(id));
  assert.deepEqual(
    missing,
    [],
    `getElementById() 引用了 HTML 中不存在的 id：${missing.join(', ')}`
  );
});

test('uiStructure: exportRetryBtn / exportNoBasemapBtn 由内联 script 运行时创建，允许缺席 HTML', () => {
  for (const id of DYNAMIC_IDS) {
    assert.ok(JS.includes(id), `${id} 应当出现在内联 script 里（运行时创建）`);
  }
});

/* ==================== 2 · label[for] 都有目标 ==================== */

test('uiStructure: 每个 label[for] 都指向 HTML 中存在的 id', () => {
  const labelTags = tagsNamed('label').filter(t => attrOf(t, 'for') !== null);
  assert.ok(labelTags.length >= 5, `应当抽到若干 label[for]，实际 ${labelTags.length} 个`);

  const dangling = labelTags.map(t => attrOf(t, 'for')).filter(id => !HTML_IDS.has(id));
  assert.deepEqual(dangling, [], `label[for] 指向了不存在的 id：${dangling.join(', ')}`);
});

/* ==================== 3 · 基线 id 清单 ==================== */

test('uiStructure: 66 个基线 id 一个不少', () => {
  assert.equal(BASELINE_IDS.length, 66, '基线清单本身应当是 66 个 id');
  assert.equal(new Set(BASELINE_IDS).size, 66, '基线清单内部不应当有重复项');

  const missing = BASELINE_IDS.filter(id => !DYNAMIC_IDS.has(id) && !HTML_IDS.has(id));
  assert.deepEqual(missing, [], `HTML 中缺失的基线 id：${missing.join(', ')}`);
});

test('uiStructure: HTML 中的 id 互不重复', () => {
  const seen = new Set();
  const dupes = [];
  for (const id of HTML_ID_LIST) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  assert.deepEqual(dupes, [], `HTML 中出现了重复 id：${dupes.join(', ')}`);
});

/* ==================== 4 · 语法闸门 ==================== */

test('uiStructure: 内联 script 整段能被 new Function 编译通过', () => {
  assert.doesNotThrow(() => new Function(JS), '内联 script 存在语法错误');
});

/* ==================== 5 · a11y 属性齐全 ==================== */

test('uiStructure: 五个状态区域都带 aria-live="polite"', () => {
  for (const id of ['info', 'trackErrors', 'trackUndo', 'mapOverlayStatus', 'exportStatus']) {
    const tag = tagWithId(id);
    assert.ok(tag, `HTML 中应当存在 #${id}`);
    assert.equal(attrOf(tag, 'aria-live'), 'polite', `#${id} 应当带 aria-live="polite"`);
  }
});

test('uiStructure: #drop 带 role="button" 与 tabindex="0"', () => {
  const tag = tagWithId('drop');
  assert.ok(tag, 'HTML 中应当存在 #drop');
  assert.equal(attrOf(tag, 'role'), 'button', '#drop 应当带 role="button"');
  assert.equal(attrOf(tag, 'tabindex'), '0', '#drop 应当带 tabindex="0"');
});

test('uiStructure: #card 与 #dot 带 role="img" 与非空 aria-label', () => {
  for (const id of ['card', 'dot']) {
    const tag = tagWithId(id);
    assert.ok(tag, `HTML 中应当存在 #${id}`);
    assert.equal(attrOf(tag, 'role'), 'img', `#${id} 应当带 role="img"`);
    const label = attrOf(tag, 'aria-label');
    assert.ok(label && collapse(label).length > 0, `#${id} 应当带非空 aria-label`);
  }
});

test('uiStructure: 每个 input.val 都有可访问名称（aria-label 或关联的 label[for]）', () => {
  const valInputs = tagsWithClass('val').filter(t => /^<input\b/i.test(t));
  assert.ok(valInputs.length >= 5, `应当抽到若干 input.val，实际 ${valInputs.length} 个`);

  const labelledIds = new Set(
    tagsNamed('label')
      .map(t => attrOf(t, 'for'))
      .filter(Boolean)
  );
  const bad = valInputs
    .filter(t => !collapse(attrOf(t, 'aria-label') || '') && !labelledIds.has(attrOf(t, 'id')))
    .map(t => attrOf(t, 'id') || t);
  assert.deepEqual(bad, [], `缺少可访问名称的 input.val：${bad.join(', ')}`);
});

test('uiStructure: 滑杆旁的数值框（input.val）绝大多数直接带 aria-label', () => {
  const valInputs = tagsWithClass('val').filter(t => /^<input\b/i.test(t));
  const withAria = valInputs.filter(t => collapse(attrOf(t, 'aria-label') || ''));
  assert.ok(
    withAria.length >= valInputs.length - 1,
    `input.val 共 ${valInputs.length} 个，带 aria-label 的只有 ${withAria.length} 个；` +
      '只允许有 label[for] 关联的那一个数值框省略 aria-label'
  );
});

test('uiStructure: 每个 segmented 容器都带 role="radiogroup" 与非空 aria-label', () => {
  const segs = tagsWithClass('segmented');
  assert.ok(segs.length >= 1, '至少应当有一个 .segmented 容器');

  for (const tag of segs) {
    const id = attrOf(tag, 'id') || tag;
    assert.equal(attrOf(tag, 'role'), 'radiogroup', `.segmented（${id}）应当带 role="radiogroup"`);
    const label = attrOf(tag, 'aria-label');
    assert.ok(label && collapse(label).length > 0, `.segmented（${id}）应当带非空 aria-label`);
  }
});

/* ==================== 6 · setTrackGate 的 gate 契约 ==================== */

test('uiStructure: setTrackGate 对 [data-gate] 同时设置 needs-track 与 inert', () => {
  const body = functionBody(JS, 'setTrackGate');
  assert.ok(body, '内联 script 里应当存在 function setTrackGate');

  const flat = collapse(body);
  assert.match(flat, /\[data-gate\]/, 'setTrackGate 应当遍历 [data-gate] 元素');
  assert.match(
    flat,
    /classList\.toggle\(\s*['"]needs-track['"]\s*,/,
    'setTrackGate 应当 classList.toggle("needs-track", …)'
  );
  assert.match(flat, /inert/, 'setTrackGate 应当同步 inert');
});

test('uiStructure: HTML 中存在 [data-gate] 容器供 setTrackGate 驱动', () => {
  const gated = ALL_TAGS.filter(t => /(?<![-\w])data-gate\b/.test(t));
  assert.ok(gated.length >= 1, 'HTML 中至少应当有一个 [data-gate] 容器');
});

/* ==================== 7 · COLOR_INPUT_IDS ↔ input[type=color] ==================== */

test('uiStructure: COLOR_INPUT_IDS 与 HTML 里的 input[type=color] 一一对应（7 个）', () => {
  const m = JS.match(/COLOR_INPUT_IDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, '内联 script 里应当存在 COLOR_INPUT_IDS 数组');
  const declared = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);

  const inHtml = tagsNamed('input')
    .filter(t => attrOf(t, 'type') === 'color')
    .map(t => attrOf(t, 'id'));

  assert.equal(declared.length, 7, `COLOR_INPUT_IDS 应当是 7 个 id，实际 ${declared.length} 个`);
  assert.equal(inHtml.length, 7, `HTML 里应当有 7 个 input[type=color]，实际 ${inHtml.length} 个`);

  const missingInHtml = declared.filter(id => !inHtml.includes(id));
  assert.deepEqual(
    missingInHtml,
    [],
    `COLOR_INPUT_IDS 里的 id 在 HTML 中没有对应 color input：${missingInHtml.join(', ')}`
  );

  const missingInArray = inHtml.filter(id => !declared.includes(id));
  assert.deepEqual(
    missingInArray,
    [],
    `HTML 里的 color input 未登记进 COLOR_INPUT_IDS：${missingInArray.join(', ')}`
  );
});

test('uiStructure: 七个颜色输入的 id 都在基线 id 清单里', () => {
  const m = JS.match(/COLOR_INPUT_IDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, '内联 script 里应当存在 COLOR_INPUT_IDS 数组');
  const declared = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);

  const offList = declared.filter(id => !BASELINE_IDS.includes(id));
  assert.deepEqual(offList, [], `未登记进基线清单的颜色输入 id：${offList.join(', ')}`);
});
