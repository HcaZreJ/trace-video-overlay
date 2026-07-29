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
  DOM 解耦。

## 模块地图
| 模块 | 职责 |
|---|---|
| `core.mjs` | 纯函数权威实现：墨卡托投影、GCJ-02 转换、高德静图参数与对齐数学、轨迹平滑 / 拼接 / 指标、GeoJSON 与文本坐标提取、进度插值、定位点几何（dotGeometry）、MP4 参数合法化（clampMp4Duration） |
| `fit.mjs` | FIT 二进制解析 |
| `index.html` | 工作台 UI（sticky 预览舞台 + 三步流程的控件列 + 吸底导出条）、文件载入与撤销、Canvas 渲染（renderCard / renderDot / renderFrame）、动画预览播放、高德底图 fetch 与错误诊断、MP4 导出管线（含取消与关页拦截）；内联持有 core.mjs 逻辑的同步副本 |
| `mp4-muxer.js` | vendored MP4 封装库 |
| `tests/` | harness 盲测（visible / hidden 分离） |
