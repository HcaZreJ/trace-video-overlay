// T3 · uiExport 目标态断言（完整用例，逐条对应 §9「T3 · uiExport（目标态）」10 点）
// spec: .claude/plans/ui-hierarchy-redesign.md → §4.5 ③ 导出 + 吸底动作条
// 形态：读 index.html 源文件，切成 <style> CSS / <body> HTML / 内联 <script> JS 三段后做结构断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RAW = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/* ==================== 三段切片 ==================== */

function sliceDoc(raw) {
  const css = [...raw.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const inline = [...raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc\s*=/i.test(m[1]))
    .map((m) => m[2]);
  const bodyM = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(raw);
  const html = (bodyM ? bodyM[1] : raw)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return { css, html, js: inline.join('\n') };
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
const classPattern = (cls) => `\\bclass\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["']`;

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
const elByClass = (html, cls) => rangeOf(html, openTag(html, classPattern(cls)));
const idIndex = (html, id) => html.search(new RegExp(idPattern(id)));
const inRange = (range, idx) => range != null && idx >= 0 && idx > range.start && idx < range.end;

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

/* ==================== T3-1 产物切换 segmented ==================== */

test('uiExport: 产物切换容器 exportKindSegmented 是 role=radiogroup', () => {
  const seg = elById(HTML, 'exportKindSegmented');
  assert.ok(seg, 'T3-1（产物切换 segmented）: 期望存在 id="exportKindSegmented" 的容器');
  assert.match(
    seg.tag,
    /role\s*=\s*["']radiogroup["']/,
    'T3-1（产物切换 segmented）: 期望 #exportKindSegmented 带 role="radiogroup"',
  );
  assert.match(
    seg.tag,
    /aria-label\s*=\s*["'][^"']+["']/,
    'T3-1（产物切换 segmented）: 期望 #exportKindSegmented 带非空 aria-label（radiogroup 需可读名称）',
  );
});

test('uiExport: 两个 radio 同属 name=exportKind，png 默认选中、mp4 不选中', () => {
  const seg = elById(HTML, 'exportKindSegmented');
  const png = openTag(HTML, idPattern('exportKindPng'));
  const mp4 = openTag(HTML, idPattern('exportKindMp4'));

  assert.ok(png, 'T3-1（产物切换 segmented）: 期望存在 id="exportKindPng"');
  assert.ok(mp4, 'T3-1（产物切换 segmented）: 期望存在 id="exportKindMp4"');

  for (const [id, tag, value] of [['exportKindPng', png.tag, 'png'], ['exportKindMp4', mp4.tag, 'mp4']]) {
    assert.match(tag, /type\s*=\s*["']radio["']/, `T3-1: 期望 #${id} 是 type="radio"`);
    assert.match(tag, /name\s*=\s*["']exportKind["']/, `T3-1: 期望 #${id} 带 name="exportKind"`);
    assert.match(
      tag,
      new RegExp(`value\\s*=\\s*["']${value}["']`),
      `T3-1: 期望 #${id} 的 value 为 "${value}"`,
    );
    assert.ok(
      inRange(seg, idIndex(HTML, id)),
      `T3-1: 期望 #${id} 落在 #exportKindSegmented 容器内部`,
    );
  }

  assert.match(png.tag, /\bchecked\b/, 'T3-1: 期望 #exportKindPng 默认 checked（默认产物 png）');
  assert.ok(!/\bchecked\b/.test(mp4.tag), 'T3-1: 期望 #exportKindMp4 默认不选中（默认产物是 png）');
});

test('uiExport: 两个 segmented label 的 id 与文案为「贴图 PNG」「动画 MP4」', () => {
  const cases = [
    ['exportKindPngLabel', 'exportKindPng', '贴图 PNG'],
    ['exportKindMp4Label', 'exportKindMp4', '动画 MP4'],
  ];
  for (const [labelId, inputId, copy] of cases) {
    const label = elById(HTML, labelId);
    assert.ok(label, `T3-1（产物切换 segmented）: 期望存在 id="${labelId}" 的 label`);
    assert.ok(
      hasCopy(label.inner, copy),
      `T3-1（产物切换 segmented）: 期望 #${labelId} 的文案为「${copy}」，实际为「${collapse(label.inner)}」`,
    );
    const linked =
      new RegExp(`for\\s*=\\s*["']${inputId}["']`).test(label.tag) ||
      inRange(label, idIndex(HTML, inputId));
    assert.ok(
      linked,
      `T3-1: 期望 #${labelId} 与 #${inputId} 建立 label 关联（for="${inputId}" 或把 radio 嵌在 label 内）`,
    );
  }
});

/* ==================== T3-2 / T3-3 / T3-4 两个参数面板 ==================== */

test('uiExport: 存在 exportPngFields 与 exportMp4Fields 两个参数面板', () => {
  assert.ok(elById(HTML, 'exportPngFields'), 'T3-2（两个参数面板）: 期望存在 #exportPngFields');
  assert.ok(elById(HTML, 'exportMp4Fields'), 'T3-2（两个参数面板）: 期望存在 #exportMp4Fields');
  const pngIdx = idIndex(HTML, 'exportPngFields');
  const mp4Idx = idIndex(HTML, 'exportMp4Fields');
  assert.ok(
    !inRange(elById(HTML, 'exportPngFields'), mp4Idx) && !inRange(elById(HTML, 'exportMp4Fields'), pngIdx),
    'T3-2（两个参数面板）: 期望两个面板互为并列，不互相嵌套',
  );
});

test('uiExport: 贴图 PNG 面板只放定稿的剪映用法说明', () => {
  const png = elById(HTML, 'exportPngFields');
  assert.ok(png, 'T3-3（贴图 PNG 面板）: 期望存在 #exportPngFields');
  assert.ok(
    hasCopy(
      png.inner,
      '会导出两张图：轨迹卡片和定位点。在剪映里把卡片当作画中画放在角落；把定位点也拖进去，沿线路打几个位置关键帧，它就会跟着线路移动',
    ),
    'T3-3（贴图 PNG 面板）: 期望 #exportPngFields 内含 §4.5 定稿说明整句',
  );
  for (const id of ['mp4Duration', 'mp4Fps', 'mp4BgMode']) {
    assert.ok(
      !inRange(png, idIndex(HTML, id)),
      `T3-3（贴图 PNG 面板）: 贴图面板没有参数，#${id} 期望落在 MP4 面板而非 #exportPngFields`,
    );
  }
});

test('uiExport: 动画 MP4 面板收纳时长/帧率/画布/两个颜色 field 与不支持提示', () => {
  const mp4 = elById(HTML, 'exportMp4Fields');
  assert.ok(mp4, 'T3-4（动画 MP4 面板）: 期望存在 #exportMp4Fields');
  const ids = [
    'mp4Duration',
    'mp4Fps',
    'mp4BgMode',
    'mp4PageColorField',
    'mp4GreenColorField',
    'mp4UnsupportedHint',
  ];
  for (const id of ids) {
    const idx = idIndex(HTML, id);
    assert.ok(idx >= 0, `T3-4（动画 MP4 面板）: 期望 HTML 中仍存在 #${id}`);
    assert.ok(inRange(mp4, idx), `T3-4（动画 MP4 面板）: 期望 #${id} 落在 #exportMp4Fields 内部`);
  }
});

test('uiExport: 动画 MP4 面板带时长说明「最长 600 秒；1080p 的文件大小约为每分钟 90 MB」', () => {
  const mp4 = elById(HTML, 'exportMp4Fields');
  assert.ok(mp4, 'T3-4（动画 MP4 面板）: 期望存在 #exportMp4Fields');
  assert.ok(
    hasCopy(mp4.inner, '最长 600 秒；1080p 的文件大小约为每分钟 90 MB'),
    'T3-4（动画 MP4 面板）: 期望 #exportMp4Fields 内含定稿时长说明',
  );
});

/* ==================== T3-5 旧内容清除 ==================== */

test('uiExport: 旧的「剪映用法：」hint 块与旧时长说明不再出现', () => {
  assert.ok(
    !hasCopy(RAW, '剪映用法'),
    'T3-5（旧内容清除）: 期望整份 index.html 里不再出现旧的「剪映用法：」hint 块（用法说明已并入 #exportPngFields）',
  );
  assert.ok(
    !hasCopy(RAW, '上限 600 秒；文件大小约与时长成正比'),
    'T3-5（旧内容清除）: 期望旧文案「上限 600 秒；文件大小约与时长成正比」已换成「最长 600 秒；1080p 的文件大小约为每分钟 90 MB」',
  );
});

/* ==================== T3-6 分辨率 label ==================== */

test('uiExport: 分辨率 label 文案为「分辨率（PNG 与 MP4 共用）」', () => {
  const label = rangeOf(HTML, openTag(HTML, '\\bfor\\s*=\\s*["\']exportRes["\']', 'label'));
  assert.ok(label, 'T3-6（分辨率 label）: 期望存在 <label for="exportRes">');
  // 取 label 的纯文本：去掉可能嵌套的 select 及其 option、去掉内联标签、折叠空白。
  const text = collapse(
    label.inner.replace(/<select[\s\S]*?<\/select>/gi, '').replace(/<[^>]*>/g, ''),
  );
  assert.equal(
    text,
    '分辨率（PNG 与 MP4 共用）',
    `T3-6（分辨率 label）: 期望 label 文案恰为「分辨率（PNG 与 MP4 共用）」，实际为「${text}」`,
  );
});

/* ==================== T3-7 画布颜色文案 ==================== */

test('uiExport: 画布颜色 label 与说明句为 §4.5 定稿文案', () => {
  const field = elById(HTML, 'mp4PageColorField');
  const mp4 = elById(HTML, 'exportMp4Fields');
  assert.ok(field, 'T3-7（画布颜色文案）: 期望存在 #mp4PageColorField');
  assert.ok(
    hasCopy(field.inner, '画布颜色（卡片圆角以外的部分）'),
    `T3-7（画布颜色文案）: 期望 #mp4PageColorField 内 label 文案为「画布颜色（卡片圆角以外的部分）」，实际为「${collapse(field.inner)}」`,
  );
  assert.ok(
    mp4 && hasCopy(mp4.inner, '卡片本体的底色仍然用「底色」里的设置'),
    'T3-7（画布颜色文案）: 期望动画 MP4 面板里出现说明句「卡片本体的底色仍然用「底色」里的设置」',
  );
});

/* ==================== T3-8 updateExportKindUI + localStorage + 接线 ==================== */

test('uiExport: updateExportKindUI 函数体同时提到三个导出按钮与两个面板', () => {
  const body = functionBody(JS, 'updateExportKindUI');
  assert.ok(body, 'T3-8（updateExportKindUI）: 期望内联 script 里存在 updateExportKindUI 函数');
  for (const id of ['expCard', 'expDot', 'expMp4', 'exportPngFields', 'exportMp4Fields']) {
    assert.ok(
      body.includes(id),
      `T3-8（updateExportKindUI）: 期望函数体内提到 ${id}（吸底条主/次按钮与参数面板随产物切换）`,
    );
  }
});

test('uiExport: 产物选择用 localStorage 键 exportKind 读写记忆', () => {
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
  assert.ok(
    /['"]png['"]/.test(JS),
    'T3-8（localStorage 记忆）: 期望内联 script 里出现默认值 png（缺省产物为贴图 PNG）',
  );
});

test('uiExport: exportKind radio 的 change 事件接到 updateExportKindUI', () => {
  const inlineHandler = /\bonchange\s*=\s*["'][^"']*updateExportKindUI/.test(HTML);
  const wired = [...JS.matchAll(/updateExportKindUI/g)].some((m) => {
    const w = JS.slice(Math.max(0, m.index - 600), m.index + 600);
    return /['"]change['"]/.test(w) && /exportKind(Png|Mp4|Segmented)?\b/.test(w);
  });
  assert.ok(
    inlineHandler || wired,
    "T3-8（change 接线）: 期望 name=\"exportKind\" 的 radio 在 change 事件上调用 updateExportKindUI（未找到 'change' 与 exportKind radio 同时出现在 updateExportKindUI 附近）",
  );
});

/* ==================== T3-9 卡片 PNG 成功提示 ==================== */

test('uiExport: 卡片 PNG 成功提示简化为「已下载「轨迹卡片.png」」', () => {
  assert.ok(
    collapse(JS).includes('已下载「轨迹卡片.png」'),
    'T3-9（成功提示）: 期望内联 script 里卡片 PNG 成功提示为「已下载「轨迹卡片.png」」',
  );
  assert.ok(
    !JS.includes('不含定位点'),
    'T3-9（成功提示）: 期望提示里不再重复「不含定位点」（该解释已由定位点子组说明与贴图面板用法说明承担）',
  );
});

/* ==================== T3-10 吸底动作条 ==================== */

test('uiExport: 吸底条 .export-actions 内仍含进度、状态行与三个导出按钮', () => {
  const bar = elByClass(HTML, 'export-actions');
  assert.ok(bar, 'T3-10（吸底动作条）: 期望存在 class 含 export-actions 的容器');
  // 边界自检：吸底条是紧凑单行操作条，不应把 ① 轨迹 / ② 样式 的控件也圈进来。
  for (const outsider of ['drop', 'bgColor']) {
    assert.ok(
      !inRange(bar, idIndex(HTML, outsider)),
      `T3-10（吸底动作条）: 期望 #${outsider} 落在 .export-actions 之外`,
    );
  }
  for (const id of ['mp4ProgressWrap', 'exportStatus', 'expCard', 'expDot', 'expMp4']) {
    const idx = idIndex(HTML, id);
    assert.ok(idx >= 0, `T3-10（吸底动作条）: 期望 HTML 中仍存在 #${id}`);
    assert.ok(inRange(bar, idx), `T3-10（吸底动作条）: 期望 #${id} 落在 .export-actions 内部`);
  }
});
