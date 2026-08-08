# PROJECT

## 目的
把一次骑行的轨迹文件（GPX / KML / TCX / FIT / GeoJSON / CSV）渲染成视频剪辑用的素材：
透明 PNG 贴图、定位点 PNG、或者一键 MP4 动画，为剪映等剪辑软件的画中画场景设计。
在线使用：https://hcazrej.github.io/trace-video-overlay/

## 功能清单与状态
| 功能 | 状态 |
|---|---|
| 多格式轨迹解析（GPX / KML / TCX / FIT / GeoJSON / CSV） | 已上线 |
| 多轨迹文件按拖入顺序首尾相连（列表重排 + 拼接 + 删除撤销） | 已上线 |
| 工作台 UI（sticky 预览舞台 + 右列「① 轨迹 → ② 样式 → ③ 导出」三步流程 + 吸底导出条） | 已上线 |
| 空状态：②③ 收起成置灰标题行、吸底条不渲染，入口只剩 drop 区 / 画布点击 / 示例轨迹链接 | 已上线 |
| 导出产物切换（贴图 PNG / 动画 MP4 两个参数面板，主按钮随之切换，选择存 localStorage） | 已上线 |
| 透明卡片 PNG 导出（分辨率 720 / 1080 / 1440 与 MP4 共用，样式可调，成功 toast） | 已上线 |
| 定位点（预览实时叠加 + 通过按钮导出高清 PNG；尺寸语义 = 彩色核直径，dotGeometry 统一几何） | 已上线 |
| 动画预览扫拨条（拖动 / 播放定位点沿线路运动，时长与 MP4 联动） | 已上线 |
| MP4 动画导出（WebCodecs + vendored mp4-muxer，时长 clamp、导出中可取消、关页拦截） | 已上线 |
| 时间真实模式 MP4 导出（定位点按轨迹时间戳走、停留段静止、可指定起止时刻与时间缩放、多文件段间空隙可折叠） | 已上线 |
| 流式写盘导出（File System Access API，时长上限 6 小时；不支持的浏览器回落全内存 + 600 秒上限） | 已上线 |
| 导出画质三档（high/medium/low，与分辨率交叉查表）+ 预计文件大小实时估算 | 已上线 |
| 时间真实导出的 sidecar 元数据（文件名编码 `_t<epochSec>_s<scale>` + 同名 .json，供下游按真实时刻裁剪） | 已上线 |
| 地图底图（segmented 纯色 / 地图切换、参数变化自动重拉、key 类型中文诊断与申请引导） | 已上线 |
| 底图缺失时导出阻断（重试 / 一次性无底图导出） | 已上线 |
| a11y 基线（label 关联、aria-live、键盘拖放区、focus-visible、主按钮对比度 ≥ 4.5:1） | 已上线 |
| 自定义 Color Picker（SV 面板 + 色相条 + HEX/RGB/HSL 分段 tab + 吸管 + localStorage 保留模式） | 已上线 |

## 核心 Data Model
- **轨迹点数组** `[{ lng, lat, ele?, time? }]`：所有解析器的统一输出，也是所有投影 / 渲染的统一输入。
- **投影结果** `{ points: [{x,y}], fullSize }`：`projectTrack`（自适应 bbox）与
  `projectTrackOnAmap`（底图对齐）输出同构，渲染层可以无缝切换。
- **`window.mapOverlayState`**：地图 overlay 的运行时状态（底图 Image、center、zoom、
  spanPx、viewScale、蒙层参数）；null 表示 overlay 未激活。
- **帧渲染 opts**（`buildFrameOpts()`）：renderFrame 的全部参数快照，让 MP4 逐帧渲染与
  DOM 解耦；其中 `proj` 是预先算好的投影结果，逐帧复用。
- **时间轴索引**（`buildTimeIndex()`）：`{ anchorTimes, anchorLens, totalLen, startMs, endMs,
  droppedCount }`。带时间戳的点构成 `(时刻, 累计弧长)` 锚点序列，时刻与进度的双向换算都在
  它上面插值。弧长用墨卡托平面距离，与画布像素弧长同度量。
- **导出计划**（`resolveExportPlan()`）：一次导出的全部决策快照（模式、帧数、码率、
  时长上限、产物名、时间窗口），让「导出什么」与「怎么编码」分家。

## 模块地图

分层与依赖方向见 [PATTERNS.md](PATTERNS.md)。39 个模块，每个 200 行以内。

| 模块 | 职责 |
|---|---|
| `index.html` | HTML 结构骨架：六条样式 `<link>` + 第三方库与 module 入口两条 `<script>` |
| `styles/` | `tokens` · `base` · `layout` · `forms` · `components` · `color-picker` 六份，按 `<link>` 顺序层叠 |
| `src/main.mjs` | 装配入口：import、事件绑定、首屏初始化 |
| `src/state.mjs` | 跨层共享的可变状态（轨迹文件与派生点、预览进度、底图待刷新标记）与 `CARD_SIZE` |
| `src/dom.mjs` | `$` 取元素 |
| `src/core/geo.mjs` | 墨卡托投影、Catmull-Rom 平滑、画布投影、总里程、沿弧长的进度插值 |
| `src/core/gcj02.mjs` | WGS84 → GCJ-02（国测局公式） |
| `src/core/amap.mjs` | 高德静图的像素换算、取景计算、URL 构造、轨迹与底图对齐 |
| `src/core/metrics.mjs` | 时长、均速、配速、爬升与其格式化 |
| `src/core/color.mjs` | HEX / RGB / HSL / HSV 互转 |
| `src/core/track-files.mjs` | 多文件首尾拼接、列表重排 |
| `src/core/export-params.mjs` | 定位点几何 `dotGeometry`、时长夹取 `clampMp4Duration`、画质码率表、体积估算与格式化 |
| `src/core/track-time.mjs` | 轨迹时间轴：时间范围、时间索引、时刻↔进度双向换算 |
| `src/core/export-meta.mjs` | 时间真实产物的文件名编码与 sidecar 字段（跨 repo 契约） |
| `src/parse/` | `index` 按扩展名分派 → `fit` · `geojson` · `csv` · `xml`（GPX/TCX/KML，依赖 DOMParser） |
| `src/basemap/` | `diagnose` 高德错误码翻译 · `image` Blob 与 URL 两条解码路径 · `fetch` 取图与内存缓存 |
| `src/render/` | `primitives` 描边与标记 · `card` renderCard 与 renderFrame · `dot` 定位点 |
| `src/export/` | `status` 产物切换与状态条 · `png` 卡片与定位点下载 · `mp4` WebCodecs 编码管线 · `mp4-sink` 流式/内存两条产物出口 · `mp4-opts` 帧参数与预投影 · `mp4-plan` 导出决策 |
| `src/ui/` | `preview` 重绘编排与动画播放 · `map-panel` 底图交互 · `track-panel` 轨迹列表 · `track-errors` 失败提示与撤销 · `controls` 滑杆联动 · `time-mode` 时间真实模式状态与联动 · `color-picker/` 四个模块 |
| `vendor/mp4-muxer.js` | 第三方 MP4 封装库，classic script 挂 `window.Mp4Muxer` |
| `tests/unit/` | core 与 parse 纯逻辑的单测 |
| `tests/visible/`、`tests/hidden/` | harness 盲测（实现 agent 只见 hidden 跑分） |
| `tests/helpers/source.mjs` | UI 测试的取材单一入口 |
