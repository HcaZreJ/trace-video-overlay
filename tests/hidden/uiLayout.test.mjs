/**
 * T2 · uiLayout（目标态）— 右列信息架构重排的结构不变量断言（完整用例）
 *
 * 断言对象是仓库根的 index.html 源文件，切成三段后分别断言：
 *   CSS    = 全部 <style> 块的内容
 *   BODY   = <body> 里的 HTML（已剔除 <script> / <style> / 注释）
 *   SCRIPT = 全部内联 <script>（无 src）的源码
 *
 * 文本类断言在比较前剥标签、去全部空白；顺序与归属关系用字符下标比较表达。
 * 每条断言对应 plan §9「T2 · uiLayout（目标态）」的一条，失败信息里标注 T2.<n>。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ==================== index.html 三段切分 ==================== */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = readFileSync(join(ROOT, 'index.html'), 'utf8');

const CSS = [...RAW.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const SCRIPT = [...RAW.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc\s*=/i.test(m[1]))
  .map(m => m[2])
  .join('\n');
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
const SCRIPT_NS = noSpace(SCRIPT);

function occurrences(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

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

function findElementById(html, id) {
  const re = new RegExp('<([a-zA-Z][\\w-]*)\\b([^>]*\\bid\\s*=\\s*["\']' + id + '["\'][^>]*)>', 'i');
  const m = re.exec(html);
  return m ? { tag: m[1], attrs: m[2], start: m.index, openEnd: m.index + m[0].length } : null;
}

function idIndex(html, id) {
  const m = new RegExp('\\bid\\s*=\\s*["\']' + id + '["\']').exec(html);
  return m ? m.index : -1;
}

function classList(el) {
  const cm = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(el.attrs);
  return cm ? (cm[2] ?? cm[3]).split(/\s+/).filter(Boolean) : [];
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

/** ② 样式区内的三个子组标题（卡片 / 线路 / 定位点）的起始下标。 */
function styleSubgroups() {
  const idx2 = stepHeadingIndex('②样式');
  const idx3 = stepHeadingIndex('③导出');
  assert.notEqual(idx2, -1, 'T2.1/T2.6：应能找到以「② 样式」开头的区标题 h2');
  assert.notEqual(idx3, -1, 'T2.1/T2.6：应能找到以「③ 导出」开头的区标题 h2');
  const subs = subheadsBetween(idx2, idx3);
  const pick = want => subs.find(s => s.text.startsWith(want));
  return { idx2, idx3, subs, pick };
}

/* ==================== T2.1 三个步骤容器 ==================== */

test('uiLayout: 右列三个步骤容器 .step 的区标题依次为 ① 轨迹 / ② 样式 / ③ 导出', () => {
  const steps = findElementsByClass(BODY, 'step');
  assert.equal(
    steps.length, 3,
    `T2.1：右列应有且仅有 3 个 class 含 step 的步骤容器，实测 ${steps.length} 个`,
  );
  const want = ['①轨迹', '②样式', '③导出'];
  const got = [];
  steps.forEach((el, i) => {
    const outer = extractElement(BODY, el);
    const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(outer);
    assert.ok(h2, `T2.1：第 ${i + 1} 个 .step 容器内应有 <h2> 区标题`);
    const text = noSpace(stripTags(h2[1]));
    got.push(text);
    assert.ok(
      text.startsWith(want[i]),
      `T2.1：第 ${i + 1} 个 .step 的 h2 文本应以「${want[i]}」开头（三步顺序一致），实测「${text}」`,
    );
  });
  const positions = want.map(w => stepHeadingIndex(w));
  assert.ok(
    positions[0] < positions[1] && positions[1] < positions[2],
    `T2.1：三个区标题在文档中的先后顺序应为 ① → ② → ③，实测下标 ${JSON.stringify(positions)}（标题文本 ${JSON.stringify(got)}）`,
  );
});

test('uiLayout: 三个步骤容器不再使用旧的 .section 卡片类', () => {
  const steps = findElementsByClass(BODY, 'step');
  assert.ok(steps.length > 0, 'T2.1：应存在 .step 步骤容器');
  for (const el of steps) {
    const classes = classList(el);
    assert.ok(
      !classes.includes('section'),
      `T2.1：步骤容器不应再带旧的 section 卡片类，实测 class="${classes.join(' ')}"`,
    );
  }
});

/* ==================== T2.2 步骤容器不是边框卡片 ==================== */

test('uiLayout: .step 规则体不含 --line 边框与 --panel 底色', () => {
  const rules = cssRules().filter(r => targetsClass(r.selector, 'step') && !r.selector.includes('::'));
  assert.ok(
    rules.length > 0,
    'T2.2：CSS 里应存在作用于 .step 的规则（步骤之间用间距+分隔线表达分组）',
  );
  for (const r of rules) {
    const body = cssSquash(r.body);
    assert.ok(
      !body.includes('border:1pxsolidvar(--line)'),
      `T2.2：「${r.selector}」不应含 border:1px solid var(--line)（步骤间取消边框卡片包裹）`,
    );
    assert.ok(
      !body.includes('background:var(--panel)'),
      `T2.2：「${r.selector}」不应含 background:var(--panel)（--panel 只留给悬浮层与从属层）`,
    );
  }
});

/* ==================== T2.3 边框容器白名单 ==================== */

test('uiLayout: --panel 底色 + --line 边框的容器只允许吸底条 / 地图子面板 / 取色弹层', () => {
  // 白名单 = 悬浮层 / 从属层 / 取色弹层 / 文件列表的列表行（列表行不是把步骤包成卡片的容器）
  const allow = ['.export-actions', '.map-subpanel', '.cp-popup', '.file-row'];
  const offenders = cssRules()
    .filter(r => {
      const body = cssSquash(r.body);
      return body.includes('background:var(--panel)') && body.includes('border:1pxsolidvar(--line)');
    })
    .filter(r => !allow.some(a => r.selector.includes(a)))
    .map(r => r.selector);
  assert.deepEqual(
    offenders, [],
    `T2.3：同时带 background:var(--panel) 与 border:1px solid var(--line) 的规则只允许 ${allow.join(' / ')}，越界选择器：${JSON.stringify(offenders)}`,
  );
});

/* ==================== T2.4 地图嵌套子面板 ==================== */

test('uiLayout: .map-subpanel 规则含 --panel 底色 + 2px 左竖线 + 12px 缩进', () => {
  const rules = cssRules().filter(r => targetsClass(r.selector, 'map-subpanel'));
  assert.ok(rules.length > 0, 'T2.4：CSS 里应存在 .map-subpanel 规则（地图配置嵌套子面板 = 从属层）');
  const body = rules.map(r => cssSquash(r.body)).join(';');
  assert.ok(body.includes('background:var(--panel)'), 'T2.4：.map-subpanel 应有 background:var(--panel)');
  assert.ok(
    body.includes('border-left:2pxsolidvar(--line)'),
    'T2.4：.map-subpanel 应有 border-left:2px solid var(--line)',
  );
  assert.ok(
    /padding-left:12px|margin-left:12px|padding:[^;]*12px/.test(body),
    'T2.4：.map-subpanel 应有 12px 左缩进（padding-left:12px 或等效声明）',
  );
});

test('uiLayout: #bgMapFields 带上 map-subpanel class', () => {
  const el = findElementById(BODY, 'bgMapFields');
  assert.ok(el, 'T2.4：HTML 中应存在 id="bgMapFields" 的元素');
  const classes = classList(el);
  assert.ok(
    classes.includes('map-subpanel'),
    `T2.4：#bgMapFields 应带 map-subpanel class，实测 class="${classes.join(' ')}"`,
  );
});

/* ==================== T2.5 子面板内部顺序 ==================== */

test('uiLayout: #bgMapFields 内部依次包含 key / 路况 / 底图样式 / 蒙层 / 取景缩放 / 重新拉取 / 状态', () => {
  const el = findElementById(BODY, 'bgMapFields');
  assert.ok(el, 'T2.5：HTML 中应存在 id="bgMapFields" 的元素');
  const panel = extractElement(BODY, el);

  const items = [
    ['amapKey', () => idIndex(panel, 'amapKey')],
    ['mapTraffic', () => idIndex(panel, 'mapTraffic')],
    ['mapOverlayMode 单选', () => {
      const m = /\bname\s*=\s*["']mapOverlayMode["']/.exec(panel);
      return m ? m.index : panel.indexOf('mapOverlayMode');
    }],
    ['mapMaskOpacityField', () => idIndex(panel, 'mapMaskOpacityField')],
    ['mapViewScale', () => idIndex(panel, 'mapViewScale')],
    ['mapPreview', () => idIndex(panel, 'mapPreview')],
    ['mapOverlayStatus', () => idIndex(panel, 'mapOverlayStatus')],
  ];

  const found = items.map(([label, get]) => {
    const i = get();
    assert.ok(i > -1, `T2.5：「${label}」应位于 #bgMapFields 子面板内部`);
    return { label, i };
  });

  for (let k = 1; k < found.length; k += 1) {
    assert.ok(
      found[k - 1].i < found[k].i,
      `T2.5：子面板内容顺序应为 ${items.map(x => x[0]).join(' → ')}，实测「${found[k - 1].label}」排在「${found[k].label}」之后`,
    );
  }
});

/* ==================== T2.6 ② 区三个子组 ==================== */

test('uiLayout: ② 样式下的三个子组标题依次为 卡片 / 线路 / 定位点', () => {
  const { subs } = styleSubgroups();
  const texts = subs.map(s => s.text);
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
});

test('uiLayout: .subhead 排版为 13px / 600 / var(--fg)', () => {
  const rules = cssRules().filter(r => targetsClass(r.selector, 'subhead'));
  assert.ok(rules.length > 0, 'T2.6：CSS 里应存在 .subhead 规则（子组标题）');
  const body = rules.map(r => cssSquash(r.body)).join(';');
  assert.ok(body.includes('font-size:13px'), 'T2.6：.subhead 的 font-size 应为 13px');
  assert.ok(body.includes('font-weight:600'), 'T2.6：.subhead 的 font-weight 应为 600');
  assert.ok(body.includes('color:var(--fg)'), 'T2.6：.subhead 的 color 应为 var(--fg)');
});

/* ==================== T2.7 卡片子组归属 ==================== */

test('uiLayout: 背景 segmented / 底色 / 不透明度 / 圆角 / 内边距 都落在「卡片」子组内', () => {
  const { pick } = styleSubgroups();
  const card = pick('卡片');
  const line = pick('线路');
  assert.ok(card, 'T2.7：② 区内应有「卡片」子组标题');
  assert.ok(line, 'T2.7：② 区内应有「线路」子组标题');

  for (const id of ['bgModeSegmented', 'bgColor', 'bgOpacity', 'radius', 'pad']) {
    const i = idIndex(BODY, id);
    assert.notEqual(i, -1, `T2.7：HTML 中应存在 id="${id}"`);
    assert.ok(
      i > card.start && i < line.start,
      `T2.7：#${id} 应落在「卡片」子组内（位于「卡片」子组标题之后、「线路」子组标题之前），实测下标 ${i}，卡片标题 ${card.start}、线路标题 ${line.start}`,
    );
  }
});

/* ==================== T2.8 起点 / 终点颜色同行 ==================== */

test('uiLayout: startColor 与 endColor 落在同一个 .color-pair 容器里', () => {
  const pairs = findElementsByClass(BODY, 'color-pair');
  assert.ok(pairs.length > 0, 'T2.8：HTML 中应存在 .color-pair 容器（起点与终点两个颜色合并在同一行）');
  const hit = pairs.find(el => {
    const outer = extractElement(BODY, el);
    return idIndex(outer, 'startColor') > -1 && idIndex(outer, 'endColor') > -1;
  });
  assert.ok(
    hit,
    'T2.8：应有一个 .color-pair 容器同时包含 #startColor 与 #endColor（起点/终点两个 swatch 同行）',
  );
});

/* ==================== T2.9 定稿文案 ==================== */

const FINAL_COPY = [
  ['header 副标题', '把骑行轨迹导出成剪映可用的透明 PNG 贴图和 MP4 动画，文件全程在本地处理'],
  ['drop 区主行', '拖入轨迹文件，或点击选择。可以一次选多个，多条轨迹会按列表顺序连成一条'],
  ['drop 区小字', '支持 .gpx / .kml / .tcx / .fit / .geojson / .csv；文件全程在本地处理，不会上传'],
  ['申请 key 链接', '前往高德开放平台申请 key（免费）'],
  ['取景缩放说明', '调整轨迹在卡片中所占的比例；数值调小后底图会缩小，露出的边缘显示「底色」里设置的颜色'],
  ['不透明度说明', '导出的 PNG 会保留这里设置的透明度'],
  ['地图隐私声明', '开启地图底图后，轨迹范围的坐标会发送给高德用于获取底图，其余处理仍然全部在本地完成；key 只保存在你自己的浏览器里'],
  ['定位点说明', '定位点是沿线路移动的圆点，会出现在预览和 MP4 动画里；轨迹卡片 PNG 不包含它，用「导出定位点 PNG」单独导出'],
];

for (const [label, copy] of FINAL_COPY) {
  test(`uiLayout: 定稿文案「${label}」出现在 HTML 中`, () => {
    assert.ok(
      TEXT_NS.includes(noSpace(copy)),
      `T2.9：HTML 文本里应包含定稿文案「${copy}」（比较时忽略空白与内联标签）`,
    );
  });
}

/* ==================== T2.10 旧文案清除 ==================== */

const OLD_COPY = [
  ['segmented 选项', '地图底图（需免费 key）'],
  ['底色说明', '纯色模式下是卡片底'],
  ['定位点旧说明', '定位点只出现在预览与 MP4 里'],
  ['隐私旧说明', '开启后轨迹范围坐标会发送给高德'],
  ['header 旧副标题', '把 GPX / KML / TCX / FIT / GeoJSON / CSV 骑行轨迹导出成透明 PNG 或 MP4 动画'],
];

for (const [label, copy] of OLD_COPY) {
  test(`uiLayout: 旧文案「${label}」不再出现`, () => {
    const needle = noSpace(copy);
    assert.ok(
      !TEXT_NS.includes(needle),
      `T2.10：HTML 文本里不应再出现旧文案「${copy}」`,
    );
    assert.ok(
      !SCRIPT_NS.includes(needle),
      `T2.10：内联 script 里不应再出现旧文案「${copy}」`,
    );
  });
}

/* ==================== T2.11 segmented 选项文案 ==================== */

test('uiLayout: 背景来源 segmented 的两个选项文案为 纯色 / 地图底图', () => {
  for (const [id, want] of [['bgModeSolidLabel', '纯色'], ['bgModeMapLabel', '地图底图']]) {
    const el = findElementById(BODY, id);
    assert.ok(el, `T2.11：HTML 中应存在 id="${id}" 的 segmented 选项 label`);
    const text = elementText(el);
    assert.equal(
      text, want,
      `T2.11：#${id} 的选项文案应为「${want}」（保持短词），实测「${text}」`,
    );
  }
});

/* ==================== T2.12 定位点说明只出现一次 ==================== */

test('uiLayout: 定位点说明句在整份 HTML 中只出现一次', () => {
  const copy = '定位点是沿线路移动的圆点，会出现在预览和 MP4 动画里；轨迹卡片 PNG 不包含它，用「导出定位点 PNG」单独导出';
  const needle = noSpace(copy);
  const inHtml = occurrences(TEXT_NS, needle);
  const inScript = occurrences(SCRIPT_NS, needle);
  assert.equal(
    inHtml + inScript, 1,
    `T2.12：关于定位点规则的说明只保留一处，实测 HTML 文本 ${inHtml} 次 + 内联 script ${inScript} 次`,
  );
});
