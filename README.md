# trace-video-overlay

把一次骑行的轨迹（GPX / KML / TCX / FIT / GeoJSON / CSV）渲染成视频剪辑用的**透明 PNG 贴图素材**，专为剪映等剪辑软件设计。

在线使用：https://hcazrej.github.io/trace-video-overlay/

## 导出什么

- **地图卡片 PNG** — 600×600 透明底，半透明圆角背景 + 线路 + 起终点标记。放进剪映当画中画贴在视频角落。
- **定位点 PNG** — 单独的一个圆点。拖进剪映后用位置关键帧让它沿线路移动，表现「当前所在位置」。不想动就只放地图卡片。

## 为什么是透明 PNG 而不是 MP4

角落贴图需要透明背景才能浮在素材上。常见 MP4（H.264/H.265）不带 alpha 透明通道；剪映也不支持图片序列或透明视频导入，但完美支持单张透明 PNG 当画中画并对其打位置关键帧。所以透明 PNG 是最省事、最兼容的选择。

## 特点

- 纯前端、零依赖、全程本地处理，不上传任何数据
- 复用主项目 [trace-photo-overlay](https://github.com/HcaZreJ/trace-photo-overlay) 的解析与投影逻辑
- 线色 / 线宽 / 底色 / 底透明度 / 圆角 / 内边距 / 起终点标记 / 定位点样式均可调

## 本地运行

直接用浏览器打开 `index.html` 即可（或 `python3 -m http.server` 起个本地服务）。

## 测试

复用的纯几何/解析函数在 `core.mjs`，用 Node 内置测试跑：

```
node --test
```

## 许可证

PolyForm Noncommercial 1.0.0，见 [LICENSE](LICENSE)。
