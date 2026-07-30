// T3 · uiExport 目标态断言（可见样例）
// spec: .claude/plans/ui-hierarchy-redesign.md → §4.5 / §9「T3 · uiExport（目标态）」
// 形态：读 index.html 源文件，切成 <style> CSS / <body> HTML / 内联 <script> JS 三段后做结构断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCss, readJs } from '../helpers/source.mjs';

const RAW = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/* ==================== 三段切片 ==================== */

function sliceDoc(raw) {
  const bodyM = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(raw);
  const html = (bodyM ? bodyM[1] : raw)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return { css: readCss(), html, js: readJs() };
}

const { html: HTML, js: JS } = sliceDoc(RAW);

/* ==================== 宽容工具 ==================== */

// JS 的 \s 已覆盖 nbsp，连续空白一律折叠成单空格再比较。
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

// 文案断言：同时接受「标签原样 / 标签换成空格 / 标签删掉」三种形态，
// 让 <small> 之类的内联包裹不影响判定。
function hasCopy(fragment, copy) {
  const forms = [fragment, fragment.replace(/<[^>]*>/g, ' '), fragment.replace(/<[^>]*>/g, '')];
  return forms.some((f) => collapse(f).includes(copy));
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const idPattern = (id) => `\\bid\\s*=\\s*["']${id}["']`;

function openTag(html, pattern, tagName) {
  const head = tagName ? `<${tagName}\\b` : '<[a-zA-Z][\\w-]*';
  const m = new RegExp(`${head}[^<>]*${pattern}[^<>]*>`).exec(html);
  return m ? { tag: m[0], start: m.index } : null;
}

// 从开标签向后做标签深度扫描，拿到 [start,end) 与 inner；「谁在谁里面」用位置下标比较判定。
function rangeOf(html, open) {
  if (!open) return null;
  const name = (/^<\s*([a-zA-Z][\w-]*)/.exec(open.tag) || [, ''])[1].toLowerCase();
  const contentStart = open.start + open.tag.length;
  if (VOID_TAGS.has(name) || /\/>\s*$/.test(open.tag)) {
    return { start: open.start, end: contentStart, inner: '', tag: open.tag };
  }
  const re = /<\/?([a-zA-Z][\w-]*)([^<>]*)>/g;
  re.lastIndex = contentStart;
  let depth = 1;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = m[1].toLowerCase();
    if (VOID_TAGS.has(t)) continue;
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        return { start: open.start, end: m.index, inner: html.slice(contentStart, m.index), tag: open.tag };
      }
    } else if (!/\/\s*$/.test(m[2])) {
      depth += 1;
    }
  }
  return { start: open.start, end: html.length, inner: html.slice(contentStart), tag: open.tag };
}

const elById = (html, id) => rangeOf(html, openTag(html, idPattern(id)));
const idIndex = (html, id) => html.search(new RegExp(idPattern(id)));
const inRange = (range, idx) => range != null && idx > range.start && idx < range.end;

/* ==================== 内联 JS 取函数体 ==================== */

function skipString(src, i) {
  const q = src[i];
  i += 1;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === q) return i + 1;
    if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
      let d = 0;
      i += 1;
      while (i < src.length) {
        if (src[i] === '{') d += 1;
        else if (src[i] === '}') { d -= 1; if (d === 0) { i += 1; break; } }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

// 优先括号配平取函数体；配平不成立时退回「从函数名到下一个顶层 function 声明之间」。
function functionBody(js, name) {
  const decl = new RegExp(
    `(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=|\\b${name}\\s*=\\s*(?:async\\s*)?(?:function|\\())`,
  ).exec(js);
  if (!decl) return null;
  const open = js.indexOf('{', decl.index);
  if (open !== -1) {
    let depth = 0;
    let i = open;
    while (i < js.length) {
      const c = js[i];
      if (c === '/' && js[i + 1] === '/') { const nl = js.indexOf('\n', i); i = nl === -1 ? js.length : nl; continue; }
      if (c === '/' && js[i + 1] === '*') { const e = js.indexOf('*/', i + 2); i = e === -1 ? js.length : e + 2; continue; }
      if (c === '"' || c === "'" || c === '`') { i = skipString(js, i); continue; }
      if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) return js.slice(open, i + 1); }
      i += 1;
    }
  }
  const rest = js.slice(decl.index);
  const next = /\n\s{0,2}function\s+\w/.exec(rest.slice(1));
  return next ? rest.slice(0, next.index + 1) : rest;
}

/* ==================== 用例 ==================== */

test('uiExport: 导出区有「贴图 PNG / 动画 MP4」产物切换 segmented', () => {
  const seg = elById(HTML, 'exportKindSegmented');
  assert.ok(seg, 'T3-1（产物切换 segmented）: 期望 ③ 导出区存在 id="exportKindSegmented" 的容器');
  assert.match(
    seg.tag,
    /role\s*=\s*["']radiogroup["']/,
    'T3-1（产物切换 segmented）: 期望 #exportKindSegmented 带 role="radiogroup"',
  );

  const png = openTag(HTML, idPattern('exportKindPng'));
  const mp4 = openTag(HTML, idPattern('exportKindMp4'));
  assert.ok(png, 'T3-1（产物切换 segmented）: 期望存在 id="exportKindPng" 的 radio');
  assert.ok(mp4, 'T3-1（产物切换 segmented）: 期望存在 id="exportKindMp4" 的 radio');
  assert.match(png.tag, /name\s*=\s*["']exportKind["']/, 'T3-1: #exportKindPng 期望 name="exportKind"');
  assert.match(png.tag, /value\s*=\s*["']png["']/, 'T3-1: #exportKindPng 期望 value="png"');
  assert.match(png.tag, /\bchecked\b/, 'T3-1: #exportKindPng 期望默认 checked（默认产物为 png）');
  assert.match(mp4.tag, /value\s*=\s*["']mp4["']/, 'T3-1: #exportKindMp4 期望 value="mp4"');

  const pngLabel = elById(HTML, 'exportKindPngLabel');
  const mp4Label = elById(HTML, 'exportKindMp4Label');
  assert.ok(pngLabel && hasCopy(pngLabel.inner, '贴图 PNG'), 'T3-1: 期望 #exportKindPngLabel 文案为「贴图 PNG」');
  assert.ok(mp4Label && hasCopy(mp4Label.inner, '动画 MP4'), 'T3-1: 期望 #exportKindMp4Label 文案为「动画 MP4」');
});

test('uiExport: 两种产物各有独立参数面板，贴图 PNG 面板只放用法说明', () => {
  const pngFields = elById(HTML, 'exportPngFields');
  const mp4Fields = elById(HTML, 'exportMp4Fields');
  assert.ok(pngFields, 'T3-2（两个参数面板）: 期望存在 #exportPngFields');
  assert.ok(mp4Fields, 'T3-2（两个参数面板）: 期望存在 #exportMp4Fields');

  assert.ok(
    hasCopy(
      pngFields.inner,
      '会导出两张图：轨迹卡片和定位点。在剪映里把卡片当作画中画放在角落；把定位点也拖进去，沿线路打几个位置关键帧，它就会跟着线路移动',
    ),
    'T3-3（贴图 PNG 面板定稿说明）: 期望 #exportPngFields 内含 §4.5 的用法说明整句',
  );

  for (const id of ['mp4Duration', 'mp4Fps', 'mp4BgMode', 'mp4UnsupportedHint']) {
    assert.ok(
      inRange(mp4Fields, idIndex(HTML, id)),
      `T3-4（动画 MP4 面板）: 期望 #${id} 落在 #exportMp4Fields 内部`,
    );
  }
});

test('uiExport: updateExportKindUI 统管按钮与面板，并把选择记进 localStorage', () => {
  const body = functionBody(JS, 'updateExportKindUI');
  assert.ok(body, 'T3-8（updateExportKindUI）: 期望内联 script 里存在 updateExportKindUI 函数');
  for (const id of ['expCard', 'expDot', 'expMp4', 'exportPngFields', 'exportMp4Fields']) {
    assert.ok(
      body.includes(id),
      `T3-8（updateExportKindUI）: 期望函数体内提到 ${id}（吸底条按钮与参数面板随产物切换）`,
    );
  }
  assert.match(
    JS,
    /localStorage\s*\.\s*getItem\s*\(\s*['"]exportKind['"]\s*\)/,
    "T3-8（localStorage 记忆）: 期望内联 script 里有 localStorage.getItem('exportKind')",
  );
  assert.match(
    JS,
    /localStorage\s*\.\s*setItem\s*\(\s*['"]exportKind['"]/,
    "T3-8（localStorage 记忆）: 期望内联 script 里有 localStorage.setItem('exportKind', …)",
  );
});
