/**
 * T4 · uiStage 目标态断言（hidden 全量）
 *
 * 断言对象：仓库根的 index.html 源文件。读进来后切成三段——<style> 里的 CSS、
 * <body> 里的 HTML（剔除 script/style/注释）、末尾内联 <script> 里的 JS——再分别断言。
 * 覆盖 plan §9 「T4 · uiStage（目标态）」10 条，对写法与空白保持宽容：
 * 文案比较前先折叠连续空白，位置关系用文档序下标表达，只钉清单点名的语义。
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
/** 文案出现次数（按折叠空白后的整份文本计数） */
const countText = (hay, needle) => squeeze(hay).split(squeeze(needle)).length - 1;

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
const byTag = (name) => ELS.filter((e) => e.name === name);
const inner = (el) => HTML.slice(el.innerStart, el.innerEnd);
const outer = (el) => HTML.slice(el.start, el.end);
const tag = (el) => `<${el.name}${el.id ? '#' + el.id : ''}${el.classes.map((c) => '.' + c).join('')}>`;
const childrenOf = (el) =>
  ELS.filter((e) => e.depth === el.depth + 1 && e.start >= el.innerStart && e.end <= el.innerEnd);
const contains = (parent, child) =>
  !!parent && !!child && child.start >= parent.innerStart && child.end <= parent.innerEnd;
const parentOf = (el) =>
  [...ELS].reverse().find((e) => e !== el && contains(e, el)) || null;
/** 子组标题定位：优先短文本 .subhead，其次同文本的标题标签 */
function subheadEl(text) {
  const short = (el) => collapse(stripTags(inner(el))).length <= 24;
  const hit = byClass('subhead').find((el) => short(el) && squeeze(stripTags(inner(el))).includes(squeeze(text)));
  if (hit) return hit;
  return ELS.find((el) => /^h[1-6]$/.test(el.name) && squeeze(stripTags(inner(el))) === squeeze(text)) || null;
}
/** 片段内的位置下标：id="xxx" 的出现位置，找不到返回 -1 */
const idPos = (html, id) => {
  const m = new RegExp(`\\bid\\s*=\\s*("${id}"|'${id}'|${id}(?=[\\s>]))`).exec(html);
  return m ? m.index : -1;
};
/** 片段内的位置下标：class 列表里含 cls 的元素出现位置，找不到返回 -1 */
const clsPos = (html, cls) => {
  const m = new RegExp(
    `\\bclass\\s*=\\s*("[^"]*(?<![\\w-])${cls}(?![\\w-])[^"]*"|'[^']*(?<![\\w-])${cls}(?![\\w-])[^']*')`,
  ).exec(html);
  return m ? m.index : -1;
};
/** 三个步骤容器里，h2 文本以给定序号词开头的那个 */
function stepWithHead(text) {
  return (
    byClass('step').find((s) => {
      const h = ELS.find((e) => e.name === 'h2' && contains(s, e));
      return h && squeeze(stripTags(inner(h))).includes(squeeze(text));
    }) || null
  );
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
const hasIdSel = (part, id) => new RegExp(`#${id}(?![\\w-])`).test(part);
const rulesText = (rules) => rules.map((r) => `${collapse(r.selector)}{${squeeze(r.body)}}`).join('  |  ') || '（无）';

/* ==================== JS 工具 ==================== */

const JS_SQ = squeeze(JS);
const numToken = (n) => new RegExp(`(?<![\\d.])${n}(?![\\d.])`);
/** 以某个 token 的每次出现为锚点，取前后窗口 */
const windowsAround = (token, before, after) =>
  [...JS_SQ.matchAll(new RegExp(token, 'g'))].map((m) =>
    JS_SQ.slice(Math.max(0, m.index - before), m.index + after));
/** 定位点显示尺寸映射所在的表达式窗口（6 / 8 / 28 / 160 四端点 + dotSize 同处一段） */
function mappingWindow(radius) {
  const anchors = [...JS_SQ.matchAll(/(?<![\d.])160(?![\d.])/g)].map((m) => m.index);
  for (const i of anchors) {
    const w = JS_SQ.slice(Math.max(0, i - radius), i + radius);
    if (numToken(6).test(w) && numToken(8).test(w) && numToken(28).test(w) && /dotSize/.test(w)) return w;
  }
  return null;
}

/* ==================== T4 第 1 条 · 左舞台只剩三块 ==================== */

test('uiStage: .stage 舞台里只留卡片预览 / 动画预览条 / 轨迹摘要三块', () => {
  const stage = firstByClass('stage');
  assert.ok(stage, 'T4 第 1 条：期望页面存在 .stage 左舞台容器');
  const html = inner(stage);

  assert.ok(clsPos(html, 'cardbox') >= 0, 'T4 第 1 条：期望 .stage 内含卡片预览 .cardbox');
  assert.ok(idPos(html, 'previewScrub') >= 0, 'T4 第 1 条：期望 .stage 内含动画预览条 #previewScrub');
  assert.ok(idPos(html, 'info') >= 0, 'T4 第 1 条：期望 .stage 内含轨迹摘要行 #info');
});

test('uiStage: 舞台内容按 卡片预览 → 动画预览条 → 轨迹摘要 的顺序排列', () => {
  const stage = firstByClass('stage');
  assert.ok(stage, 'T4 第 1 条：期望页面存在 .stage 左舞台容器');
  const html = inner(stage);

  const card = clsPos(html, 'cardbox');
  const scrub = idPos(html, 'previewScrub');
  const info = idPos(html, 'info');
  assert.ok(card >= 0 && scrub >= 0 && info >= 0,
    `T4 第 1 条：三块内容需齐备（下标 cardbox=${card} previewScrub=${scrub} info=${info}）`);
  assert.ok(card < scrub,
    `T4 第 1 条：期望卡片预览排在动画预览条之前（下标 cardbox=${card} previewScrub=${scrub}）`);
  assert.ok(scrub < info,
    `T4 第 1 条：期望动画预览条排在轨迹摘要之前（下标 previewScrub=${scrub} info=${info}）`);
});

test('uiStage: 定位点预览与它的说明已经移出左舞台', () => {
  const stage = firstByClass('stage');
  assert.ok(stage, 'T4 第 1 条：期望页面存在 .stage 左舞台容器');
  const html = inner(stage);

  assert.equal(idPos(html, 'dot'), -1,
    'T4 第 1 条：期望 #dot 定位点画布已从 .stage 移出（迁往 ② 样式的定位点子组）');
  assert.equal(clsPos(html, 'dotbox'), -1,
    'T4 第 1 条：期望 .dotbox 小盒子不再出现在 .stage 内');
  assert.equal(clsPos(html, 'dotwrap'), -1,
    'T4 第 1 条：期望旧的 .dotwrap 定位点区块不再出现在 .stage 内');
});

/* ==================== T4 第 2 条 · 定位点小预览迁入子组标题行 ==================== */

test('uiStage: #dot 位于「定位点」子组标题之后、#dotColor 之前', () => {
  const sub = subheadEl('定位点');
  assert.ok(sub, 'T4 第 2 条：期望 ② 样式里存在「定位点」子组标题（.subhead）');
  const dot = byId('dot');
  const dotColor = byId('dotColor');
  assert.ok(dot, 'T4 第 2 条：期望 #dot 定位点画布仍在页面上');
  assert.ok(dotColor, 'T4 第 2 条：期望 #dotColor 颜色输入仍在页面上');

  assert.ok(sub.start < dot.start,
    `T4 第 2 条：期望 #dot 在「定位点」子组标题之后（下标 subhead=${sub.start} dot=${dot.start}）`);
  assert.ok(dot.start < dotColor.start,
    `T4 第 2 条：期望 #dot 在 #dotColor 之前（下标 dot=${dot.start} dotColor=${dotColor.start}）`);
});

test('uiStage: #dot 被 .dotbox 包裹，且与「定位点」子组标题同处一行容器', () => {
  const sub = subheadEl('定位点');
  assert.ok(sub, 'T4 第 2 条：期望 ② 样式里存在「定位点」子组标题（.subhead）');
  const dot = byId('dot');
  assert.ok(dot, 'T4 第 2 条：期望 #dot 定位点画布仍在页面上');

  const box = byClass('dotbox').find((b) => contains(b, dot));
  assert.ok(box, `T4 第 2 条：期望 #dot 被 .dotbox 棋盘格小盒子包裹，实际 #dot 的父元素是 ${parentOf(dot) ? tag(parentOf(dot)) : '（无）'}`);

  const row = parentOf(sub);
  assert.ok(row, 'T4 第 2 条：期望「定位点」子组标题外层存在标题行容器');
  assert.ok(contains(row, dot) || contains(sub, dot),
    `T4 第 2 条：期望小预览与「定位点」子组标题同处一行（标题行容器 ${tag(row)} 未包含 #dot）`);
});

test('uiStage: 旧 .dotwrap 的两行说明文字不再出现', () => {
  for (const old of ['单独的定位点', '放进剪映后用位置关键帧']) {
    assert.ok(
      !hasText(SRC, old),
      `T4 第 2 条：期望旧的定位点说明「${old}」已删除（定位点规则只保留 ② 样式里的那一句）`,
    );
  }
});

/* ==================== T4 第 3 条 · .dotbox 尺寸 ==================== */

test('uiStage: .dotbox 小盒子的宽高为 32px', () => {
  const boxRules = rulesWhere((p) => hasClassSel(p, 'dotbox'));
  assert.ok(boxRules.length > 0, 'T4 第 3 条：期望 CSS 里存在 .dotbox 规则');
  const d = declsOf(boxRules);
  assert.ok(d.includes('width:32px'), `T4 第 3 条：期望 .dotbox width:32px，实际声明：${d}`);
  assert.ok(d.includes('height:32px'), `T4 第 3 条：期望 .dotbox height:32px，实际声明：${d}`);
});

test('uiStage: .dotbox 的尺寸声明只有 32px 一档（min/max 不再撑大盒子）', () => {
  const boxRules = rulesWhere((p) => hasClassSel(p, 'dotbox'));
  assert.ok(boxRules.length > 0, 'T4 第 3 条：期望 CSS 里存在 .dotbox 规则');

  for (const r of boxRules) {
    const decls = [...squeeze(r.body).matchAll(/(?:^|;)((?:min-|max-)?(?:width|height)):([^;]+)/g)];
    for (const [, prop, value] of decls) {
      if (!/^\d+(?:\.\d+)?px$/.test(value)) continue; // 只管写死 px 的那些
      assert.equal(
        value,
        '32px',
        `T4 第 3 条：期望 .dotbox 的尺寸声明统一为 32px，实际 ${prop}:${value}（规则「${collapse(r.selector)}」）`,
      );
    }
  }
});

/* ==================== T4 第 4 条 · 显示尺寸线性映射 ==================== */

test('uiStage: 显示尺寸映射的四个端点 6 / 8 / 28 / 160 出现在同一段表达式里', () => {
  const anchors = [...JS_SQ.matchAll(/(?<![\d.])160(?![\d.])/g)].map((m) => m.index);
  assert.ok(anchors.length > 0, 'T4 第 4 条：期望内联 script 里出现 dotSize 上限 160（线性映射的端点）');

  const w = mappingWindow(220);
  assert.ok(
    w,
    'T4 第 4 条：期望 render() 里有一段表达式同时含 6 / 8 / 160 / 28 四个端点与 dotSize，把 dotSize 线性映射成 6–28px 的显示尺寸',
  );
});

test('uiStage: 映射结果四舍五入后以 px 写进 #dot 的行内宽高', () => {
  const w = mappingWindow(500);
  assert.ok(w, 'T4 第 4 条：期望先能定位到 6 / 8 / 160 / 28 四端点所在的映射表达式');

  assert.ok(/Math\.round|toFixed\(0\)/.test(w), 'T4 第 4 条：期望映射结果四舍五入');
  assert.ok(/style\.width/.test(w), 'T4 第 4 条：期望把映射结果写进 #dot 的 style.width');
  assert.ok(/style\.height/.test(w), 'T4 第 4 条：期望把映射结果写进 #dot 的 style.height');
  assert.ok(/['"`]px['"`]|px['"`]/.test(w), 'T4 第 4 条：期望显示尺寸带 px 单位');
});

test('uiStage: 显示尺寸随 dotSize 线性变化（写在每帧重跑的 render 里）', () => {
  assert.ok(/function\s*render\s*\(|render\s*=\s*(function|\()/.test(JS_SQ),
    'T4 第 4 条：期望内联 script 里存在 render() 函数');
  const w = mappingWindow(220);
  assert.ok(w, 'T4 第 4 条：期望先能定位到 6 / 8 / 160 / 28 四端点所在的映射表达式');
  assert.ok(/dotSize/.test(w),
    'T4 第 4 条：期望这段映射读的是 dotSize 当前值，而不是写死的常量');
  assert.ok(/\//.test(w) && /\*/.test(w),
    'T4 第 4 条：期望映射是 6+(dotSize-8)/(160-8)*(28-6) 这样的线性换算（含除与乘）');
});

/* ==================== T4 第 5 条 · 空状态文案 ==================== */

test('uiStage: renderCard 空状态主行文案为「拖入轨迹文件，或点击这里选择文件」', () => {
  assert.ok(
    hasText(JS, '拖入轨迹文件，或点击这里选择文件'),
    'T4 第 5 条：期望内联 script 的 renderCard 空状态主行文案为「拖入轨迹文件，或点击这里选择文件」',
  );
});

test('uiStage: 空状态副行「也可以先载入示例轨迹」以 loadSample 未 hidden 为条件', () => {
  const needle = squeeze('也可以先载入示例轨迹');
  const at = JS_SQ.indexOf(needle);
  assert.ok(at >= 0, 'T4 第 5 条：期望内联 script 的空状态副行文案为「也可以先载入示例轨迹」');

  const w = JS_SQ.slice(Math.max(0, at - 400), at + 400);
  assert.ok(/loadSample/.test(w),
    'T4 第 5 条：期望副行的显示条件读 loadSample（示例文件可访问时才显示）');
  assert.ok(/hidden/.test(w),
    'T4 第 5 条：期望副行以 loadSample 的 hidden 属性为条件（未 hidden 才显示）');
});

test('uiStage: 旧的空状态文案不再出现', () => {
  for (const old of ['拖入轨迹文件开始', '或点上方「试试示例轨迹」']) {
    assert.ok(!hasText(SRC, old), `T4 第 5 条：期望旧空状态文案「${old}」已被替换`);
  }
});

/* ==================== T4 第 6 条 · gate 收起与展开 ==================== */

test('uiStage: 每个 .step 的内容包在 .step-body 里，区标题留在 .step-body 之外', () => {
  const steps = byClass('step');
  assert.ok(steps.length >= 3, `T4 第 6 条：期望右列存在三个 .step 步骤容器，实际 ${steps.length} 个`);

  for (const s of steps) {
    const body = byClass('step-body').find((b) => contains(s, b));
    assert.ok(body, `T4 第 6 条：期望 ${tag(s)} 的内容包在 .step-body 里`);
    const h2 = ELS.find((e) => e.name === 'h2' && contains(s, e));
    assert.ok(h2, `T4 第 6 条：期望 ${tag(s)} 里有区标题 <h2>`);
    assert.ok(
      !contains(body, h2),
      `T4 第 6 条：期望区标题留在 .step-body 之外（收起时只渲染标题行），实际 ${collapse(stripTags(inner(h2)))} 被包进了 .step-body`,
    );
  }
});

test('uiStage: CSS 用 .needs-track .step-body 收起步骤内容', () => {
  const hits = RULES.filter((r) =>
    selParts(r.selector).some((p) => hasClassSel(p, 'needs-track') && hasClassSel(p, 'step-body'))
    && squeeze(r.body).includes('display:none'));
  assert.ok(
    hits.length > 0,
    `T4 第 6 条：期望 CSS 含 .needs-track .step-body{display:none}，实际与 .step-body 相关的规则：${rulesText(rulesWhere((p) => hasClassSel(p, 'step-body')))}`,
  );
});

test('uiStage: 收起状态的步骤标题降到 opacity .45', () => {
  const hits = RULES.filter((r) =>
    selParts(r.selector).some((p) => hasClassSel(p, 'needs-track') && /h2/.test(p))
    && /opacity:0?\.45(?!\d)/.test(squeeze(r.body)));
  assert.ok(
    hits.length > 0,
    `T4 第 6 条：期望 CSS 含 .step.needs-track > h2 的 opacity:.45，实际与 .needs-track 相关的规则：${rulesText(rulesWhere((p) => hasClassSel(p, 'needs-track')))}`,
  );
});

test('uiStage: 空状态下吸底动作条不渲染', () => {
  const hits = RULES.filter((r) =>
    selParts(r.selector).some((p) => hasClassSel(p, 'export-actions') && hasClassSel(p, 'needs-track'))
    && squeeze(r.body).includes('display:none'));
  assert.ok(
    hits.length > 0,
    `T4 第 6 条：期望 CSS 含 .export-actions.needs-track{display:none}，实际与 .export-actions 相关的规则：${rulesText(rulesWhere((p) => hasClassSel(p, 'export-actions')))}`,
  );
});

/* ==================== T4 第 7 条 · gate 提示 ==================== */

test('uiStage: #trackGateHint 文案为「载入轨迹后可用」', () => {
  const hint = byId('trackGateHint');
  assert.ok(hint, 'T4 第 7 条：期望页面存在 #trackGateHint');
  assert.ok(
    hasText(stripTags(inner(hint)), '载入轨迹后可用'),
    `T4 第 7 条：期望 #trackGateHint 文案为「载入轨迹后可用」，实际「${collapse(stripTags(inner(hint)))}」`,
  );
});

test('uiStage: #trackGateHint 位于 ② 样式的标题行内（不随内容一起收起）', () => {
  const hint = byId('trackGateHint');
  assert.ok(hint, 'T4 第 7 条：期望页面存在 #trackGateHint');
  const step = stepWithHead('② 样式');
  assert.ok(step, 'T4 第 7 条：期望右列存在 h2 为「② 样式」的 .step 容器');

  assert.ok(contains(step, hint), 'T4 第 7 条：期望 #trackGateHint 落在 ② 样式这一步里');
  const body = byClass('step-body').find((b) => contains(step, b));
  if (body) {
    assert.ok(
      !contains(body, hint),
      'T4 第 7 条：期望 #trackGateHint 在标题行内而不在 .step-body 内（收起时它仍要可见）',
    );
  }
  const h2 = ELS.find((e) => e.name === 'h2' && contains(step, e));
  assert.ok(h2, 'T4 第 7 条：期望 ② 样式这一步里有 <h2> 区标题');
  assert.ok(
    Math.abs(hint.start - h2.start) < 400,
    `T4 第 7 条：期望 #trackGateHint 紧贴 ② 样式的标题行（下标 h2=${h2.start} hint=${hint.start}）`,
  );
});

test('uiStage: 「载入轨迹后可用」整页只出现一次', () => {
  const n = countText(HTML, '载入轨迹后可用');
  assert.equal(n, 1, `T4 第 7 条：期望这句 gate 提示全页只出现一次，实际出现 ${n} 次`);
});

/* ==================== T4 第 8 条 · setTrackGate 同步 body 类 ==================== */

test('uiStage: setTrackGate 同步 body 的 has-track 类', () => {
  assert.ok(/setTrackGate/.test(JS_SQ), 'T4 第 8 条：期望内联 script 里存在 setTrackGate');
  const wins = windowsAround('setTrackGate', 0, 800);
  assert.ok(
    wins.some((w) => /document\.body\.classList\.toggle\((['"])has-track\1/.test(w)),
    'T4 第 8 条：期望 setTrackGate 里含 document.body.classList.toggle(\'has-track\', hasTrack)',
  );
});

test('uiStage: setTrackGate 仍同步 [data-gate] 的 needs-track 与 inert', () => {
  assert.ok(/setTrackGate/.test(JS_SQ), 'T4 第 8 条：期望内联 script 里存在 setTrackGate');
  const wins = windowsAround('setTrackGate', 0, 800);
  assert.ok(
    wins.some((w) => /data-gate/.test(w) && /needs-track/.test(w)),
    'T4 第 8 条：期望 setTrackGate 继续对 [data-gate] 切 needs-track 类（新增 has-track 是在现有逻辑之外）',
  );
  assert.ok(
    wins.some((w) => /inert/.test(w)),
    'T4 第 8 条：期望 setTrackGate 继续同步 inert（收起时 ②③ 区不可聚焦）',
  );
});

/* ==================== T4 第 9 条 · 示例轨迹链接位置 ==================== */

test('uiStage: #loadSample 是 .drop 的兄弟节点并紧随其后', () => {
  const sample = byId('loadSample');
  assert.ok(sample, 'T4 第 9 条：期望页面存在 #loadSample 示例轨迹入口');
  const drop = byId('drop') || firstByClass('drop');
  assert.ok(drop, 'T4 第 9 条：期望页面存在 drop 区');

  assert.ok(!contains(drop, sample),
    'T4 第 9 条：期望 #loadSample 不放在 role="button" 的 .drop 内部（避免嵌套交互语义）');
  assert.ok(sample.start >= drop.end,
    `T4 第 9 条：期望 #loadSample 位于 .drop 之后（下标 drop 结束=${drop.end} loadSample=${sample.start}）`);
  assert.equal(sample.depth, drop.depth,
    `T4 第 9 条：期望 #loadSample 与 .drop 同为兄弟节点（层级 drop=${drop.depth} loadSample=${sample.depth}）`);

  const between = ELS.filter((e) =>
    e.start >= drop.end && e.start < sample.start && e.depth === drop.depth
    && !/\shidden(\s|=|>)/i.test(e.open) && attrValue(e.open, 'type') !== 'file');
  assert.equal(
    between.length,
    0,
    `T4 第 9 条：期望 #loadSample 紧随 .drop 之后，中间不插入其它内容，实际插入了：${between.map(tag).join(' , ')}`,
  );
});

test('uiStage: #loadSample 已从 header 移出', () => {
  const sample = byId('loadSample');
  assert.ok(sample, 'T4 第 9 条：期望页面存在 #loadSample 示例轨迹入口');
  for (const h of byTag('header')) {
    assert.ok(!contains(h, sample), 'T4 第 9 条：期望 #loadSample 不再放在 <header> 里（入口移进 ① 轨迹的 drop 区下方）');
  }
});

test('uiStage: CSS 在 has-track 状态下隐藏 #loadSample', () => {
  const hits = RULES.filter((r) =>
    selParts(r.selector).some((p) => hasIdSel(p, 'loadSample') && /has-track/.test(p))
    && squeeze(r.body).includes('display:none'));
  assert.ok(
    hits.length > 0,
    `T4 第 9 条：期望 CSS 含 body.has-track #loadSample{display:none}（载入后一屏只剩吸底条一处蓝色），实际与 #loadSample 相关的规则：${rulesText(rulesWhere((p) => hasIdSel(p, 'loadSample')))}`,
  );
});

/* ==================== T4 第 10 条 · 空状态点击画布选文件 ==================== */

test('uiStage: .cardbox 的 click 触发 $(\'file\').click()', () => {
  assert.ok(/cardbox/.test(JS_SQ), 'T4 第 10 条：期望内联 script 里给 .cardbox 接上点击行为');
  const wins = windowsAround('cardbox', 200, 500);
  assert.ok(
    wins.some((w) => /addEventListener\((['"])click\1|onclick/.test(w) && /\$\((['"])file\1\)\.click\(\)/.test(w)),
    'T4 第 10 条：期望 .cardbox 绑 click → $(\'file\').click()（空状态下点画布也能选文件）',
  );
});

test('uiStage: .cardbox 的 click 在已有 trackPoints 时直接返回', () => {
  const wins = windowsAround('cardbox', 200, 500);
  assert.ok(
    wins.some((w) => /\$\((['"])file\1\)\.click\(\)/.test(w) && /trackPoints/.test(w) && /return/.test(w)),
    'T4 第 10 条：期望这个 click 处理里以 trackPoints 存在为条件直接返回（载入轨迹后移除点击选文件行为）',
  );
});

test('uiStage: .cardbox 的 cursor:pointer 只在 body:not(.has-track) 下生效', () => {
  const pointerRules = RULES.filter((r) =>
    squeeze(r.body).includes('cursor:pointer')
    && selParts(r.selector).some((p) => hasClassSel(p, 'cardbox')));
  assert.ok(
    pointerRules.length > 0,
    `T4 第 10 条：期望存在给 .cardbox 设 cursor:pointer 的规则，实际与 .cardbox 相关的规则：${rulesText(rulesWhere((p) => hasClassSel(p, 'cardbox')))}`,
  );

  for (const r of pointerRules) {
    const parts = selParts(r.selector).filter((p) => hasClassSel(p, 'cardbox'));
    for (const p of parts) {
      assert.ok(
        /:not\(\.has-track\)/.test(squeeze(p)),
        `T4 第 10 条：期望 .cardbox 的 cursor:pointer 限定在 body:not(.has-track) 下，实际选择器「${p}」没有这个限定`,
      );
    }
  }
});
