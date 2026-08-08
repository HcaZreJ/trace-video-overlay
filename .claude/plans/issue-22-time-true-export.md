# Feature: 时间真实（time-true）模式导出 — GitHub issue #22

## Overview（背景与为什么做）
本工具当初的存在理由：导出轨迹素材（PNG / 匀速小圆点 MP4），供用户在剪映里**手动**把轨迹和实拍骑行素材对齐。这个手动场景已被姊妹 repo **roughcut**（`~/Documents/roughcut`，AI 骑行 POV 粗剪工具）自动化取代：roughcut 用「素材文件名里的拍摄时刻 + FIT 点时间戳」为每个镜头段算出全程进度区间（`align_trail.py`），再把本工具导出的**按距离匀速**动画裁段、重定时后叠进成片小屏（`render_pip.py`）。

匀速动画在那条链路里只能靠「按进度裁段 + setpts 重定时」间接使用，段内速度被线性平均。**issue #22 让导出素材本身按真实时间走**——本工具由此升级为「时间真实轨迹素材源」：roughcut 可去掉重定时环节、段内速度变真实；直接拖进任何 NLE 也天然对轨。

## 需求（同 https://github.com/HcaZreJ/trace-video-overlay/issues/22）
- 位置点按轨迹点时间戳插值移动（FIT/GPX 都带时间，src/parse 已解出），不再按距离匀速；
- 可指定导出的起止时刻与时间缩放（默认 1s 视频 = 1s 真实时间）；
- 多段轨迹拼接时保持各段真实时间间隔（或提供折叠间隔的选项）；
- 停留段（时间流逝、里程不变）位置点应静止不动。

## 跨 repo 消费契约（roughcut 需要什么）
导出的 MP4 满足：**动画第 x 秒的画面 = 真实时刻 `t0 + x × scale` 的位置**，且用户导出时能看到并记下 `t0`（epoch 或 ISO 字符串）与 `scale`。roughcut 的 `render_pip.py` 届时按 wall-time 直接裁剪对应窗口，无需 progress 重定时（其升级 plan 见 roughcut repo `.claude/plans/pip-time-true-upgrade.md`）。

契约的物理载体：MP4 文件名编码 `_t<epochSec>_s<scale>`，外加同名 `.json` sidecar 记录完整参数。roughcut 读 sidecar 的 `t0Epoch` 与 `scale` 即可，文件名是人眼可读的冗余备份。

## Intent Brief

**Goal** — MP4 导出新增「按真实时间」模式：帧序号经真实时刻换算成轨迹进度，导出的视频满足 `第 x 秒画面 = 真实时刻 t0 + x×scale 的位置`；同时交付 roughcut 消费该视频所需的 `t0`/`scale` 元数据。

**Motivation** — roughcut 的 `render_pip.py` 现在必须按 progress 裁段并 setpts 重定时，段内速度被线性平均。素材本身时间真实后，该环节整体退役。

**Known context（repo 实证）**
- 时间戳数据齐备：`src/parse/xml.mjs` 解 GPX `<time>`、TCX `<Time>`、KML `<when>`；`src/parse/fit.mjs` 解 FIT field 253 为毫秒 epoch。GeoJSON / CSV 两个解析器不产出 `time`。
- 渲染链路：`帧序号 → progress(0..1) → pointAtProgress(屏幕点数组, progress)`。`pointAtProgress` 按**画布像素弧长**匀速插值。
- 画布坐标是墨卡托坐标的**等比仿射**：`projectTrack` 中 x/y 共用同一缩放因子 `fullSize/(2*half)`；`projectTrackOnAmap` 中为 `k`。因此「墨卡托平面弧长比例」严格等于「画布像素弧长比例」。
- `smoothTrack(points, 500)`：点数 ≥ 500 时原样返回，屏幕点与原始点一一对应。
- 验证数据 `~/Desktop/trails/淀山湖/淀山湖.fit` 实测：8995 点全部带时间、1Hz 采样、时间严格单调无倒退、跨度 9854 秒（2.74 小时）；含 5 处 >5 秒的记录缺口（最大 377 秒），即 Garmin 自动暂停记下的停留段。
- MP4 管线：`ArrayBufferTarget` + `fastStart:'in-memory'` 全内存封装；`clampMp4Duration` 上限 600 秒；码率表 `{720:6e6, 1080:12e6, 1440:20e6}`。
- `vendor/mp4-muxer.js` 已含 `StreamTarget` 与 `FileSystemWritableFileStreamTarget`，流式写盘零新依赖。

**Constraints**
- 零依赖、无 build、无 npm（GitHub Pages 从 `main` 根目录直接托管）。
- 单个 `.mjs` 200 行以内；纯函数进 `src/core/` 并配 `node:test`。
- `renderCard` 与 `renderFrame` 渲染同构，改一个同步另一个。
- 匀速模式的现有行为、默认值、产物完全不变。

**Non-goals**
- 不改 roughcut（其升级由该 repo 自己的 plan 承担）。
- 不为 GeoJSON / CSV 补时间戳解析。
- 不做停留段的特殊吸附：记录缺口两端位置几乎重合，线性插值的位移是亚像素量级；若缺口源于信号丢失，线性插值反而是正确近似。
- 不改 PNG 导出。

**Success criteria**
- 给定 `淀山湖.fit`，时间真实模式导出的动画在任意时刻 x 的定位点位置，等于该 FIT 在 `t0 + x` 时刻的插值位置（相机时钟比 GPS 快 28 秒，核验时按 `--offset=-28` 折算）。
- 全程 scale=1（9854 秒）能一次导完，浏览器不 OOM。
- sidecar JSON 的 `t0Epoch` / `scale` 足以让 roughcut 按 wall-time 裁剪。
- `node --test 'tests/**/*.test.mjs'` 全绿。

**Assumptions / Unknowns** — 见 Assumption Ledger。

## Alignment Gate

**I will implement**
- 「按距离匀速 / 按真实时间」模式切换，默认停在匀速（现有行为不变）；轨迹不带时间戳时「按真实时间」不可选并给出原因。
- 时间真实模式的参数：起止时刻（默认全程）、时间缩放 scale（默认 1）、多文件段间空隙折叠开关（仅多文件时出现）。
- 「画质：高 / 中 / 低」选项，两种模式通用，默认「高」= 现有码率；旁边实时显示预计文件大小。
- 流式写盘导出（`showSaveFilePicker` + `FileSystemWritableFileStreamTarget`），不支持该 API 的浏览器回退现有内存路径并保留 600 秒上限。
- 文件名编码 `_t<epochSec>_s<scale>` + 同名 `.json` sidecar。
- 逐帧投影缓存：导出前把轨迹投影算一次并放进帧参数，逐帧不再重算。
- 扫拨条在时间真实模式下显示真实时刻，播放按真实时间轴走。
- 长导出的剩余时间估算显示。

**I will not implement**
- roughcut 侧任何改动。
- GeoJSON / CSV 的时间戳解析。
- 停留段吸附、时间戳平滑、GPS 噪声抑制。
- 匀速模式行为、默认值、产物的任何改变。

**Open assumptions** — Ledger 中 Status 非 `resolved` 的行。

**Acceptance** — 见 Success criteria 与各 work-unit 的 `acceptance`。

## Assumption Ledger

| Assumption | Confidence | Impact if Wrong | Status |
|---|---:|---:|---|
| 导出管线走「流式写盘为主 + 内存回退」 | high | high | resolved（用户 2026-08-08 选定） |
| t0/scale 经「文件名编码 + sidecar JSON」交付 | high | high | resolved（用户 2026-08-08 选定） |
| 画质做成用户可选的三档，不自动降 | high | medium | resolved（用户 2026-08-08 选定，推翻先前的自动降码率倾向） |
| 画质默认「高」以保持匀速模式现有产物不变，靠预计文件大小提示引导用户在长导出时下调 | medium | low | assumed |
| GCJ-02 偏移场在单次骑行尺度上近似平移，对弧长比例的影响可忽略（仅影响地图底图模式） | medium | low | assumed |
| 稀疏轨迹（<500 点）下 `smoothTrack` 重采样引入的弧长比例偏差可接受 | medium | low | assumed；骑行 FIT/GPX 普遍数千点，不触发 |
| `fastStart:false`（moov 写在文件末尾）不影响 roughcut 的 ffmpeg 消费 | high | medium | assumed；ffmpeg 读本地文件可 seek |
| 段间空隙「折叠」的语义是压到 0（段尾接段头），而非压到某个固定秒数 | medium | low | assumed |

## 关键技术决策

### 度量一致性（正确性的根）
`progressAtTime` 返回的 progress 要喂给 `pointAtProgress`，后者按**画布像素弧长**插值。因此累计弧长必须用**墨卡托平面距离**（`mercatorX/mercatorY` 之差的欧氏距离）累加，**不用** Haversine 大圆距离。理由：画布坐标是墨卡托坐标的等比仿射变换，比例严格相等；Haversine 与墨卡托在纬度方向的尺度差会引入与纬度相关的漂移。

### 部分点缺时间戳
累计弧长对**全部**点计算（缺时间戳的点同样贡献弧长，因为它们同样出现在屏幕点数组里）。只把带有效时间戳的点收集成 `(timeMs, cumLen)` 锚点序列，换算时在锚点上二分插值。这样部分点缺时间不破坏比例。

### 停留段
停留期间相邻点弧长增量 ≈ 0，锚点序列里表现为 `cumLen` 不变而 `timeMs` 推进，插值结果自然静止。无需特殊分支。

### 长视频导出
- 流式：`showSaveFilePicker()` 取 `FileSystemFileHandle` → `createWritable()` → `Mp4Muxer.FileSystemWritableFileStreamTarget`，muxer 配 `fastStart:false`。时长上限放宽到 6 小时。
- 内存：`ArrayBufferTarget` + `fastStart:'in-memory'`，时长上限 600 秒（现状）。
- `showSaveFilePicker` 要求 user activation，必须在导出入口的**第一个 await 之前**调用；后续若因底图缺失中止，abort 掉已打开的 writable。

### 逐帧性能
9854 秒 @ 30fps = 295620 帧。逐帧重算 `projectTrack`（8995 点投影 + bbox 归约）是主要热点，导出前算一次放进帧参数，逐帧复用。

## Work-Unit Specs

```yaml
- id: T1
  title: 轨迹时间索引与时刻↔进度换算
  file_path: src/core/track-time.mjs        # 新建
  functions:
    - name: trackTimeRange
      inputs: [ "points: [{lng,lat,ele?,time?}]" ]
      outputs: "{ startMs, endMs, spanSec, anchorCount, totalCount } | null"
      behavioral_contract: |
        扫描 points，取带有效数值 time 的点。一个都没有、或 points 为空/非数组时返回 null。
        startMs/endMs 取有效时间戳的最小值与最大值；spanSec = (endMs-startMs)/1000；
        anchorCount = 带有效时间戳的点数；totalCount = points.length。
        仅有一个带时间戳的点时返回 spanSec === 0 的对象（不是 null）。
      error_cases:
        - { condition: "points 非数组", behavior: "返回 null（不抛）" }

    - name: buildTimeIndex
      inputs:
        - "points: [{lng,lat,ele?,time?}]"
        - "opts?: { segmentStarts?: number[], collapseSegmentGaps?: boolean }"
      outputs: "{ anchorTimes: number[], anchorLens: number[], totalLen: number, startMs, endMs, droppedCount } | null"
      behavioral_contract: |
        第一步：对全部点按顺序累加**墨卡托平面距离**得到 cumLen[i]（cumLen[0]=0），
        距离 = hypot(mercatorX(b.lng)-mercatorX(a.lng), mercatorY(b.lat)-mercatorY(a.lat))。
        totalLen = cumLen[n-1]。
        第二步：遍历所有点，把 typeof time === 'number' && Number.isFinite(time) 的点
        收集成锚点 (time, cumLen[i])，按索引顺序。
        第三步：强制时间严格递增——保留第一个锚点，之后任何 time <= 前一个保留锚点的 time 的
        锚点被丢弃，droppedCount 累加。
        opts.segmentStarts（各文件在拼接数组里的起始索引，首个为 0）配合
        opts.collapseSegmentGaps === true 时：对每个 segment 边界，令该段首锚点时间等于
        上一段末锚点时间 **加 1 毫秒**，该段及其后所有锚点时间整体平移同一偏移量；
        平移在第三步之前完成，逐个边界累积。取 +1ms 而非相等，是为了让平移后的锚点仍严格
        递增：锚点一个不丢，droppedCount 只反映数据自身的时间乱序，跨段跳跃在 1 毫秒内完成
        （30fps 下远小于一帧，呈现为瞬移），段内速度保持真实。
        collapseSegmentGaps 为 false 或 segmentStarts 缺失时不做平移。
        锚点数 < 2 时返回 null（无法构成时间轴）。
        startMs/endMs = 首/末锚点时间（折叠后的值）。
      error_cases:
        - { condition: "points 为空/非数组/长度<2", behavior: "返回 null" }
        - { condition: "无任何有效时间戳，或有效锚点去重后 <2 个", behavior: "返回 null" }
        - { condition: "totalLen === 0（全部点重合）", behavior: "正常返回，totalLen 为 0" }

    - name: progressAtTime
      inputs: [ "index: buildTimeIndex 的返回值", "tMs: number" ]
      outputs: "number ∈ [0,1]"
      behavioral_contract: |
        index 为 null 或 index.totalLen === 0 时返回 0——这条**优先于**下面的边界规则，
        零长度轨迹缩成一个点，任何时刻都指向它。
        tMs <= index.startMs 返回 0；tMs >= index.endMs 返回 1。
        否则在 anchorTimes 上二分定位区间 [k, k+1]，
        f = (tMs - anchorTimes[k]) / (anchorTimes[k+1] - anchorTimes[k])，
        len = anchorLens[k] + f * (anchorLens[k+1] - anchorLens[k])，
        返回 len / totalLen，并 clamp 进 [0,1]。
        停留段（anchorLens[k] === anchorLens[k+1]）自然返回恒定值。
      error_cases:
        - { condition: "tMs 非有限数", behavior: "返回 0" }

    - name: timeAtProgress
      inputs: [ "index: buildTimeIndex 的返回值", "progress: number" ]
      outputs: "number（毫秒 epoch）| null"
      behavioral_contract: |
        progressAtTime 在同一 (time, len) 折线上的逆运算，供界面把扫拨条位置显示成真实时刻。
        index 为 null 返回 null。
        totalLen === 0 时返回 startMs——这条**优先于**下面的边界规则，零长度轨迹缩成
        一个点，任何进度都指向它。
        progress <= 0 返回 startMs；>= 1 返回 endMs。
        目标 len = progress * totalLen，在 anchorLens 上二分定位区间后线性插值出时间。
        anchorLens 在停留段上是平台（多值），约定返回该平台**最早**的时间。
      error_cases:
        - { condition: "progress 非有限数", behavior: "返回 startMs（index 非 null 时）或 null" }
  dependencies: []
  reuse_candidates: |
    搜过 src/core/：geo.mjs 有 mercatorX/mercatorY（直接 import 复用）与 trackDistanceKm
    （Haversine，度量不匹配，不复用）；metrics.mjs 的 trackDurationSec 是「运动时长」
    （跳过低速段），语义与本单元的 wall-clock 时间轴不同，不复用。无现成的时间轴索引实现。
  acceptance: |
    tests/visible + tests/hidden 全绿。含关键断言：停留段（时间推进、坐标不变）progress 恒定；
    部分点缺时间戳时比例正确；时间倒退的锚点被丢弃且 droppedCount 正确；
    progressAtTime 与 timeAtProgress 互为逆（停留段平台除外）。

- id: T2
  title: 导出参数：时长上限参数化、画质码率、体积估算
  file_path: src/core/export-params.mjs      # 改（现有 dotGeometry / clampMp4Duration 保持）
  functions:
    - name: clampMp4Duration
      inputs: [ "value: number", "maxSec?: number" ]
      outputs: "number"
      behavioral_contract: |
        maxSec 省略时为 600（现有行为逐字保持：非有限数回 6，否则 clamp 进 [1,600]）。
        传入 maxSec 时上限改用 maxSec，下限仍为 1，非法输入仍回 6。
        maxSec 非有限数或 <1 时按 600 处理。
      error_cases:
        - { condition: "value 非数值/非有限", behavior: "返回 6" }
    - name: mp4Bitrate
      inputs: [ "size: 720|1080|1440", "quality: 'high'|'medium'|'low'" ]
      outputs: "number（bps）"
      behavioral_contract: |
        查表返回：high = {720:6e6, 1080:12e6, 1440:20e6}（与现有码率逐值相同）；
        medium = {720:3e6, 1080:6e6, 1440:10e6}；low = {720:1.5e6, 1080:3e6, 1440:5e6}。
        size 不在表内时按 1080 那一列取值；quality 不在三档内时按 'high'。
      error_cases:
        - { condition: "size 或 quality 缺省/非法", behavior: "各自回落到 1080 / 'high'，不抛" }
    - name: estimateMp4Bytes
      inputs: [ "durationSec: number", "bitrate: number" ]
      outputs: "number（字节）"
      behavioral_contract: "durationSec * bitrate / 8，向上取整。任一入参非有限数或为负时返回 0。"
    - name: formatByteSize
      inputs: [ "bytes: number" ]
      outputs: "string"
      behavioral_contract: |
        人类可读体积：<1024 字节用 'N B'；否则按 KB/MB/GB/TB 逐级换算（1024 进制），
        保留 1 位小数并去掉多余的 '.0'（如 '3.7 GB'、'512 MB'、'1 GB'）。
        非有限数或负数返回 '0 B'。
  dependencies: []
  reuse_candidates: |
    MP4_BITRATE 常量目前硬编码在 src/export/mp4.mjs 顶部，本单元把它提升成
    core 层的 mp4Bitrate 查表函数，mp4.mjs 侧的常量由 T9 移除并改为调用。
  acceptance: |
    tests/visible + tests/hidden 全绿；现有 tests/*/clampMp4Duration.test.mjs 不修改即通过
    （单参调用行为逐值不变）。

- id: T3
  title: 导出元数据：文件名编码与 sidecar
  file_path: src/core/export-meta.mjs        # 新建
  functions:
    - name: buildTimeTrueFilename
      inputs: [ "t0Ms: number", "scale: number", "ext: string" ]
      outputs: "string"
      behavioral_contract: |
        返回 `轨迹动画_t<epochSec>_s<scale>.<ext>`。
        epochSec = Math.floor(t0Ms/1000)。
        scale 用最短十进制表示：整数不带小数点（1 → 's1'），非整数去掉尾随零（2.50 → 's2.5'）。
        ext 不带前导点，调用方传 'mp4' 或 'json'。
      error_cases:
        - { condition: "t0Ms 非有限数", behavior: "抛 RangeError('buildTimeTrueFilename: t0Ms must be a finite number')" }
        - { condition: "scale 非有限数或 <= 0", behavior: "抛 RangeError('buildTimeTrueFilename: scale must be a positive finite number')" }
        - { condition: "ext 非非空字符串", behavior: "抛 TypeError('buildTimeTrueFilename: ext must be a non-empty string')" }
    - name: buildSidecarMeta
      inputs:
        - "{ t0Ms, scale, fps, durationSec, frames, resolution, quality, bitrate, trackStartMs, trackEndMs, sourceFiles, collapsedSegmentGaps }"
      outputs: "普通对象（可直接 JSON.stringify）"
      behavioral_contract: |
        产出跨 repo 契约载体，字段固定为：
        schema: 'trace-video-overlay/time-true-export@1'
        t0Epoch（秒，整数）、t0Iso（ISO 8601 字符串）、scale、fps、durationSec、frames、
        resolution、quality、bitrate、
        trackStartIso、trackEndIso（轨迹自身的完整时间范围，供人核对导出窗口是否截取过）、
        sourceFiles（字符串数组，按拼接顺序）、collapsedSegmentGaps（布尔）。
        缺省字段：sourceFiles 缺失时为 []；collapsedSegmentGaps 缺失时为 false；
        trackStartMs/trackEndMs 缺失时对应 Iso 字段为 null。
      error_cases:
        - { condition: "t0Ms 非有限数", behavior: "抛 RangeError('buildSidecarMeta: t0Ms must be a finite number')" }
        - { condition: "入参非对象", behavior: "抛 TypeError('buildSidecarMeta: meta must be an object')" }
  dependencies: []
  reuse_candidates: |
    搜过 src/export/：png.mjs 与 mp4.mjs 的下载文件名都是硬编码字符串字面量，
    无现成的文件名构造工具。sidecar 是本 issue 新引入的产物，无既有实现。
  acceptance: "tests/visible + tests/hidden 全绿；文件名与 sidecar 字段名逐字符匹配契约。"

- id: T4
  title: 界面结构：时间真实模式面板与画质选项
  file_path: index.html                      # 改（③ 导出区）；styles/ 按归属追加
  functions:
    - name: （无 JS；本单元交付 DOM 结构与样式）
      inputs: []
      outputs: ""
      behavioral_contract: |
        在 #exportMp4Fields 内，于现有「时长/帧率」那一行之前，加入动画节奏模式 segmented：
        id=mp4TimeModeSegmented，role=radiogroup，两个 .seg-opt：
        input[name=mp4TimeMode] id=mp4TimeModeEven value='even' checked（文案「按距离匀速」）、
        id=mp4TimeModeTrue value='true'（文案「按真实时间」）；
        与现有 #exportKindSegmented 同款结构与类名。
        紧随其后放 small.gate-hint id=mp4TimeModeHint（默认 display:none），
        用于承载「这条轨迹没有时间戳」这类不可用原因。

        现有「时长（秒）」与「帧率」那一行整体包进 div id=mp4EvenFields。
        新增 div id=mp4TrueFields（默认 display:none），内含：
        - .row > 两个 .field：起始时刻 input[type=datetime-local] id=mp4TimeStart、
          结束时刻 id=mp4TimeEnd，各带 label 与 small 说明；
        - .field：时间缩放 label + input[type=number] id=mp4TimeScale class=val
          min=0.1 max=100 step=0.1 value=1，small 文案说明「1 = 1 秒视频对应 1 秒真实时间」；
        - .field id=mp4CollapseGapsField（默认 display:none，多文件时显示）：
          label + input[type=checkbox] id=mp4CollapseGaps，文案「折叠多个文件之间的时间空隙」；
        - .field：帧率 select id=mp4TrueFps（选项 24/30/60，30 selected）；
        - small id=mp4TrueDurationHint：显示推导出的视频时长与真实时间跨度。

        新增画质 .field（放在 #exportMp4Fields 内、两个模式面板之外，两种模式通用）：
        label + select id=mp4Quality，三个 option：high(选中，文案「高」)/medium(「中」)/low(「低」)；
        同 .field 内 small id=mp4SizeHint 承载「预计文件大小 ≈ X」。

        在 #mp4ProgressWrap 的 label 内、#mp4ProgressV 之后，加 span id=mp4Eta 承载剩余时间估算。

        所有新 input/select 与其 label 用 for/id 关联；segmented 与 hint 的样式复用
        styles/forms.css 既有的 .segmented / .seg-opt 与 styles/layout.css 的 .gate-hint，
        确需新规则时按 PATTERNS.md「样式组织」放进所属主题的那个文件。
      error_cases: []
  dependencies: []
  reuse_candidates: |
    #exportKindSegmented（index.html:215-218）是同款 segmented 的现成范式，直接照搬结构与类名；
    .field / .row / .val / .gate-hint / small 说明文字都是既有范式，无需新样式类。
  acceptance: |
    tests/visible + tests/hidden（静态断言，取材走 tests/helpers/source.mjs）全绿：
    所有新 id 存在、label for 关联完整、默认显隐状态正确、segmented 结构与既有款一致。

- id: T5
  title: 逐帧投影缓存
  file_path: src/render/card.mjs             # 改 renderFrame
  functions:
    - name: renderFrame
      inputs: [ "ctx", "size: number", "progress: number", "opts: object" ]
      outputs: "void"
      behavioral_contract: |
        新增可选 opts.proj：形如 { points:[{x,y}], fullSize } 的预投影结果。
        提供时直接使用它，跳过内部的 projectTrack / projectTrackOnAmap 调用；
        缺省时行为与现在逐字符相同（自行投影）。
        「直接使用」是字面意思：proj.points 已是调用方算好的最终屏幕坐标，原样送去描线，
        不再做平滑、加密、缩放或任何二次加工。
        另：state.trackPoints 为空数组 [] 时，renderFrame 与 renderCard 都与 null 一样
        直接返回（renderCard 走空状态分支）。解析器对无法识别的文件产出空点数组，
        拼接后 trackPoints 可能是 []；两处守卫同时改，渲染同构要求它们对同一种输入
        给出同一种判断。
        opts.proj 的选取必须与当前分支一致：底图分支（opts.bgMode!=='green' && opts.basemapImage）
        用 projectTrackOnAmap 的结果，其余分支用 projectTrack 的结果——由调用方保证，
        本函数不校验来源，只在 opts.proj 存在时信任它。
        ctx.translate(pad,pad) 这一步属于非底图分支的坐标约定，无论是否用缓存都照旧执行。
        renderCard 不接受 proj，行为完全不变（预览每次只渲一帧，缓存无收益）。
        「渲染同构」约束仍成立：两者画同一幅画，仅取参形态不同。
      error_cases:
        - { condition: "opts.proj 存在但 points 为空数组", behavior: "与空轨迹一致地跳过描线与定位点，不抛" }
  dependencies: []
  reuse_candidates: |
    projectTrack / projectTrackOnAmap 已是纯函数，本单元只把「何时调用」的时机交给调用方，
    不复制任何投影逻辑。
  acceptance: |
    tests/visible + tests/hidden 全绿；含「传入 proj 与不传 proj 渲染结果一致」的像素签名断言
    （非透明像素数 + FNV-1a + 采样点 RGBA，范式见 PATTERNS.md「测试」）。

- id: T6
  title: MP4 输出端：流式/内存双路径与 sidecar 落盘
  file_path: src/export/mp4-sink.mjs         # 新建
  functions:
    - name: streamSinkSupported
      inputs: []
      outputs: "boolean"
      behavioral_contract: "typeof window.showSaveFilePicker === 'function' && !!(window.Mp4Muxer && Mp4Muxer.FileSystemWritableFileStreamTarget)。"
    - name: MP4_MAX_DURATION_STREAM / MP4_MAX_DURATION_MEMORY
      inputs: []
      outputs: "number"
      behavioral_contract: "导出的常量：流式 21600（6 小时），内存 600（现状）。"
    - name: createMp4Sink
      inputs: [ "{ suggestedName: string, preferStream: boolean }" ]
      outputs: "Promise<{ kind:'stream'|'memory', target, fastStart, finish(name), abort() }>"
      behavioral_contract: |
        preferStream 为 true 且 streamSinkSupported() 时走流式：
        await window.showSaveFilePicker({ suggestedName, types:[{ description:'MP4 视频',
        accept:{ 'video/mp4':['.mp4'] } }] }) → handle.createWritable() →
        target = new Mp4Muxer.FileSystemWritableFileStreamTarget(writable)，fastStart = false，
        kind='stream'；finish() 关闭 writable，abort() 调 writable.abort() 并吞掉异常。
        否则走内存：target = new Mp4Muxer.ArrayBufferTarget()，fastStart='in-memory'，
        kind='memory'；finish(name) 用 target.buffer 造 Blob 并以 name 触发下载
        （a.click() 后 setTimeout 1000ms revokeObjectURL，与现有 mp4.mjs 的下载写法一致）；
        abort() 是 no-op。
        用户在文件选择框点取消时 showSaveFilePicker 抛 AbortError —— 原样向上抛，
        由调用方识别为「用户主动取消」而非失败。
      error_cases:
        - { condition: "showSaveFilePicker 抛 AbortError", behavior: "原样抛出，err.name === 'AbortError' 可判别" }
        - { condition: "createWritable 失败（权限/磁盘）", behavior: "原样抛出，由调用方转成导出失败状态" }
    - name: downloadSidecar
      inputs: [ "meta: object", "name: string" ]
      outputs: "void"
      behavioral_contract: |
        JSON.stringify(meta, null, 2) 造 application/json Blob，以 name 触发下载，
        与 MP4 的下载写法一致（a.click() + 延时 revokeObjectURL）。
  dependencies: [T2, T3]
  reuse_candidates: |
    内存路径的 Blob 下载逻辑现存于 src/export/mp4.mjs:164-167 与 src/export/png.mjs，
    本单元收敛成 sink 的 finish 一处；mp4.mjs 侧由 T9 改为调用。
  acceptance: |
    tests/visible + tests/hidden 全绿。浏览器 API 部分用静态断言（源码含
    showSaveFilePicker 分支、fastStart 取值随 kind 分流、AbortError 原样上抛）+
    可注入的纯逻辑断言；真实文件写入走 T11 之后的无头 Chrome 手测。

- id: T7
  title: MP4 帧参数：预投影与时间真实帧映射
  file_path: src/export/mp4-opts.mjs         # 新建（buildFrameOpts 从 mp4.mjs 迁入并扩展）
  functions:
    - name: buildFrameOpts
      inputs: [ "{ skipBasemap: boolean, size: number }" ]
      outputs: "object（renderFrame 的 opts）"
      behavioral_contract: |
        承接 src/export/mp4.mjs 现有 buildFrameOpts 的全部字段与取值来源（逐字段不变），
        并在此基础上：
        - skipBasemap 为 true 时按无底图取值（basemapImage 等地图字段取 null/缺省值），
          调用方不再需要临时改写 window.mapOverlayState；
        - 追加 proj 字段：按与 renderFrame 相同的分支条件预先算好投影
          （opts.bgMode!=='green' && basemapImage 时用 projectTrackOnAmap(state.trackPoints,
          size, mapCenter, mapZoom, computeOverlayScale(spanPx, size, pad*size/CARD_SIZE, viewScale))，
          否则用 projectTrack(state.trackPoints, size - 2*(pad*size/CARD_SIZE))）；
          state.trackPoints 为空时 proj 为 null。
      error_cases:
        - { condition: "state.trackPoints 为 null", behavior: "proj 为 null，其余字段照常取值" }
    - name: buildTimeTruePlan
      inputs: [ "{ points, segmentStarts, collapseSegmentGaps, startMs, endMs, scale, fps }" ]
      outputs: "{ index, t0Ms, t1Ms, durationSec, frames, frameTimeMs(i) } | null"
      behavioral_contract: |
        调 buildTimeIndex(points, {segmentStarts, collapseSegmentGaps}) 拿索引；索引为 null 时返回 null。
        t0Ms = clamp(startMs ?? index.startMs) 进 [index.startMs, index.endMs]；
        t1Ms 同理，且保证 t1Ms > t0Ms（否则返回 null）。
        durationSec = (t1Ms - t0Ms) / 1000 / scale；
        frames = max(1, round(durationSec * fps))；
        frameTimeMs(i) = t0Ms + (i / fps) * scale * 1000。
        契约锚点：frameTimeMs(0) === t0Ms，且第 x 秒的帧对应真实时刻 t0Ms + x*scale*1000。
      error_cases:
        - { condition: "scale 非有限数或 <= 0", behavior: "抛 RangeError('buildTimeTruePlan: scale must be a positive finite number')" }
        - { condition: "fps 非有限数或 <= 0", behavior: "抛 RangeError('buildTimeTruePlan: fps must be a positive finite number')" }
        - { condition: "轨迹无可用时间轴", behavior: "返回 null" }
  dependencies: [T1, T5]
  reuse_candidates: |
    buildFrameOpts 整体来自 src/export/mp4.mjs:22-48，迁移时字段与取值逐行保留；
    投影与 overlay scale 计算复用 core/geo 与 core/amap 的现成纯函数，不重写。
  acceptance: |
    tests/visible + tests/hidden 全绿；含 frameTimeMs 的契约断言
    （第 x 秒 ↔ t0 + x*scale）与 proj 分支选取正确性断言。

- id: T8
  title: 界面逻辑：时间真实模式状态与联动
  file_path: src/ui/time-mode.mjs            # 新建
  functions:
    - name: timeMode（导出的可变状态对象）
      inputs: []
      outputs: "{ index: object|null, range: object|null, available: boolean }"
      behavioral_contract: |
        跨模块共享的时间轴状态：index 是 buildTimeIndex 的结果，range 是 trackTimeRange 的结果，
        available 表示当前轨迹是否支持时间真实模式（range 非 null 且 index 非 null）。
        按 PATTERNS.md「跨模块状态」用对象属性而非具名 let，供 ui/preview 与 export/mp4 共读。
    - name: refreshTimeMode
      inputs: []
      outputs: "void"
      behavioral_contract: |
        轨迹变化（载入/删除/重排）后调用：重算 timeMode.range 与 timeMode.index
        （segmentStarts 由 state.trackFiles 各段 points.length 累计得出，
        collapseSegmentGaps 取 $('mp4CollapseGaps').checked）。
        available 为 false 时：#mp4TimeModeTrue 置 disabled，若它当前选中则切回
        #mp4TimeModeEven，#mp4TimeModeHint 显示原因文案
        （无轨迹 / 这条轨迹的点不带时间戳 / 带时间戳的点不足两个）；
        available 为 true 时清空 hint 并解除 disabled。
        #mp4CollapseGapsField 仅在 state.trackFiles.length > 1 时显示。
        随后把起止时刻输入框的取值范围与默认值设为轨迹的完整时间范围。
    - name: isTimeTrueMode
      inputs: []
      outputs: "boolean"
      behavioral_contract: "$('mp4TimeModeTrue').checked && timeMode.available。"
    - name: updateTimeModeUI
      inputs: []
      outputs: "void"
      behavioral_contract: |
        按当前模式切 #mp4EvenFields 与 #mp4TrueFields 的 style.display（只改显隐，
        不碰 disabled——与 updateExportKindUI 同一条约定）；
        时间真实模式下更新 #mp4TrueDurationHint（视频时长与真实时间跨度）；
        两种模式下都更新 #mp4SizeHint：
        estimateMp4Bytes(当前模式的时长, mp4Bitrate(+$('exportRes').value, $('mp4Quality').value))
        经 formatByteSize 格式化，文案形如「预计文件大小 ≈ 3.7 GB」；
        分辨率必须先经 + 转成数值——mp4Bitrate 按数值查表，字符串 '720' 会落进
        「size 非法」分支拿到 1080 那一列的码率；
        流式写盘不可用且预计时长超过内存路径上限时，在 #mp4SizeHint 追加提示
        「当前浏览器一次最多导出 600 秒，请缩小时间范围或调大时间缩放」。
    - name: currentExportWindow
      inputs: []
      outputs: "{ startMs, endMs, scale, fps, collapseSegmentGaps } | null"
      behavioral_contract: |
        从 #mp4TimeStart / #mp4TimeEnd / #mp4TimeScale / #mp4TrueFps / #mp4CollapseGaps
        读出当前导出窗口。datetime-local 的值按**本地时区**解析成毫秒 epoch。
        起止越界时 clamp 进轨迹时间范围；start >= end 时返回 null。
        非时间真实模式返回 null。
  dependencies: [T1, T2, T4, T6]
  reuse_candidates: |
    显隐切换照 src/export/status.mjs 的 updateExportKindUI 范式（只改 style.display 与
    .active，可用性与显隐两条通道互不相交）；状态对象照 exportState / pickerState 的
    对象属性范式。超限提示要判断流式写盘可用性，直接调 T6 的 streamSinkSupported()，
    不另写检测——这条依赖把 T8 的实现排在 T6 之后。
  acceptance: |
    tests/visible + tests/hidden 全绿：模式切换的显隐正确、无时间戳轨迹自动回落匀速并给出
    原因文案、体积估算文案随分辨率/画质/时长变化、datetime-local 按本地时区换算。

- id: T9
  title: MP4 导出：决策层与主流程接线
  file_path: src/export/mp4-plan.mjs（新建）+ src/export/mp4.mjs（改）
  # 两个文件同属导出流程的两半，由同一对 test-author / implementer 处理。
  # 拆开的理由有二：exportMp4 是依赖 WebCodecs 的长异步流程，决策逻辑埋在里面无法单元测试；
  # 且合在一处会突破 200 行的单文件约束。
  functions:
    - name: resolveExportPlan
      inputs: []
      outputs: "{ mode, fps, frames, durationSec, size, quality, bitrate, maxDurationSec, preferStream, suggestedName, timePlan, t0Ms, scale }"
      behavioral_contract: |
        读控件与依赖单元算出本次导出的全部参数。分辨率经 + 转数值后查码率表；
        时长上限随流式可用性取 MP4_MAX_DURATION_STREAM / MEMORY，并用它夹取时长、
        再按夹取后的时长重算帧数；时间真实模式的三个前置条件（radio 选中且可用、
        currentExportWindow 非 null、buildTimeTruePlan 非 null）任一不满足即回落匀速。
      error_cases:
        - { condition: "轨迹为空", behavior: "照常返回匀速模式的对象，可导出与否由调用方判断" }
        - { condition: "buildTimeTruePlan 抛 RangeError", behavior: "不吞，向上传播" }
    - name: frameProgress
      inputs: [ "plan", "i: number" ]
      outputs: "number ∈ [0,1]"
      behavioral_contract: |
        时间真实模式 = progressAtTime(plan.timePlan.index, plan.timePlan.frameTimeMs(i))；
        匀速模式 = frames>1 ? i/(frames-1) : 0（与现有行为逐字符相同）。
      error_cases:
        - { condition: "plan 为 null/undefined", behavior: "返回 0，不抛" }
    - name: formatEta
      inputs: [ "remainingSec: number" ]
      outputs: "string"
      behavioral_contract: |
        剩余秒数 → 中文人话，三个量级（秒 / 分秒 / 时分），含秒进位到 60、分进位到 60；
        非有限数或负数返回空串，界面据此不显示。
    - name: buildExportSidecar
      inputs: [ "plan", "extra: { trackStartMs, trackEndMs, sourceFiles, collapsedSegmentGaps }" ]
      outputs: "object | null"
      behavioral_contract: |
        把 plan 的字段映射成 buildSidecarMeta 的入参并调用它；
        匀速模式（mode !== 'true' 或 t0Ms 非有限数）返回 null，不产 sidecar。
    - name: exportMp4（主流程接线）
      inputs: []
      outputs: "Promise<void>"
      behavioral_contract: |
        流程按序：
        1. 时间真实模式（isTimeTrueMode()）下先取 currentExportWindow() 与 buildTimeTruePlan()，
           据此定出 frames/fps/durationSec/t0Ms；匀速模式沿用
           clampMp4Duration(+$('mp4Duration').value, 上限) 与 $('mp4Fps')。
           时长上限：流式可用取 MP4_MAX_DURATION_STREAM，否则 MP4_MAX_DURATION_MEMORY。
        2. **在任何 await 之前**调 createMp4Sink（user activation 要求）：
           时间真实模式的 suggestedName 用 buildTimeTrueFilename(t0Ms, scale, 'mp4')，
           匀速模式用 '轨迹动画.mp4'；preferStream 取 streamSinkSupported()。
           AbortError（用户在保存框点取消）静默结束，不显示失败状态。
        3. 补拉底图、底图缺失阻断等现有前置逻辑照旧；在这些路径上中止时调 sink.abort()。
        4. 码率改用 mp4Bitrate(+$('exportRes').value, $('mp4Quality').value)，
           分辨率先经 + 转数值（mp4Bitrate 按数值查表，字符串 '720' 会落进「size 非法」
           分支拿到 1080 那一列的码率）；muxer 的 fastStart 取 sink.fastStart。
        5. 帧参数走 buildFrameOpts({skipBasemap, size})，逐帧渲染传 opts（含 proj）。
        6. 每帧的 progress：时间真实模式 = progressAtTime(plan.index, plan.frameTimeMs(i))；
           匀速模式 = frames>1 ? i/(frames-1) : 0（现状不变）。
        7. 进度显示照旧，另更新 #mp4Eta：用已完成帧数与已耗时估算剩余秒数并格式化。
        8. 完成后 await sink.finish(文件名)；时间真实模式再调 downloadSidecar(
           buildSidecarMeta({...}), buildTimeTrueFilename(t0Ms, scale, 'json'))。
        9. 成功状态文案：时间真实模式写明起始时刻与缩放，供用户核对与记录。
        取消、beforeunload 拦截、按钮互斥、产物切换锁定等现有行为逐条保持；
        取消时调 sink.abort()。
      error_cases:
        - { condition: "showSaveFilePicker 被用户取消", behavior: "静默结束，不进失败状态，界面复位" }
        - { condition: "时间真实模式但 buildTimeTruePlan 返回 null", behavior: "setExportStatus 说明轨迹无可用时间轴，不开始编码" }
        - { condition: "编码中途出错", behavior: "现有 catch 逻辑照旧，额外调 sink.abort()" }
    - name: mp4Supported
      inputs: []
      outputs: "boolean"
      behavioral_contract: "现有实现逐字符不变。"
  dependencies: [T2, T5, T6, T7, T8]
  reuse_candidates: |
    编码循环、背压、mp4Yield、取消与 beforeunload 守卫全部沿用现有实现；
    本单元只替换「progress 从哪来」「码率从哪来」「产物往哪写」三处接缝，
    并把 buildFrameOpts 与 MP4_BITRATE 的定义交给 T7 / T2。
  acceptance: |
    tests/visible + tests/hidden 全绿；文件仍在 200 行以内；
    匀速模式的静态断言（现有 uiExport 测试）不修改即通过。

- id: T10
  title: 扫拨条时间轴
  file_path: src/ui/preview.mjs              # 改
  functions:
    - name: updatePreviewScrubLabel
      inputs: []
      outputs: "void"
      behavioral_contract: |
        匀速模式：文案与现在逐字符相同（`动画预览 · N 秒`）。
        时间真实模式：显示当前扫拨位置对应的真实时刻，
        由 timeAtProgress(timeMode.index, state.previewProgress) 得出，
        格式 `动画预览 · HH:MM:SS`（本地时区），并在其后附导出窗口时长。
    - name: previewPlayStep（内部）
      inputs: [ "ts: number" ]
      outputs: "void"
      behavioral_contract: |
        匀速模式：推进逻辑与现在逐字符相同（按 clampMp4Duration(mp4Duration) 循环）。
        时间真实模式：按导出窗口的视频时长推进（(t1-t0)/1000/scale 秒走完 0→1），
        推进到 1 后回绕到 0；每步同时刷新扫拨条标签，让时刻跟着走。
      error_cases:
        - { condition: "时间真实模式但 timeMode.index 为 null", behavior: "按匀速逻辑推进，不抛" }
  dependencies: [T1, T8]
  reuse_candidates: |
    播放循环、rAF 管理、播放按钮态全部沿用现有实现，只替换「一圈走多久」与标签文案两处。
  acceptance: |
    tests/visible + tests/hidden 全绿；匀速模式的标签文案断言不修改即通过。

- id: T11
  title: 装配接线
  file_path: src/main.mjs                    # 改
  functions:
    - name: （装配，无导出函数）
      inputs: []
      outputs: ""
      behavioral_contract: |
        接线项：
        - input[name=mp4TimeMode] 的 change → updateTimeModeUI + updatePreviewScrubLabel + render；
        - #mp4TimeStart / #mp4TimeEnd / #mp4TimeScale / #mp4TrueFps 的 input|change
          → updateTimeModeUI + updatePreviewScrubLabel；
        - #mp4CollapseGaps 的 change → refreshTimeMode + updateTimeModeUI；
        - #mp4Quality 与 #exportRes 的 change → updateTimeModeUI（体积估算随之变）；
        - 现有 #exportRes 的 change → render 保持；
        - 首屏初始化调用 refreshTimeMode() 与 updateTimeModeUI()，位置在 updateExportKindUI()
          与 updatePreviewScrubLabel() 之间。
        轨迹载入/删除/重排后调 refreshTimeMode 的接缝落在 src/ui/track-panel.mjs 里
        已有的重算路径上（该文件在本单元一并接线，改动限于调用一行）。
        依赖只从 main.mjs 流向各层这条恒真约束保持。
      error_cases: []
  dependencies: [T8, T9, T10]
  reuse_candidates: "沿用现有事件绑定与首屏初始化顺序的写法，不引入新范式。"
  acceptance: |
    全量 node --test 绿；无头 Chrome 实测：载入 淀山湖.fit → 切「按真实时间」→
    起止时刻自动填成轨迹范围 → 扫拨条显示真实时刻 → 体积估算随画质变化。

## Dependency Graph

| 单元 | 文件 | 依赖 |
|---|---|---|
| T1 | `src/core/track-time.mjs` | — |
| T2 | `src/core/export-params.mjs` | — |
| T3 | `src/core/export-meta.mjs` | — |
| T4 | `index.html` + `styles/` | — |
| T5 | `src/render/card.mjs` | — |
| T6 | `src/export/mp4-sink.mjs` | T2 · T3 |
| T7 | `src/export/mp4-opts.mjs` | T1 · T5 |
| T8 | `src/ui/time-mode.mjs` | T1 · T2 · T4 · T6 |
| T9 | `src/export/mp4-plan.mjs` + `src/export/mp4.mjs` | T6 · T7 · T8 |
| T10 | `src/ui/preview.mjs` | T1 · T8 |
| T11 | `src/main.mjs`（+ `src/ui/track-panel.mjs` 一行） | T8 · T9 · T10 |

无环：T1–T5 无入边，T11 为汇点。

## Execution Waves

| 波次 | 单元 | 并行性 |
|---|---|---|
| Wave 1 | T1 · T2 · T3 · T4 · T5 | 五个文件互不相交，全并行 |
| Wave 2 | T6 · T7 | 两个文件互不相交，并行 |
| Wave 3 | T8 | 单元（等 T6 的 streamSinkSupported） |
| Wave 4 | T9 · T10 | 两组文件互不相交，并行 |
| Wave 5 | T11 | 单元（含 track-panel 一行接线） |

同文件串行约束：全程无两个单元落在同一文件。
测试可以比实现提前一波派发——test-author 只需 spec 与接口契约，不需要依赖单元的实现落地。

## 验收

给定已知开拍时刻的实拍素材与同程 FIT，任意时刻动画位置点与实拍画面所处路段一致。现成验证数据：`~/Desktop/环淀山湖/`（DJI 素材，文件名含拍摄时刻）+ `~/Desktop/trails/淀山湖/淀山湖.fit`；该相机时钟比 GPS 快 28s（校准方法与锚点核验记录见 roughcut repo 的 DEVFLOW.md / PATTERNS.md「跨数据源时间对齐」）。

集成验证清单：
1. `node --test 'tests/**/*.test.mjs'` 全绿。
2. 无头 Chrome 实测流式写盘导出一段短窗口（如 60 秒），核对 sidecar 的 `t0Epoch` 与文件名一致。
3. 取 `淀山湖.fit`，在时间真实模式下导出 `15:59:04`（DJI_0005 开拍时刻减 28 秒时钟偏差）起的 60 秒窗口，与 roughcut 现有 progress 模式的 4K PiP 预览逐帧比对定位点位置。
4. 匀速模式导出一段，与改动前的产物做像素签名比对，确认无变化。

## 实现入口提示
进本 repo 先读 AGENTS.md。匀速逻辑在 `src/core/geo.mjs` 的 `pointAtProgress`；MP4 导出走 WebCodecs `VideoEncoder` + vendored mp4-muxer；无 build、无 npm 依赖、ES modules。

## Status
In Progress
