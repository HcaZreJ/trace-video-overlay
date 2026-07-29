/**
 * T4 · uiStage 目标态断言（visible 样例）
 *
 * 断言对象：仓库根的 index.html 源文件。读进来后切成三段——<style> 里的 CSS、
 * <body> 里的 HTML（剔除 script/style/注释）、末尾内联 <script> 里的 JS——再分别断言。
 * 断言只钉 plan §9 「T4 · uiStage（目标态）」点名的语义，对写法与空白保持宽容。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/* ==================== 读取与切段 ==================== */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(join(ROOT, 'index.html'), 'utf8');

const CSS = [...SRC.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
const JS = [...SRC.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/i.test(m[1]))
  .map((m) => m[2])
  .join('\n');
const HTML = ((/<body[^>]*>([\s\S]*)<\/body>/i.exec(SRC) || [null, SRC])[1])
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');

if (!CSS.trim() || !JS.trim() || !HTML.trim()) {
  throw new Error('uiStage 测试：index.html 的 CSS / HTML / 内联 script 三段中有空段，切段逻辑需要修正');
}

/* ==================== 文本工具 ==================== */

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const squeeze = (s) => s.replace(/\s+/g, '');
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ');
/** 文案包含：先折叠连续空白成单空格比较，再退一步全空白剔除比较（兼容换行断在中文中间） */
const hasText = (hay, needle) =>
  collapse(hay).includes(collapse(needle)) || squeeze(hay).includes(squeeze(needle));

/* ==================== HTML 结构工具 ==================== */

const VOID_TAGS = new Set(
  ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'],
);

function attrValue(openTag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(openTag);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
}
const classesOf = (openTag) => {
  const v = attrValue(openTag, 'class');
  return v ? v.split(/\s+/).filter(Boolean) : [];
};

/** 解析出文档序的元素列表，每项带 start / innerStart / innerEnd / end / depth / id / classes */
function parseElements(html) {
  const re = /<\/?[a-zA-Z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  const els = [];
  const stack = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = m[0];
    const name = (/^<\/?\s*([a-zA-Z][\w:-]*)/.exec(text) || [, ''])[1].toLowerCase();
    if (text[1] === '/') {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) {
          stack[k].innerEnd = m.index;
          stack[k].end = m.index + text.length;
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const el = {
      name,
      open: text,
      start: m.index,
      innerStart: m.index + text.length,
      innerEnd: m.index + text.length,
      end: m.index + text.length,
      depth: stack.length,
      id: attrValue(text, 'id') || '',
      classes: classesOf(text),
    };
    els.push(el);
    if (!(/\/>\s*$/.test(text) || VOID_TAGS.has(name))) stack.push(el);
  }
  return els;
}

const ELS = parseElements(HTML);
const byId = (id) => ELS.find((e) => e.id === id) || null;
const byClass = (cls) => ELS.filter((e) => e.classes.includes(cls));
const firstByClass = (cls) => byClass(cls)[0] || null;
const inner = (el) => HTML.slice(el.innerStart, el.innerEnd);
const tag = (el) => `<${el.name}${el.id ? '#' + el.id : ''}${el.classes.map((c) => '.' + c).join('')}>`;
const childrenOf = (el) =>
  ELS.filter((e) => e.depth === el.depth + 1 && e.start >= el.innerStart && e.end <= el.innerEnd);
const contains = (parent, child) =>
  !!parent && !!child && child.start >= parent.innerStart && child.end <= parent.innerEnd;
/** 子组标题定位：优先短文本 .subhead，其次同文本的标题标签 */
function subheadEl(text) {
  const short = (el) => collapse(stripTags(inner(el))).length <= 24;
  const hit = byClass('subhead').find((el) => short(el) && squeeze(stripTags(inner(el))).includes(squeeze(text)));
  if (hit) return hit;
  return ELS.find((el) => /^h[1-6]$/.test(el.name) && squeeze(stripTags(inner(el))) === squeeze(text)) || null;
}

/* ==================== CSS 工具 ==================== */

function parseCssRules(css) {
  const out = [];
  const walk = (text) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) break;
      const selector = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (selector.startsWith('@') && /\{/.test(body)) walk(body);
      else out.push({ selector, body });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}
const RULES = parseCssRules(CSS);
const selParts = (sel) =>
  sel.split(',').map((p) => p.replace(/\s+/g, ' ').replace(/\s*([>+~])\s*/g, '$1').trim()).filter(Boolean);
const rulesWhere = (pred) => RULES.filter((r) => selParts(r.selector).some(pred));
const declsOf = (rules) => rules.map((r) => squeeze(r.body)).join(' ;; ');
const hasClassSel = (part, cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(part);

/* ==================== JS 工具 ==================== */

const JS_SQ = squeeze(JS);
const numToken = (n) => new RegExp(`(?<![\\d.])${n}(?![\\d.])`);

/* ==================== 断言 ==================== */

test('uiStage: 左舞台只剩卡片预览、动画预览条、轨迹摘要三块', () => {
  const stage = firstByClass('stage');
  assert.ok(stage, 'T4 第 1 条：期望页面存在 .stage 左舞台容器');

  const kids = childrenOf(stage);
  const found = kids.map(tag).join(' , ') || '（空）';
  assert.equal(
    kids.length,
    3,
    `T4 第 1 条：期望 .stage 的直接子元素恰好 3 个（卡片预览 / 动画预览条 / 轨迹摘要），实际 ${kids.length} 个：${found}`,
  );

  const holdsClass = (el, cls) => el.classes.includes(cls) || byClass(cls).some((c) => contains(el, c));
  const holdsId = (el, id) => el.id === id || (byId(id) ? contains(el, byId(id)) : false);
  assert.ok(holdsClass(kids[0], 'cardbox'), `T4 第 1 条：期望第 1 块是卡片预览 .cardbox，实际 ${tag(kids[0])}`);
  assert.ok(holdsId(kids[1], 'previewScrub'), `T4 第 1 条：期望第 2 块是动画预览条（含 #previewScrub），实际 ${tag(kids[1])}`);
  assert.ok(holdsId(kids[2], 'info'), `T4 第 1 条：期望第 3 块是轨迹摘要行 #info，实际 ${tag(kids[2])}`);

  const dot = byId('dot');
  assert.ok(!dot || !contains(stage, dot), 'T4 第 1 条：期望定位点预览 #dot 已移出左舞台');
});

test('uiStage: 定位点小预览搬进「定位点」子组标题行且盒子为 32×32', () => {
  const sub = subheadEl('定位点');
  assert.ok(sub, 'T4 第 2 条：期望 ② 样式里存在「定位点」子组标题');
  const dot = byId('dot');
  const dotColor = byId('dotColor');
  assert.ok(dot, 'T4 第 2 条：期望 #dot 定位点画布仍在页面上');
  assert.ok(dotColor, 'T4 第 2 条：期望 #dotColor 颜色输入仍在页面上');
  assert.ok(
    sub.start < dot.start && dot.start < dotColor.start,
    `T4 第 2 条：期望 #dot 位于「定位点」子组标题之后、#dotColor 之前（实际下标 subhead=${sub.start} dot=${dot.start} dotColor=${dotColor.start}）`,
  );

  const box = byClass('dotbox').find((b) => contains(b, dot));
  assert.ok(box, 'T4 第 2 条：期望 #dot 被 .dotbox 棋盘格小盒子包裹');

  const boxRules = rulesWhere((p) => hasClassSel(p, 'dotbox'));
  assert.ok(boxRules.length > 0, 'T4 第 3 条：期望 CSS 里存在 .dotbox 规则');
  const d = declsOf(boxRules);
  assert.ok(d.includes('width:32px'), `T4 第 3 条：期望 .dotbox width:32px，实际声明：${d}`);
  assert.ok(d.includes('height:32px'), `T4 第 3 条：期望 .dotbox height:32px，实际声明：${d}`);
});

test('uiStage: 小预览显示尺寸按 6+(dotSize-8)/(160-8)*(28-6) 映射', () => {
  const anchors = [...JS_SQ.matchAll(/(?<![\d.])160(?![\d.])/g)].map((m) => m.index);
  assert.ok(anchors.length > 0, 'T4 第 4 条：期望内联 script 里出现 dotSize 上限 160（显示尺寸线性映射的端点）');

  const hit = anchors.find((i) => {
    const w = JS_SQ.slice(Math.max(0, i - 180), i + 180);
    return numToken(6).test(w) && numToken(8).test(w) && numToken(28).test(w);
  });
  assert.ok(
    hit !== undefined,
    'T4 第 4 条：期望 render() 里有一段表达式同时含 6 / 8 / 160 / 28 四个端点，把 dotSize 线性映射成 6–28px 的显示尺寸',
  );

  const wide = JS_SQ.slice(Math.max(0, hit - 500), hit + 500);
  assert.ok(/dotSize/.test(wide), 'T4 第 4 条：期望这段映射读的是 dotSize（随定位点大小实时变化）');
  assert.ok(/Math\.round|toFixed\(0\)/.test(wide), 'T4 第 4 条：期望映射结果四舍五入');
  assert.ok(
    /style\.width/.test(wide) && /style\.height/.test(wide),
    'T4 第 4 条：期望把映射结果以 px 写进 #dot 的 style.width / style.height',
  );
});
