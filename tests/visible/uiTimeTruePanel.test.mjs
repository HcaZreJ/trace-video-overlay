// T4 · uiTimeTruePanel 目标态断言（可见样例）
// spec: 时间真实模式 → 「界面结构：时间真实面板与画质选项」
// 形态：读 index.html 源文本做静态结构断言，不启动浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { INDEX_HTML } from '../helpers/source.mjs';

/* ==================== 切片 ==================== */

/** <body> 内的标记，剔除 <script> 与注释，只留结构。 */
function bodyHtml(raw) {
  const m = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(raw);
  return (m ? m[1] : raw)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

const HTML = bodyHtml(INDEX_HTML);

/* ==================== 宽容工具 ==================== */

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** 文案断言：同时接受「标签原样 / 标签换成空格 / 标签删掉」三种形态。 */
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

const hasClass = (tag, cls) => {
  const m = /\bclass\s*=\s*["']([^"']*)["']/.exec(tag);
  return !!m && m[1].split(/\s+/).includes(cls);
};

const isHidden = (tag) => /\bstyle\s*=\s*["'][^"']*display\s*:\s*none/i.test(tag);

/** 包住某下标的最小的一个候选范围。 */
function innermost(ranges, idx) {
  return ranges
    .filter((r) => inRange(r, idx))
    .sort((a, b) => (b.start - a.start) || (a.end - b.end))[0] || null;
}

/* ==================== 用例 ==================== */

test('uiTimeTruePanel · 新增结构: 时间真实面板与画质选项的每个 id 都在 index.html 里', () => {
  const ids = [
    'mp4TimeModeSegmented', 'mp4TimeModeEven', 'mp4TimeModeTrue', 'mp4TimeModeHint',
    'mp4EvenFields', 'mp4TrueFields', 'mp4TimeStart', 'mp4TimeEnd', 'mp4TimeScale',
    'mp4CollapseGapsField', 'mp4CollapseGaps', 'mp4TrueFps', 'mp4TrueDurationHint',
    'mp4Quality', 'mp4SizeHint', 'mp4Eta',
  ];
  const missing = ids.filter((id) => idIndex(HTML, id) === -1);
  assert.deepEqual(missing, [], `T4-1（新增 id）: index.html 里缺失的 id：${missing.join(', ')}`);

  const mp4Fields = elById(HTML, 'exportMp4Fields');
  assert.ok(mp4Fields, 'T4-10（归属）: 期望 ③ 导出区存在 #exportMp4Fields');
  for (const id of ids.filter((x) => x !== 'mp4Eta')) {
    assert.ok(
      inRange(mp4Fields, idIndex(HTML, id)),
      `T4-10（归属）: 期望 #${id} 落在 #exportMp4Fields 内部`,
    );
  }
});

test('uiTimeTruePanel · 节奏模式 segmented: radiogroup + 两个 .seg-opt，「按距离匀速」默认选中', () => {
  const seg = elById(HTML, 'mp4TimeModeSegmented');
  assert.ok(seg, 'T4-2（节奏模式 segmented）: 期望存在 id="mp4TimeModeSegmented" 的容器');
  assert.ok(hasClass(seg.tag, 'segmented'), 'T4-2: 期望 #mp4TimeModeSegmented 复用 class="segmented"');
  assert.match(seg.tag, /\brole\s*=\s*["']radiogroup["']/, 'T4-2: 期望 #mp4TimeModeSegmented 带 role="radiogroup"');
  assert.match(seg.tag, /\baria-label\s*=\s*["'][^"']+["']/, 'T4-2: 期望 #mp4TimeModeSegmented 带非空 aria-label');

  const opts = elementsWithClass(HTML, 'seg-opt').filter((r) => inRange(seg, r.start));
  assert.equal(opts.length, 2, `T4-2: 期望 #mp4TimeModeSegmented 内正好两个 .seg-opt，实际 ${opts.length} 个`);

  const even = openTag(HTML, idPattern('mp4TimeModeEven'));
  const trueOpt = openTag(HTML, idPattern('mp4TimeModeTrue'));
  assert.ok(even, 'T4-2: 期望存在 id="mp4TimeModeEven" 的 radio');
  assert.ok(trueOpt, 'T4-2: 期望存在 id="mp4TimeModeTrue" 的 radio');
  for (const [id, tag] of [['mp4TimeModeEven', even.tag], ['mp4TimeModeTrue', trueOpt.tag]]) {
    assert.match(tag, /\btype\s*=\s*["']radio["']/, `T4-2: 期望 #${id} 是 type="radio"`);
    assert.match(tag, /\bname\s*=\s*["']mp4TimeMode["']/, `T4-2: 期望 #${id} 带 name="mp4TimeMode"`);
  }
  assert.match(even.tag, /\bvalue\s*=\s*["']even["']/, 'T4-2: 期望 #mp4TimeModeEven 的 value="even"');
  assert.match(trueOpt.tag, /\bvalue\s*=\s*["']true["']/, 'T4-2: 期望 #mp4TimeModeTrue 的 value="true"');
  assert.match(even.tag, /(?<![-\w])checked\b/, 'T4-2: 期望 #mp4TimeModeEven 默认 checked（默认按距离匀速）');
  assert.doesNotMatch(trueOpt.tag, /(?<![-\w])checked\b/, 'T4-2: 期望 #mp4TimeModeTrue 默认不 checked');

  const evenLabel = innermost(opts, idIndex(HTML, 'mp4TimeModeEven'));
  const trueLabel = innermost(opts, idIndex(HTML, 'mp4TimeModeTrue'));
  assert.ok(evenLabel && hasCopy(evenLabel.inner, '按距离匀速'), 'T4-2: 期望 #mp4TimeModeEven 所在 .seg-opt 文案为「按距离匀速」');
  assert.ok(trueLabel && hasCopy(trueLabel.inner, '按真实时间'), 'T4-2: 期望 #mp4TimeModeTrue 所在 .seg-opt 文案为「按真实时间」');
});

test('uiTimeTruePanel · 默认显隐: 真实面板与两条按需提示默认收起，匀速面板可见', () => {
  const trueFields = elById(HTML, 'mp4TrueFields');
  const modeHint = elById(HTML, 'mp4TimeModeHint');
  const gapsField = elById(HTML, 'mp4CollapseGapsField');
  const evenFields = elById(HTML, 'mp4EvenFields');

  assert.ok(trueFields, 'T4-3（默认显隐）: 期望存在 #mp4TrueFields');
  assert.ok(modeHint, 'T4-3（默认显隐）: 期望存在 #mp4TimeModeHint');
  assert.ok(gapsField, 'T4-3（默认显隐）: 期望存在 #mp4CollapseGapsField');
  assert.ok(evenFields, 'T4-3（默认显隐）: 期望存在 #mp4EvenFields');

  assert.ok(isHidden(trueFields.tag), 'T4-3: 期望 #mp4TrueFields 默认 style="display:none"');
  assert.ok(isHidden(modeHint.tag), 'T4-3: 期望 #mp4TimeModeHint 默认 style="display:none"');
  assert.ok(isHidden(gapsField.tag), 'T4-3: 期望 #mp4CollapseGapsField 默认 style="display:none"');
  assert.ok(!isHidden(evenFields.tag), 'T4-3: 期望 #mp4EvenFields 默认可见（不带 display:none）');

  // 既有的匀速参数现在由 #mp4EvenFields 包裹。
  for (const id of ['mp4Duration', 'mp4Fps']) {
    assert.ok(
      inRange(evenFields, idIndex(HTML, id)),
      `T4-9（既有结构）: 期望既有的 #${id} 仍存在，且被 #mp4EvenFields 包裹`,
    );
  }
});
