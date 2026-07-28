# PATTERNS

## 模块边界：core.mjs 权威 + index.html 内联同步
- 纯几何/解析/字符串构造函数写进 `core.mjs`（具名 `export function`），由 node:test 覆盖。
- 涉及 fetch / DOM / Canvas / Image 的浏览器运行时逻辑只写在 `index.html` 内联 script。
- `core.mjs` 中被 `index.html` 使用的函数，必须**逐字符**同步进内联 script
  （内联副本为普通函数声明，去掉 `export` 关键字），并在内联区用
  `/* ==================== 分区标题（core.mjs 权威，已 node:test 覆盖） ==================== */`
  banner 标注归属。

## 命名
- 函数/变量 camelCase；真常量 SCREAMING_SNAKE_CASE（如 `AMAP_STATIC_ZOOM_BIAS`、`GCJ_EE`）。
- DOM id 用 camelCase（如 `mapViewScale`、`lineColor`）。
- 测试描述用中文，格式 `test('函数名(中文含义): 场景', fn)`。

## 错误处理
- 参数校验抛原生 `TypeError`（类型/结构错）或 `RangeError`（值域错），消息以函数名前缀：
  `throw new RangeError('computeAmapView: sizePx must be a positive number')`。
- 语义上「无数据」的指标函数返回 `null`（如 `trackDurationSec`）；解析失败才抛错。
- 浏览器侧网络失败 reject 带 `code` 字段的 `Error`（如 `'fetch_failed'`），UI 层据此提示并降级。

## 渲染
- 一切卡片渲染以 `CARD_SIZE = 600` 为基准；其它分辨率按 `scale = size/CARD_SIZE`
  等比缩放全部样式参数（pad/lineWidth/radius/markerSize/dotSize）。
- `renderCard`（DOM 驱动，预览+PNG）与 `renderFrame`（opts 驱动，MP4 逐帧）保持同构逻辑；
  改渲染行为时两处同步。
- 尺寸滑块语义统一为「彩色核直径」（600 基准像素）：起终点标记 `r=size/2`，定位点几何
  全部由 `dotGeometry(size)` 导出（coreR/ringW/outerR/pad/full/阴影），同数值 → 彩色核同大；
  渲染层出现定位点的三处（renderCard 预览、renderFrame、renderDot）统一走 dotGeometry。
- 地图 overlay 对齐模型：底图与轨迹共享同一 world→canvas 仿射变换
  `canvasPx = (worldPx(mercZoom) − centerPx) × k + size/2`，k 由
  `computeOverlayScale` 连续计算——对齐靠数学，UI 控件只调取景。

## 颜色选择器
- 全站色块（`.cp-swatch`）触发同一个自定义 popup 组件，原生 `<input type="color">`
  保留在 DOM 中并加 `.native-color-hidden` 隐藏，仍作为值容器供下游 `$('id').value` 读、
  作为事件源派发 `input`（每次值变化）与 `change`（关闭 popup 时）；隐藏原生 input
  的 CSS 用 `position:absolute;opacity:0;width:1px;height:1px;pointer-events:none`
  以保留可 focus 语义。
- 表达模式（HEX / RGB / HSL）用 `.segmented > .seg-opt` 分段控件（与工作台既有的
  纯色/地图底图切换同款），当前项加 `.active` 复用 `--accent-strong` 底色；模式偏好
  持久化于 `localStorage.colorPickerMode`，跨全站所有色块共享，缺省 `'hex'`。
- 内部维护 `currentRgb` + `currentHsv` 双份状态：SV 面板与色相条要求连续浮点 hue
  与 s/v，输入框展示要求整数 RGB/HSL；灰阶（`hsv.s === 0`）时保留旧 hue，避免光标
  跳回 0。

## UI 结构（工作台）
- 布局 = 左列 sticky 预览舞台（卡片 canvas + 动画扫拨行 + 轨迹统计 + 定位点图例）+
  右列四个任务分区卡片：①轨迹 ②背景与卡片 ③线路与标记 ④导出；吸底元素只允许紧凑
  单行操作条（`.export-actions`），整卡吸底会遮挡其余分区。
- 数值参数一律 field 范式：标签（含单位）+ 全宽 slider + 右侧 number 输入，`bind()`
  双向同步并对越界输入 clamp；互斥配置（纯色/地图底图）用 segmented 单选驱动渐进披露。
- 状态反馈：导出类消息走 ④ 区 `#exportStatus`（成功 ✓ 4s 自清，失败 ✕ 持久），地图链
  消息走 ② 区 `#mapOverlayStatus`，两者均 `aria-live="polite"`；用户可见报错为中文人话，
  内部 `Error.code` 供程序分支。
- 空状态：canvas 内绘引导文字，依赖轨迹的分区加 `.needs-track` 降透明度，示例轨迹按钮
  提供零成本首个成功体验。

## 测试
- Node 内置 `node:test` + `node:assert/strict`，零框架。
- harness 单元走 `tests/visible/`（少量样例，实现 agent 可见）+ `tests/hidden/`
  （全面用例，实现 agent 仅见跑分）双文件盲测。
- 浮点断言用容差比较；已知锚定值由公式手工推导写死。

## 刻意省略的设计
- 无 build 工具、无框架、无 TypeScript、无 npm 依赖——`index.html` 打开即用是产品约束。
- 无后端、无数据库；唯一网络请求（高德静图）是用户 opt-in 的运行时行为。
