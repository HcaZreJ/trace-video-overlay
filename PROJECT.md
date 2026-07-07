# PROJECT

## 目的
把一次骑行的轨迹文件（GPX / KML / TCX / FIT / GeoJSON / CSV）渲染成视频剪辑用的素材：
透明 PNG 贴图、定位点 PNG、或一键 MP4 动画，专为剪映等剪辑软件的画中画场景设计。
在线使用：https://hcazrej.github.io/trace-video-overlay/

## 功能清单与状态
| 功能 | 状态 |
|---|---|
| 多格式轨迹解析（GPX/KML/TCX/FIT/GeoJSON/CSV） | 已上线 |
| 多轨迹文件首尾相连（列表重排 + 拼接） | 已上线 |
| 透明卡片 PNG 导出（分辨率 720/1080/1440 与 MP4 共用，样式可调） | 已上线 |
| 定位点（卡片预览实时叠加显示比例；预览区右键另存高清 PNG） | 已上线 |
| MP4 动画导出（WebCodecs + vendored mp4-muxer，720/1080/1440） | 已上线 |
| 地图底图 overlay（高德静图，自动像素级对齐 + 取景缩放） | 已上线 |

## 核心 Data Model
- **轨迹点数组** `[{ lng, lat, ele?, time? }]`——所有解析器的统一输出、所有投影/渲染的统一输入。
- **投影结果** `{ points: [{x,y}], fullSize }`——`projectTrack`（自适应 bbox）与
  `projectTrackOnAmap`（底图对齐）输出同构，渲染层无缝切换。
- **`window.mapOverlayState`**——地图 overlay 的运行时状态（底图 Image、center、zoom、
  spanPx、viewScale、蒙层参数）；null 表示 overlay 未激活。
- **帧渲染 opts**（`buildFrameOpts()`）——renderFrame 的全部参数快照，MP4 逐帧渲染与
  DOM 解耦。

## 模块地图
| 模块 | 职责 |
|---|---|
| `core.mjs` | 纯函数权威实现：墨卡托投影、GCJ-02 转换、高德静图参数/对齐数学、轨迹平滑/拼接/指标、GeoJSON/文本坐标提取、进度插值 |
| `fit.mjs` | FIT 二进制解析 |
| `index.html` | 全部 UI、文件载入、Canvas 渲染（renderCard/renderDot/renderFrame）、高德底图 fetch、MP4 导出管线；内联持有 core.mjs 逻辑的同步副本 |
| `mp4-muxer.js` | vendored MP4 封装库 |
| `tests/` | harness 盲测（visible/hidden 分离） |
