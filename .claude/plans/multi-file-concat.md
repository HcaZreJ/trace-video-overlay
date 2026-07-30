# Feature: 多轨迹文件首尾相连

> 本 plan 已完成，作为设计记录保留。仓库现为按层分模块的多文件结构，
> 代码位置与仓库级规则以 [AGENTS.md](../../AGENTS.md) 与 [PATTERNS.md](../../PATTERNS.md) 为准。

## Overview
当前 app 只接受单个轨迹文件。补齐 trace-photo-overlay 已有的能力：一次导入多个
GPX/KML/TCX/FIT/GeoJSON/CSV 文件，按用户指定顺序**首尾拼接成一条轨迹**再渲染，
适合码表分段记录的多日/多段骑行。

## Intent Brief
- Goal：多文件按顺序拼接为单条 trackPoints，渲染逻辑不变。
- Motivation：码表常把一次长骑分成多个文件；用户已在主 app 依赖此能力。
- Known context：主 app（../cycling-grid = trace-photo-overlay）index.html 已实现同款机制，直接移植：
  - 状态：`trackFiles = [{name, format, points}]`，`trackPoints = trackFiles.flatMap(f => f.points)`（按列表顺序拼接）。
  - 不自动按时间排序，顺序由用户用「上移/下移/删除」手动控制。
  - 参考实现：主 app 的 `loadTrackFiles` / `recomputeTrack` / `renderFileList` / `trackFileAction` / `clearTrack`。
- Constraints：纯前端、无网络、无 build；沿用本 repo 现有 index.html 的自包含 `<script>` 结构。
- Non-goals：不做自动按 GPS 时间排序、不做跨文件去重/接缝平滑（保持与主 app 一致的朴素拼接）。
- Success criteria：拖入多个文件 → 出现文件列表（含序号、格式、点数、上移/下移/删除）→ 卡片按拼接后整条轨迹渲染 → 起点=首文件首点、终点=末文件末点。
- Assumptions：见 Ledger。

## Alignment Gate
- I will implement：多文件导入解析、trackFiles 列表状态、flatMap 拼接、文件列表 UI（重排/删除）、
  拖入多文件支持、卡片按合并轨迹渲染。
- I will not implement：自动时间排序、接缝平滑、跨文件去重。
- Acceptance：导入 sample-ride.gpx + sample-route.gpx 两个文件 → 列表显示 2 条 → 卡片渲染合并轨迹 →
  上移/下移改变拼接顺序后卡片随之更新 → 删除某条后回到单条渲染。

## Assumption Ledger
| Assumption | Confidence | Impact if Wrong | Status |
|---|---:|---:|---|
| 沿用主 app「手动排序、朴素首尾拼接」即可，无需按时间自动排 | high | medium | 沿用主 app 既定行为 |
| 定位点 PNG 不受影响（仍是独立单点素材，与轨迹段数无关） | high | low | 设计如此 |

## Work-Unit Specs
- id: M1
  title: 多文件导入与首尾拼接
  file_path: index.html
  内容：
    - 引入 `trackFiles=[{name,format,points}]` 状态；`trackPoints=trackFiles.flatMap(f=>f.points)`。
    - `loadFile` 改为 `loadTrackFiles(fileList)`：遍历解析，成功的 push 进 trackFiles，失败的收集后提示。
    - 文件输入加 `multiple`；drop 区支持一次拖入多个文件（`e.dataTransfer.files` 全量遍历）。
    - 文件列表 UI：每行序号 + 文件名 + 「格式·点数」+ 上移/下移/删除按钮；操作后重算并重渲染。
    - info 行显示：文件数 + 合并后总点数 + 总距离。
    - 参考主 app 对应函数，命名/交互保持一致。
  acceptance：见 Alignment Gate 的 Acceptance；浏览器实测两文件拼接、重排、删除均正确。

## Dependency Graph
（单工作单元，无依赖）

## Execution Waves
Wave 1：M1

## Status
Completed
