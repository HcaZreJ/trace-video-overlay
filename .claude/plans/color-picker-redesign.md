# Feature: 自定义 Color Picker（RGB/HSL/HEX 显式分段 + 状态保留）

## Overview
弃用浏览器原生 `<input type="color">` popup（Chrome 内建，样式/状态不可控），
自建一个零依赖的自定义 color picker：SV 面板 + 色相条 + HEX/RGB/HSL 三段 tab +
数值输入 + 吸管。用户对模式的选择通过 `localStorage.colorPickerMode` 保留，
跨 popup、跨 session、跨全部 7 处 color input 共享。

## Intent Brief

- **Goal**：所有颜色选择器（1）状态保留，用户切到 HEX 后下次打开仍是 HEX；
  （2）RGB/HSL/HEX 切换在 popup 里一眼可见、一次点击可达。
- **Motivation**：原生 popup 的模式切换藏在右下小箭头 ⇅ 里，用户「意外点到才发现」；
  Chrome 每次开都重置为 RGB，用户每次跨 tab 复制 HEX 后回来还要点两下切换。
- **Known context**：项目 7 处 color input（bgColor / lineColor / startColor /
  endColor / dotColor / mp4PageColor / mp4GreenColor）；下游全部通过 `$('id').value`
  读 hex 字符串；已用 `localStorage.amap_key` 存偏好。
- **Constraints**：
  - 零依赖（AGENTS.md 铁律 3）；纯函数进 core.mjs 配 node:test（铁律 2）；
  - core.mjs 公共函数须逐字符同步进 index.html 内联 script（铁律 1）；
  - 下游 `$('id').value` 与 `input`/`change` 事件语义保持兼容；
  - 复用现有 `.segmented > .seg-opt.active` 分段控件样式与 `--accent-strong` 强调色语义。
- **Non-goals**：alpha 通道、颜色历史、预设色板、剪贴板粘贴、EyeDropper polyfill。
- **Success criteria**：
  - 全部 7 处 color input 打开都是自定义 popup，看不到浏览器原生 popup；
  - popup 顶部三段 tab（HEX / RGB / HSL）一眼可见，当前项 `--accent-strong` 底色；
  - 切换 tab 后关闭再打开（任意 color input），仍是同一模式；
  - 在 SV 面板拖动、色相条拖动、输入框编辑，三者双向同步，实时更新 swatch 与预览；
  - 下游渲染管线（renderCard / renderFrame / MP4 buildFrameOpts）零改动照旧工作。
- **Assumptions**：见 Assumption Ledger。
- **Unknowns**：EyeDropper API 在无 https 的 `file://` 打开时是否可用（不可用则藏按钮即可，不阻塞交付）。

## Alignment Gate

**I will implement：**
- core.mjs 新增颜色空间纯函数：`parseHex` / `formatHex` / `rgbToHsl` / `hslToRgb` /
  `rgbToHsv` / `hsvToRgb`，并写 harness 测试；
- index.html 新增自定义 color picker 组件（单例 popup + 每个 swatch 触发器）；
- 隐藏原生 `<input type="color">`（保留 DOM 元素作为值容器与事件源），JS 初始化时
  为每个 color input 注入自定义 swatch；
- popup 内包含：SV 面板（canvas 拖动）、色相条、模式分段 tab（HEX/RGB/HSL）、数值输入、
  吸管（EyeDropper 可用时显示）、当前色预览；
- `localStorage.colorPickerMode` 保存与恢复模式偏好，全局共享；
- 从 core.mjs 逐字符同步纯函数到 index.html 内联 script（去 `export`）。

**I will not implement：**
- alpha 透明度通道（底色不透明度已有独立 slider，不合并进 picker）；
- 颜色历史 / 最近使用 / 预设色板 / 剪贴板一键粘贴；
- EyeDropper polyfill（浏览器不支持时藏起按钮）。

**Open assumptions：**
- 保留底层 `<input type="color">` 作为值容器（不删除元素，只隐藏并接管 UI）——
  下游 `$('id').value` 读取与 `on('input'/'change')` 事件监听零改动。
- HEX 输出为 6 位小写（与项目现有默认值 `#000000` `#ffd60a` `#0a84ff` 一致）。
- 新用户首次打开时默认模式为 HEX（跨工具复制最常见）。

**Acceptance criteria：**
- `node --test 'tests/**/*.test.mjs'` 全绿；
- `node --test core.test.mjs fit.test.mjs` 全绿；
- 浏览器手测：7 处 color input 全部走自定义 popup；模式切换后关开仍保留；数值/面板双向同步；
  下游渲染（预览、PNG 导出、MP4 导出）颜色输出与旧行为一致。

## Assumption Ledger

| Assumption | Confidence | Impact if Wrong | Status |
|---|---:|---:|---|
| 下游全部通过 `$('id').value` 读 hex；保留隐藏原生 input 即可零改动接线 | high | high | verified：grep 已确认 7 处均走 `.value` |
| HEX 全小写符合项目风格 | high | low | verified：现有 defaults 全小写 |
| 默认模式选 HEX 最合适 | medium | low | 用户接受的默认；首次打开可见 tab，可随时切 |
| EyeDropper API 在 `file://` 或 GH Pages 均可用 | medium | low | 不可用则藏按钮，不阻塞交付 |
| 复用 `.segmented .seg-opt` 样式作为 popup 内的 tab | high | low | verified：现有 bgModeSegmented 是同款用法 |

## Work-Unit Specs

### T1 — 颜色空间转换纯函数（core.mjs）

```yaml
id: T1
title: 颜色空间转换纯函数
file_path: core.mjs
functions:
  - name: parseHex
    inputs:
      - hex: string  形如 "#RGB" / "#RRGGBB" / "RGB" / "RRGGBB"（大小写不敏感，允许无 #）
    outputs: "{ r: number, g: number, b: number }（0-255 整数）"
    behavioral_contract: |
      支持 3 位速记（#f0a → {0xff,0x00,0xaa}）与 6 位标准形式；忽略前导 #；大小写不敏感。
    error_cases:
      - condition: "非 string 输入"
        behavior: "throw new TypeError('parseHex: hex must be a string')"
      - condition: "长度不是 3 或 6（去掉 # 后）"
        behavior: "throw new RangeError('parseHex: hex must be 3 or 6 hex digits')"
      - condition: "含非 hex 字符"
        behavior: "throw new RangeError('parseHex: invalid hex digit')"

  - name: formatHex
    inputs:
      - r: number  0-255（整数或近似整数，内部 Math.round + clamp）
      - g: number
      - b: number
    outputs: "string  6 位小写 hex，含前导 #，如 '#003366'"
    behavioral_contract: |
      对每分量 clamp 到 [0,255] 后 Math.round；输出 6 位补零小写 hex。
    error_cases:
      - condition: "任一分量非 number"
        behavior: "throw new TypeError('formatHex: r/g/b must be numbers')"
      - condition: "任一分量 NaN 或非有限数"
        behavior: "throw new RangeError('formatHex: r/g/b must be finite')"

  - name: rgbToHsl
    inputs:
      - r: number  0-255
      - g: number
      - b: number
    outputs: "{ h: number, s: number, l: number }  h ∈ [0,360)，s/l ∈ [0,100]"
    behavioral_contract: |
      标准 RGB→HSL 公式；灰阶（max===min）时 h=0；round 到整数。
    error_cases:
      - condition: "任一分量非有限数"
        behavior: "throw new RangeError('rgbToHsl: r/g/b must be finite')"

  - name: hslToRgb
    inputs:
      - h: number  ∈ [0,360)（超出范围内部 mod 归一）
      - s: number  ∈ [0,100]
      - l: number  ∈ [0,100]
    outputs: "{ r: number, g: number, b: number }  0-255 整数"
    behavioral_contract: |
      标准 HSL→RGB 公式；s/l 内部 clamp 到 [0,100]；结果 Math.round。
    error_cases:
      - condition: "任一分量非有限数"
        behavior: "throw new RangeError('hslToRgb: h/s/l must be finite')"

  - name: rgbToHsv
    inputs:
      - r: number  0-255
      - g: number
      - b: number
    outputs: "{ h: number, s: number, v: number }  h ∈ [0,360)，s/v ∈ [0,1]"
    behavioral_contract: |
      标准 RGB→HSV 公式；灰阶时 h=0；不 round（picker 定位需连续值）。
    error_cases:
      - condition: "任一分量非有限数"
        behavior: "throw new RangeError('rgbToHsv: r/g/b must be finite')"

  - name: hsvToRgb
    inputs:
      - h: number  ∈ [0,360)（内部 mod 归一）
      - s: number  ∈ [0,1]
      - v: number  ∈ [0,1]
    outputs: "{ r: number, g: number, b: number }  0-255 整数（Math.round）"
    behavioral_contract: |
      标准 HSV→RGB 公式；s/v 内部 clamp 到 [0,1]；结果 Math.round。
    error_cases:
      - condition: "任一分量非有限数"
        behavior: "throw new RangeError('hsvToRgb: h/s/v must be finite')"

dependencies: []
reuse_candidates: |
  已扫 core.mjs：无颜色空间转换现有实现；index.html 有 hexToRgba（拼 rgba 字符串，
  非结构化）不复用。此为全新纯函数簇。
acceptance: |
  visible + hidden 全绿；往返一致性覆盖：
  - hex → parseHex → formatHex → 原 hex 无损；
  - RGB → rgbToHsl → hslToRgb → 原 RGB 截尾误差 ≤2（HSL 输出 h/s/l round 到整数，
    反向累计误差理论上限 ±2）；
  - RGB → rgbToHsv → hsvToRgb → 原 RGB 截尾误差 ≤1（HSV 输出 s/v 保浮点，误差仅来自最终 RGB round）。
```

### T2 — 自定义 Color Picker UI + 全站接线 + 偏好存储（index.html）

```yaml
id: T2
title: Color Picker UI 组件与全站接线
file_path: index.html
functions:
  - name: initColorPickers
    inputs: []
    outputs: void
    behavioral_contract: |
      DOM ready 时调用一次；查询全部 input[type=color]（7 处 id 见 Overview），
      为每个 input：
        1) 用 CSS 隐藏原生 input（visibility:hidden 或 display:none 皆可，保留为值容器）；
        2) 在其位置插入 `<button class="cp-swatch" data-cp-target="<inputId>">`
           带内联背景色 = 当前 input.value；
        3) 绑定 click → openPicker(input, swatch)。
      单例 popup DOM 用 lazy-init（首次打开时插入 body 尾部并绑定全局事件）。

  - name: openPicker
    inputs:
      - targetInput: HTMLInputElement  底层 <input type="color">
      - swatch: HTMLButtonElement  触发按钮
    outputs: void
    behavioral_contract: |
      定位 popup 到 swatch 下方（视口边缘检测，越界时改到上方或右侧对齐）；
      读取 targetInput.value 初始化：hex → rgb → hsv，确定 SV 光标位置与 hue 位置；
      读取 localStorage.colorPickerMode（缺省 'hex'）应用当前模式；
      渲染值区（HEX=1 input / RGB=3 input / HSL=3 input）；
      绑定 outside-click / ESC → closePicker（含 commit 'change' 事件）。

  - name: closePicker
    inputs:
      - commit: boolean  是否派发 change 事件（默认 true）
    outputs: void
    behavioral_contract: |
      隐藏 popup；若 commit：向 targetInput 派发 new Event('change', {bubbles:true})。
      注意：popup 内值变化时已在实时派发 'input' 事件（预览联动）；'change' 语义
      = 「用户已敲定本次选色」，用于 MP4 导出等 change-only 监听。

  - name: setPickerMode
    inputs:
      - mode: 'hex' | 'rgb' | 'hsl'
    outputs: void
    behavioral_contract: |
      更新 tab 高亮（复用 .seg-opt.active 样式，`--accent-strong` 底色）；
      重新渲染值区（切换 1 input ↔ 3 input）；
      写入 localStorage.colorPickerMode。

  - name: (内部) updateFromXxx / syncPickerState
    inputs: (rgb 对象或 hex 字符串或 hsv 对象)
    outputs: void
    behavioral_contract: |
      单一状态源：popup 内部维护 currentHsv 与 currentRgb。任何输入源（SV 面板、色相条、
      HEX 输入、RGB 输入、HSL 输入、吸管）→ 换算为 currentHsv/currentRgb → 重绘所有 UI：
      SV 面板底色（跟随 hue）+ SV 光标位置 + 色相条光标位置 + 当前色预览 +
      三个模式的输入框值 + swatch 背景 + targetInput.value（触发 'input' 事件）。

dependencies: [T1]

reuse_candidates: |
  - CSS：复用现有 .segmented / .seg-opt / .seg-opt.active（line 89-95）作为模式 tab；
  - 强调色：复用 --accent-strong: #0066cc；
  - 面板色卡：新增，无可复用。
  - 事件语义：保留原生 input 的 input/change 事件语义。

acceptance: |
  浏览器手测 checklist（用户验收）：
  1. 打开 index.html，点任一色块 → 出现自定义 popup（无浏览器原生 popup）；
  2. popup 顶部 HEX/RGB/HSL 三段 tab 一眼可见，当前项 --accent-strong 蓝底白字；
  3. 在 SV 面板拖动光标，色相条拖动，任一 mode 的输入框编辑 → 三者双向同步、
     实时更新色块与预览；
  4. 切换 tab 到 HEX → 关闭 popup → 打开另一个 color input → 仍然是 HEX；
  5. 刷新页面 → 再打开 → 仍然是 HEX；
  6. 关掉页面重开 → 仍然是 HEX；
  7. Chrome/Edge：吸管按钮显示且可用；其它浏览器：吸管按钮隐藏；
  8. 预览、PNG 导出、MP4 导出的颜色输出与旧版一致（对同一 hex）；
  9. 逐字符核对：index.html 内联 script 内 parseHex/formatHex/rgbToHsl/hslToRgb/
     rgbToHsv/hsvToRgb 六函数体与 core.mjs 完全一致（仅去掉 `export`）。
```

## Dependency Graph

```
T1 (core.mjs 纯函数)
  └─ T2 (index.html UI + 接线 + 同步 T1 到内联副本)
```

## Execution Waves

- **Wave 1**：T1（无依赖）
- **Wave 2**：T2（依赖 T1 完成）

同文件规则：T1 单独在 core.mjs，T2 单独在 index.html，不冲突。

## Status
Completed（待浏览器手测最终验收）
