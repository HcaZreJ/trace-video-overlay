# Feature: 全程动画 MP4 导出（从头渲染到尾）

> 本 plan 已完成，作为设计记录保留。仓库现为按层分模块的多文件结构，
> 代码位置与仓库级规则以 [AGENTS.md](../../AGENTS.md) 与 [PATTERNS.md](../../PATTERNS.md) 为准。

## Overview
在现有透明 PNG 素材之外，新增一个导出：把整条骑行轨迹渲染成一段 **MP4 视频**，
定位点从起点沿线路走到终点，用户拖进剪辑软件即可当动态贴图。区别于 PNG 方案（用户自己打关键帧），
本方案由 app 一次性渲染完整动画。

## Intent Brief
- Goal：一键导出「定位点从头走到尾」的 MP4 动画片段。
- Motivation：PNG 方案要在剪映里手动打关键帧；有些场景想要拖进去即用的成品动画。
- Known context：
  - MP4（H.264）**不带 alpha 透明通道**，所以背景必须是不透明色或绿幕。
  - 剪映支持不透明画中画（矩形/圆角卡片）与绿幕色度抠图。
  - 现有 `renderCard` 已能画「某一进度下的卡片」——把它参数化成「渲染到轨迹第 t 比例」即可逐帧生成。
  - `projectTrack(points,size)` 返回已 smooth 到 ~500 点的屏幕坐标数组，逐帧沿其弧长插值即得匀速定位点。
- Constraints：纯前端、无网络运行时、无 build 步骤；编码库以单文件本地 vendor 进 repo（提交进仓库，运行时不走 CDN/npm）。
- Non-goals：透明 MP4、音频轨、服务端编码、轨迹渐进画出（B2）。
- Success criteria：载入轨迹 → 设定时长/帧率/分辨率/背景 → 点击导出 → 下载一个可在剪映导入并正常播放的 .mp4，
  其中定位点从起点平滑移动到终点。

## Alignment Gate
- I will implement：进度参数化渲染、逐帧 H.264 编码、MP4 封装、时长/帧率/分辨率/背景模式选项、导出进度 UI。
- I will not implement：透明 MP4、音频轨、服务端编码、轨迹渐进画出。
- Acceptance：sample-ride.gpx 导出 MP4，ffprobe 验证为有效 H.264、帧数=时长×帧率、分辨率正确；
  首帧定位点在起点、末帧在终点；剪映能导入播放。

## Assumption Ledger（决策已确认）
| 决策 | 取值 | Status |
|---|---|---|
| A · 背景处理 | 两者都做：默认**不透明卡片**（半透明卡片底叠在纯色背景上），另提供**绿幕**选项 | confirmed |
| B · 动画形态 | 只做**全线常显 + 定位点移动**（B1） | confirmed |
| 编码方案 | WebCodecs `VideoEncoder`（H.264）逐帧编码 + **vendored mp4-muxer**（单文件，提交进 repo） | confirmed |
| 默认参数 | 时长默认 6s（可调）、fps 30、分辨率 1080×1080（可选 720/1080/1440） | confirmed |

## 设计决定
**背景（A）**：
- 卡片模式（默认）：整帧先填不透明背景色（用户可选，默认页面深色），再在其上叠半透明圆角卡片底 + 线路 + 标记 + 定位点。整帧不透明，圆角卡片浮在纯色上，当矩形画中画。
- 绿幕模式：整帧填不透明纯绿（用户可选绿色），其上直接画线路 + 标记 + 定位点（不画卡片半透明底），供剪映色度抠图。

**动画（B）**：整条线路始终完整显示，仅定位点沿轨迹从起点匀速移动到终点。

## 技术选型
- **编码**：`WebCodecs` `VideoEncoder`，codec `avc1.42001f`（H.264 baseline，按分辨率选 level），逐帧 `VideoFrame`(from canvas) → `encode` → `mp4-muxer` `addVideoChunk`，末尾 `flush` + `finalize` 得 MP4 Blob 下载。
- **muxer**：vendor `mp4-muxer` UMD 单文件到 repo 根，`<script src>` 引入挂全局 `Mp4Muxer`，配合现有普通 `<script>`。
- **匀速**：每帧 `progress=i/(frames-1)`，用 `pointAtProgress(proj.points, progress)` 沿累计弧长插值出定位点屏幕坐标。
- **支持检测**：`'VideoEncoder' in window` 且 `VideoEncoder.isConfigSupported` 通过，否则禁用按钮 + 提示换 Chrome/Edge 或新版 Safari。
- **体验**：编码期间显示进度条，逐帧间 `await` 让出主线程避免卡 UI。

## Work-Unit Specs
- id: T1
  title: 沿弧长匀速插值定位点（纯几何，可 node 测）
  file_path: core.mjs（并在 index.html 内联同步）
  functions:
    - name: pointAtProgress
      inputs: [ "points: Array<{x:number,y:number}>（投影后屏幕坐标，projectTrack 输出）", "progress: number" ]
      outputs: "{x:number, y:number}（新对象），空数组返回 null"
      behavioral_contract: |
        沿相邻点线段的累计弧长匀速插值。
        - points 为空 → 返回 null。
        - points 单点 → 返回该点的 {x,y}（值拷贝）。
        - progress ≤ 0 → 返回起点 {x,y}；progress ≥ 1 → 返回终点 {x,y}。
        - 0<progress<1：total=Σ 段长；target=total×progress；沿段累加定位到 target 落入的段 [i,i+1]，
          段内比例 f=(target−已累计)/段长，返回线性插值点 {x:xi+(xi1−xi)f, y:yi+(yi1−yi)f}。
        - total=0（所有点重合）→ 返回起点 {x,y}。
      error_cases:
        - { condition: "points 为空数组", behavior: "返回 null" }
        - { condition: "points 只有 1 个点", behavior: "返回该点 {x,y} 拷贝" }
        - { condition: "含零长段（相邻点重合）", behavior: "跳过零长段，不影响插值定位，不产生 NaN" }
        - { condition: "progress 为负 / >1", behavior: "clamp 到起点 / 终点" }
  dependencies: []
  reuse_candidates: |
    core.mjs 已有 trackDistanceKm（Haversine，作用于经纬度点，非屏幕坐标），不复用；
    本函数作用于 projectTrack 输出的平面屏幕坐标，用平面欧氏距离，新写。
  acceptance: |
    node --test 全绿；给 progress=0/0.5/1 分别得起点/弧长中点/终点，含零长段不产生 NaN。

- id: T2
  title: renderFrame 逐帧渲染（背景模式 + 移动定位点）
  file_path: index.html
  functions:
    - name: renderFrame
      inputs: [ "ctx: CanvasRenderingContext2D（画布已设 width=height=size）", "size: number", "progress: number", "opts: 样式与背景对象" ]
      outputs: "无（在 ctx 上绘制一帧）"
      behavioral_contract: |
        复用 renderCard 的投影/画线/标记逻辑，参数化为逐帧：
        - opts.bgMode==='card'：ctx 填满不透明 opts.pageColor；再叠半透明圆角卡片底（opts.bgColor/opts.bgOpacity/opts.radius）。
        - opts.bgMode==='green'：ctx 填满不透明 opts.greenColor；不画卡片底。
        - 两模式都画：线路（strokePath, opts.lineColor/lineWidth）、起终点标记（若 opts.showMarkers）。
        - 在 pointAtProgress(proj.points, progress) 处画定位点（复用 renderDot 白环+彩色心+阴影风格，opts.dotColor/dotSize，按 size 缩放）。
        - 所有尺寸随 size 相对 CARD_SIZE 缩放，1080 与 600 视觉一致。
  dependencies: [T1]
  reuse_candidates: |
    直接复用 renderCard 的 clip/fill/projectTrack/strokePath/drawMarker、renderDot 的圆点画法；
    抽取共用绘制，避免与 renderCard 重复逻辑漂移。
  acceptance: |
    浏览器实测：载入 sample-ride.gpx，renderFrame 到 progress=0/0.5/1 分别在起点/中段/终点画出定位点，
    卡片模式整帧不透明、绿幕模式整帧纯绿。

- id: T3
  title: vendor mp4-muxer + WebCodecs 编码 + 导出 UI/进度/下载
  file_path: index.html（+ 新增 vendored muxer 单文件）
  内容: |
    - vendor mp4-muxer UMD 单文件到 repo 根，index.html 引入。
    - 新增导出面板控件：时长(s，默认6)、帧率(默认30)、分辨率(720/1080/1440，默认1080)、
      背景模式(卡片/绿幕)、卡片背景色/绿幕色、导出按钮、进度条。
    - 支持检测：不支持 WebCodecs H.264 时禁用导出按钮并提示。
    - 导出流程：建 offscreen canvas(size×size) → 配置 VideoEncoder(avc1, fps, bitrate) + Mp4Muxer(ArrayBufferTarget, avc) →
      循环 frames=round(duration×fps)：renderFrame(offCtx,size,i/(frames-1),opts) → new VideoFrame(canvas,{timestamp:i*1e6/fps}) →
      encoder.encode(frame,{keyFrame: i%fps===0}) → frame.close() → 更新进度 → await 让出 →
      encoder.flush() → muxer.finalize() → Blob(video/mp4) → 下载「轨迹动画.mp4」。
    - 编码期间禁用按钮，结束/出错恢复并给反馈。
  dependencies: [T2]
  reuse_candidates: |
    复用 T2 renderFrame 做每帧位图源；复用现有 download() 思路做 Blob 下载；
    复用现有控件读取与 bind() 联动模式加导出参数控件。
  acceptance: |
    浏览器实测：sample-ride.gpx 导出 .mp4；ffprobe 验证为 H.264、分辨率与所选一致、帧数=round(时长×帧率)；
    首帧定位点在起点、末帧在终点；控制台无错、无内存崩溃；剪映可导入播放。

## Dependency Graph
T1 → T2 → T3

## Execution Waves
- Wave 1：T1（纯几何，test-first 盲测流程）
- Wave 2：T2（依赖 T1，改 index.html）
- Wave 3：T3（依赖 T2，改 index.html；与 T2 同文件，串行）

## 测试与验收策略
- T1 是纯函数，走 test-first 盲测：`@test-author` 从 spec 写 visible+hidden 测试（node:test，作用于构造的屏幕坐标数组）→ 架构师审 → `@function-implementer` 实现，只见 `PASSED: X/Y`。
- T2/T3 是浏览器 canvas / WebCodecs 运行时代码，现有 `node --test` 基础设施覆盖不到；由 `@function-implementer` 按 spec 实现，架构师起本地 http server + Chrome 实测 + ffprobe 验证导出的 MP4 验收。

## Status
Completed
