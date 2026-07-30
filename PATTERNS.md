# PATTERNS

## 分层

六层加两个叶子模块，`src/main.mjs` 是装配入口。

| 层 | 边界 |
|---|---|
| `src/core/` | 零浏览器 API 的纯函数。Node 直接 import 单测，浏览器 import 同一份。 |
| `src/parse/` | 按轨迹格式分家，`index.mjs` 按扩展名分派。`xml.mjs` 依赖浏览器 `DOMParser`，因而是这一层里唯一 Node 下不可单测的模块。 |
| `src/basemap/` | 高德静图的网络与图片解码。不碰界面 DOM；结果经返回值或带 `code` 的 `Error` 交给 ui 层。 |
| `src/render/` | 收 canvas 作画。从 `state` 读轨迹与进度、用 `$` 读控件当前值，不写 DOM、不绑事件、不改 state。 |
| `src/export/` | 产物出口：PNG 下载、MP4 编码管线、导出状态条。与 `ui` 互相调用，见「依赖方向」。 |
| `src/ui/` | 唯一写界面 DOM、绑事件的一层。 |
| `src/state.mjs` | 跨层共享的可变状态与 `CARD_SIZE`。叶子，零导入。 |
| `src/dom.mjs` | `$` 取元素。叶子，零导入。 |

`src/main.mjs` 只装 import、事件绑定、首屏初始化。

## 依赖方向

**恒真的一条**：没有任何模块导入入口 `src/main.mjs`，依赖只从它流向各层。
这条由 `tests/hidden/uiStructure.test.mjs` 盯着。

**主干向下**：`core` 是叶子，谁都可以导入它；`parse` · `basemap` · `render` 只向下依赖
`core` 与 `state` / `dom` 两个叶子，不反向依赖 `export` 或 `ui`。

**`export` 与 `ui` 之间是双向的**：`export/png` 与 `export/mp4` 在开工前要调
`ui/map-panel.onPreviewMapOverlay`（补拉底图）与 `ui/preview.stopPreviewPlay`（停动画），
而 `ui/track-panel` 要调 `export/mp4.mp4Supported` 决定界面能力。给这两层排先后没有意义，
它们是同一次「用户点导出」里的协作方。

**同层兄弟模块之间也互相调用**：`ui/map-panel ↔ ui/preview`（重绘失败要报状态、
底图拉取完成要重绘）、`ui/track-panel ↔ ui/track-errors`（撤销按钮触发重算、载入失败弹提示）、
`ui/color-picker/` 四个模块构成一个强连通分量（输入框与指针回调就是状态同步链路本身）。

这些环都只在函数体内跨模块调用，模块顶层不读取伙伴模块的绑定，因此 ESM 求值期安全。
往这些模块的顶层加会立即执行的语句时要留意这一点。

## 跨模块状态

ES module 的导入绑定是只读的，所以多个模块共读共写的状态一律挂在导出的对象上：

- `state`（`src/state.mjs`）—— `trackFiles` · `trackPoints` · `previewProgress`
  · `mapOverlayNeedsRefresh`，被 ui / render / export 三层共用。
- `exportState`（`src/export/status.mjs`）—— `forceNoBasemap`，「改用无底图导出」这条路径上
  status 写、png 与 mp4 读并消费。
- `pickerState`（`src/ui/color-picker/index.mjs`）—— 取色器自身的界面状态，
  在定义它的模块内以 `state` 之名使用，跨模块以 `pickerState` 之名导出以免与应用状态混淆。
- `window.mapOverlayState` —— 地图 overlay 运行时状态，挂 window 便于浏览器控制台手测。

只服务单一模块的可变量用普通 `let` 留在那个模块里（如 `mp4CancelRequested`
之于 `export/mp4.mjs`、`mapFetchInFlight` 之于 `ui/map-panel.mjs`）。

## 命名
- 函数/变量 camelCase；真常量 SCREAMING_SNAKE_CASE（如 `AMAP_STATIC_ZOOM_BIAS`、`GCJ_EE`）。
- DOM id 用 camelCase（如 `mapViewScale`、`lineColor`）。
- 测试描述用中文，格式 `test('函数名(中文含义): 场景', fn)`。

## 错误处理
- 参数校验抛原生 `TypeError`（类型/结构错）或 `RangeError`（值域错），消息以函数名前缀：
  `throw new RangeError('computeAmapView: sizePx must be a positive number')`。
- 语义上「无数据」的指标函数返回 `null`（如 `trackDurationSec`）；解析失败才抛错。
- 浏览器侧网络失败 reject 带 `code` 字段的 `Error`（如 `'amap_api_error'`），
  ui 层据此分支提示并降级。用户可见文案是中文人话，`Error.code` 供程序判别。

## 渲染
- 一切卡片渲染以 `CARD_SIZE = 600` 为基准；其它分辨率按 `scale = size/CARD_SIZE`
  等比缩放全部样式参数（pad/lineWidth/radius/markerSize/dotSize）。
- `renderCard`（读控件取值，服务预览与 PNG）与 `renderFrame`（收 opts 对象，服务 MP4 逐帧）
  画同一幅画，同处 `src/render/card.mjs`；改渲染行为时两处同步。
  取参形态不同：`buildFrameOpts()` 把控件取值快照成 opts，让逐帧渲染与 DOM 解耦。
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

## 样式组织

`styles/` 六个文件按 `<link>` 顺序拼接即浏览器看到的层叠顺序，所以文件内与文件间的
规则顺序都有语义：`tokens`（`:root` 变量）→ `base`（reset · body · header · focus-visible）
→ `layout`（workspace 栅格 · drop 区 · 舞台 · 步骤结构 · gate 态 · 断点）
→ `forms`（input · select · range · val · check · segmented）
→ `components`（keyhelp · 按钮 · 吸底导出条 · 状态按钮 · 文件列表）
→ `color-picker`（`.cp-*`，与 `src/ui/color-picker/` 成对）。
新增规则放进它所属主题的那个文件。

## UI 结构（工作台）
- 布局 = 左列 sticky 预览舞台（卡片 canvas + 动画扫拨行 + 轨迹摘要行）+ 右列三个步骤
  `.step`：① 轨迹 → ② 样式 → ③ 导出，序号表达先后顺序。舞台自身 `min-height:calc(100vh - 48px)`
  且内容居中，垂直居中不依赖右列高度。
- 步骤之间用 `--sp-step` 间距 + 一条 `border-top` 分隔线表达分组，步骤本身没有边框和
  `--panel` 底色。边框容器只表达两种含义：悬浮层（`.export-actions` 吸底操作条）与从属层
  （`.map-subpanel` 地图配置子面板，`--panel` 底 + 2px 左竖线 + 12px 缩进）。
- ② 样式下辖三个 `.subhead` 子组，共同类别是「画面上的视觉对象」：卡片 / 线路 / 定位点；
  子组之间只用 `--sp-group` 间距，不画线。定位点子组的标题行右侧内联 32px 小预览。
- ③ 导出用 `exportKind` segmented 切换产物（贴图 PNG / 动画 MP4），两个参数面板与吸底条
  主按钮随之切换，`updateExportKindUI()` 只改 `style.display` 与 `.active`，不碰 `disabled`；
  可用性（有无轨迹、导出中互斥）与显隐是两条互不相交的通道。选择存 `localStorage.exportKind`。
- 视觉 token：字号只有 17（页标题）/ 14（区标题）/ 13（子组标题与控件 label）/ 12（元信息）
  四档；操作性文字用 `--fg`，`--dim` 只给可跳过的说明；hover 只改亮度（唯一例外是文件列表
  删除按钮 hover 变红）；segmented 选中态用中性 `#39404d`，蓝色只留给吸底条主按钮与链接；
  间距走 `--sp-label` / `--sp-field` / `--sp-group` / `--sp-step` 四个变量。
- 数值参数一律 field 范式：标签（含单位）+ 全宽 slider + 右侧 number 输入，`bind()`
  双向同步并对越界输入 clamp；互斥配置（纯色/地图底图）用 segmented 单选驱动渐进披露。
- 颜色参数一律 `.color-row` 范式：左 label + 右 28×28 swatch + `data-hex-for` 的 12px 灰字
  hex 值，起点终点两行装进 `.color-pair` 同行显示。
- 状态反馈：导出类消息走吸底条的 `#exportStatus`（成功 ✓ 6s 自清，失败 ✕ 持久），地图链
  消息走 ② 区 `#mapOverlayStatus`，两者均 `aria-live="polite"`。
- gate：`setTrackGate(hasTrack)` 切 `body.has-track`，并对每个 `[data-gate]` 切 `needs-track`
  + `inert` + `aria-disabled`。未载入轨迹时 `.step-body` 收起、区标题降到 45%、吸底条整条
  `display:none`，页面上只剩 drop 区 / 画布点击 / 示例轨迹链接三个入口，三者是同一个动作。
- 空状态引导画在 canvas 内（`renderCard` 的空状态分支），画布本身在无轨迹时可点击选文件。

## 测试
- Node 内置 `node:test` + `node:assert/strict`，零框架。
- `tests/unit/` 覆盖 core 与 parse 的纯逻辑。`src/core/metrics.mjs` 的六个指标函数
  目前只有测试覆盖、界面尚未接线，改动它不影响页面行为。
- harness 单元走 `tests/visible/`（少量样例，实现 agent 可见）+ `tests/hidden/`
  （全面用例，实现 agent 仅见跑分）双文件盲测。
- UI 测试断言的对象是「浏览器最终装载到的 CSS 与 JS」，取材统一走
  `tests/helpers/source.mjs`：`readCss()` 按 `<style>` 块与 `<link>` 在文档中的先后顺序拼接，
  `readJs()` 取内联 `<script>` 加 `src/` 下全部 `.mjs`，`readAll()` 供「某段内容已彻底删除」
  这类断言使用。样式或脚本换了文件归属时只改这一处。
- 浮点断言用容差比较；已知锚定值由公式手工推导写死。
- canvas 与网络这类静态断言够不着的行为，靠无头 Chrome + iframe harness + CDP
  `Runtime.evaluate` 实测；渲染改动用像素签名（非透明像素数 + FNV-1a + 采样点 RGBA）比对。

## 刻意省略的设计
- 无 build 工具、无框架、无 TypeScript、无 npm 依赖——GitHub Pages 从 `main` 根目录
  直接托管源码是产品约束。
- 无后端、无数据库；唯一网络请求（高德静图）是用户 opt-in 的运行时行为。
