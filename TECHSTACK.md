# TECHSTACK

## 语言与运行时
- 纯前端 vanilla JavaScript（ES2015+），无框架、无 TypeScript、无 build 步骤、无 package.json。
- 应用代码是原生 ES module（`.mjs`，具名导出），页面经
  `<script type="module" src="src/main.mjs">` 装载。module 的隐式 defer 保证执行时 DOM 已就位。
- 页面经 HTTP 打开：ES module 的 import 要求 HTTP(S) 协议。
  本地开发起 `python3 -m http.server 8137`。
- GitHub Pages 对 `.mjs` 返回 `content-type: text/javascript; charset=utf-8`，
  ES module 生产可用，零服务器配置。
- Node.js（v22+）仅用于跑测试：内置 `node:test` + `node:assert/strict`，无测试框架依赖。
  `src/core/` 与 `src/parse/`（`xml.mjs` 除外）零浏览器 API，Node 直接 import。

## 依赖
- npm 依赖：零。
- Vendored：`vendor/mp4-muxer.js`（Vanilagy/mp4-muxer 的 bundled IIFE 构建，暴露全局
  `Mp4Muxer`），经 `<script src="vendor/mp4-muxer.js">` 以 classic script 加载，
  排在 module 入口之前，保证 `window.Mp4Muxer` 先就位。
- 浏览器能力依赖：Canvas 2D、WebCodecs（`VideoEncoder`/`VideoFrame`，MP4 导出用，
  `mp4Supported()` 做能力检测）、`DOMParser`（GPX/TCX/KML 解析）、`localStorage`、
  File API（拖拽/多选）、`Image` 加载、`EyeDropper`（取色器吸管，可选）。

## 外部服务
- 唯一外部网络集成：高德静态地图 API `https://restapi.amap.com/v3/staticmap`
  （key/location/zoom/size/scale/traffic 参数；用户 opt-in 才请求）。
- 高德静图 zoom 为 512px tile 基准：`zoom=N` 地面分辨率 = 标准 256px Web Mercator 的 `N+1`，
  代码中经 `AMAP_STATIC_ZOOM_BIAS`（=1）换算。
- 坐标系：GPS 数据为 WGS84，高德为 GCJ-02，经 `wgs84ToGcj02`（国测局公式）转换后投影。

## 目录结构
```
index.html                  HTML 结构 + 六条 <link> + 两条 <script>
styles/
  tokens.css                :root 设计变量
  base.css                  reset · body · header · 示例入口 · focus-visible
  layout.css                workspace 栅格 · drop 区 · 舞台 · 步骤结构 · gate 态 · 断点
  forms.css                 input · select · range · val · check · segmented
  components.css            keyhelp · 按钮 · 吸底导出条 · 状态按钮 · 文件列表
  color-picker.css          .cp-*
src/
  main.mjs                  装配入口
  state.mjs                 跨层共享状态 + CARD_SIZE
  dom.mjs                   $ 取元素
  core/                     geo · gcj02 · amap · metrics · color · track-files · export-params
  parse/                    index · fit · geojson · csv · xml
  basemap/                  diagnose · image · fetch
  render/                   primitives · card · dot
  export/                   status · png · mp4
  ui/                       preview · map-panel · track-panel · track-errors · controls
    color-picker/           index · popup · canvas · inputs
vendor/
  mp4-muxer.js              第三方 MP4 封装库
tests/
  unit/                     core.test.mjs · fit.test.mjs
  visible/                  harness 测试（实现 agent 可见）
  hidden/                   harness 测试（实现 agent 不可见，经脚本跑分）
  helpers/source.mjs        UI 测试取材入口
docs/demo-taihu.png         README 用的 demo 截图
sample-ride.gpx / sample-route.gpx   手测样例数据
.claude/plans/              跨 session 权威设计文档
.claude/launch.json         本地开发服务配置（python3 -m http.server 8137）
```

## 配置与环境变量
- 应用运行时配置只有一处：高德 API Key，由用户在 UI 输入框填写，持久化于
  `localStorage.amap_key`。另有两项界面偏好也存 localStorage：`exportKind`（产物选择）、
  `colorPickerMode`（取色器表达模式）。
- 根目录 `.env`（git-ignored）存在但不被任何代码读取；应用无 `process.env` 消费路径。

## 部署
- GitHub Pages 静态托管：https://hcazrej.github.io/trace-video-overlay/ （仓库 settings 配置，
  无 in-repo CI/CD workflow）。从 `main` 分支根目录直接发布源码，无构建产物。
- 端口：本地开发 8137（launch.json）。
