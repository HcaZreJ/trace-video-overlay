# Feature: 地图底图 overlay（高德静图）

## Overview
在现有透明卡片渲染之上，新增一个可选的**地图底图 overlay** 模式：把高德「静态地图 API」返回的
底图铺在卡片下面，轨迹线与定位点画在上面，一次骑行的信息从「一根线」变成「一张能看出
街道、河流、山脉的完整地图」。默认关闭；开启后从「不上传任何数据」变为「导出时向高德发起一次
底图请求，包含轨迹的中心点/zoom」，用户在 UI 上 opt-in 才生效。

## Intent Brief
- **Goal**：地图 overlay 打开时，PNG 卡片和 MP4 都以高德实拍地图为底、轨迹/定位点在上，
  **对齐由数学保证**（底图与轨迹共享同一投影变换，像素级贴合，零手动校准）。
- **Motivation**：单纯一根轨迹线信息量太少，用户希望剪进视频时能直接看出「这段是长安街」「那段
  是绕西湖」，不必再手动叠一张截图。
- **Known context**：
  - 现有渲染：`projectTrack(points, fullSize)` 自适应 bbox 投影，Web Mercator，输出屏幕坐标数组。
  - 现有 renderCard/renderFrame 已支持 opts 驱动的逐帧渲染（用于 MP4 导出）。
  - 高德「静态地图 API」`restapi.amap.com/v3/staticmap` 官方文档参数：
    - 必需：`key`、`location`（center，`lng,lat`）、`zoom`（1-17）
    - 可选：`size`（宽*高，最大 1024×1024）、`scale`（1/2，2 为同视野双倍分辨率）、`traffic`（0/1 路况）、
            `markers`、`labels`、`paths`
    - **不支持**样式切换（无 `style`/`mapstyle` 参数），也**没有卫星图静图**（卫星图仅 JS SDK）。
  - **静图 zoom 基准**：高德静图按 512px tile 渲染（矢量瓦片惯例，高德 JS API 2.0 同源），
    `zoom=N` 的地面分辨率等于标准 256px Web Mercator 的 `N+1`。投影计算统一换算
    `mercZoom = amapZoom + AMAP_STATIC_ZOOM_BIAS`（导出常量，值 1，集中一处便于实测校准）。
    证据：环太湖轨迹（bbox ≈65km）在静图 zoom=9/600px 上占满图幅，而 256 基公式算出仅 30-50%，
    比值恰为一个 zoom 级；默认 fitZoom 下地图视野恰比预期小一半。
  - 坐标系：高德静图返回的是 **GCJ-02** 空间的图；GPS 是 WGS84。二者境内偏差 100-500m，
    必须做 WGS84→GCJ-02 转换后再投影，否则轨迹会离马路。
- **Constraints**：
  - 纯前端、无 build、无后端；无 key 时降级为原透明卡片模式（无底图）。
  - GitHub Pages 部署路径不变；`index.html` 打开即用。
  - 与现有 MP4/PNG 导出管线兼容：MP4 一次请求一张不动的底图，逐帧只叠轨迹+定位点。
  - core.mjs 公共逻辑与 index.html 内联 script 逐字符同步。
- **Non-goals**：
  - 卫星图 / 地形图 / 多种地图样式切换（高德静图 API 不支持）。
  - 百度地图接入。
  - 镜头跟随定位点的动态视野（工作量 3-5×，暂缓）。
  - 地图交互（拖拽/平移）—— 只是渲染底图。
  - 底图细节层级（街道名密度）独立调节——zoom 由取景自动选定。
- **Success criteria**：
  - `sample-ride.gpx` / 环太湖 GPX 载入 → UI 勾选「地图 overlay」→ 填入 key → 点预览 →
    轨迹线沿着实际道路、起终点标记在正确位置，PNG 与 MP4 各分辨率下对齐一致。
  - 「取景缩放」slider 拖动时底图与轨迹作为刚体整体缩放（贴合关系保持不变），仅本地重画。
  - 无 key 或请求失败 → 静默降级为无底图（用户可见状态提示），其它导出功能不受影响。

## Alignment Gate
- **I will implement**：
  - WGS84→GCJ-02 坐标转换（境内判定 + 标准公式）。
  - 高德静图 URL 构造（key/location/zoom/size/scale/traffic 参数）。
  - 512 基 zoom 换算 + 底图/轨迹共享的 world→canvas 仿射变换（对齐由数学保证）。
  - 底图 fetch + 内存缓存（同参数不重复请求），恒 size=1024、scale=2。
  - renderCard/renderFrame 集成底图 + 可选黑蒙层。
  - UI 控件：overlay 开关、key 输入（localStorage）、路况 checkbox、
    「铺满 / 铺满+黑蒙层」radio + 蒙层透明度、「取景缩放」slider、预览按钮、错误状态提示。
  - README：feature 说明、key 申请步骤、隐私声明、对齐原理与露边说明。
- **I will not implement**：卫星图、其它地图样式、百度、动态视野、镜头跟随、地图交互、
  手动对齐类控件（对齐是数学精确的，手动校准控件只会引入错位）。
- **Open assumptions**：见 Assumption Ledger。
- **Acceptance**：见 Success criteria + 「浏览器实测验收」。

## Assumption Ledger
| Assumption | Confidence | Impact if Wrong | Status |
|---|---:|---:|---|
| 用户接受 opt-in 后向高德发送轨迹中心点/zoom | high | high | 用户确认 |
| 用户可自申请高德开放平台 key、UI 手动填入 | high | high | 用户确认 |
| MP4 场景用「全轨迹一张不动的底图」 | high | high | 用户确认 |
| 卡片外观支持「铺满 / 铺满+黑蒙层」两种可选 | high | medium | 用户确认 |
| WGS84→GCJ-02 标准公式对民用 GPS 数据精度足够（境内 <5m 误差） | high | high | 常见事实，业界通用 |
| 高德静图 zoom=N 分辨率 = 标准 Web Mercator N+1（512px tile 基准） | high | high | 用户浏览器实测确认（轨迹贴合道路） |
| 静图 scale=2 为同视野双倍分辨率（retina 语义） | high | medium | 用户浏览器实测确认 |
| 高德静图免费额度（个人 5000 次/天）够日常骑行导出 | high | low | 官方公开 |
| 境外坐标不做转换（原样发给高德） | medium | medium | 通用做法，README 声明只保证境内精度 |
| 高德个别地区可能返回 400/403（受限区域）→ 静默降级 | medium | low | 有降级逻辑兜底 |
| 高德静图端点返回 CORS 头（crossOrigin='anonymous' 加载成功，canvas 不 taint） | high | high | 已实测确认（底图曾成功渲染并导出） |

## 对齐模型（A 系列 work-unit 的共同契约）
- 底图与轨迹共享同一 world→canvas 仿射变换：
  `canvasPx = (worldPx(mercZoom) − centerPx(mercZoom)) × k + canvasSize/2`。
- `mercZoom = amapZoom + AMAP_STATIC_ZOOM_BIAS`，`AMAP_STATIC_ZOOM_BIAS = 1`（导出常量）。
- 静图**内容视野**恒等于请求参数 `size`（scale=2 只翻倍图像分辨率，视野不变）。
  请求恒用 `size=1024`、`scale=2` → 图像 2048px、内容视野 1024 世界像素。
- **k 为连续绘制因子**：`k = viewScale × (canvasSize − 2·padPx) / max(spanPx, 1)`。
  - `spanPx` = 轨迹 GCJ-02 bbox 在 mercZoom 下的世界像素跨度 `max(dx, dy)`。
  - `viewScale` = 用户「取景缩放」slider 值（默认 1）。
  - 默认取景下轨迹恰好占满 pad 内区域（与无底图模式视觉一致）；zoom 的整数颗粒度被 k 的
    连续性完全吸收，对齐与取景解耦。
- **amapZoom 选择**：最大 amapZoom ∈ [1,17] 使 `spanPx × 1.4 ≤ 1024`（1.4 为取景余量，
  覆盖常用 pad/viewScale 范围）；全部超出时取 1。单点轨迹（bbox 退化）→ zoom=15、spanPx=0。
- **底图绘制矩形**：内容中心 = 静图 center = 轨迹 bbox 中心 = canvas 中心。
  `drawRect = { x: canvasSize/2 − (contentSize/2)·k, y: 同, w: contentSize·k, h: contentSize·k }`。
  矩形外露出的区域保持卡片原背景（viewScale 拉小或 pad 极大时可见，属预期行为，README 说明）。
- 各导出分辨率（600 PNG / 720 / 1080 / 1440 MP4）下 pad 均按 `size/CARD_SIZE` 等比缩放，
  k 随之等比，视野与预览一致。

## Work-Unit Specs

### T1 · WGS84 → GCJ-02 坐标转换 ✅（已交付，36/36 hidden 全绿，无变更）
- **file_path**：`core.mjs`（+ `index.html` 内联同步）。
- `wgs84ToGcj02(lng, lat) → { lng, lat }`：境内按国测局公式偏移，境外原样返回，
  非有限数入参抛 `TypeError`。

### A1 · core.mjs 对齐数学簇
- **file_path**：`core.mjs`（`index.html` 内联同步在 A2 做）。
- **functions**：
  - `AMAP_STATIC_ZOOM_BIAS`（导出常量，值 `1`）。
  - `lngLatToAmapPixel(lng, lat, zoom) → { x, y }`
    - **behavioral_contract**：`zoom` 是**标准 256 基 Web Mercator zoom**（静图 amapZoom 经
      +BIAS 换算后传入），接受整数 [1,18]。世界宽度 `256 × 2^zoom` 像素，X 向东递增，
      Y 向南递增。公式与现实现一致。
    - **error_cases**：zoom 非整数或超 [1,18] → `RangeError`；|lat| > 85.05112878 → `RangeError`。
  - `computeAmapView(bboxGcj02, sizePx) → { center: {lng,lat}, zoom, spanPx }`
    - **behavioral_contract**：zoom 为 **amap 语义**（1-17）：从 17 向下取第一个使
      bbox 在 `mercZoom = zoom + BIAS` 下的世界像素跨度 `max(dx,dy) × 1.4 ≤ sizePx` 的值；
      全部超出取 1。`spanPx` = 选定 mercZoom 下的该跨度。center 取 bbox 中心。
      单点 bbox → `{ center: 该点, zoom: 15, spanPx: 0 }`。
    - **error_cases**：bbox 字段缺失或非数字 → `TypeError`；min > max → `RangeError`；
      sizePx 非正有限数 → `RangeError`。
  - `computeOverlayScale(spanPx, canvasSize, padPx, viewScale) → number`
    - **behavioral_contract**：`viewScale × (canvasSize − 2·padPx) / max(spanPx, 1)`。纯函数。
    - **error_cases**：spanPx 负数或非有限 → `RangeError`；canvasSize 非正 → `RangeError`；
      padPx 负数或 `2·padPx ≥ canvasSize` → `RangeError`；viewScale 非正 → `RangeError`。
  - `computeBasemapDrawRect(canvasSize, contentSize, k) → { x, y, w, h }`
    - **behavioral_contract**：`w = h = contentSize × k`；`x = y = canvasSize/2 − w/2`。纯函数。
    - **error_cases**：canvasSize/contentSize/k 非正有限数 → `RangeError`。
  - `projectTrackOnAmap(pointsWgs84, canvasSize, center, amapZoom, k) → { points: [{x,y}], fullSize }`
    - **behavioral_contract**：`amapZoom` 为 amap 语义（整数 1-17），内部 `mercZoom = amapZoom + BIAS`。
      每点 WGS84 → GCJ-02 → `lngLatToAmapPixel(·, mercZoom)` 世界像素，再
      `(worldPx − centerPx) × k + canvasSize/2`。轨迹先经 `smoothTrack(points, 500)` 平滑
      （与现实现一致）。`fullSize = canvasSize`。
    - **error_cases**：pointsWgs84 非空数组 → `TypeError`；center 缺 lng/lat 数字 → `TypeError`；
      amapZoom 非整数或超 [1,17] → `RangeError`；k 非正有限数 → `RangeError`。
  - `computeAmapUrlForTrack(pointsWgs84, size, key, scale, traffic) → { url, center, zoom, spanPx }`
    - **behavioral_contract**：串联 wgs84ToGcj02 → bbox → computeAmapView → buildAmapStaticUrl，
      返回值透传 computeAmapView 的 spanPx。其余与 buildAmapStaticUrl 现契约一致。
    - **error_cases**：pointsWgs84 非空数组 → `TypeError`；其余由被串联函数抛出。
  - `buildAmapStaticUrl(params) → string`：契约不变（参数顺序稳定、location 6 位小数、
    size ≤ 1024、scale ∈ {1,2}、traffic ∈ {0,1}、zoom ∈ [1,17] 整数）。
- **dependencies**：T1。
- **reuse_candidates**：现有 `lngLatToAmapPixel` 公式主体保留（仅 zoom 域放宽到 18）；
  `buildAmapStaticUrl`、`smoothTrack` 原样复用；`computeAmapView`/`projectTrackOnAmap` 在
  原实现上改造。
- **tests**：重写 `tests/{visible,hidden}/amapStatic.test.mjs`（lngLatToAmapPixel、
  computeAmapView、buildAmapStaticUrl、computeOverlayScale、computeBasemapDrawRect）与
  `tests/{visible,hidden}/amapTrackBridge.test.mjs`（computeAmapUrlForTrack、projectTrackOnAmap）。
  `wgs84ToGcj02` 测试不动。
- **acceptance**：`node --test 'tests/**/*.test.mjs'` 全绿。关键锚定用例：
  - bbox 跨度恰为某 mercZoom 下 `sizePx/1.4` 时选中该级、超一点则降一级；
  - `computeOverlayScale(500, 600, 70, 1) = 0.92`；
  - projectTrackOnAmap 输出满足 `bbox 中心点 → canvasSize/2 ± ε`、任两点间距 = 世界像素距 × k。

### A2 · index.html：内联同步 + fetch + 渲染变换 + UI 终态
- **file_path**：`index.html`（同文件一个 implementer 串行完成；浏览器运行时逻辑，无 hidden test，
  浏览器实测验收）。
- **内联同步**：core.mjs 中 A1 触及的全部函数/常量逐字符同步进内联 script。
- **fetch 层**：
  - `fetchAmapBasemap({ pointsWgs84, key, traffic }) → Promise<{ image, center, zoom, spanPx, contentSize, url }>`
    - 恒 `size=1024`、`scale=2`，`contentSize = 1024`。
    - 内部调 `computeAmapUrlForTrack`；`new Image()` 加载 + 15s 超时 + `{url → Image}` 内存缓存
      （与现实现一致）；失败 reject 带 `code: 'fetch_failed'` 的 Error。
  - `window.mapOverlayState = { basemapImage, mapCenter, mapZoom, spanPx, contentSize, viewScale, overlayMode, overlayMaskOpacity }`。
- **渲染层**（renderCard overlay 分支 / renderFrame overlay 分支，两处同构）：
  ```js
  const k = computeOverlayScale(spanPx, size, pad, viewScale);   // pad 已按 size/CARD_SIZE 缩放
  const rect = computeBasemapDrawRect(size, contentSize, k);
  // 圆角 clip → drawImage(img, rect.x, rect.y, rect.w, rect.h) → 可选蒙层
  const proj = projectTrackOnAmap(trackPoints, size, mapCenter, mapZoom, k);
  ```
  蒙层、圆角、marker、定位点、strokePath 逻辑保持现状；`buildFrameOpts` 把
  spanPx/contentSize/viewScale 一并放入 opts（MP4 全帧同一变换）。
- **UI 终态**（地图 overlay 分组内的全部控件）：
  - checkbox `mapOverlay`「开启地图 overlay」（默认 unchecked）。
  - input `amapKey` + 「获取 key 帮助」外链，读写 `localStorage.amap_key`。
  - checkbox `mapTraffic`「显示路况」。
  - radio `mapOverlayMode`「铺满 / 铺满+黑蒙层」+ range `mapMaskOpacity`（0-80%）。
  - **range `mapViewScale`「取景缩放」**：0.5–1.5、step 0.05、默认 1.0。input 事件更新
    `mapOverlayState.viewScale` + `render()`，纯本地重画。文案说明：调整轨迹在卡片中的占比，
    底图与轨迹同步缩放、贴合关系不变；拉小可能露出底图边界（边界外为卡片背景）。
  - button `mapPreview`「预览地图 overlay」+ 状态提示区 `mapOverlayStatus`（逻辑保持现状）。
  - 移除清单（DOM + 事件绑定 + state 字段 + opts 字段一并移除）：`mapZoomOffset`、
    `mapHiDpi`、`mapBasemapScale`、`mapTrackScale`、`overlayScale`、`trackScale`、`basemapScale`。
  - 触发 refetch 的参数集合：轨迹数据（同时立即清空 mapOverlayState 降级渲染，旧底图与新轨迹
    不再对应）、traffic、key；仅本地重画的集合：viewScale、overlayMode、maskOpacity、pad、
    线色线宽、marker。
- **dependencies**：A1。
- **acceptance**：见「浏览器实测验收」。

### A3 · README overlay 小节改写
- **file_path**：`README.md`。
- **behavioral_contract**：「地图底图 overlay（可选）」小节反映当前行为：
  - 对齐原理一句话：静图 zoom 按 512px tile 基准换算 + 底图/轨迹共享同一投影变换，自动像素级对齐。
  - 「取景缩放」的用途（调轨迹占比，非对齐工具）；拉小可能露出底图边界。
  - 底图恒为高清（scale=2）；路况可选。
  - key 申请步骤、免费额度、隐私声明（发送中心点/zoom）、精度声明（境内 <5m、境外原样）、
    无 key/失败降级——保持既有内容。
- **dependencies**：与 A2 不同文件，可并行。
- **acceptance**：README 渲染正常，描述与 A2 交付的实际 UI 一致。

## 浏览器实测验收（A2 完成后，用户执行）
1. 环太湖 GPX + key + 点预览 → 底图视野包含完整轨迹、轨迹沿实际道路贴合（≤2-3px）——
   此条同时是对 zoom-bias 假设的最终确认。
2. 拖「取景缩放」→ 底图与轨迹刚体同缩、贴合不变、无网络请求。
3. 改蒙层透明度/模式/pad/线色 → 仅本地重画；改路况/换轨迹 → 状态区提示需重新预览。
4. PNG（600）与 MP4（1080）导出 → 两种分辨率下对齐一致，MP4 全程底图稳定。
5. 无 key / 断网 → 状态提示错误，卡片降级为无底图透明渲染。

## Dependency Graph
```
T1 ✅
 └── A1 (core.mjs 对齐数学 + 测试重写)
      └── A2 (index.html 同步 + 渲染 + UI 终态)  [A1]
A3 (README)  [可与 A2 并行]
```

## Execution Waves
- **Wave A-1**：A1 —— `@test-author` 重写两组测试 → 架构师审测试 → `@function-implementer` 实现。
- **Wave A-2**：A2（implementer，浏览器实测验收）∥ A3。
- **Wave A-3**：终审（`@spec-compliance-reviewer` + `@quality-security-reviewer` 并行）→
  用户浏览器实测 → 汇报 → 批准后 commit。

## Status
Completed（用户浏览器实测验收通过）
