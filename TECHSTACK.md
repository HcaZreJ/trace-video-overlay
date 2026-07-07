# TECHSTACK

## 语言与运行时
- 纯前端 vanilla JavaScript（ES2015+），无框架、无 TypeScript、无 build 步骤、无 package.json。
- 浏览器直接运行 `index.html`（file:// 或任意静态服务器）。
- Node.js（v22+）仅用于跑测试：内置 `node:test` + `node:assert/strict`，无测试框架依赖。
- `.mjs` 文件为原生 ES module（具名导出）；`index.html` 内联 script 为普通 script（非 module）。

## 依赖
- npm 依赖：零。
- Vendored：`mp4-muxer.js`（Vanilagy/mp4-muxer 的 bundled IIFE 构建，暴露全局 `Mp4Muxer`），
  经 `<script src="mp4-muxer.js">` 加载。
- 浏览器能力依赖：Canvas 2D、WebCodecs（`VideoEncoder`/`VideoFrame`，MP4 导出用，
  `mp4Supported()` 做能力检测）、`localStorage`、File API（拖拽/多选）、`Image` 加载。

## 外部服务
- 唯一外部网络集成：高德静态地图 API `https://restapi.amap.com/v3/staticmap`
  （key/location/zoom/size/scale/traffic 参数；用户 opt-in 才请求）。
- 高德静图 zoom 为 512px tile 基准：`zoom=N` 地面分辨率 = 标准 256px Web Mercator 的 `N+1`，
  代码中经 `AMAP_STATIC_ZOOM_BIAS`（=1）换算。
- 坐标系：GPS 数据为 WGS84，高德为 GCJ-02，经 `wgs84ToGcj02`（国测局公式）转换后投影。

## 目录结构
```
core.mjs            纯几何/解析/构造函数（权威实现，node:test 覆盖）
core.test.mjs       core.mjs 的早期测试（根目录，与 tests/ 并存）
fit.mjs             FIT 二进制解析模块
fit.test.mjs        fit.mjs 测试
index.html          整个应用：CSS + DOM + 内联 script（含 core.mjs 逻辑的内联副本）
mp4-muxer.js        vendored MP4 muxer
tests/visible/      harness 测试（实现 agent 可见）
tests/hidden/       harness 测试（实现 agent 不可见，经脚本跑分）
sample-ride.gpx / sample-route.gpx   手测样例数据
.claude/plans/      跨 session 权威设计文档
.claude/launch.json 本地开发服务配置（python3 -m http.server 8137）
```

## 配置与环境变量
- 应用运行时配置只有一处：高德 API Key，由用户在 UI 输入框填写，持久化于
  `localStorage.amap_key`。
- 根目录 `.env`（git-ignored）存在但不被任何代码读取；应用无 `process.env` 消费路径。

## 部署
- GitHub Pages 静态托管：https://hcazrej.github.io/trace-video-overlay/ （仓库 settings 配置，
  无 in-repo CI/CD workflow）。
- 端口：本地开发 8137（launch.json）。
