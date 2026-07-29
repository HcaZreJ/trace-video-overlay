/**
 * T2 · uiLayout（目标态）— 右列信息架构重排的结构不变量断言（样例）
 *
 * 断言对象是仓库根的 index.html 源文件，切成三段后分别断言：
 *   CSS    = 全部 <style> 块的内容
 *   BODY   = <body> 里的 HTML（已剔除 <script> / <style> / 注释）
 *   SCRIPT = 全部内联 <script>（无 src）的源码
 *
 * 文本类断言在比较前会剥掉标签、去掉全部空白，因此换行、缩进、以及把
 * 「点击选择」之类的片段包进 <strong> 都不影响通过。
 * 顺序与归属关系用字符下标比较表达。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readCss, readJs } from '../helpers/source.mjs';

/* ==================== index.html 三段切分 ==================== */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = readFileSync(join(ROOT, 'index.html'), 'utf8');

const CSS = readCss();
const SCRIPT = readJs();
const BODY = (/<body\b[^>]*>([\s\S]*)<\/body>/i.exec(RAW)?.[1] ?? RAW)
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ');

/* ==================== 文本与 CSS 工具 ==================== */
const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = s => s.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, m => ENTITIES[m]);
const stripTags = s => decode(s.replace(/<[^>]*>/g, ''));
const collapse = s => s.replace(/\s+/g, ' ').trim();
const noSpace = s => s.replace(/\s+/g, '');
const cssSquash = s => s.replace(/\s+/g, '').toLowerCase();

const TEXT = collapse(stripTags(BODY));
const TEXT_NS = noSpace(TEXT);

function cssRules() {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    const selector = collapse(m[1]);
    if (!selector || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

/** 选择器的「最后一个复合选择器」是否命中该 class（`.step` 不匹配 `.step-body`、`.step > h2`）。 */
function targetsClass(selector, cls) {
  const re = new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '(?![\\w-])');
  return selector.split(',').some(part => {
    const compounds = collapse(part).split(/\s*[\s>+~]\s*/).filter(Boolean);
    return re.test(compounds[compounds.length - 1] || '');
  });
}

/* ==================== HTML 定位工具（下标比较，不做 HTML 解析） ==================== */
function findElementsByClass(html, cls) {
  const out = [];
  const re = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const cm = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[2]);
    if (!cm) continue;
    if ((cm[2] ?? cm[3]).split(/\s+/).includes(cls)) {
      out.push({ tag: m[1], attrs: m[2], start: m.index, openEnd: re.lastIndex });
    }
  }
  return out;
}

/** 从开标签起做同名标签配对扫描，返回该元素的 outerHTML。 */
function extractElement(html, el) {
  const open = new RegExp('<' + el.tag + '\\b', 'gi');
  const close = new RegExp('</' + el.tag + '\\s*>', 'gi');
  let depth = 1;
  let i = el.openEnd;
  while (depth > 0 && i < html.length) {
    open.lastIndex = i;
    close.lastIndex = i;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return html.slice(el.start);
    if (o && o.index < c.index) { depth += 1; i = o.index + el.tag.length + 1; }
    else { depth -= 1; i = close.lastIndex; }
  }
  return html.slice(el.start, i);
}

const elementText = el => noSpace(stripTags(extractElement(BODY, el)));

function headings() {
  return [...BODY.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map(m => ({ index: m.index, text: noSpace(stripTags(m[1])) }));
}

const stepHeadingIndex = marker => (headings().find(h => h.text.startsWith(marker))?.index ?? -1);

function subheadsBetween(from, to) {
  return findElementsByClass(BODY, 'subhead')
    .filter(el => el.start > from && el.start < to)
    .map(el => ({ start: el.start, text: elementText(el) }));
}

/* ==================== 断言（T2 目标态样例） ==================== */

test('uiLayout: 右列三个步骤容器 .step 的区标题依次为 ① 轨迹 / ② 样式 / ③ 导出', () => {
  const steps = findElementsByClass(BODY, 'step');
  assert.equal(
    steps.length, 3,
    `T2.1：右列应有且仅有 3 个 class 含 step 的步骤容器，实测 ${steps.length} 个`,
  );
  const want = ['①轨迹', '②样式', '③导出'];
  steps.forEach((el, i) => {
    const outer = extractElement(BODY, el);
    const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(outer);
    assert.ok(h2, `T2.1：第 ${i + 1} 个 .step 容器内应有 <h2> 区标题`);
    const text = noSpace(stripTags(h2[1]));
    assert.ok(
      text.startsWith(want[i]),
      `T2.1：第 ${i + 1} 个 .step 的 h2 文本应以「${want[i]}」开头（三步顺序一致），实测「${text}」`,
    );
  });
});

test('uiLayout: ② 样式下的三个子组标题依次为 卡片 / 线路 / 定位点', () => {
  const idx2 = stepHeadingIndex('②样式');
  const idx3 = stepHeadingIndex('③导出');
  assert.notEqual(idx2, -1, 'T2.6：应能找到以「② 样式」开头的区标题 h2');
  assert.notEqual(idx3, -1, 'T2.6：应能找到以「③ 导出」开头的区标题 h2');
  const texts = subheadsBetween(idx2, idx3).map(s => s.text);
  assert.equal(
    texts.length, 3,
    `T2.6：② 区内应有 3 个 .subhead 子组标题，实测 ${texts.length} 个：${JSON.stringify(texts)}`,
  );
  ['卡片', '线路', '定位点'].forEach((want, i) => {
    assert.ok(
      texts[i].startsWith(want),
      `T2.6：② 区第 ${i + 1} 个 .subhead 应以「${want}」开头，实测「${texts[i]}」`,
    );
  });

  // 同一条 spec 的 CSS 半边：子组标题的排版 token。
  const rules = cssRules().filter(r => targetsClass(r.selector, 'subhead'));
  assert.ok(rules.length > 0, 'T2.6：CSS 里应存在 .subhead 规则（子组标题）');
  const css = rules.map(r => cssSquash(r.body)).join(';');
  assert.ok(css.includes('font-size:13px'), 'T2.6：.subhead 的 font-size 应为 13px');
  assert.ok(css.includes('font-weight:600'), 'T2.6：.subhead 的 font-weight 应为 600');
  assert.ok(css.includes('color:var(--fg)'), 'T2.6：.subhead 的 color 应为 var(--fg)');
});

test('uiLayout: 地图子面板与定位点两处定稿文案已就位、对应旧文案已清除', () => {
  const copies = [
    '调整轨迹在卡片中所占的比例；数值调小后底图会缩小，露出的边缘显示「底色」里设置的颜色',
    '定位点是沿线路移动的圆点，会出现在预览和 MP4 动画里；轨迹卡片 PNG 不包含它，用「导出定位点 PNG」单独导出',
  ];
  for (const copy of copies) {
    assert.ok(
      TEXT_NS.includes(noSpace(copy)),
      `T2.9：HTML 文本里应包含定稿文案「${copy}」（比较时忽略空白与内联标签）`,
    );
  }
  const old = '定位点只出现在预览与 MP4 里';
  assert.ok(
    !TEXT_NS.includes(noSpace(old)) && !noSpace(SCRIPT).includes(noSpace(old)),
    `T2.10：旧文案「${old}」应已被上面的定稿说明取代`,
  );
});
