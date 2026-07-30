/**
 * 页面源码取材的单一入口。
 *
 * UI 测试断言的对象是「浏览器最终装载到的 CSS 与 JS」，而不是某一个具体文件。
 * 样式与脚本分布在哪些文件里由这里回答，各测试文件只管拿到文本后做自己的断言。
 *
 * readCss() —— index.html 里 <style> 块的内容，加上 <link rel="stylesheet"> 指向的样式文件，
 *              按两者在文档中出现的先后顺序拼接。拼接顺序等于浏览器的层叠顺序。
 * readJs()  —— index.html 里内联 <script> 的源码，加上 src/ 下全部 .mjs 模块（按路径排序）。
 *              vendor/ 下的第三方库不计入。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const INDEX_HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** 按 <style> 块与 <link rel="stylesheet"> 在文档中的先后顺序取全部 CSS。 */
export function readCss(raw = INDEX_HTML) {
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>|<link\b([^>]*)>/gi;
  const out = [];
  for (const m of raw.matchAll(re)) {
    if (m[1] !== undefined) {
      out.push(m[1]);
      continue;
    }
    const attrs = m[2] || '';
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(attrs)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!href) continue;
    const path = join(ROOT, href[1]);
    if (existsSync(path)) out.push(readFileSync(path, 'utf8'));
  }
  return out.join('\n');
}

/** 递归收集一个目录下的全部 .mjs，按路径排序。 */
function collectMjs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMjs(path));
    else if (entry.name.endsWith('.mjs')) out.push(path);
  }
  return out.sort();
}

/** 内联 <script>（无 src 属性）的源码，逐段返回。 */
export function readInlineScripts(raw = INDEX_HTML) {
  return [...raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc\s*=/i.test(m[1]))
    .map((m) => m[2]);
}

/** 应用侧 JS 分段：内联 <script> 在前，src/ 下模块按路径排序在后。 */
export function readJsParts(raw = INDEX_HTML) {
  const parts = readInlineScripts(raw);
  for (const path of collectMjs(join(ROOT, 'src'))) parts.push(readFileSync(path, 'utf8'));
  return parts;
}

/** 应用侧 JS 全文。 */
export function readJs(raw = INDEX_HTML) {
  return readJsParts(raw).join('\n');
}

/** src/ 下全部模块的绝对路径，按路径排序。 */
export function listAppModulePaths() {
  return collectMjs(join(ROOT, 'src'));
}

/** 全站源码：index.html 原文 + 全部 CSS + 全部应用 JS。「某段旧内容已彻底删除」这类断言用它。 */
export function readAll(raw = INDEX_HTML) {
  return [raw, readCss(raw), readJs(raw)].join('\n');
}
