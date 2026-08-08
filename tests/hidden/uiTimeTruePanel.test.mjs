// T4 · uiTimeTruePanel 目标态断言（隐藏全量）
// spec: 时间真实模式 → 「界面结构：时间真实面板与画质选项」
// 形态：读 index.html / 全部 CSS 的源文本做静态结构断言，不启动浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { INDEX_HTML, readCss } from '../helpers/source.mjs';

/* ==================== 切片 ==================== */

/** <body> 内的标记，剔除 <script> 与注释，只留结构。 */
function bodyHtml(raw) {
  const m = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(raw);
  return (m ? m[1] : raw)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

const HTML = bodyHtml(INDEX_HTML);
const CSS = readCss();

/* ==================== 宽容工具 ==================== */

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** 文案断言：同时接受「标签原样 / 标签换成空格 / 标签删掉」三种形态。 */
function hasCopy(fragment, copy) {
  const forms = [fragment, fragment.replace(/<[^>]*>/g, ' '), fragment.replace(/<[^>]*>/g, '')];
  return forms.some((f) => collapse(f).includes(copy));
}

const textOf = (fragment) => collapse(fragment.replace(/<[^>]*>/g, ' '));

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

/** 从开标签向后做标签深度扫描，拿到 [start,end) 与 inner；「谁在谁里面」用位置下标判定。 */
function rangeOf(html, open) {
  if (!open) return null;
  const name = (/^<\s*([a-zA-Z][\w-]*)/.exec(open.tag) || [, ''])[1].toLowerCase();
  const contentStart = open.start + open.tag.length;
  if (VOID_TAGS.has(name) || /\/>\s*$/.test(open.tag)) {
    return { name, start: open.start, end: contentStart, inner: '', tag: open.tag };
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
        return { name, start: open.start, end: m.index, inner: html.slice(contentStart, m.index), tag: open.tag };
      }
    } else if (!/\/\s*$/.test(m[2])) {
      depth += 1;
    }
  }
  return { name, start: open.start, end: html.length, inner: html.slice(contentStart), tag: open.tag };
}

const elById = (html, id) => rangeOf(html, openTag(html, idPattern(id)));
const idIndex = (html, id) => html.search(new RegExp(idPattern(id)));
const inRange = (range, idx) => range != null && idx > -1 && idx > range.start && idx < range.end;

/** class 里含某个 token 的全部元素范围。 */
function elementsWithClass(html, cls) {
  const re = /<([a-zA-Z][\w-]*)[^<>]*\bclass\s*=\s*["']([^"']*)["'][^<>]*>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!m[2].split(/\s+/).includes(cls)) continue;
    const r = rangeOf(html, { tag: m[0], start: m.index });
    if (r) out.push(r);
  }
  return out;
}

/** 某个标签名的全部元素范围。 */
function elementsByTag(html, tag) {
  const re = new RegExp(`<${tag}\\b[^<>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const r = rangeOf(html, { tag: m[0], start: m.index });
    if (r) out.push(r);
  }
  return out;
}

const hasClass = (tag, cls) => {
  const m = /\bclass\s*=\s*["']([^"']*)["']/.exec(tag);
  return !!m && m[1].split(/\s+/).includes(cls);
};

const attrOf = (tag, name) => {
  const m = new RegExp(`(?<![-\\w])${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1] : null;
};

const isHidden = (tag) => /\bstyle\s*=\s*["'][^"']*display\s*:\s*none/i.test(tag);

/** 包住某下标的最小的一个候选范围。 */
function innermost(ranges, idx) {
  return ranges
    .filter((r) => inRange(r, idx))
    .sort((a, b) => (b.start - a.start) || (a.end - b.end))[0] || null;
}

/** <select> 的 option 列表。 */
function optionsOf(selectInner) {
  return [...selectInner.matchAll(/<option\b([^<>]*)>([\s\S]*?)<\/option>/gi)].map((m) => ({
    value: attrOf(`<option${m[1]}>`, 'value'),
    selected: /(?<![-\w])selected\b/i.test(m[1]),
    text: textOf(m[2]),
  }));
}

const hasLabelFor = (html, id) =>
  new RegExp(`<label\\b[^<>]*\\bfor\\s*=\\s*["']${id}["']`, 'i').test(html);

const wrappedInLabel = (html, id) =>
  elementsByTag(html, 'label').some((r) => inRange(r, idIndex(html, id)));

/* ==================== 常量 ==================== */

/** 本单元新增的全部 id。 */
const NEW_IDS = [
  'mp4TimeModeSegmented', 'mp4TimeModeEven', 'mp4TimeModeTrue', 'mp4TimeModeHint',
  'mp4EvenFields', 'mp4TrueFields', 'mp4TimeStart', 'mp4TimeEnd', 'mp4TimeScale',
  'mp4CollapseGapsField', 'mp4CollapseGaps', 'mp4TrueFps', 'mp4TrueDurationHint',
  'mp4Quality', 'mp4SizeHint', 'mp4Eta',
];

/** 除进度条上的 #mp4Eta 外，其余新控件都归 #exportMp4Fields 管。 */
const IDS_IN_MP4_FIELDS = NEW_IDS.filter((id) => id !== 'mp4Eta');

/** 真实模式面板内应当装下的控件。 */
const TRUE_MODE_IDS = [
  'mp4TimeStart', 'mp4TimeEnd', 'mp4TimeScale',
  'mp4CollapseGapsField', 'mp4CollapseGaps', 'mp4TrueFps', 'mp4TrueDurationHint',
];

/* ==================== 用例 ==================== */

test('uiTimeTruePanel · 新增 id: 16 个新 id 在 index.html 里一个不少', () => {
  const missing = NEW_IDS.filter((id) => idIndex(HTML, id) === -1);
  assert.deepEqual(missing, [], `T4-1（新增 id）: index.html 里缺失的 id：${missing.join(', ')}`);
});

test('uiTimeTruePanel · id 唯一性: 每个新 id 在文档里只出现一次', () => {
  for (const id of NEW_IDS) {
    const hits = HTML.match(new RegExp(idPattern(id), 'g')) || [];
    assert.equal(hits.length, 1, `T4-1（id 唯一性）: 期望 id="${id}" 只出现 1 次，实际 ${hits.length} 次`);
  }
});

test('uiTimeTruePanel · 节奏模式 segmented: 与既有 #exportKindSegmented 同款', () => {
  const seg = elById(HTML, 'mp4TimeModeSegmented');
  const kind = elById(HTML, 'exportKindSegmented');
  assert.ok(kind, 'T4-2（同款参照）: 期望既有的 #exportKindSegmented 仍存在');
  assert.ok(seg, 'T4-2（节奏模式 segmented）: 期望存在 id="mp4TimeModeSegmented" 的容器');

  assert.equal(seg.name, kind.name, `T4-2: 期望 #mp4TimeModeSegmented 与 #exportKindSegmented 用同一种标签（${kind.name}）`);
  assert.ok(hasClass(seg.tag, 'segmented'), 'T4-2: 期望 #mp4TimeModeSegmented 复用 class="segmented"');
  assert.match(seg.tag, /\brole\s*=\s*["']radiogroup["']/, 'T4-2: 期望 #mp4TimeModeSegmented 带 role="radiogroup"');

  const aria = attrOf(seg.tag, 'aria-label');
  assert.ok(aria && aria.trim().length > 0, 'T4-2: 期望 #mp4TimeModeSegmented 带非空 aria-label');

  const opts = elementsWithClass(HTML, 'seg-opt').filter((r) => inRange(seg, r.start));
  assert.equal(opts.length, 2, `T4-2: 期望 #mp4TimeModeSegmented 内正好两个 .seg-opt，实际 ${opts.length} 个`);
  for (const r of opts) {
    assert.equal(r.name, 'label', `T4-2: 期望每个 .seg-opt 是 <label>，实际 <${r.name}>`);
  }
  for (const id of ['mp4TimeModeEven', 'mp4TimeModeTrue']) {
    assert.ok(
      opts.some((r) => inRange(r, idIndex(HTML, id))),
      `T4-2: 期望 #${id} 被一个 label.seg-opt 包住`,
    );
  }
});

test('uiTimeTruePanel · 节奏模式 radio: name/value 精确，even 默认 checked', () => {
  const even = openTag(HTML, idPattern('mp4TimeModeEven'));
  const trueOpt = openTag(HTML, idPattern('mp4TimeModeTrue'));
  assert.ok(even, 'T4-2（radio）: 期望存在 id="mp4TimeModeEven"');
  assert.ok(trueOpt, 'T4-2（radio）: 期望存在 id="mp4TimeModeTrue"');

  for (const [id, tag] of [['mp4TimeModeEven', even.tag], ['mp4TimeModeTrue', trueOpt.tag]]) {
    assert.ok(/^<input\b/i.test(tag), `T4-2: 期望 #${id} 是 <input>`);
    assert.equal(attrOf(tag, 'type'), 'radio', `T4-2: 期望 #${id} 的 type="radio"`);
    assert.equal(attrOf(tag, 'name'), 'mp4TimeMode', `T4-2: 期望 #${id} 的 name="mp4TimeMode"`);
  }
  assert.equal(attrOf(even.tag, 'value'), 'even', 'T4-2: 期望 #mp4TimeModeEven 的 value="even"');
  assert.equal(attrOf(trueOpt.tag, 'value'), 'true', 'T4-2: 期望 #mp4TimeModeTrue 的 value="true"');

  assert.match(even.tag, /(?<![-\w])checked\b/, 'T4-2: 期望 #mp4TimeModeEven 默认 checked');
  assert.doesNotMatch(trueOpt.tag, /(?<![-\w])checked\b/, 'T4-2: 期望 #mp4TimeModeTrue 默认不 checked（同组只有一个默认值）');
});

test('uiTimeTruePanel · 节奏模式文案: 两个选项分别是「按距离匀速」「按真实时间」', () => {
  const seg = elById(HTML, 'mp4TimeModeSegmented');
  assert.ok(seg, 'T4-2（文案）: 期望存在 #mp4TimeModeSegmented');
  const opts = elementsWithClass(HTML, 'seg-opt').filter((r) => inRange(seg, r.start));

  const evenLabel = innermost(opts, idIndex(HTML, 'mp4TimeModeEven'));
  const trueLabel = innermost(opts, idIndex(HTML, 'mp4TimeModeTrue'));
  assert.ok(evenLabel, 'T4-2（文案）: 期望 #mp4TimeModeEven 落在某个 .seg-opt 内');
  assert.ok(trueLabel, 'T4-2（文案）: 期望 #mp4TimeModeTrue 落在某个 .seg-opt 内');
  assert.ok(hasCopy(evenLabel.inner, '按距离匀速'), `T4-2: 期望 even 选项文案为「按距离匀速」，实际「${textOf(evenLabel.inner)}」`);
  assert.ok(hasCopy(trueLabel.inner, '按真实时间'), `T4-2: 期望 true 选项文案为「按真实时间」，实际「${textOf(trueLabel.inner)}」`);
});

test('uiTimeTruePanel · 默认显隐: 真实面板/模式提示/空隙折叠默认收起，匀速面板可见', () => {
  for (const id of ['mp4TrueFields', 'mp4TimeModeHint', 'mp4CollapseGapsField']) {
    const el = elById(HTML, id);
    assert.ok(el, `T4-3（默认显隐）: 期望存在 #${id}`);
    assert.ok(isHidden(el.tag), `T4-3: 期望 #${id} 默认 style="display:none"，实际开标签 ${collapse(el.tag)}`);
  }
  const even = elById(HTML, 'mp4EvenFields');
  assert.ok(even, 'T4-3（默认显隐）: 期望存在 #mp4EvenFields');
  assert.ok(!isHidden(even.tag), `T4-3: 期望 #mp4EvenFields 默认可见，实际开标签 ${collapse(even.tag)}`);
});

test('uiTimeTruePanel · 显隐与可用性分离: 新增的显隐容器不用 disabled 承载默认态', () => {
  for (const id of ['mp4TrueFields', 'mp4TimeModeHint', 'mp4CollapseGapsField', 'mp4EvenFields']) {
    const el = elById(HTML, id);
    assert.ok(el, `T4-3（通道分离）: 期望存在 #${id}`);
    assert.doesNotMatch(
      el.tag,
      /(?<![-\w])disabled\b/,
      `T4-3（通道分离）: 期望 #${id} 的默认态只由 style.display 承载，不带 disabled`,
    );
  }
});

test('uiTimeTruePanel · label 关联: 每个新 input / select 都能被 label 关联到', () => {
  const strictFor = ['mp4TimeStart', 'mp4TimeEnd', 'mp4TimeScale', 'mp4TrueFps', 'mp4Quality'];
  for (const id of strictFor) {
    assert.ok(idIndex(HTML, id) > -1, `T4-4（label 关联）: 期望存在 #${id}`);
    assert.ok(hasLabelFor(HTML, id), `T4-4（label 关联）: 期望存在 <label for="${id}">`);
  }
  for (const id of ['mp4TimeModeEven', 'mp4TimeModeTrue', 'mp4CollapseGaps']) {
    assert.ok(idIndex(HTML, id) > -1, `T4-4（label 关联）: 期望存在 #${id}`);
    assert.ok(
      hasLabelFor(HTML, id) || wrappedInLabel(HTML, id),
      `T4-4（label 关联）: 期望 #${id} 有 for="${id}" 的 label，或被 <label> 包住`,
    );
  }
});

test('uiTimeTruePanel · 画质: 三个 option 的值与文案精确，high 默认 selected', () => {
  const sel = elById(HTML, 'mp4Quality');
  assert.ok(sel, 'T4-5（画质）: 期望存在 id="mp4Quality" 的控件');
  assert.equal(sel.name, 'select', `T4-5: 期望 #mp4Quality 是 <select>，实际 <${sel.name}>`);

  const opts = optionsOf(sel.inner);
  assert.deepEqual(
    opts.map((o) => ({ value: o.value, text: o.text })),
    [{ value: 'high', text: '高' }, { value: 'medium', text: '中' }, { value: 'low', text: '低' }],
    'T4-5: 期望 #mp4Quality 的三个 option 依次是 high/高、medium/中、low/低',
  );
  assert.deepEqual(
    opts.filter((o) => o.selected).map((o) => o.value),
    ['high'],
    'T4-5: 期望 #mp4Quality 只有 high 带 selected',
  );
});

test('uiTimeTruePanel · 时间缩放: type/class 与 min/max/step/value 精确', () => {
  const el = openTag(HTML, idPattern('mp4TimeScale'));
  assert.ok(el, 'T4-6（时间缩放）: 期望存在 id="mp4TimeScale" 的控件');
  assert.ok(/^<input\b/i.test(el.tag), 'T4-6: 期望 #mp4TimeScale 是 <input>');
  assert.equal(attrOf(el.tag, 'type'), 'number', 'T4-6: 期望 #mp4TimeScale 的 type="number"');
  assert.ok(hasClass(el.tag, 'val'), 'T4-6: 期望 #mp4TimeScale 沿用 class="val"');

  for (const [name, expected] of [['min', 0.1], ['max', 100], ['step', 0.1], ['value', 1]]) {
    const raw = attrOf(el.tag, name);
    assert.ok(raw !== null, `T4-6: 期望 #mp4TimeScale 带 ${name} 属性`);
    assert.equal(Number(raw), expected, `T4-6: 期望 #mp4TimeScale 的 ${name}=${expected}，实际 "${raw}"`);
  }
});

test('uiTimeTruePanel · 时间缩放说明: 同一 .field 内有解释真实时间对应关系的 small', () => {
  const idx = idIndex(HTML, 'mp4TimeScale');
  assert.ok(idx > -1, 'T4-6（说明）: 期望存在 #mp4TimeScale');
  const field = innermost(elementsWithClass(HTML, 'field'), idx);
  assert.ok(field, 'T4-6（说明）: 期望 #mp4TimeScale 落在一个 .field 内');
  const smalls = elementsByTag(field.inner, 'small');
  assert.ok(smalls.length >= 1, 'T4-6（说明）: 期望时间缩放 .field 内有一句 <small> 说明');
  assert.ok(
    smalls.some((s) => textOf(s.inner).includes('真实时间')),
    `T4-6（说明）: 期望说明点出「真实时间」的对应关系，实际「${textOf(field.inner)}」`,
  );
});

test('uiTimeTruePanel · 真实模式帧率: 三个 option 值精确，30 默认 selected', () => {
  const sel = elById(HTML, 'mp4TrueFps');
  assert.ok(sel, 'T4-7（真实模式帧率）: 期望存在 id="mp4TrueFps" 的控件');
  assert.equal(sel.name, 'select', `T4-7: 期望 #mp4TrueFps 是 <select>，实际 <${sel.name}>`);

  const opts = optionsOf(sel.inner);
  assert.deepEqual(
    opts.map((o) => o.value),
    ['24', '30', '60'],
    'T4-7: 期望 #mp4TrueFps 的三个 option 值依次是 24 / 30 / 60',
  );
  assert.deepEqual(
    opts.filter((o) => o.selected).map((o) => o.value),
    ['30'],
    'T4-7: 期望 #mp4TrueFps 只有 30 带 selected',
  );
});

test('uiTimeTruePanel · 导出进度: #mp4Eta 在 #mp4ProgressWrap 的 label 内、#mp4ProgressV 之后', () => {
  const wrap = elById(HTML, 'mp4ProgressWrap');
  assert.ok(wrap, 'T4-8（剩余时间位）: 期望既有的 #mp4ProgressWrap 仍存在');

  const eta = elById(HTML, 'mp4Eta');
  assert.ok(eta, 'T4-8: 期望存在 id="mp4Eta"');
  assert.equal(eta.name, 'span', `T4-8: 期望 #mp4Eta 是 <span>，实际 <${eta.name}>`);

  const etaIdx = idIndex(HTML, 'mp4Eta');
  const vIdx = idIndex(HTML, 'mp4ProgressV');
  assert.ok(vIdx > -1, 'T4-8: 期望既有的 #mp4ProgressV 仍存在');
  assert.ok(inRange(wrap, etaIdx), 'T4-8: 期望 #mp4Eta 落在 #mp4ProgressWrap 内部');
  assert.ok(etaIdx > vIdx, 'T4-8: 期望 #mp4Eta 排在 #mp4ProgressV 之后');

  const holder = elementsByTag(HTML, 'label')
    .filter((r) => inRange(wrap, r.start))
    .find((r) => inRange(r, etaIdx) && inRange(r, vIdx));
  assert.ok(holder, 'T4-8: 期望 #mp4Eta 与 #mp4ProgressV 同处 #mp4ProgressWrap 的那个 <label> 内');
});

test('uiTimeTruePanel · 既有结构: #mp4Duration / #mp4Fps 仍在，且被 #mp4EvenFields 包裹', () => {
  const even = elById(HTML, 'mp4EvenFields');
  assert.ok(even, 'T4-9（既有结构）: 期望存在 #mp4EvenFields');

  for (const id of ['mp4Duration', 'mp4Fps']) {
    const idx = idIndex(HTML, id);
    assert.ok(idx > -1, `T4-9: 期望既有的 #${id} 仍存在`);
    assert.ok(inRange(even, idx), `T4-9: 期望 #${id} 被 #mp4EvenFields 包裹`);
  }
  const row = innermost(elementsWithClass(HTML, 'row'), idIndex(HTML, 'mp4Duration'));
  assert.ok(row, 'T4-9: 期望 #mp4Duration 仍在一个 .row 内');
  assert.ok(inRange(row, idIndex(HTML, 'mp4Fps')), 'T4-9: 期望 #mp4Duration 与 #mp4Fps 仍同处一行');
});

test('uiTimeTruePanel · 归属: 节奏模式与画质的新控件全部落在 #exportMp4Fields 内', () => {
  const mp4Fields = elById(HTML, 'exportMp4Fields');
  assert.ok(mp4Fields, 'T4-10（归属）: 期望既有的 #exportMp4Fields 仍存在');

  const outside = IDS_IN_MP4_FIELDS.filter((id) => !inRange(mp4Fields, idIndex(HTML, id)));
  assert.deepEqual(outside, [], `T4-10: 越出 #exportMp4Fields 的新 id：${outside.join(', ')}`);

  const pngFields = elById(HTML, 'exportPngFields');
  if (pngFields) {
    const leaked = NEW_IDS.filter((id) => inRange(pngFields, idIndex(HTML, id)));
    assert.deepEqual(leaked, [], `T4-10: 不应落进贴图 PNG 面板的新 id：${leaked.join(', ')}`);
  }
});

test('uiTimeTruePanel · 起止时刻: 两个 datetime-local 同处一个 .row，各带 small 说明', () => {
  const trueFields = elById(HTML, 'mp4TrueFields');
  assert.ok(trueFields, 'T4（起止时刻）: 期望存在 #mp4TrueFields');

  for (const id of ['mp4TimeStart', 'mp4TimeEnd']) {
    const el = openTag(HTML, idPattern(id));
    assert.ok(el, `T4（起止时刻）: 期望存在 id="${id}" 的控件`);
    assert.ok(/^<input\b/i.test(el.tag), `T4（起止时刻）: 期望 #${id} 是 <input>`);
    assert.equal(attrOf(el.tag, 'type'), 'datetime-local', `T4（起止时刻）: 期望 #${id} 的 type="datetime-local"`);
    assert.ok(inRange(trueFields, idIndex(HTML, id)), `T4（起止时刻）: 期望 #${id} 落在 #mp4TrueFields 内`);

    const field = innermost(elementsWithClass(HTML, 'field'), idIndex(HTML, id));
    assert.ok(field, `T4（起止时刻）: 期望 #${id} 落在一个 .field 内`);
    assert.ok(
      elementsByTag(field.inner, 'small').length >= 1,
      `T4（起止时刻）: 期望 #${id} 所在 .field 内带一句 <small> 说明`,
    );
  }

  const row = innermost(elementsWithClass(HTML, 'row'), idIndex(HTML, 'mp4TimeStart'));
  assert.ok(row, 'T4（起止时刻）: 期望 #mp4TimeStart 落在一个 .row 内');
  assert.ok(inRange(row, idIndex(HTML, 'mp4TimeEnd')), 'T4（起止时刻）: 期望起止两个时刻同处一个 .row');
  assert.ok(inRange(trueFields, row.start), 'T4（起止时刻）: 期望这一行落在 #mp4TrueFields 内');
});

test('uiTimeTruePanel · 空隙折叠: checkbox 落在 #mp4CollapseGapsField 内，文案齐备', () => {
  const field = elById(HTML, 'mp4CollapseGapsField');
  assert.ok(field, 'T4（空隙折叠）: 期望存在 #mp4CollapseGapsField');
  assert.ok(hasClass(field.tag, 'field'), 'T4（空隙折叠）: 期望 #mp4CollapseGapsField 带 class="field"');

  const box = openTag(HTML, idPattern('mp4CollapseGaps'));
  assert.ok(box, 'T4（空隙折叠）: 期望存在 id="mp4CollapseGaps" 的控件');
  assert.ok(/^<input\b/i.test(box.tag), 'T4（空隙折叠）: 期望 #mp4CollapseGaps 是 <input>');
  assert.equal(attrOf(box.tag, 'type'), 'checkbox', 'T4（空隙折叠）: 期望 #mp4CollapseGaps 的 type="checkbox"');
  assert.doesNotMatch(box.tag, /(?<![-\w])checked\b/, 'T4（空隙折叠）: 期望 #mp4CollapseGaps 默认不勾选');

  assert.ok(inRange(field, idIndex(HTML, 'mp4CollapseGaps')), 'T4（空隙折叠）: 期望 #mp4CollapseGaps 落在 #mp4CollapseGapsField 内');
  assert.ok(
    hasCopy(field.inner, '折叠多个文件之间的时间空隙'),
    `T4（空隙折叠）: 期望文案为「折叠多个文件之间的时间空隙」，实际「${textOf(field.inner)}」`,
  );

  const trueFields = elById(HTML, 'mp4TrueFields');
  assert.ok(trueFields && inRange(trueFields, field.start), 'T4（空隙折叠）: 期望 #mp4CollapseGapsField 落在 #mp4TrueFields 内');
});

test('uiTimeTruePanel · 文案承载位: 三个 small 的标签与归属正确', () => {
  const modeHint = elById(HTML, 'mp4TimeModeHint');
  assert.ok(modeHint, 'T4（承载位）: 期望存在 #mp4TimeModeHint');
  assert.equal(modeHint.name, 'small', `T4（承载位）: 期望 #mp4TimeModeHint 是 <small>，实际 <${modeHint.name}>`);
  assert.ok(hasClass(modeHint.tag, 'gate-hint'), 'T4（承载位）: 期望 #mp4TimeModeHint 复用 class="gate-hint"');

  const durHint = elById(HTML, 'mp4TrueDurationHint');
  assert.ok(durHint, 'T4（承载位）: 期望存在 #mp4TrueDurationHint');
  assert.equal(durHint.name, 'small', `T4（承载位）: 期望 #mp4TrueDurationHint 是 <small>，实际 <${durHint.name}>`);
  const trueFields = elById(HTML, 'mp4TrueFields');
  assert.ok(trueFields && inRange(trueFields, idIndex(HTML, 'mp4TrueDurationHint')), 'T4（承载位）: 期望 #mp4TrueDurationHint 落在 #mp4TrueFields 内');

  const sizeHint = elById(HTML, 'mp4SizeHint');
  assert.ok(sizeHint, 'T4（承载位）: 期望存在 #mp4SizeHint');
  assert.equal(sizeHint.name, 'small', `T4（承载位）: 期望 #mp4SizeHint 是 <small>，实际 <${sizeHint.name}>`);
});

test('uiTimeTruePanel · 画质 .field: 与 #mp4SizeHint 同处一个 .field，且在两个模式面板之外', () => {
  const qualityIdx = idIndex(HTML, 'mp4Quality');
  const sizeIdx = idIndex(HTML, 'mp4SizeHint');
  assert.ok(qualityIdx > -1, 'T4（画质归属）: 期望存在 #mp4Quality');
  assert.ok(sizeIdx > -1, 'T4（画质归属）: 期望存在 #mp4SizeHint');

  const field = innermost(elementsWithClass(HTML, 'field'), qualityIdx);
  assert.ok(field, 'T4（画质归属）: 期望 #mp4Quality 落在一个 .field 内');
  assert.ok(inRange(field, sizeIdx), 'T4（画质归属）: 期望 #mp4SizeHint 与 #mp4Quality 同处一个 .field');

  const even = elById(HTML, 'mp4EvenFields');
  const trueFields = elById(HTML, 'mp4TrueFields');
  assert.ok(even && trueFields, 'T4（画质归属）: 期望两个模式面板都存在');
  for (const [name, panel] of [['#mp4EvenFields', even], ['#mp4TrueFields', trueFields]]) {
    assert.ok(!inRange(panel, qualityIdx), `T4（画质归属）: 期望 #mp4Quality 落在 ${name} 之外（两种模式通用）`);
    assert.ok(!inRange(panel, sizeIdx), `T4（画质归属）: 期望 #mp4SizeHint 落在 ${name} 之外（两种模式通用）`);
  }
});

test('uiTimeTruePanel · 顺序: segmented 与模式提示都排在匀速面板之前', () => {
  const seg = elById(HTML, 'mp4TimeModeSegmented');
  const hint = elById(HTML, 'mp4TimeModeHint');
  const even = elById(HTML, 'mp4EvenFields');
  assert.ok(seg, 'T4（顺序）: 期望存在 #mp4TimeModeSegmented');
  assert.ok(hint, 'T4（顺序）: 期望存在 #mp4TimeModeHint');
  assert.ok(even, 'T4（顺序）: 期望存在 #mp4EvenFields');

  assert.ok(seg.end < hint.start, 'T4（顺序）: 期望 #mp4TimeModeHint 紧随 #mp4TimeModeSegmented 之后');
  assert.ok(hint.end < even.start, 'T4（顺序）: 期望模式 segmented 与提示都排在「时长/帧率」那一行之前');
  assert.ok(!inRange(even, seg.start), 'T4（顺序）: 期望 #mp4TimeModeSegmented 落在 #mp4EvenFields 之外');
  assert.ok(!inRange(even, hint.start), 'T4（顺序）: 期望 #mp4TimeModeHint 落在 #mp4EvenFields 之外');
});

test('uiTimeTruePanel · 面板互斥: 真实模式控件全在 #mp4TrueFields，匀速控件不混入', () => {
  const trueFields = elById(HTML, 'mp4TrueFields');
  const even = elById(HTML, 'mp4EvenFields');
  assert.ok(trueFields, 'T4（面板互斥）: 期望存在 #mp4TrueFields');
  assert.ok(even, 'T4（面板互斥）: 期望存在 #mp4EvenFields');

  const strayed = TRUE_MODE_IDS.filter((id) => !inRange(trueFields, idIndex(HTML, id)));
  assert.deepEqual(strayed, [], `T4（面板互斥）: 未落在 #mp4TrueFields 内的真实模式控件：${strayed.join(', ')}`);

  const mixed = TRUE_MODE_IDS.filter((id) => inRange(even, idIndex(HTML, id)));
  assert.deepEqual(mixed, [], `T4（面板互斥）: 混进 #mp4EvenFields 的真实模式控件：${mixed.join(', ')}`);

  for (const id of ['mp4Duration', 'mp4Fps']) {
    assert.ok(!inRange(trueFields, idIndex(HTML, id)), `T4（面板互斥）: 期望匀速参数 #${id} 不落在 #mp4TrueFields 内`);
  }
  assert.ok(!inRange(even, trueFields.start), 'T4（面板互斥）: 期望 #mp4TrueFields 不嵌套在 #mp4EvenFields 内');
  assert.ok(!inRange(trueFields, even.start), 'T4（面板互斥）: 期望 #mp4EvenFields 不嵌套在 #mp4TrueFields 内');
});

test('uiTimeTruePanel · 样式复用: .segmented / .seg-opt / .gate-hint 规则存在且被新结构沿用', () => {
  for (const sel of ['.segmented', '.seg-opt', '.gate-hint']) {
    assert.ok(
      new RegExp(sel.replace('.', '\\.') + '\\b').test(CSS),
      `T4（样式复用）: 期望装载到的 CSS 里存在 ${sel} 规则`,
    );
  }
  const seg = elById(HTML, 'mp4TimeModeSegmented');
  const hint = elById(HTML, 'mp4TimeModeHint');
  assert.ok(seg && hasClass(seg.tag, 'segmented'), 'T4（样式复用）: 期望 #mp4TimeModeSegmented 沿用 .segmented');
  assert.ok(hint && hasClass(hint.tag, 'gate-hint'), 'T4（样式复用）: 期望 #mp4TimeModeHint 沿用 .gate-hint');

  const opts = seg ? elementsWithClass(HTML, 'seg-opt').filter((r) => inRange(seg, r.start)) : [];
  assert.equal(opts.length, 2, 'T4（样式复用）: 期望两个选项都沿用 .seg-opt');
});
