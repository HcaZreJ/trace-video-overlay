# BACKLOG

## 执行中 · Plan: color-picker-redesign  (→ .claude/plans/color-picker-redesign.md)

### Wave 1 — 无依赖 · 可并行
- [x] **T1**  颜色空间转换纯函数    file: `core.mjs`
        spec: parseHex / formatHex / rgbToHsl / hslToRgb / rgbToHsv / hsvToRgb
        验收: `node --test tests/visible/color-space.test.mjs` + hidden 全绿；
              往返一致性（hex↔rgb↔hsl↔rgb↔hex 无损，rgb↔hsv 截尾误差 ≤1）

### Wave 2 — deps: T1
- [x] **T2**  Color Picker UI 组件 + 全站接线 + 偏好存储    file: `index.html`
        spec: initColorPickers / openPicker / closePicker / setPickerMode + SV 面板 +
              色相条 + HEX/RGB/HSL 三段 tab + EyeDropper 吸管 + localStorage.colorPickerMode +
              把 T1 六函数逐字符同步进内联 script
        验收: 浏览器手测 checklist 9 条（见 plan 文件 T2.acceptance），全部 7 处
              color input（bgColor / lineColor / startColor / endColor / dotColor /
              mp4PageColor / mp4GreenColor）走自定义 popup；下游渲染管线零改动照旧工作
