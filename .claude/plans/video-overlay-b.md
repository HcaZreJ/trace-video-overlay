# Feature: 骑行轨迹 → 剪辑用透明贴图导出（方案 B）

## Overview
把一次骑行的 GPX/KML/TCX/FIT/GeoJSON 轨迹渲染成剪辑软件（剪映）能用的角落贴图素材：
一张 600×600 的透明 PNG 地图卡片（半透明圆角底 + 线路 + 起终点标记），
外加一张单独的小圆点 PNG（供用户在剪映里用位置关键帧让"当前位置"沿线路移动）。
纯前端、无后端、无网络请求，部署为 GitHub Pages。

## Intent Brief
- Goal：产出剪映可直接使用的透明素材，展示一次骑行的路线与一个可移动的位置点。
- Motivation：主 app（trace-photo-overlay）面向朋友圈九宫格图片；用户另有视频剪辑需求。
- Known context：剪映不支持"图片序列当片段"导入，也基本不支持透明视频；但支持单张透明 PNG 当画中画 + 位置关键帧。
- Constraints：纯前端、复用主 repo 的解析与投影逻辑、GitHub Pages（main 根目录，与 trace-photo-overlay 一致）。
- Non-goals：方案 A（绿幕 MP4 自动动画）本次不做，记为未来 plan。
- Success criteria：导入轨迹文件 → 预览地图卡片 → 导出透明地图 PNG 与定位点 PNG 两个文件；部署可访问。

## Alignment Gate
- I will implement：文件导入解析、600×600 透明圆角地图卡片渲染（半透明底 + 线路 + 起终点标记）、
  样式选项（线色/线宽/底色/底透明度/圆角/内边距/标记开关/点样式）、导出地图 PNG + 定位点 PNG、部署 Pages。
- I will not implement：方案 A（绿幕 MP4）、视频编码、服务端任何逻辑。
- Acceptance：用 sample-ride.gpx 能导入→预览→导出两张透明 PNG，浏览器实测通过；Pages 可访问。

## Assumption Ledger
| Assumption | Confidence | Impact if Wrong | Status |
|---|---:|---:|---|
| 剪映接受单张透明 PNG 当画中画并支持位置关键帧 | high | high | 已知事实 |
| 600×600 方形卡片尺寸够用（用户确认） | high | low | 用户确认 |
| 默认配色可接受、细节做成 App 内选项 | high | low | 用户确认 |

## Work-Unit Specs
本 app 为单一自包含 index.html（canvas/DOM 渲染，按主 repo 惯例此部分不写单测），
纯逻辑（mercator/smoothTrack/projectTrack/各格式解析）从主 repo 复用且已被 core.mjs 的 node:test 覆盖。
作为一个紧耦合工作单元交付，靠浏览器实测 + 复用模块的 node 测试保证正确。

- id: B1
  title: 轨迹 → 透明贴图 App（单页）
  file_path: index.html
  内容：
    - 复用 parse（GPX/KML/TCX/FIT/GeoJSON/CSV）→ trackPoints [{lng,lat,ele?,time?}]
    - 复用 projectTrack 投影进内边距后的正方形
    - 渲染 600×600 透明 canvas：圆角裁剪 + 半透明底 + 线路 polyline + 起点(绿)/终点(红)标记
    - 样式选项：线色、线宽、底色、底透明度、圆角、内边距、起终点标记开关、定位点颜色/大小
    - 导出：地图卡片透明 PNG；单独定位点透明 PNG
    - 拖拽 + 点击导入，实时预览
  acceptance：浏览器导入 sample-ride.gpx → 预览正确 → 两个导出按钮各下载一张透明 PNG。

## Dependency Graph
（单工作单元，无依赖）

## Execution Waves
Wave 1：B1

## Status
In Progress
