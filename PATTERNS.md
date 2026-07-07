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
- 地图 overlay 对齐模型：底图与轨迹共享同一 world→canvas 仿射变换
  `canvasPx = (worldPx(mercZoom) − centerPx) × k + size/2`，k 由
  `computeOverlayScale` 连续计算——对齐靠数学，UI 控件只调取景。

## 测试
- Node 内置 `node:test` + `node:assert/strict`，零框架。
- harness 单元走 `tests/visible/`（少量样例，实现 agent 可见）+ `tests/hidden/`
  （全面用例，实现 agent 仅见跑分）双文件盲测。
- 浮点断言用容差比较；已知锚定值由公式手工推导写死。

## 刻意省略的设计
- 无 build 工具、无框架、无 TypeScript、无 npm 依赖——`index.html` 打开即用是产品约束。
- 无后端、无数据库；唯一网络请求（高德静图）是用户 opt-in 的运行时行为。
