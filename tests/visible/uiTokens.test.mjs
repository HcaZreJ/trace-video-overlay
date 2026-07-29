// uiTokens · 目标态断言（可见样例）
// 规格来源：.claude/plans/ui-hierarchy-redesign.md → §3 视觉 token 规范 / §9「T1 · uiTokens（目标态）」
// 形态：node:test + node:assert/strict，零依赖；读 index.html 切成 CSS / HTML / 内联 JS 三段再断言。
// 断言只钉住 spec 点名的语义 token：比较前折叠空白，按选择器切出规则体后再在体内找目标声明。

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

/* ==================== HTML 结构辅助 ==================== */

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

/* ==================== 三段与常量 ==================== */

const CSS = stripCssComments(extractStyleCss(SRC));
const HTML = extractBodyHtml(SRC);
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

/* ==================== 断言 ==================== */

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

test('uiTokens: segmented 选中态使用中性高对比配色', () => {
  const rules = collectRules(BASE, ['.seg-opt', '.active']);
  assert.ok(
    rules.length > 0,
    'uiTokens 第 3 条（§9 T1.3 / §3.1）：CSS 里应存在 .seg-opt.active 规则，用于定义 segmented 选中态',
  );
  const d = mergedDecls(rules);
  const bg = d.get('background') ?? d.get('background-color');
  assert.ok(
    bg && /#39404d/i.test(bg),
    `uiTokens 第 3 条（§9 T1.3）：.seg-opt.active 的 background 应为 #39404d（选中态 = 当前位置，与蓝色主动作区分），实际为 ${JSON.stringify(bg)}`,
  );
  const color = d.get('color');
  assert.ok(
    color && /^(#fff|#ffffff|white)$/i.test(collapse(color)),
    `uiTokens 第 3 条（§9 T1.3）：.seg-opt.active 的 color 应为 #fff，实际为 ${JSON.stringify(color)}`,
  );
  const accented = rules.filter((r) => /var\(\s*--accent-strong\s*[,)]/.test(r.body)).map((r) => collapse(r.selector));
  assert.deepEqual(
    accented,
    [],
    `uiTokens 第 3 条（§9 T1.3）：.seg-opt.active 规则体不得再使用 var(--accent-strong)。命中选择器：${JSON.stringify(accented)}`,
  );
});

test('uiTokens: 七个颜色输入都在 .color-row 行内并配有 data-hex-for 灰字', () => {
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
      `uiTokens 第 6 条（§9 T1.6）：${id} 所在的行应是 .color-row 结构（label + 28×28 swatch + hex 灰字），全宽颜色条取消`,
    );
    assert.equal(
      rowOfHex,
      rowOfInput,
      `uiTokens 第 6 条（§9 T1.6）：data-hex-for="${id}" 的元素应与 #${id} 同在一个 .color-row 容器内`,
    );
  }
});
