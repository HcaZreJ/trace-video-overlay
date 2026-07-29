# Feature: 拆分 index.html —— 按层分模块的多文件结构

## Overview

`index.html` 当前 2550 行，一个文件装完 CSS、HTML 结构、应用逻辑，其中应用逻辑里还手抄着
`core.mjs` / `fit.mjs` 的算法副本。把它拆成按层分离的模块结构：每个文件只装一类内容，
每个 JS 模块 50–200 行，粒度对齐「一个 sub-agent 一个 context window 能完整读懂并改对一个文件」。

浏览器端直接 `import` 纯函数模块，算法在仓库里只存一份。

交付形态保持 GitHub Pages 从 `main` 根目录直接托管、无构建步骤、无包管理器。本地开发用
`python3 -m http.server 8137`。

### 当前构成（实测行号）

| 段 | 行号 | 行数 |
|---|---|---|
| `<head>` 元信息 | 1–6 | 6 |
| CSS | 7–194 | 188 |
| HTML 结构 | 196–473 | 278 |
| 第三方库 `<script src>` | 474 | 1 |
| 应用逻辑内联 `<script>` | 475–2548 | 2074 |

`core.mjs` 733 行（36 个导出）+ `fit.mjs` 70 行（1 个导出）。37 个导出里 27 个在内联 script
有同算法副本，占约 323 行；9 个在 `index.html` 全文零命中；2 个与副本存在语义漂移。

`mp4-muxer.js` 1904 行，第三方库，以 classic script 挂 `window.Mp4Muxer`。

测试基线 572 个全绿：`tests/**` 505 个（visible / hidden 盲测分离）+ 根目录
`core.test.mjs` 64 个 + `fit.test.mjs` 3 个。

### 目标构成

```
index.html                     约 300 行 —— 只有 HTML 结构 + <link> + <script type="module">

src/
  main.mjs                     入口：装配各模块 + 事件绑定 + 首屏初始化

  core/                        零浏览器 API，Node 直接 import 单测
    geo.mjs                    mercatorX · mercatorY · smoothTrack · projectTrack
                               · trackDistanceKm · pointAtProgress
    gcj02.mjs                  gcjOutOfChina · gcjTransformLat · gcjTransformLng · wgs84ToGcj02
    amap.mjs                   AMAP_STATIC_ZOOM_BIAS · computeOverlayScale · computeBasemapDrawRect
                               · lngLatToAmapPixel · computeAmapView · buildAmapStaticUrl
                               · computeAmapUrlForTrack · projectTrackOnAmap
    metrics.mjs                trackDurationSec · avgSpeedKmh · paceSecPerKm · elevationGainM
                               · formatDuration · formatPace
    color.mjs                  parseHex · formatHex · rgbToHsl · hslToRgb · rgbToHsv · hsvToRgb
    track-files.mjs            concatTrackPoints · reorderTrackFiles
    export-params.mjs          dotGeometry · clampMp4Duration

  parse/
    index.mjs                  parseTrackFile 按扩展名分派
    fit.mjs                    parseFIT（纯函数，Node 可测）
    geojson.mjs                extractGeoJSONCoords（纯函数，Node 可测）
    csv.mjs                    extractTextCoords（纯函数，Node 可测）
    xml.mjs                    ptFromAttrEl · extractGPXCoords · extractTCXCoords
                               · extractKMLCoords（需 DOMParser）

  basemap/                     浏览器运行时：高德静态图按需请求
    diagnose.mjs               diagnoseAmapApiError
    image.mjs                  loadImageFromBlob · loadImageDirect
    fetch.mjs                  fetchBasemapViaHttp · fetchAmapBasemap · 内存缓存 · 超时

  render/                      要 canvas，不碰界面 DOM
    primitives.mjs             hexToRgba · strokePath · drawMarker
    card.mjs                   renderCard · renderFrame（同构一对，同文件让同步约束可见）
    dot.mjs                    renderDot

  export/
    status.mjs                 setExportStatus · showExportBlockedStatus
                               · updateExportKindUI · setExportKindLocked
    png.mjs                    download · exportCard · exportDot
    mp4.mjs                    mp4Yield · mp4Supported · buildFrameOpts · pickMp4Codec
                               · exportMp4 · 关页拦截

  ui/                          唯一碰界面 DOM 的一层
    dom.mjs                    $ · bind · stepDecimals · 拖放绑定
    state.mjs                  应用状态与常量的单一持有者
    track-errors.mjs           clearTrackErrors · showTrackErrors · clearTrackUndo · showTrackUndo
    track-panel.mjs            setTrackGate · loadTrackFiles · recomputeTrack · renderFileList
                               · trackFileAction · clearTrack
    map-panel.mjs              setMapStatus · markOverlayNeedsRefresh · scheduleMapAutoFetch
                               · onPreviewMapOverlay · updateBgModeUI · updateMapModeFieldsUI
    preview.mjs                render · previewPlayStep · startPreviewPlay · stopPreviewPlay
                               · updatePreviewScrubLabel
    controls.mjs               syncColorHexLabel · initColorHexLabels · range↔number 联动
                               · amapKey 持久化
    color-picker/
      index.mjs                state · openPicker · closePicker · initColorPickers
                               · applyState · syncFromRgb · syncFromHsv
      popup.mjs                buildPopup · positionPopup
      canvas.mjs               drawSvPanel · drawHueBar · updateCursors · updateSwatchPreview
      inputs.mjs               renderMode · updateInputs · setPickerMode · readSavedMode

styles/
  tokens.css                   :root 设计 token —— 设计系统的单一来源
  base.css                     reset · body · header · 示例入口 · focus-visible
  layout.css                   workspace 栅格 · drop 区 · stage · cardbox · scrub · dotbox
                               · controls 列 · step 结构 · gate 态 · 断点
  forms.css                    input · select · range · val · row · check · segmented
  components.css               keyhelp · 按钮 · 吸底导出条 · 状态按钮 · hint · 文件列表
  color-picker.css             取色器（与 ui/color-picker/ 成对）

vendor/
  mp4-muxer.js                 第三方库，独立目录

tests/
  unit/                        core.test.mjs · fit.test.mjs（原根目录早期测试）
  visible/                     harness 盲测：实现 agent 可见的样例
  hidden/                      harness 盲测：实现 agent 只见 PASSED: X/Y
```

## Intent Brief

**Goal** —— 每个文件只装一类内容，每个 JS 模块 50–200 行；算法在仓库里只存一份；
`index.html` 只剩 HTML 结构。

**Motivation** —— 这个仓库要承载对 sub-agent 驱动开发方法的验证，代码可读性与 agent 可导航性
是首要指标。2550 行单文件对 agent 是最差形态：改一个按钮要把整个应用读进上下文。

**Known context**
- GitHub Pages 对 `.mjs` 返回 `content-type: text/javascript; charset=utf-8`
  （对本仓库 `core.mjs` 线上 curl 实测），ES module 生产可用，零服务器配置。
- `file://` 下 ES module 的 `import` 受 CORS 阻断，无绕法。这是内联手抄副本存在的直接原因。
- 本仓库无内联 base64 字体，字体走系统字体栈；测试全是 Node 静态断言，不驱动浏览器。
  这两点让拆分比姊妹仓库少两个工作单元。
- 地图底图功能在运行时按需请求高德静态图 API（`restapi.amap.com/v3/staticmap`），
  key 由用户自带并存 localStorage。这是本仓库唯一的运行时外部网络请求。
- 双份实现已漂移两处（sub-agent token 级审计 37 个导出的结论）：
  `projectTrack` 的 `core.mjs` 版返回 `{points, fullSize}`，内联副本只返回 `{points}`；
  `extractGeoJSONCoords` 的内联副本保留第三位坐标的 `ele`、`core.mjs` 版丢弃，
  反过来 `core.mjs` 版有 `Array.isArray(features)` 守卫、内联副本没有。
- `core.mjs` 有 9 个导出在 `index.html` 全文零命中：统计六件套
  （`trackDurationSec` · `avgSpeedKmh` · `paceSecPerKm` · `elevationGainM`
  · `formatDuration` · `formatPace`）保留待接线；`crc32` · `buildStoreZip` · `layoutTextBlockX`
  属姊妹仓库的九宫格 ZIP 与文字卡布局，本仓库不接线，连同其 10 个测试一并移除。
  移除 `buildStoreZip` 测试同时去掉测试套件对系统 `unzip` 命令的依赖。
- 五个 UI 测试文件（`uiLayout` · `uiStructure` · `uiTokens` · `uiExport` · `uiStage`）
  用正则从 `index.html` 抓 `<style>` / `<body>` / 内联 `<script>` 三段做静态断言。
  取材方式：CSS 用 `/<style\b[^>]*>([\s\S]*?)<\/style>/gi`，JS 取无 `src` 的 `<script>` 内容，
  HTML 是剔除 script/style/注释后的 body。

**Constraints**
- 无构建步骤、无包管理器、无 `node_modules`。第三方库 vendored。
- GitHub Pages 从 `main` 根目录直接托管。
- 测试只用 Node 内建模块。
- 行为零变化。572 个现有测试全绿是每个工作单元的验收前提。
- **代码迁移由脚本按行号切割完成，不手抄。** 每个搬迁单元交付时附带守恒校验：
  去掉 `import` / `export` 关键字后，函数体逐字与源一致。
- CSS 拆分**只切不重排版**：`<link>` 顺序拼接后与原 `<style>` 内容逐字节一致，
  层叠优先级不变。

**Non-goals**
- 不引入 TypeScript、JSDoc 类型标注、前端框架、构建工具、lint、CI。
- 不改任何 UI 外观、文案、交互行为。
- 不改 `mp4-muxer.js` 本身，不改它作为 UMD 库挂 `window` 的用法。
- 不做 SEO 优化（另开 GitHub issue 跟踪）。
- 不重写事件绑定的编排结构，只把函数移出并使其可被 `main.mjs` 调用。

**Success criteria**
- `index.html` 不含 `<style>`、不含内联应用逻辑，总行数 ≤ 320。
- 无任何算法在仓库里存在两份定义。
- 每个 `src/**/*.mjs` 行数 ≤ 200。
- `node --test 'tests/**/*.test.mjs'` 一条命令覆盖全部测试并全绿。
- `python3 -m http.server 8137` 下手工过完整流程：轨迹导入（GPX/FIT/GeoJSON/CSV）、
  多文件拼接与重排、高德底图拉取、取色器、动画预览播放、PNG 与 MP4 两种导出。
- 六份文档只陈述多文件 + ES module + 静态服务器这一套当前事实。

## Alignment Gate

**I will implement** —— 下列 Work-Unit Specs 全部（T0–T11）。

**I will not implement** —— 见 Non-goals。SEO 另开 GitHub issue。

**Open assumptions** —— 无阻塞项。

**Acceptance** —— 见 Success criteria。每个工作单元独立验收、独立 commit，
全部完成后拉一个 PR。

## Assumption Ledger

| Assumption | Confidence | Impact if Wrong | Status |
|---|---:|---:|---|
| 放弃 `file://` 双击可用 | high | high | 用户已确认，并要求推翻文档中的该前提 |
| Pages 对 `.mjs` 返回可执行 MIME | high | high | 对本仓库 `core.mjs` 线上 curl 实测，已消解 |
| `extractGeoJSONCoords` 以保留 `ele` + 带守卫为准 | high | medium | 爬升指标依赖 `ele`，畸形输入不应抛错，两侧优点合并 |
| `projectTrack` 以返回 `fullSize` 为准 | high | low | 页面两个调用点只取 `.points`，加宽契约不影响行为 |
| 统计六件套保留、ZIP 与文字布局移除 | high | medium | 用户已选定 |
| `<script type="module">` 的隐含 defer 不影响首屏初始化 | medium | high | module 在文档解析完毕后执行，使「DOM id 已就位」这个前提更强。T2 内以全量测试与手工流程验证 |
| CSS 六段按 `<link>` 顺序拼接与原样等价 | high | medium | T1 内以字节级 diff 校验拼接结果 |
| `mp4-muxer.js` 移入 `vendor/` 后全局挂载不变 | high | medium | classic script 的 `window` 挂载与路径无关。T2 内实测 MP4 导出 |

## Work-Unit Specs

```yaml
- id: T0
  title: core.mjs 权威化 —— 消解两处漂移 + 移除三个无关导出
  file_path: core.mjs, core.test.mjs, tests/visible/**, tests/hidden/**
  functions:
    - name: extractGeoJSONCoords
      inputs: [geojson 对象]
      outputs: "[{lng, lat, ele?}]"
      behavioral_contract: |
        core.mjs:354-370 已具备 Array.isArray(features) 守卫与全部遍历分支，
        本单元唯一的改动是点构造加 ele：把两处 points.push({ lng: c[0], lat: c[1] })
        改为走一个构造 helper，当 c.length >= 3 且 typeof c[2] === 'number' 时
        额外带 ele: c[2]，否则完全不带 ele 这个 key。
      error_cases:
        - { condition: "坐标第三位存在但非 number", behavior: "产出的点不带 ele 字段" }
    - name: projectTrack
      behavioral_contract: |
        core.mjs:329-351 已返回 { points, fullSize }，本单元不改动它。
        该漂移在 T2 删除内联副本时自然消解。
    - name: 移除
      behavioral_contract: |
        从 core.mjs 删除 crc32 · buildStoreZip · layoutTextBlockX 三个导出，
        从 core.test.mjs 删除它们的 10 个测试块（crc32 两个、buildStoreZip 一个、
        layoutTextBlockX 七个）与随之无用的 node:child_process / node:fs / node:os import。
  dependencies: []
  reuse_candidates: |
    ele 构造与 Array.isArray 守卫两侧各已有实现，取 index.html:598 的 mk 构造 +
    core.mjs:364 的守卫合并，不新写。
  acceptance: |
    先派 test-author 就 extractGeoJSONCoords 的新契约补 visible + hidden 测试（这是本 plan
    唯一有行为变化的单元）；架构师审过后 implementer 实现。
    `node --test 'tests/**/*.test.mjs'` 与 `node --test core.test.mjs fit.test.mjs` 全绿；
    core.test.mjs 测试块数由 64 降为 54；
    `grep -n 'crc32\|buildStoreZip\|layoutTextBlockX' core.mjs core.test.mjs` 零命中。

- id: T1a
  title: UI 测试取材抽为共享模块（架构师亲做）
  file_path: tests/helpers/source.mjs, tests/{visible,hidden}/ui{Layout,Structure,Tokens,Export,Stage}.test.mjs
  functions:
    - name: 取材单一入口
      behavioral_contract: |
        五个 UI 测试族各有一套从 index.html 抓 <style> / 内联 <script> 的代码，
        在 visible 与 hidden 下各存一份，共十处。抽成 tests/helpers/source.mjs：
          readCss()  按 <style> 块与 <link rel=stylesheet> 在文档中的先后顺序拼接
          readJs()   内联 <script> 加 src/ 下全部 .mjs（按路径排序），vendor/ 不计入
          readAll()  index.html 原文 + 全部 CSS + 全部应用 JS，供「旧内容已彻底删除」类断言使用
        十个测试文件改为从它取 CSS 与 JS，body 的切分与各自的后处理逐字不动。
        helper 同时覆盖拆分前后两种形态，T1 与 T2 不需要再改它。
        本单元由架构师亲做：其中五个文件在 tests/hidden/ 下，implementer 的 persona 读不到。
  dependencies: []
  reuse_candidates: |
    十处取材代码来自五个不同作者，语义有细微差别（空白替换字符、剔除哪些块）。
    只统一「内容从哪些文件来」，各测试自己的后处理保留原样。
  acceptance: |
    tests/ 下测试数量与通过数相对改造前不变（改造前 505 全绿）。

- id: T1
  title: CSS 按主题拆为六个文件
  file_path: styles/{tokens,base,layout,forms,components,color-picker}.css, index.html
  functions:
    - name: CSS 切割
      behavioral_contract: |
        按 index.html 原始行号连续切段，顺序不变：
          tokens.css        8–9      :root 变量
          base.css          10–22    * reset · body · header · #loadSample · focus-visible
          layout.css        23–98    workspace · drop · info · stage · cardbox · scrub
                                     · dotbox · controls · step · subhead · map-subpanel
                                     · gate-hint · needs-track · 断点
          forms.css         99–126   input[type=text|range] · select · fieldrow · val
                                     · row · check · segmented · 它们的 760px 断点
          components.css    127–164  keyhelp · privacy-note · btns · button.exp
                                     · export-actions · status-btn · hint · file-list
                                     · input[type=file]
          color-picker.css  165–193  .cp-* 全部
        index.html 的 <style> 块整体删除，<head> 内按上述顺序加六条 <link rel="stylesheet">。
        边界可微调，前提是连续且总顺序不变。
  dependencies: [T1a]
  reuse_candidates: 不适用，纯切割。测试侧无需改动，T1a 的 readCss() 已覆盖 <link> 形态。
  acceptance: |
    六个 css 文件按 <link> 顺序拼接后，与原 index.html 第 8–193 行逐字节一致（diff 为空）；
    572 个测试全绿；
    `python3 -m http.server 8137` 下页面外观与拆分前一致（含 760px 断点与 820px 高度断点）。

- id: T2
  title: 应用逻辑迁出为 src/main.mjs，删除全部内联副本，第三方库移入 vendor/
  file_path: src/main.mjs, index.html, vendor/mp4-muxer.js,
             tests/{visible,hidden}/ui*.test.mjs
  functions:
    - name: 逻辑迁出
      behavioral_contract: |
        index.html 第 476–2547 行整体切成 src/main.mjs。
        删除其中与 core.mjs / fit.mjs 同名的 27 个函数副本，改为从 core.mjs / fit.mjs import。
        index.html 保留 HTML 结构，<body> 末尾放
        <script src="vendor/mp4-muxer.js"></script> 与 <script type="module" src="src/main.mjs"></script>。
        mp4-muxer.js 用 git mv 移入 vendor/，内容不动。
    - name: 内联 script 数量断言翻转（架构师亲做）
      behavioral_contract: |
        tests/{visible,hidden}/uiStructure.test.mjs 断言「页面应当只有一段内联 script」，
        它陈述的是「应用逻辑集中在一处」这条不变量。逻辑迁出后同一条不变量的形态是
        「index.html 不含内联应用逻辑」，断言改为 INLINE_SCRIPTS.length === 0 并同步改写描述。
        hidden 侧的那份由架构师亲做。
  dependencies: [T0, T1]
  reuse_candidates: 不适用，纯搬迁。
  acceptance: |
    index.html ≤ 320 行且不含 <style>、不含内联应用逻辑；
    src/main.mjs 与原 476–2547 行去掉 27 个副本后逐字符一致（守恒脚本校验）；
    572 个测试全绿；
    静态服务器下手工过完整流程（轨迹导入 · 底图 · 取色器 · 动画预览 · PNG · MP4）通过。

- id: T3
  title: core.mjs 拆为 src/core/ 七个模块
  file_path: src/core/{geo,gcj02,amap,metrics,color,track-files,export-params}.mjs,
             core.mjs, src/main.mjs, tests/**
  functions:
    - name: 领域切分
      behavioral_contract: |
        按目标构成表把 core.mjs 的 33 个导出分入七个模块，函数体逐字不动。
        gcj02.mjs 额外收纳 main.mjs 里的 gcjOutOfChina · gcjTransformLat · gcjTransformLng
        三个内部函数。amap.mjs 从 gcj02.mjs 与 geo.mjs import 它需要的换算。
        core.mjs 删除。src/main.mjs 与全部测试的 import 改指新路径。
  dependencies: [T2]
  reuse_candidates: 不适用，纯切割。
  acceptance: |
    每个 src/core/*.mjs ≤ 200 行；`git grep -c '^export' core.mjs` 报文件不存在；
    全量测试全绿（数量以 T0 交付后的实测基线为准）；守恒校验通过。

- id: T4
  title: 轨迹解析层抽出为 src/parse/
  file_path: src/parse/{index,fit,geojson,csv,xml}.mjs, src/main.mjs, fit.mjs, tests/**
  functions:
    - name: 解析层切分
      behavioral_contract: |
        parseTrackFile 进 index.mjs 并 import 其余四个模块；
        fit.mjs（原根目录文件）移入 src/parse/fit.mjs；
        extractGeoJSONCoords 进 geojson.mjs、extractTextCoords 进 csv.mjs
        （两者从 src/core/ 迁来，它们属解析层而非几何层）；
        ptFromAttrEl 与三个 XML 提取器进 xml.mjs。函数体逐字不动。
  dependencies: [T3]
  reuse_candidates: 不适用，纯切割。
  acceptance: 每个模块 ≤ 200 行；全量测试全绿；守恒校验通过。

- id: T5
  title: 高德底图运行时抽出为 src/basemap/
  file_path: src/basemap/{diagnose,image,fetch}.mjs, src/main.mjs
  functions:
    - name: 底图层切分
      behavioral_contract: |
        diagnoseAmapApiError 进 diagnose.mjs；
        loadImageFromBlob · loadImageDirect 进 image.mjs；
        fetchBasemapViaHttp · fetchAmapBasemap 与模块级内存缓存进 fetch.mjs。
        这一层做网络与 Image 解码，不碰界面 DOM，状态提示通过返回值或抛错交给 ui/map-panel.mjs。
        函数体逐字不动。
  dependencies: [T4]
  reuse_candidates: 不适用，纯切割。
  acceptance: 每个模块 ≤ 200 行；全量测试全绿；静态服务器下底图拉取与三类错误诊断路径手测通过。

- id: T6
  title: canvas 渲染层抽出为 src/render/
  file_path: src/render/{primitives,card,dot}.mjs, src/main.mjs
  functions:
    - name: 渲染层切分
      behavioral_contract: |
        hexToRgba · strokePath · drawMarker 进 primitives.mjs；
        renderCard 与 renderFrame 同进 card.mjs（两者渲染同构，同文件让同步约束在一屏内可见）；
        renderDot 进 dot.mjs。
        这一层收 canvas 与参数对象，不读界面 DOM、不读全局状态。函数体逐字不动。
  dependencies: [T5]
  reuse_candidates: 不适用，纯切割。
  acceptance: 每个模块 ≤ 200 行；全量测试全绿；静态服务器下三种渲染产物与拆分前像素一致。

- id: T7
  title: 导出层抽出为 src/export/
  file_path: src/export/{status,png,mp4}.mjs, src/main.mjs
  functions:
    - name: 导出层切分
      behavioral_contract: |
        setExportStatus · showExportBlockedStatus · updateExportKindUI · setExportKindLocked
        进 status.mjs；download · exportCard · exportDot 进 png.mjs；
        mp4Yield · mp4Supported · buildFrameOpts · pickMp4Codec · exportMp4
        · mp4BeforeUnloadHandler · setMp4BeforeUnloadGuard · onExpMp4Click 进 mp4.mjs。
        mp4.mjs 通过 window.Mp4Muxer 取 vendored 库。函数体逐字不动。
  dependencies: [T6]
  reuse_candidates: 不适用，纯切割。
  acceptance: |
    每个模块 ≤ 200 行；全量测试全绿；
    静态服务器下 PNG 导出、MP4 导出、导出中取消、导出中关页拦截四条路径手测通过。

- id: T8
  title: UI 层抽出为 src/ui/
  file_path: src/ui/{dom,state,track-errors,track-panel,map-panel,preview,controls}.mjs,
             src/main.mjs
  functions:
    - name: UI 层切分
      behavioral_contract: |
        按目标构成表切分。state.mjs 是应用状态与常量的单一持有者，其余模块从它读写；
        dom.mjs 提供 $ · bind · stepDecimals 与拖放绑定；
        其余四个模块各管一块面板。函数体逐字不动。
        main.mjs 收缩为「import + 事件绑定 + 首屏初始化」。
  dependencies: [T7]
  reuse_candidates: 不适用，纯切割。
  acceptance: |
    每个模块 ≤ 200 行；src/main.mjs ≤ 200 行；全量测试全绿；
    静态服务器下轨迹载入 · 失败提示 · 删除撤销 · 多文件重排 · gate 态切换手测通过。

- id: T9
  title: 取色器闭包拆为 src/ui/color-picker/ 四个模块
  file_path: src/ui/color-picker/{index,popup,canvas,inputs}.mjs, src/ui/controls.mjs
  functions:
    - name: 取色器切分
      behavioral_contract: |
        原 424 行 IIFE 闭包拆四个模块，闭包内共享的 state 对象移入 index.mjs 并 export，
        其余三个模块 import 它。函数体逐字不动。
  dependencies: [T8]
  reuse_candidates: 不适用，纯切割。
  acceptance: |
    每个模块 ≤ 200 行；全量测试全绿；
    静态服务器下六个颜色输入的取色器手测通过：HEX/RGB/HSL 三段切换 · SV 面板拖拽
    · 色相条拖拽 · 吸管 · 模式记忆 · Esc 关闭 · 点击外部提交。

- id: T10
  title: 测试收拢为单一入口
  file_path: tests/unit/{core,fit}.test.mjs, DEVFLOW.md 的命令表
  functions:
    - name: 测试重组
      behavioral_contract: |
        根目录 core.test.mjs · fit.test.mjs 用 git mv 移入 tests/unit/，
        import 路径改指 src/core/ 与 src/parse/ 下的对应模块。断言主体逐字不动。
        全量测试统一为一条命令 `node --test 'tests/**/*.test.mjs'`。
  dependencies: [T9]
  reuse_candidates: 不适用。
  acceptance: |
    `node --test 'tests/**/*.test.mjs'` 一条命令跑出全量测试全绿，
    数量等于 T0 交付后的实测基线；仓库根目录不再有 *.test.mjs。

- id: T11
  title: 文档全面更新，推翻单文件与 file:// 前提
  file_path: AGENTS.md, PROJECT.md, PATTERNS.md, TECHSTACK.md, DEVFLOW.md, README.md
  functions:
    - name: 文档同步
      behavioral_contract: |
        全部改为只陈述当前事实：多文件 ES module 结构、本地起静态服务器、
        core 层是浏览器与 Node 共用的单一实现。
        AGENTS.md 铁律 1 陈述：按层分模块的多文件结构，无构建步骤、无包管理器，
        第三方库 vendored 在 vendor/，本地开发起静态服务器。
        AGENTS.md 铁律 2 陈述：src/core 与 src/parse 的纯函数在 Node 下单测，浏览器 import 同一份。
        AGENTS.md 铁律 4 的测试命令统一为一条。
        AGENTS.md 铁律 5 的渲染同构约束改为指向 src/render/card.mjs。
        TECHSTACK.md：浏览器运行时改为 ES module；目录结构改为新树；
        vendored 库路径改为 vendor/；外部服务一节写明高德静态图是唯一的运行时外部请求。
        DEVFLOW.md：本地运行改为 python3 -m http.server 8137；测试命令统一为一条。
        PATTERNS.md：架构原则改为按层分模块与各层职责边界
        （core 零浏览器 API · parse 分格式 · basemap 只做网络与解码 · render 要 canvas
        不碰界面 DOM · export 收产物 · ui 是唯一碰界面 DOM 的一层）；
        模块边界一节陈述这些层的依赖方向为单向向下。
        PROJECT.md：模块地图改为新文件清单与职责。
        README.md：本地运行方式改为起静态服务器，文件清单改为新结构。
      error_cases:
        - { condition: "某文档陈述与实际文件结构不符", behavior: "以实际 ls 输出与实际执行的命令为准" }
  dependencies: [T10]
  reuse_candidates: 不适用。
  acceptance: |
    grep 六份文档确认无 "file://"、无 "双击"、无 "单文件"、无 "副本"、无 "抄"、
    无任何改动前后的对照叙述；
    DEVFLOW.md 每条命令实际执行通过；
    TECHSTACK.md 目录结构与实际 ls 输出逐行一致。
```

## Dependency Graph

```
T0（core 权威化）  T1a（测试取材共享模块）
        │                 ↓
        │            T1（CSS 六拆）
        └──────┬──────────┘
               ↓
          T2（JS 迁出 main.mjs + vendor/）
               ↓
          T3（core 层七拆）
               ↓
          T4（parse 层）
               ↓
          T5（basemap 层）
               ↓
          T6（render 层）
               ↓
          T7（export 层）
               ↓
          T8（ui 层）
               ↓
          T9（取色器四拆）
               ↓
          T10（测试收拢）
               ↓
          T11（文档）
```

T3 至 T9 依次改动 `src/main.mjs`，按同文件串行。T0 与 T1 无文件交集，可并行。

## Execution Waves

| Wave | 单元 | 并行性 |
|---|---|---|
| 1 | T0, T1a | 可并行 |
| 2 | T1 | — |
| 3 | T2 | — |
| 4 | T3 | — |
| 5 | T4 | — |
| 6 | T5 | — |
| 7 | T6 | — |
| 8 | T7 | — |
| 9 | T8 | — |
| 10 | T9 | — |
| 11 | T10 | — |
| 12 | T11 | — |

## 迁移正确性策略

**测试先于实现的适用方式。** T0 是本 plan 唯一带行为变化的单元
（`extractGeoJSONCoords` 的 `ele` 与守卫契约），它走完整的 test-first：
`@test-author` 从 spec 写 visible + hidden 测试 → 架构师审正确性与覆盖度 →
`@function-implementer` 实现。
T1–T11 是行为零变化的搬迁，spec 就是「搬完之后既有 572 个测试仍全绿」，
既有测试即该单元的测试，implementer 直接实现并以全量测试 + 守恒校验自验收。

**按行号切割，不手抄。** 每个搬迁单元用 `sed -n '<start>,<end>p'` 取源码段，
再补 `import` / `export`。

**守恒校验。** 每个搬迁单元交付时附带校验：把新模块的函数体与源文件对应行号段做 `diff`，
除 `import` / `export` 关键字外应为空。CSS 单元的校验是六个文件按 `<link>` 顺序拼接后
与原 `<style>` 内容 `diff` 为空。校验脚本一次性使用，不提交。

**测试是行为不变的唯一判据。** 现有测试的断言主体逐字不动，只改取材来源与 import 路径 ——
断言主体的 diff 为空是每个单元的验收项。

**手工流程是渲染与网络路径的判据。** 静态断言测不到 canvas 像素与 fetch 行为，
T2 · T5 · T6 · T7 · T9 各自的 acceptance 里写明该单元必须手测的路径。

## Status

In Progress —— 已落 plan，待用户批准 BACKLOG 后开工 Wave 1。
