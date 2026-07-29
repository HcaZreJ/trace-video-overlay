import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ==================== index.html 三段切分（style / body HTML / 内联 script） ==================== */

const INDEX_PATH = fileURLToPath(new URL('../../index.html', import.meta.url));
const SRC = readFileSync(INDEX_PATH, 'utf8');

/** 连续空白折叠成单空格并裁剪两端，让断言对换行与缩进宽容。 */
const collapse = s => s.replace(/\s+/g, ' ').trim();

/** 取全部 <style>…</style> 里的 CSS。 */
function extractCss(src) {
  return [...src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
}

/** 取内联 <script>（不带 src 属性的那些；<script src="mp4-muxer.js"> 是外部引用）。 */
function extractInlineScripts(src) {
  return [...src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m => !/\bsrc\s*=/.test(m[1]))
    .map(m => m[2]);
}

/** 取 <body>…</body> 内的标记，剔除 <script> 段，只留 HTML。 */
function extractBodyHtml(src) {
  const m = src.match(/<body\b[^>]*>([\s\S]*?)<\/body>/);
  assert.ok(m, 'index.html 应当含有 <body>…</body>');
  return m[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
}

const CSS = extractCss(SRC);
const INLINE_SCRIPTS = extractInlineScripts(SRC);
const JS = INLINE_SCRIPTS.join('\n');
const HTML = extractBodyHtml(SRC);

/** 取 HTML 里某个属性的全部取值（`id`、`for`、`class` 等）。 */
function attrValues(html, attr) {
  const re = new RegExp(`(?<![-\\w])${attr}=["']([^"']*)["']`, 'g');
  return [...html.matchAll(re)].map(m => m[1]);
}

const HTML_IDS = new Set(attrValues(HTML, 'id'));

/** 内联 script 里 `$('id')` 与 `getElementById('id')` 引用到的全部字面量 id。 */
function scriptIdRefs(js) {
  const refs = new Set();
  for (const m of js.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.add(m[1]);
  for (const m of js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.add(m[1]);
  return refs;
}

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

/* ==================== 测试 ==================== */

test('uiStructure: index.html 切成 style / body HTML / 内联 script 三段', () => {
  assert.ok(CSS.length > 500, `<style> 段应当非空，实际长度 ${CSS.length}`);
  assert.ok(HTML.length > 500, `<body> 段应当非空，实际长度 ${HTML.length}`);
  assert.equal(INLINE_SCRIPTS.length, 1, '页面应当只有一段内联 script');
  assert.ok(JS.length > 5000, `内联 script 应当非空，实际长度 ${JS.length}`);

  const muxerAt = SRC.indexOf('<script src="mp4-muxer.js">');
  assert.ok(muxerAt > -1, 'mp4-muxer.js 应当以外部 script 引入');
  assert.ok(
    SRC.indexOf(JS.slice(0, 80)) > muxerAt,
    '内联 script 应当位于 <script src="mp4-muxer.js"> 之后'
  );
});

test('uiStructure: 内联 script 引用的每个 id 都能在 HTML 里找到', () => {
  const refs = [...scriptIdRefs(JS)];
  assert.ok(refs.length >= 40, `id 引用抽取应当非空，实际只抽到 ${refs.length} 个`);

  const missing = refs.filter(id => !DYNAMIC_IDS.has(id) && !HTML_IDS.has(id));
  assert.deepEqual(missing, [], `内联 script 引用了 HTML 中不存在的 id：${missing.join(', ')}`);
});

test('uiStructure: 66 个基线 id 一个不少', () => {
  assert.equal(BASELINE_IDS.length, 66, '基线清单本身应当是 66 个 id');

  const missing = BASELINE_IDS.filter(id => !DYNAMIC_IDS.has(id) && !HTML_IDS.has(id));
  assert.deepEqual(missing, [], `HTML 中缺失的基线 id：${missing.join(', ')}`);

  for (const id of DYNAMIC_IDS) {
    assert.ok(JS.includes(id), `运行时创建的 ${id} 应当出现在内联 script 里`);
  }
});
