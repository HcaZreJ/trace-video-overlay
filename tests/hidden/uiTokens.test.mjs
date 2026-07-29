// uiTokens · 目标态断言（完整用例）
// 规格来源：.claude/plans/ui-hierarchy-redesign.md → §3 视觉 token 规范 / §9「T1 · uiTokens（目标态）」12 条
// 形态：node:test + node:assert/strict，零依赖；读 index.html 切成 CSS / HTML / 内联 JS 三段再断言。
// 断言只钉住 spec 点名的语义 token：比较前折叠空白，按选择器切出规则体后再在体内找目标声明，
// 对声明顺序与无关声明保持宽容。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ==================== 通用工具：读文件 + 切三段 ==================== */

const INDEX_PATH = fileURLToPath(new URL('../../index.html', import.meta.url));
const SRC = readFileSync(INDEX_PATH, 'utf8');

const collapse = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 所有 <style> 块的内容拼成一段 CSS */
function extractStyleCss(src) {
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out.join('\n');
}

/** <body> 里的结构 HTML（剔除 script / style 块，只留标记） */
function extractBodyHtml(src) {
  const m = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(src);
  const body = m ? m[1] : src;
  return body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

/** 所有内联（无 src）<script> 的 JS 源码 */
function extractInlineJs(src) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) if (!/\bsrc\s*=/i.test(m[1])) out.push(m[2]);
  return out.join('\n');
}

/* ==================== CSS 极简解析（注释 / 规则 / 声明） ==================== */

function stripCssComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < css.length && css[j] !== q) {
        if (css[j] === '\\') j++;
        j++;
      }
      out += css.slice(i, Math.min(j + 1, css.length));
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 展平成 {selector, body, media} 列表；@media/@supports 等条件组内的规则带上 media 标记 */
function parseRules(css, media = '') {
  const rules = [];
  let sel = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < css.length && css[j] !== q) {
        if (css[j] === '\\') j++;
        j++;
      }
      sel += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        const d = css[j];
        if (d === '"' || d === "'") {
          const q = d;
          j++;
          while (j < css.length && css[j] !== q) {
            if (css[j] === '\\') j++;
            j++;
          }
          j++;
          continue;
        }
        if (d === '{') depth++;
        else if (d === '}') depth--;
        j++;
      }
      const body = css.slice(i + 1, depth === 0 ? j - 1 : j);
      const selector = collapse(sel);
      if (selector.startsWith('@')) {
        const name = selector.slice(1).split(/[\s({]/)[0].toLowerCase();
        if (['media', 'supports', 'layer', 'container', 'scope'].includes(name)) {
          rules.push(...parseRules(body, media ? `${media} && ${selector}` : selector));
        } else {
          rules.push({ selector, body, media });
        }
      } else if (selector) {
        rules.push({ selector, body, media });
      }
      sel = '';
      i = j;
      continue;
    }
    if (c === '}') {
      sel = '';
      i++;
      continue;
    }
    if (c === ';' && collapse(sel).startsWith('@')) {
      sel = '';
      i++;
      continue;
    }
    sel += c;
    i++;
  }
  return rules;
}

/** 规则体拆成声明数组（尊重括号与字符串，跳过嵌套块） */
function splitDecls(body) {
  const out = [];
  let cur = '';
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < body.length && body[j] !== q) {
        if (body[j] === '\\') j++;
        j++;
      }
      cur += body.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '{') {
      let d = 1;
      let j = i + 1;
      while (j < body.length && d > 0) {
        if (body[j] === '{') d++;
        else if (body[j] === '}') d--;
        j++;
      }
      cur = '';
      i = j;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ';' && depth === 0) {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur);
  return out.map(collapse).filter(Boolean);
}

/** 规则体 → Map(prop → value)，后写的覆盖先写的 */
function declMap(body) {
  const m = new Map();
  for (const d of splitDecls(body)) {
    const idx = d.indexOf(':');
    if (idx === -1) continue;
    const prop = collapse(d.slice(0, idx)).toLowerCase();
    const val = collapse(d.slice(idx + 1)).replace(/\s*!important$/i, '');
    if (prop) m.set(prop, val);
  }
  return m;
}

function mergedDecls(rules) {
  const m = new Map();
  for (const r of rules) for (const [k, v] of declMap(r.body)) m.set(k, v);
  return m;
}

/* ==================== 选择器匹配（对空白/子代组合符宽容） ==================== */

const selectorParts = (sel) => sel.split(',').map(collapse).filter(Boolean);
const normSel = (sel) => collapse(sel).replace(/\s*>\s*/g, ' ');
const lastCompound = (part) => normSel(part).split(' ').pop();
const ancestorCompounds = (part) => normSel(part).split(' ').slice(0, -1);

/** compound 里是否含某个 token（'.cls' / '#id' / 'tag'） */
function compoundHas(compound, token) {
  if (token.startsWith('.') || token.startsWith('#')) {
    return new RegExp(`${escapeRe(token)}(?![\\w-])`).test(compound);
  }
  return new RegExp(`^${escapeRe(token)}(?![\\w-])`).test(compound);
}

/**
 * 收集「最后一个 compound 命中 token（可为多 token 数组）」的规则。
 * ancestor 给定时只要祖先链里有它；无祖先的通用规则排在前面，近似层叠优先级。
 */
function collectRules(rules, token, ancestor = null) {
  const tokens = Array.isArray(token) ? token : [token];
  const generic = [];
  const scoped = [];
  for (const r of rules) {
    for (const p of selectorParts(r.selector)) {
      const lc = lastCompound(p);
      if (lc.includes(':')) continue;
      if (!tokens.every((t) => compoundHas(lc, t))) continue;
      const anc = ancestorCompounds(p);
      if (anc.length === 0) {
        generic.push(r);
        break;
      }
      if (!ancestor) {
        scoped.push(r);
        break;
      }
      if (anc.some((c) => compoundHas(c, ancestor))) {
        scoped.push(r);
        break;
      }
    }
  }
  return [...generic, ...scoped];
}

/* ==================== HTML / JS 结构辅助 ==================== */

/** 属性首次出现位置（attr="value"） */
function attrIndex(html, attr, value) {
  const re = new RegExp(`${escapeRe(attr)}\\s*=\\s*["']${escapeRe(value)}["']`);
  const m = re.exec(html);
  return m ? m.index : -1;
}

/** idx 之前最近一个带 cls 的 class 属性起始位置（同一容器的代理判据） */
function nearestClassStart(html, idx, cls) {
  const re = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let best = -1;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m.index >= idx) break;
    const list = collapse(m[1] ?? m[2] ?? '').split(' ');
    if (list.includes(cls)) best = m.index;
  }
  return best;
}

/** text 里 needle 附近 radius 字符窗口内是否命中 probe（字符串或正则） */
function hasNear(text, needle, probe, radius) {
  const isRe = probe instanceof RegExp;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    const seg = text.slice(Math.max(0, idx - radius), idx + needle.length + radius);
    if (isRe ? probe.test(seg) : seg.includes(probe)) return true;
    idx = text.indexOf(needle, idx + 1);
  }
  return false;
}

/** 正则命中处附近 radius 字符窗口内是否命中 probe */
function hasNearRe(text, needleRe, probe, radius) {
  const re = new RegExp(needleRe.source, needleRe.flags.includes('g') ? needleRe.flags : `${needleRe.flags}g`);
  let m;
  while ((m = re.exec(text)) !== null) {
    const seg = text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius);
    if (probe.test(seg)) return true;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return false;
}

/* ==================== 三段与常量 ==================== */

const CSS = stripCssComments(extractStyleCss(SRC));
const HTML = extractBodyHtml(SRC);
const JS = collapse(extractInlineJs(SRC));
const RULES = parseRules(CSS);
const BASE = RULES.filter((r) => !r.media);

/** §9 T0.7：页面共 7 个 <input type="color"> */
const COLOR_IDS = [
  'bgColor',
  'lineColor',
  'startColor',
  'endColor',
  'dotColor',
  'mp4PageColor',
  'mp4GreenColor',
];

/** 所有 font-size:<N>px 声明（含 font 简写里的 px 字号） */
function fontSizeHits(rules) {
  const hits = [];
  for (const r of rules) {
    for (const d of splitDecls(r.body)) {
      const idx = d.indexOf(':');
      if (idx === -1) continue;
      const prop = collapse(d.slice(0, idx)).toLowerCase();
      const val = collapse(d.slice(idx + 1));
      if (prop === 'font-size') {
        const m = /^([\d.]+)px$/.exec(val);
        if (m) hits.push({ selector: collapse(r.selector), decl: `font-size:${val}`, px: Number(m[1]) });
      } else if (prop === 'font') {
        const m = /(?:^|[\s/])([\d.]+)px/.exec(val);
        if (m) hits.push({ selector: collapse(r.selector), decl: `font:${val}`, px: Number(m[1]) });
      }
    }
  }
  return hits;
}

/** 所有含 :hover 的规则（含 @media 内） */
const HOVER_RULES = RULES.filter((r) => selectorParts(r.selector).some((p) => p.includes(':hover')));

/* ==================== 0 · 测试装置自检 ==================== */

test('uiTokens: index.html 可切成 CSS / HTML / 内联 script 三段', () => {
  assert.ok(SRC.length > 0, `读不到 index.html：${INDEX_PATH}`);
  assert.ok(CSS.length > 0, '未能从 index.html 抽出 <style> 段');
  assert.ok(HTML.length > 0, '未能从 index.html 抽出 <body> 结构段');
  assert.ok(JS.length > 0, '未能从 index.html 抽出内联 <script> 段');
  assert.ok(RULES.length > 0, 'CSS 段未解析出任何规则，选择器断言无从谈起');
});

/* ==================== 1 · 字号档位 ==================== */

test('uiTokens: CSS 字号只使用 17 / 14 / 13 / 12 四档', () => {
  const allowed = new Set([17, 14, 13, 12]);
  const bad = fontSizeHits(RULES).filter((h) => !allowed.has(h.px));
  assert.deepEqual(
    bad,
    [],
    `uiTokens 第 1 条（§9 T1.1 / §3.2）：CSS 里所有 font-size 的 px 取值必须 ⊆ {17,14,13,12}，` +
      `现有 10px / 11px 一律就近升为 12px。越界声明：${JSON.stringify(bad, null, 2)}`,
  );
});

test('uiTokens: HTML 行内 style 不出现 10px / 11px 字号', () => {
  const hits = [...HTML.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)].map((m) => Number(m[1]));
  const bad = hits.filter((px) => px === 10 || px === 11);
  assert.deepEqual(
    bad,
    [],
    `uiTokens 第 1 条（§9 T1.1）：HTML 的 inline style 里不允许出现 font-size:10px / font-size:11px，` +
      `就近升为 12px。命中值：${JSON.stringify(bad)}`,
  );
});

/* ==================== 2 · 页标题 ==================== */

test('uiTokens: header h1 字号为 17px', () => {
  const rules = collectRules(BASE, 'h1');
  assert.ok(
    rules.length > 0,
    'uiTokens 第 2 条（§9 T1.2 / §3.2）：CSS 里应存在针对 h1（页标题）的规则',
  );
  const d = mergedDecls(rules);
  assert.equal(
    d.get('font-size'),
    '17px',
    `uiTokens 第 2 条（§9 T1.2）：header h1 的 font-size 应为 17px（页标题是唯一的 17 档），实际为 ${JSON.stringify(d.get('font-size'))}`,
  );
});

/* ==================== 3 · segmented 选中态 ==================== */

test('uiTokens: segmented 选中态用 #39404d 底 + #fff 字', () => {
  const rules = collectRules(BASE, ['.seg-opt', '.active']);
  assert.ok(
    rules.length > 0,
    'uiTokens 第 3 条（§9 T1.3 / §3.1）：CSS 里应存在 .seg-opt.active 规则，用于定义 segmented 选中态',
  );
  const d = mergedDecls(rules);
  const bg = d.get('background') ?? d.get('background-color');
  assert.ok(
    bg && /#39404d/i.test(bg),
    `uiTokens 第 3 条（§9 T1.3）：.seg-opt.active 的 background 应为 #39404d（选中态 = 当前所处位置，与蓝色主动作区分），实际为 ${JSON.stringify(bg)}`,
  );
  const color = d.get('color');
  assert.ok(
    color && /^(#fff|#ffffff|white)$/i.test(collapse(color)),
    `uiTokens 第 3 条（§9 T1.3）：.seg-opt.active 的 color 应为 #fff，实际为 ${JSON.stringify(color)}`,
  );
});

test('uiTokens: segmented 选中态不再使用 var(--accent-strong)', () => {
  const rules = collectRules(BASE, ['.seg-opt', '.active']);
  const accented = rules
    .filter((r) => /var\(\s*--accent-strong\s*[,)]/.test(r.body))
    .map((r) => collapse(r.selector));
  assert.deepEqual(
    accented,
    [],
    `uiTokens 第 3 条（§9 T1.3）：.seg-opt.active 规则体不得再出现 var(--accent-strong)，` +
      `蓝色只留给吸底条主按钮。命中选择器：${JSON.stringify(accented)}`,
  );
});

/* ==================== 4 · hover 只变亮度 ==================== */

test('uiTokens: 任何 :hover 规则都不用 accent 作背景', () => {
  const bad = [];
  for (const r of HOVER_RULES) {
    for (const d of splitDecls(r.body)) {
      const idx = d.indexOf(':');
      if (idx === -1) continue;
      const prop = collapse(d.slice(0, idx)).toLowerCase();
      const val = collapse(d.slice(idx + 1));
      if (/^background(-color|-image)?$/.test(prop) && /var\(\s*--accent(-strong)?\s*[,)]/.test(val)) {
        bad.push(`${collapse(r.selector)} { ${prop}:${val} }`);
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    `uiTokens 第 4 条（§9 T1.4 / §3.1）：hover 只允许改变亮度（filter:brightness 或换更亮的中性底色），` +
      `不允许把 var(--accent) / var(--accent-strong) 用作 hover 背景。违规规则：${JSON.stringify(bad, null, 2)}`,
  );
});

test('uiTokens: 只有文件列表删除按钮的 hover 允许出现红色 #ff453a', () => {
  const delRe = /\[data-act\s*=\s*["']?del["']?\]/;
  const bad = HOVER_RULES.filter((r) => /#ff453a/i.test(r.body))
    .filter((r) => !selectorParts(r.selector).some((p) => delRe.test(p)))
    .map((r) => collapse(r.selector));
  assert.deepEqual(
    bad,
    [],
    `uiTokens 第 4 条（§9 T1.4 / §3.1）：hover 变红是删除警示的专属语义，只允许出现在选择器含 [data-act="del"] 的规则里。` +
      `其余违规规则：${JSON.stringify(bad, null, 2)}`,
  );
});

/* ==================== 5 · 色块尺寸 ==================== */

test('uiTokens: .cp-swatch 为 28×28 圆角 6px 的小色块', () => {
  const rules = collectRules(BASE, '.cp-swatch');
  assert.ok(
    rules.length > 0,
    'uiTokens 第 5 条（§9 T1.5 / §3.4）：CSS 里应存在 .cp-swatch 规则',
  );
  const d = mergedDecls(rules);
  assert.equal(
    d.get('width'),
    '28px',
    `uiTokens 第 5 条（§9 T1.5）：.cp-swatch 的 width 应为 28px，实际为 ${JSON.stringify(d.get('width'))}`,
  );
  assert.equal(
    d.get('height'),
    '28px',
    `uiTokens 第 5 条（§9 T1.5）：.cp-swatch 的 height 应为 28px，实际为 ${JSON.stringify(d.get('height'))}`,
  );
  assert.equal(
    collapse(d.get('border-radius')),
    '6px',
    `uiTokens 第 5 条（§9 T1.5）：.cp-swatch 的 border-radius 应为 6px，实际为 ${JSON.stringify(d.get('border-radius'))}`,
  );
});

test('uiTokens: .cp-swatch 不再是全宽颜色条', () => {
  const rules = collectRules(BASE, '.cp-swatch');
  const bad = rules.filter((r) => /width\s*:\s*100%/i.test(r.body)).map((r) => collapse(r.selector));
  assert.deepEqual(
    bad,
    [],
    `uiTokens 第 5 条（§9 T1.5 / §3.4）：.cp-swatch 规则体不得含 width:100%，` +
      `全宽颜色条取消，整页只允许预览卡片是大面积色块。命中选择器：${JSON.stringify(bad)}`,
  );
});

/* ==================== 6 · 颜色行结构 ==================== */

test('uiTokens: 七个颜色输入都在 .color-row 行内并配有 data-hex-for 元素', () => {
  for (const id of COLOR_IDS) {
    const inputIdx = attrIndex(HTML, 'id', id);
    assert.notEqual(
      inputIdx,
      -1,
      `uiTokens 第 6 条（§9 T1.6 / §3.4）：HTML 里应保留颜色输入 id="${id}"`,
    );
    const hexIdx = attrIndex(HTML, 'data-hex-for', id);
    assert.notEqual(
      hexIdx,
      -1,
      `uiTokens 第 6 条（§9 T1.6）：颜色行内应有一个 data-hex-for="${id}" 的元素，用 12px 灰字显示当前 hex 值`,
    );
    const rowOfInput = nearestClassStart(HTML, inputIdx, 'color-row');
    const rowOfHex = nearestClassStart(HTML, hexIdx, 'color-row');
    assert.notEqual(
      rowOfInput,
      -1,
      `uiTokens 第 6 条（§9 T1.6）：${id} 所在的行应是 .color-row 结构（label + 28×28 swatch + hex 灰字）`,
    );
    assert.equal(
      rowOfHex,
      rowOfInput,
      `uiTokens 第 6 条（§9 T1.6）：data-hex-for="${id}" 的元素应与 #${id} 同在一个 .color-row 容器内`,
    );
  }
});

test('uiTokens: data-hex-for 与七个颜色输入一一对应', () => {
  const values = [...HTML.matchAll(/data-hex-for\s*=\s*["']([^"']*)["']/g)].map((m) => m[1]);
  const stray = values.filter((v) => !COLOR_IDS.includes(v));
  assert.deepEqual(
    stray,
    [],
    `uiTokens 第 6 条（§9 T1.6）：data-hex-for 的取值只能是七个颜色输入的 id（${COLOR_IDS.join(' / ')}）。越界取值：${JSON.stringify(stray)}`,
  );
  const counts = COLOR_IDS.map((id) => [id, values.filter((v) => v === id).length]);
  const wrong = counts.filter(([, n]) => n !== 1);
  assert.deepEqual(
    wrong,
    [],
    `uiTokens 第 6 条（§9 T1.6）：七个颜色 id 各应恰好出现一次 data-hex-for。异常计数：${JSON.stringify(wrong)}`,
  );
});

/* ==================== 7 · hex 灰字同步逻辑 ==================== */

test('uiTokens: 内联 script 把 data-hex-for 元素同步为大写 hex', () => {
  assert.ok(
    JS.includes('data-hex-for'),
    'uiTokens 第 7 条（§9 T1.7）：内联 script 里应有读取 data-hex-for 元素的逻辑，用来同步显示当前 hex 值',
  );
  assert.ok(
    hasNear(JS, 'data-hex-for', 'toUpperCase', 900),
    'uiTokens 第 7 条（§9 T1.7）：同步 data-hex-for 文本的逻辑附近应有 toUpperCase()，hex 值以大写显示',
  );
});

/** 定义体（起始 700 字符窗口）里提到 probes 之一的函数名 */
function fnNamesMentioning(js, probes) {
  const defRe =
    /function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/g;
  const names = new Set();
  let m;
  while ((m = defRe.exec(js)) !== null) {
    const name = m[1] || m[2];
    if (!name) continue;
    const seg = js.slice(m.index, m.index + 700);
    if (probes.some((p) => seg.includes(p))) names.add(name);
  }
  return [...names];
}

test('uiTokens: hex 灰字同步接线到颜色 input 的 input 事件', () => {
  const listenerRe = /addEventListener\(\s*['"]input['"]|\.oninput\s*=/;
  assert.ok(
    listenerRe.test(JS),
    "uiTokens 第 7 条（§9 T1.7）：内联 script 里应存在 'input' 事件监听，用于实时同步 hex 灰字",
  );
  // 接线可以是「监听器里直接写同步逻辑」，也可以是「监听器调用同步函数」（再套一层调用者也认）
  const level1 = fnNamesMentioning(JS, ['data-hex-for']);
  const level2 = fnNamesMentioning(JS, level1.map((n) => `${n}(`));
  const tokens = ['data-hex-for', ...level1, ...level2];
  const probe = new RegExp(tokens.map(escapeRe).join('|'));
  assert.ok(
    hasNearRe(JS, listenerRe, probe, 1500),
    "uiTokens 第 7 条（§9 T1.7）：颜色 input 的 'input' 事件要接到 hex 同步逻辑上——" +
      `监听器附近应出现 data-hex-for 本身，或调用写有 data-hex-for 的同步函数。当前可识别的同步入口：${JSON.stringify(tokens)}`,
  );
});

/* ==================== 8 · select 自定义外观 ==================== */

test('uiTokens: select 统一为 appearance:none 且高 32px', () => {
  const rules = collectRules(BASE, 'select');
  assert.ok(
    rules.length > 0,
    'uiTokens 第 8 条（§9 T1.8 / §3.4）：CSS 里应存在针对 select 的规则',
  );
  const d = mergedDecls(rules);
  assert.equal(
    d.get('appearance'),
    'none',
    `uiTokens 第 8 条（§9 T1.8）：select 应声明 appearance:none，实际为 ${JSON.stringify(d.get('appearance'))}`,
  );
  assert.equal(
    d.get('-webkit-appearance'),
    'none',
    `uiTokens 第 8 条（§9 T1.8）：select 应声明 -webkit-appearance:none，实际为 ${JSON.stringify(d.get('-webkit-appearance'))}`,
  );
  assert.equal(
    d.get('height'),
    '32px',
    `uiTokens 第 8 条（§9 T1.8 / §3.4）：select 高度统一为 32px，实际为 ${JSON.stringify(d.get('height'))}`,
  );
});

test('uiTokens: select 右侧有内嵌 chevron 箭头', () => {
  const rules = collectRules(BASE, 'select');
  const d = mergedDecls(rules);
  const bgVals = [d.get('background'), d.get('background-image')].filter(Boolean).join(' ');
  const hasDataUri = /data:image\/svg\+xml/i.test(bgVals);
  const hasPseudoArrow = RULES.some((r) =>
    selectorParts(r.selector).some((p) => /select/.test(p) && /::?(after|before)\b/.test(p)),
  );
  assert.ok(
    hasDataUri || hasPseudoArrow,
    'uiTokens 第 8 条（§9 T1.8 / §3.4）：select 需要内嵌箭头——' +
      'background-image 用 data:image/svg+xml 内联 SVG，或用 .select-wrap::after 画 CSS 三角，两者具备其一',
  );
});

/* ==================== 9 · 数字等宽 ==================== */

test('uiTokens: 数字类内容使用 tabular-nums', () => {
  const targets = [
    ['input.val', '.val'],
    ['#info', '#info'],
    ['#mp4ProgressV', '#mp4ProgressV'],
    ['.file-meta', '.file-meta'],
  ];
  for (const [label, token] of targets) {
    const rules = collectRules(BASE, token);
    const d = mergedDecls(rules);
    const val = d.get('font-variant-numeric');
    assert.ok(
      val && /tabular-nums/i.test(val),
      `uiTokens 第 9 条（§9 T1.9 / §3.2）：${label} 应声明 font-variant-numeric:tabular-nums 让数字等宽对齐` +
        `（可与其它选择器写在同一条选择器列表里），实际为 ${JSON.stringify(val)}`,
    );
  }
});

/* ==================== 10 · 间距变量 ==================== */

test('uiTokens: :root 定义四个间距变量', () => {
  const rootRules = BASE.filter((r) => selectorParts(r.selector).some((p) => normSel(p) === ':root'));
  assert.ok(
    rootRules.length > 0,
    'uiTokens 第 10 条（§9 T1.10 / §3.3）：CSS 里应存在 :root 规则用于定义 token 变量',
  );
  const d = mergedDecls(rootRules);
  const expected = [
    ['--sp-label', '6px'],
    ['--sp-field', '12px'],
    ['--sp-group', '24px'],
    ['--sp-step', '36px'],
  ];
  for (const [name, value] of expected) {
    assert.equal(
      d.get(name),
      value,
      `uiTokens 第 10 条（§9 T1.10 / §3.3）：:root 应定义 ${name}:${value}` +
        `（label→控件 6px、field 间 12px、子组间 24px、步骤间 36px），实际为 ${JSON.stringify(d.get(name))}`,
    );
  }
});

test('uiTokens: 四个间距变量都被 var() 引用', () => {
  const names = ['--sp-label', '--sp-field', '--sp-group', '--sp-step'];
  const unused = names.filter((n) => !new RegExp(`var\\(\\s*${escapeRe(n)}\\s*[,)]`).test(CSS));
  assert.deepEqual(
    unused,
    [],
    `uiTokens 第 10 条（§9 T1.10）：间距变量必须真正被 var() 用起来（各至少一次），` +
      `否则间距体系没有落到样式上。未被引用：${JSON.stringify(unused)}`,
  );
});

/* ==================== 11 · field 内文字层级 ==================== */

test('uiTokens: .field label 是 13px 前景色', () => {
  const rules = collectRules(BASE, 'label', '.field');
  assert.ok(
    rules.length > 0,
    'uiTokens 第 11 条（§9 T1.11 / §3.2）：CSS 里应存在 .field label 规则',
  );
  const d = mergedDecls(rules);
  assert.ok(
    /var\(\s*--fg\s*[,)]/.test(d.get('color') ?? ''),
    `uiTokens 第 11 条（§9 T1.11 / §3.2）：.field label 的 color 应为 var(--fg)——操作性文字一律用前景色，` +
      `灰色只留给元信息。实际为 ${JSON.stringify(d.get('color'))}`,
  );
  assert.equal(
    d.get('font-size'),
    '13px',
    `uiTokens 第 11 条（§9 T1.11）：.field label 的 font-size 应为 13px，实际为 ${JSON.stringify(d.get('font-size'))}`,
  );
});

test('uiTokens: .field small 是 12px 元信息灰字', () => {
  const rules = collectRules(BASE, 'small', '.field');
  assert.ok(
    rules.length > 0,
    'uiTokens 第 11 条（§9 T1.11 / §3.2）：CSS 里应存在 .field small 规则',
  );
  const d = mergedDecls(rules);
  assert.equal(
    d.get('font-size'),
    '12px',
    `uiTokens 第 11 条（§9 T1.11）：.field small 的 font-size 应为 12px，实际为 ${JSON.stringify(d.get('font-size'))}`,
  );
  assert.ok(
    /var\(\s*--dim\s*[,)]/.test(d.get('color') ?? ''),
    `uiTokens 第 11 条（§9 T1.11）：.field small 的 color 应为 var(--dim)（说明文字属于可跳过的元信息层），实际为 ${JSON.stringify(d.get('color'))}`,
  );
});

/* ==================== 12 · drop 区强调文字 ==================== */

test('uiTokens: .drop strong 用前景色而不是 accent', () => {
  const rules = collectRules(BASE, 'strong', '.drop');
  assert.ok(
    rules.length > 0,
    'uiTokens 第 12 条（§9 T1.12 / §4.3）：CSS 里应存在 .drop strong 规则（drop 区主行里的「点击选择」）',
  );
  const d = mergedDecls(rules);
  const color = d.get('color');
  assert.ok(
    /var\(\s*--fg\s*[,)]/.test(color ?? ''),
    `uiTokens 第 12 条（§9 T1.12 / §4.3）：.drop strong 的 color 应为 var(--fg)，实际为 ${JSON.stringify(color)}`,
  );
  assert.ok(
    !/accent/i.test(color ?? ''),
    `uiTokens 第 12 条（§9 T1.12 / §3.1）：.drop strong 不再使用 accent——` +
      `同一屏里蓝色界面元素只允许吸底条主按钮一处。实际为 ${JSON.stringify(color)}`,
  );
});
