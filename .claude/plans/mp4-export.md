# Feature: 全程动画 MP4 导出（从头渲染到尾）

## Overview
在现有透明 PNG 素材之外，新增一个导出：把整条骑行轨迹渲染成一段 **MP4 视频**，
定位点从起点沿线路走到终点，用户拖进剪辑软件即可当动态贴图。区别于 PNG 方案（用户自己打关键帧），
本方案由 app 一次性渲染完整动画。

## Intent Brief
- Goal：一键导出「定位点从头走到尾」的 MP4 动画片段。
- Motivation：PNG 方案要在剪映里手动打关键帧；有些场景想要拖进去即用的成品动画。
- Known context：
  - MP4（H.264/H.265）**不带 alpha 透明通道**，所以背景必须是不透明色或绿幕。
  - 剪映不支持透明视频，但支持不透明画中画（矩形/圆角卡片）与绿幕色度抠图。
  - 现有 `renderCard` 已能画「某一进度下的卡片」——把它参数化成「渲染到轨迹第 t 比例」即可逐帧生成。
- Constraints：纯前端、无网络、无 build 步骤；编码库需可作为单文件本地 vendor 进 repo，不走 CDN/npm 运行时。
- Non-goals：不做透明 MP4（技术不可行）、不做音频、不做服务端渲染。
- Success criteria：载入轨迹 → 设定时长/帧率 → 点击导出 → 下载一个可在剪映导入并正常播放的 .mp4，
  其中定位点从起点平滑移动到终点。
- Assumptions & Open Questions：见 Ledger（含需 kickoff 时确认的高影响决策）。

## Alignment Gate
- I will implement：进度参数化渲染、逐帧编码为 H.264、封装 MP4、时长/帧率/分辨率选项、导出进度 UI。
- I will not implement：透明 MP4、音频轨、服务端编码。
- Open assumptions：见 Ledger 的 Open Questions，kickoff 必须先与用户确认再实现。
- Acceptance：sample-ride.gpx 导出 MP4，剪映能导入播放，点从头走到尾；控制台无错、无内存崩溃。

## Assumption Ledger
| Assumption / Open Question | Confidence | Impact if Wrong | Status |
|---|---:|---:|---|
| 背景处理方式（见下「关键决策 A」） | low | high | **kickoff 必问用户** |
| 动画形态：轨迹渐进"画出" vs 全线常显+点移动（见「关键决策 B」） | low | medium | **kickoff 必问用户** |
| 编码用 WebCodecs H.264 + vendored mp4-muxer 单文件（见「技术选型」） | medium | high | 待验证浏览器支持 + 库可本地 vendor |
| 默认参数：时长可调（默认 6s）、fps 30、分辨率 1080×1080 | medium | low | 建议默认，用户可改 |

## 关键决策（kickoff 必问）
**A · MP4 背景怎么处理**（因 MP4 无透明）：
- 选项 A1：**不透明卡片**——半透明底叠在一个用户选的纯色背景上（如深色卡片），当不透明角落贴图。最省事、无抠图、边缘干净。
- 选项 A2：**绿幕**——纯绿背景，用户在剪映色度抠图。可"透明"浮在素材上，但细线/小点可能有绿边。
- 建议默认 A1，同时提供 A2 作为选项。

**B · 动画形态**：
- B1：全程线路常显，仅定位点移动。
- B2：线路随定位点"渐进画出"（走过的部分才显示），更有"轨迹生长"感。
- 建议做成开关，默认 B1。

## 技术选型（供实现 agent 落地，kickoff 后确认）
- **编码**：优先 `WebCodecs` 的 `VideoEncoder`（`avc`/H.264）逐帧编码，配合 **vendored `mp4-muxer`**（单文件 ESM，随 repo 提交，不走网络）封装成 .mp4。
  - 需先做可行性验证：目标浏览器 `VideoEncoder.isConfigSupported({codec:'avc1.42001f'})` 返回支持；mp4-muxer 能以本地文件形式引入本 app 的自包含结构。
- **回退考量**：`MediaRecorder` 只稳定产 WebM（非 MP4），不满足需求；`ffmpeg.wasm` 体积大、慢，作为最后手段。
- **逐帧流程**：把 `renderCard` 抽成 `renderFrame(ctx, size, progress∈[0,1], mode)`；按 `frames = duration*fps` 循环，
  每帧算 `progress`，用 `smoothTrack` 采样出该进度下的定位点坐标（沿累计弧长插值，保证匀速），编码入队，最后 flush 封装下载。
- **性能/体验**：编码期间显示进度条；大分辨率/长时长时避免卡 UI（可考虑 `requestAnimationFrame` 分片或 OffscreenCanvas）。

## Work-Unit Specs
- id: V1
  title: 进度参数化逐帧渲染
  file_path: index.html
  内容：把卡片渲染抽成 `renderFrame(ctx,size,progress,opts)`；按累计弧长沿轨迹插值出 progress 处的定位点；
        支持 A1/A2 背景、B1/B2 动画形态。
  dependencies: []
  acceptance：给定 progress=0/0.5/1 渲染出起点/中点/终点位置正确的帧。

- id: V2
  title: H.264 编码 + MP4 封装 + 导出 UI
  file_path: index.html
  内容：vendor mp4-muxer；WebCodecs 逐帧编码；时长/fps/分辨率/背景模式/动画形态选项；进度条；下载 .mp4。
  dependencies: [V1]
  acceptance：sample-ride.gpx 导出可在剪映播放的 mp4，点从头走到尾。

## Dependency Graph
V1 → V2

## Execution Waves
Wave 1：V1
Wave 2：V2（deps: V1）

## Status
Not Started
