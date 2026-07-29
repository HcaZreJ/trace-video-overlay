# Feature: 工作台信息层级重设计（index.html 纯 UI 改造）

## Status
Completed — T0–T4 全部落地，§7 验收清单逐条通过。

## Overview
现状工作台的视觉层级与用户的任务模型脱节：输入（轨迹）、样式（外观调节）、输出（导出）被摆成四个外观完全相同的并列卡片；颜色设置用全宽大色块呈现，把截图转成灰度后，这些色块比预览卡片更抢眼；「定位点」一个概念散落在左舞台、样式区、导出按钮三处，靠三段灰色小字互相解释。本 plan 把页面重排成「① 轨迹 → ② 样式 → ③ 导出」的流程结构，让每个视觉差异都编码一个信息差异。

改造范围只有 index.html 的 CSS / HTML / 交互 JS。core.mjs、fit.mjs、渲染数学（renderCard / renderFrame / renderDot 的绘制逻辑）、解析器、MP4 管线全部保持原样。

## Intent Brief
- **Goal**：用户打开页面第一眼就知道「先做什么、能调什么、最后拿到什么」；每个按钮的用途从它的位置和层级就能读出来。
- **Motivation**：现状各个按钮的用途需要读小字才能理解，信息层级混乱。
- **Success criteria**：完成后跑本文 §7 验收清单，逐条通过；空状态与载入态的截图通过灰度测试（唯一焦点分别是 drop 区与预览卡片）。
- **Non-goals**：见 §5。

## 一、功能全景清单

页面全部能力（= 重设计必须逐项保留的行为）：

**输入**
- 拖放或点击选择多格式轨迹文件（GPX / KML / TCX / FIT / GeoJSON / CSV），页面任意位置都可以拖放
- 多个文件按列表顺序首尾拼接成一条轨迹；文件列表每行有：序号、文件名、格式与点数、上移 / 下移 / 删除按钮；删除后 5 秒内可以撤销
- 解析失败提示（列出失败的文件名 + 格式帮助 + 关闭按钮）
- 示例轨迹一键载入（sample-ride.gpx 可访问时入口才出现）

**预览（左舞台，所见即所得）**
- 卡片预览 canvas（棋盘格衬底表示透明）
- 动画预览：播放 / 暂停按钮 + 进度扫拨条，预览时长与 MP4 的时长设置联动
- 轨迹摘要一行：合并 N 个文件 · M 个轨迹点 · 约 K km
- 定位点预览（白环 + 彩色核，尺寸和颜色实时反映设置）

**样式调节**
- 卡片背景二选一：纯色 / 高德地图底图
  - 纯色：底色 + 不透明度（导出的 PNG 保留透明度）
  - 地图：Web 服务 API Key（存 localStorage + 申请教程折叠块）、实时路况开关、铺满或加黑蒙层（蒙层不透明度可调）、取景缩放、手动重新拉取底图、拉取状态反馈（含 key 类型错误的中文诊断）、隐私声明；参数变化后 600ms 防抖自动重新拉取
- 卡片形状：圆角、内边距
- 线路：颜色、线宽
- 起点 / 终点标记：显示开关、起点颜色、终点颜色、标记大小
- 定位点：颜色、大小
- 所有颜色都走自定义 color picker（SV 面板 + 色相条 + 吸管 + HEX/RGB/HSL 分段切换，模式存 localStorage）
- 每个滑杆旁边都有一个数字输入框，两者双向同步

**导出**
- 分辨率 720 / 1080 / 1440（PNG 与 MP4 共用）
- 卡片 PNG（透明底、不含定位点）
- 定位点 PNG（高清、含投影留白）
- MP4 动画（时长 1–600 秒、帧率 24/30/60、画布可选卡片底或绿幕、导出中可取消、有进度百分比、导出中关闭页面会被拦截确认、浏览器不支持 WebCodecs 时禁用并提示）
- 地图模式下底图缺失时导出中止，提供「重试」和「改用无底图导出」两个出口
- 导出结果状态行（成功提示 6 秒后自动消失，失败提示常驻）

**横切**
- 未载入轨迹时，样式与导出区不可用（gate）
- a11y：label 关联、aria-live、键盘可达、focus-visible、inert

## 二、目标信息层级（先定大纲，再上样式）

页面按一条流程组织：载入轨迹文件 → 在预览里调样式 → 导出成剪映素材。

```
├─ Header
│    标题 + 一句话说明用途
│
├─ 左舞台（sticky，页面唯一的大视觉焦点）
│    卡片预览 canvas
│    ├─ 动画预览条（播放按钮 + 扫拨条 + 「动画预览 · N 秒」）
│    └─ 轨迹摘要行（元信息，灰色小字）
│
└─ 右列（工作流，三步，用序号表达先后顺序）
     ① 轨迹 ─ 输入
     │    drop 区（内含「试试示例轨迹」入口）
     │    文件列表 / 解析错误提示 / 撤销提示
     ② 样式 ─ 调节（未载入轨迹时不可用）
     │    卡片   背景来源 segmented（纯色｜地图底图）
     │    │        └ 地图配置嵌套子面板（key / 路况 / 蒙层 / 取景缩放 / 重新拉取 / 状态 / 隐私声明）
     │    │      底色 + 不透明度 · 圆角 · 内边距
     │    线路   颜色 · 线宽 · 起点终点标记（开关 + 两个颜色 + 大小）
     │    定位点 颜色 · 大小 · 就地小预览
     ③ 导出 ─ 输出（未载入轨迹时不可用）
     │    分辨率（两种产物共用）
     │    产物切换 segmented（贴图 PNG｜动画 MP4）
     │        贴图 PNG 面板：一句剪映用法说明
     │        动画 MP4 面板：时长 · 帧率 · 画布（卡片/绿幕）· 浏览器不支持时的提示
     └─ 吸底动作条（页面上唯一使用强调色的地方）
          主按钮（随产物切换）+ 贴图模式的次按钮 + 状态行 / 进度条
```

层级自检：右列第一层的并列成员是 3 个步骤，共同类别是「步骤」，先后顺序由序号表达；② 内第二层的并列成员是 3 个子组（卡片 / 线路 / 定位点），共同类别是「画面上的视觉对象」；③ 内的并列成员是 2 种导出产物。每一层并列数都不超过 4 ✓。

## 三、视觉 token 规范

### 3.1 颜色（每种颜色只有一个含义，全站一致）
| token | 值 | 唯一含义 |
|---|---|---|
| `--bg` | `#0d0f12` | 页面底色 |
| `--panel` | `#171a1f` | 容器底色（只用在三处：吸底动作条、地图嵌套子面板、color picker 弹层）|
| `--line` | `#262b33` | 分隔线 / 控件边框 |
| `--fg` | `#e6e9ef` | 内容文字 |
| `--dim` | `#8a93a2` | 元信息文字（可跳过的说明层）|
| `--accent` `#0a84ff` / `--accent-strong` `#0066cc` | 蓝 | 主动作按钮、链接、focus ring。**同一屏里蓝色的界面元素最多出现一处（即吸底条的主按钮）** |
| `#34c759` 绿 | 状态文字 | 只用于成功反馈 |
| `#ff9f0a` 黄 | 状态文字 | 只用于警告反馈 |
| `#ff453a` 红 | 状态文字 / 边框 | 只用于错误提示、删除按钮的悬停态、非法输入 |

- segmented 的选中态用中性高对比配色：`background:#39404d; color:#fff`。选中态的含义是「当前所处的位置」，与蓝色的「主动作」区分开。
- 所有 hover 效果只改变亮度（`filter:brightness(1.15)` 或换成更亮的背景 `#2a2f37`），hover 时颜色的色相保持不变。唯一例外：文件列表里的 ✕ 删除按钮 hover 时变红，表达删除警示。
- 画布内的内容颜色（线路的黄、起点的绿、终点的红、定位点的蓝）是用户自选的数据，可以是任何颜色，上面的语义约束只管界面控件。

### 3.2 字号层级（一屏之内只有三档）
| 档 | 规格 | 用途 |
|---|---|---|
| 页标题 | 17px / 600 | 只有 header 的 h1 |
| 区标题 | 14px / 600 / `--fg` | 「① 轨迹」「② 样式」「③ 导出」 |
| 子组标题 | 13px / 600 / `--fg` | 「卡片」「线路」「定位点」等 |
| 控件 label | 13px / 400 / `--fg` | 所有可操作项的文字。**操作性文字一律用前景色（亮色），灰色只留给元信息** |
| 元信息 | 12px / 400 / `--dim` | 说明文字、轨迹摘要等可跳过的内容 |

现有的 10px 和 11px 全部取消，就近升为 12px。数字类内容（滑杆旁的数值框、轨迹摘要、进度百分比）加 `font-variant-numeric:tabular-nums`，让数字等宽对齐。

### 3.3 分组与容器（用间距表达分组，边框容器只表达两种含义）
- 右列的三个步骤之间取消边框卡片包裹，改用「区标题 + 大间距 + 1px 分隔线」表达分组。**保留边框容器的只有两处**：吸底动作条（含义 = 悬浮层）和地图配置嵌套子面板（含义 = 从属层，样式为 `--panel` 底色 + 左侧 2px `--line` 竖线 + 12px 缩进）。
- 间距体系：field 内部 label 到控件 6px；field 与 field 之间 12px；子组与子组之间 24px；步骤与步骤之间 36px。组与组之间的间距至少是组内间距的 1.5 倍。

### 3.4 控件统一样式
- 颜色设置合并为一行：左边是 label，右边是一个 28×28、圆角 6px 的色块（swatch，点击后打开取色器），色块右侧用 12px 灰字显示当前 hex 值。起点和终点的两个颜色合并在同一行。**全宽的颜色条取消，整个页面只允许预览卡片是大面积色块。**
- select 下拉框（分辨率 / 帧率 / 画布）统一为自定义外观：和文本输入框相同的底色与边框，`appearance:none`，右侧内嵌一个 chevron 箭头（CSS 三角或内联 SVG），高 32px。
- 滑杆行、数字输入框、checkbox 沿用现有范式，尺寸统一（数值框宽 64px、高 32px）。
- 同一子组内的所有 field，标题的有无、字号、颜色保持完全一致。

## 四、逐区域设计说明（含定稿文案）

### 4.1 Header
- h1「轨迹贴图 · 剪辑素材导出」17/600。
- 副标题一句（12px `--dim`）：`把骑行轨迹导出成剪映可用的透明 PNG 贴图和 MP4 动画，文件全程在本地处理`。文件格式清单从副标题移除（drop 区已经列了）。
- 「试试示例轨迹」按钮从 header 移除，入口移进 4.3 的 drop 区。header 右侧留空。

### 4.2 左舞台
- 内容从上到下：卡片预览 → 动画预览条 → 轨迹摘要行。定位点预览和它的两行说明移出舞台，去向见 4.4 的定位点组。
- 空状态时 canvas 内的文案改为：主行 `拖入轨迹文件，或点击这里选择文件`，副行（示例轨迹可用时才显示）`也可以先载入示例轨迹`。空状态下点击 cardbox 触发文件选择（复用 `$('file').click()`），载入轨迹后移除这个点击行为。
- 动画预览条与轨迹摘要行的样式不变（label 用 12px `--dim`，属于元信息，合规）。

### 4.3 ① 轨迹
- 区标题 `① 轨迹`。
- drop 区主行：`拖入轨迹文件，或点击选择。可以一次选多个，多条轨迹会按列表顺序连成一条`；小字：`支持 .gpx / .kml / .tcx / .fit / .geojson / .csv；文件全程在本地处理，不会上传`。主行里的「点击选择」用 `--fg` 加粗，不使用 accent。
- `试试示例轨迹`（id 保持 `loadSample`）是 `.drop` 的**兄弟节点**，紧贴 drop 区下方 8px，样式为 12px accent 链接式按钮。`.drop` 自身是 `role="button"`，把可交互元素放在它内部会产生嵌套交互语义，因此改为紧邻放置；视觉上仍读作 ① 轨迹这一步的一部分。
- `loadSample` 的 `hidden` 属性继续只表达「示例文件可访问」这一件事（renderCard 的空状态副行沿用它做判断）。载入轨迹后由 `body.has-track` 驱动 CSS 隐藏这个链接，保证载入态一屏里蓝色界面元素只剩吸底条主按钮。
- 文件列表行为不变；上移 / 下移按钮 hover 时加亮，✕ 删除按钮 hover 时变红。
- 解析错误提示块和撤销提示块沿用现有实现，文案不动。

### 4.4 ② 样式
区标题 `② 样式`，下辖三个子组（子组标题 13/600）：

**卡片**
1. 背景来源 segmented，选项文案 `纯色` / `地图底图`（需要 key 这件事下沉到子面板里说，segmented 选项保持短词）。
2. 选「地图底图」时展开嵌套子面板（样式见 3.3 的从属层），内容从上到下：
   - key 输入框（label `高德 Web 服务 API Key`），下方链接 `前往高德开放平台申请 key（免费）`，链接下保留现有的 details 折叠教程，教程原文不动
   - `显示实时路况` checkbox
   - 底图样式 radio：`铺满` / `加黑蒙层`；选「加黑蒙层」时展开 `蒙层不透明度（%）` 滑杆
   - `取景缩放（×）` 滑杆，说明一句：`调整轨迹在卡片中所占的比例；数值调小后底图会缩小，露出的边缘显示「底色」里设置的颜色`
   - `重新拉取底图` 次级按钮 + 拉取状态行（aria-live 保留）
   - 隐私声明（12px `--dim`）：`开启地图底图后，轨迹范围的坐标会发送给高德用于获取底图，其余处理仍然全部在本地完成；key 只保存在你自己的浏览器里`
3. `底色` 颜色行 + `不透明度（%）` 滑杆，说明一句：`导出的 PNG 会保留这里设置的透明度`（地图模式下底色垫在底图下面这个细节，由上面取景缩放的说明承载，这里只说一件事）。
4. `圆角（px）` / `内边距（px）` 两个滑杆。

**线路**
- `颜色` 颜色行、`线宽（px）` 滑杆。
- `显示起点 / 终点` checkbox；勾选后在它下方显示一行 `起点` `终点` 两个 swatch，以及 `标记大小（px）` 滑杆。

**定位点**
- 子组标题所在的行，右侧放一个内联小预览（32px 棋盘格盒子 + 现有的 #dot canvas 缩放显示，实时反映颜色和大小设置）。
- `颜色` 颜色行、`大小（px）` 滑杆。
- 说明一句（12px `--dim`）：`定位点是沿线路移动的圆点，会出现在预览和 MP4 动画里；轨迹卡片 PNG 不包含它，用「导出定位点 PNG」单独导出`。页面上关于定位点规则的说明只保留这一处。

### 4.5 ③ 导出 + 吸底动作条
区标题 `③ 导出`。
1. `分辨率（PNG 与 MP4 共用）` select：720 × 720 / 1080 × 1080 / 1440 × 1440。
2. 产物切换 segmented：`贴图 PNG` / `动画 MP4`，选中项存 localStorage（key 名 `exportKind`，默认 `png`）。
   - **贴图 PNG 面板**：没有参数，只有一句用法说明（12px `--dim`）：`会导出两张图：轨迹卡片和定位点。在剪映里把卡片当作画中画放在角落；把定位点也拖进去，沿线路打几个位置关键帧，它就会跟着线路移动`。
   - **动画 MP4 面板**：`时长（秒）` 数字输入框（clamp 逻辑保留；说明一句：`最长 600 秒；1080p 的文件大小约为每分钟 90 MB`）、`帧率` select、`画布` select（`卡片` / `绿幕`）以及对应的颜色行：选卡片时显示 `画布颜色（卡片圆角以外的部分）`（说明一句：`卡片本体的底色仍然用「底色」里的设置`），选绿幕时显示 `绿幕色`；浏览器不支持 WebCodecs 时显示提示行（文案沿用现有的 `当前浏览器不支持视频编码，导出 MP4 需要新版 Chrome / Edge / Safari`）。
3. 吸底动作条（悬浮容器，页面上唯一出现蓝色按钮的地方）：
   - 贴图 PNG 模式：`导出卡片 PNG`（主按钮，蓝）+ `导出定位点 PNG`（次按钮，灰）。
   - 动画 MP4 模式：`导出 MP4`（主按钮，蓝；导出过程中文字变为 `取消导出`）+ 进度条 + 百分比。
   - 状态行（成功绿 / 失败红 / 进行中灰，aria-live）以及底图缺失时的导出中止提示（`重试` / `改用无底图导出` 两个按钮）逻辑全部保留，只是跟随容器换位置。
   - 导出过程中禁用其余导出按钮的现有互斥逻辑保留。
   - 卡片 PNG 导出成功的提示简化为 `已下载「轨迹卡片.png」`（「不含定位点」的解释已由 4.4 的定位点说明和本面板的用法说明承担，提示里不再重复）。

### 4.6 状态与反馈（全站统一样式）
成功 = `✓ ` 前缀绿字、错误 = `✕ ` 前缀红字、警告 = 黄字、进行中 = 灰字。这四种现有状态保留，作为全站唯一的状态样式，用于：地图拉取状态、导出状态、解析错误、撤销提示。状态行内的小按钮统一用现有的 `.status-btn` 样式。

### 4.7 空状态与 gate
- 未载入轨迹时：②③ 两个区只渲染「区标题行」（45% 透明度 + inert），区内容 `display:none`；「载入轨迹后可用」这句 12px `--dim` 提示只出现一次（id 保持 `trackGateHint`），放在 ② 的标题行右侧。载入轨迹后展开内容并解除 inert（沿用现有 `[data-gate]` 机制，收起和展开由 `.needs-track` 类驱动 CSS）。
- `setTrackGate(hasTrack)` 在现有逻辑之外同步 `document.body.classList.toggle('has-track', hasTrack)`，让 CSS 能按轨迹状态控制示例轨迹链接等舞台外元素的显示。
- 吸底动作条在空状态下不渲染；主按钮的蓝色只在按钮可用时出现。
- 空状态下逐个检查可交互元素：只剩 drop 区、画布点击、示例轨迹链接三个入口，且三者是同一个动作（载入轨迹），焦点唯一。

### 4.8 Color picker 弹层
交互与逻辑不动。只对齐 token：内部的 10px label 升为 12px、吸管按钮 hover 改为只变亮度、segmented 选中态改用 3.1 的中性配色。

### 4.9 响应式（≤760px）
- 单列顺序：header → 舞台（sticky 在顶部）→ ① → ② → ③ → 吸底动作条。现有断点行为保留，触控尺寸（40px 按钮）保留。
- 三步的区标题在窄屏下样式不变。

## 五、不改动的部分（Non-goals）
- core.mjs / fit.mjs / tests / mp4-muxer.js 零改动；index.html 内联的纯函数副本（投影、GCJ-02、颜色转换等）零改动。
- renderCard / renderFrame / renderDot 的绘制数学与「renderCard 改动必须同步 renderFrame」的同构关系零改动。本次只改 renderCard 的空状态提示文字；renderFrame 没有空状态分支，不构成同构问题。
- 解析、拼接、撤销、地图 fetch / 诊断 / 缓存、MP4 编码管线、导出中关页拦截的逻辑零改动。
- 元素 id 与现有 JS 绑定尽量保留：优先移动现有元素的位置，避免重命名 id，减少需要改动的 JS 绑定数量。
- a11y 能力只增不减：label 关联、aria-live、role、inert、focus-visible 全部保留。

## 六、工作单元拆分（全部改同一个 index.html → 严格串行执行）

测试载体：本次改动全部落在 `index.html` 的 CSS / HTML / 交互 JS，没有新增纯函数，因此测试是
**对 index.html 源文件的结构不变量断言**（node:test 读文件 + 正则/解析），分成一个常绿的回归网
（T0）和四份目标态断言（T1–T4 各一份，写完先对当前文件跑一遍确认 FAIL，对应单元完成后转 PASS）。
运行时行为由架构师用无头 Chrome + CDP 驱动核验（§7 第 2 条）。

| 单元 | 内容 | 验收 |
|---|---|---|
| T0 结构不变量回归网 | `tests/{visible,hidden}/uiStructure.test.mjs`：内联 script 里每个 `$('id')` / `getElementById('id')` 都能在 HTML 里找到对应 id；每个 `label[for]` 都有目标；66 个基线 id 一个不少；内联 script 用 `new Function` 编译通过；aria-live / role / inert 相关属性齐全 | 对改造前的 index.html 直接全绿，T1–T4 每一步之后仍全绿 |
| T1 视觉 token 与控件统一 | §3 全部：字号层级、颜色语义、segmented 选中态改中性色、hover 只变亮度、颜色行改为 label + 28×28 swatch + hex 灰字、select 自定义外观、tabular-nums、间距规格定义为 CSS 变量 | 页面无布局破损；把截图转成灰度后，除预览画布外没有大面积色块 |
| T2 右列信息架构重排 | §4.3–4.4：三步区标题、取消步骤间的边框卡片、地图嵌套子面板、线路与定位点子组重排、说明文案换成 §4 定稿 | 所有控件功能可用；每层并列成员 ≤4；同一子组内控件样式一致 |
| T3 导出区产物切换 | §4.5：产物 segmented + 两个参数面板 + 吸底条按钮随产物切换 + localStorage 记忆 | PNG / 定位点 / MP4 三种导出、取消、进度、底图缺失中止与重试全部可用 |
| T4 舞台精简 + 空状态 | §4.2、§4.4 的定位点预览迁移、§4.7 的 gate 收起与展开、示例轨迹链接移入 drop 区、空状态点击画布选文件 | 空状态焦点唯一；载入轨迹后展开、清空轨迹后收起，来回切换都正常 |

执行顺序 T0（测试资产，不改 index.html）→ T1 → T2 → T3 → T4。T1–T4 都改同一个文件，两个单元并行编辑会互相覆盖，必须做完一个再做下一个。每个单元完成后跑一遍 T0 回归网 + 该单元的目标态断言 + §7 第 1 条的既有测试，再进下一个。

## 七、验收清单
1. `node --test 'tests/**/*.test.mjs'` 与 `node --test core.test.mjs fit.test.mjs` 全绿。本次改造不触碰任何被测函数，测试变红说明改坏了本不该动的逻辑。
2. 手工回归（无头浏览器或真浏览器），按顺序验证：载入示例轨迹；调整样式；完整操作一遍地图 key 流程（包括 key 类型错误的诊断文案）；执行三种导出；在 MP4 导出过程中取消；删除文件后撤销；清空全部文件，确认页面回到空状态。
3. interface-design 单屏自检，对空状态与载入态的截图各跑一遍：
   - 灰度 / 眯眼测试：空状态的唯一焦点是 drop 区；载入态的唯一焦点是预览卡片。
   - 用一句话概括每屏的目标：空状态是「载入轨迹」；载入态是「调整样式并导出」（导出动作集中在吸底条，不构成第二条叙事线）。
   - 逐个数并列组：每组成员 ≤4，组内样式一致。
   - 同一屏里蓝色界面元素 ≤1 处（吸底条主按钮）；红色只出现在错误提示和删除警示。
   - 屏内字号只有 14 / 13 / 12 三档（页标题 17 除外）；逐处检查灰色小字，确认都是元信息。
4. a11y 抽查：Tab 键走查顺序合理；gate 收起时 ②③ 区不可聚焦；aria-live 状态播报正常。

## 八、待用户确认的决策点
| # | 决策 | 推荐 | 备选 |
|---|---|---|---|
| D1 | 导出区加「贴图 PNG / 动画 MP4」产物切换，参数面板与主按钮随之切换 | 采纳。「贴图 = 卡片 + 定位点两张图、MP4 = 一段动画」这条规则由结构直接表达，三处互相解释的小字可以删掉 | 保守版：不加切换，只重排分组和按钮主次 |
| D2 | 定位点预览从左舞台迁入 ② 样式的定位点组，改为子组标题旁的内联小预览 | 采纳。定位点的控件集中到一处，舞台只留卡片一个焦点 | 留在舞台原位，只删掉两行长说明 |
| D3 | 空状态下 ②③ 收起成置灰标题行、吸底动作条不渲染 | 采纳。空状态焦点唯一 | 维持现状的整块置灰但保持展开（能预告后续功能，代价是空状态噪声大）|
| D4 | 右列取消步骤间的边框卡片，边框容器只保留吸底动作条和地图子面板两处 | 采纳。让「有边框的容器」只表达悬浮和从属两种含义 | 保留四个卡片的外观，只改内部布局 |

## 九、目标态断言清单（T0–T4 测试规格）

测试形态：`node:test` + `node:assert/strict`，零依赖。用 `fs.readFileSync` 读 `index.html`，
把它切成三段——`<style>…</style>` 里的 CSS、`<body>` 里的 HTML、末尾内联 `<script>` 里的 JS——
再对这三段做断言。断言写成对空白与顺序宽容的形式（先把待测片段的空白折叠再比较），
只钉住本清单点名的语义，不钉住无关的声明文本。测试名前缀 = 单元名，例如
`test('uiTokens: segmented 选中态使用中性高对比配色', …)`。

### T0 · uiStructure（常绿回归网）
1. 内联 script 里每一个 `$('xxx')` 与 `getElementById('xxx')` 引用的 id，都能在 HTML 里找到
   对应元素；运行时动态创建的 `exportRetryBtn` / `exportNoBasemapBtn` 允许缺席。
2. 每个 `label for="xxx"` 都有对应 id。
3. 基线 id 清单一个不少（66 个，见下）。id 允许新增，不允许减少。
   `loadSample card previewScrub previewScrubLabel previewPlay previewProgress info dot
    drop trackGateHint file fileList trackErrors trackUndo bgModeSegmented bgModeSolidLabel
    bgModeSolid bgModeMapLabel bgModeMap mapOverlay bgColor bgOpacity bgOpacityV bgMapFields
    amapKey mapTraffic mapMaskOpacityField mapMaskOpacity mapMaskOpacityV mapViewScale
    mapViewScaleV mapPreview mapOverlayStatus radius radiusV pad padV lineColor lineWidth
    lineWidthV showMarkers startColor endColor markerSize markerSizeV dotColor dotSize dotSizeV
    exportRes mp4UnsupportedHint mp4Duration mp4Fps mp4BgMode mp4PageColorField mp4PageColor
    mp4GreenColorField mp4GreenColor mp4ProgressWrap mp4ProgressV mp4Progress exportStatus
    expCard expDot expMp4 exportRetryBtn exportNoBasemapBtn`
4. 内联 script 整段能被 `new Function(src)` 编译通过（语法闸门，不执行）。
5. a11y 属性齐全：`aria-live="polite"` 至少出现在 `#info` `#trackErrors` `#trackUndo`
   `#mapOverlayStatus` `#exportStatus` 五处；`#drop` 带 `role="button"` 与 `tabindex="0"`；
   `#card` 与 `#dot` 带 `role="img"` 与 `aria-label`；每个 `input.val` 带 `aria-label`；
   每个 segmented 容器带 `role="radiogroup"` 与 `aria-label`。
6. 内联 script 里 `setTrackGate` 对 `[data-gate]` 同时设置 `classList.toggle('needs-track', …)`
   与 `inert`。
7. 每个 `<input type="color">` 的 id 都在 `COLOR_INPUT_IDS` 数组里，反之亦然（7 个）。

### T1 · uiTokens（目标态）
1. CSS 里出现的所有 `font-size:<N>px` 的 N 值集合 ⊆ `{17,14,13,12}`；HTML 的 inline style 里
   也不出现 `font-size:10px` / `font-size:11px`。
2. `header h1` 的 font-size 为 `17px`。
3. `.seg-opt.active` 的 background 为 `#39404d`、color 为 `#fff`，且不含 `var(--accent-strong)`。
4. CSS 里任何 `:hover` 选择器的规则体都不出现 `var(--accent-strong)` 或 `var(--accent)`
   作为 background；唯一允许出现红色 `#ff453a` 的 hover 规则是文件列表删除按钮
   （选择器含 `[data-act="del"]` 或 `[data-act=del]`）。
5. `.cp-swatch` 的 width 与 height 均为 `28px`、border-radius `6px`，且规则体不含 `width:100%`。
6. 七个颜色输入所在的行都是 `.color-row` 结构，行内含一个 `data-hex-for="<对应 id>"` 的元素；
   七个 id 各出现一次。
7. 内联 script 里有把 `data-hex-for` 元素文本同步为对应 input 值（大写 hex）的逻辑，
   并在颜色 input 的 `input` 事件上接线。
8. CSS 里 `select` 的规则含 `appearance:none` 与 `-webkit-appearance:none`、`height:32px`，
   且含内嵌箭头（`background-image` 带 `data:image/svg+xml`，或 `.select-wrap::after` 三角）。
9. `font-variant-numeric:tabular-nums` 至少覆盖 `input.val`、`#info`、`#mp4ProgressV`、
   `.file-meta` 四个选择器（可以写在一条选择器列表里）。
10. `:root` 定义四个间距变量：`--sp-label:6px`、`--sp-field:12px`、`--sp-group:24px`、
    `--sp-step:36px`，且 CSS 里至少各被 `var()` 引用一次。
11. `.field label` 的 color 为 `var(--fg)`、font-size `13px`；`.field small` 为 `12px` +
    `var(--dim)`。
12. `.drop strong` 的 color 为 `var(--fg)`（不再是 accent）。

### T2 · uiLayout（目标态）
1. 右列有三个步骤容器 `.step`，各自的 `<h2>` 文本分别以 `① 轨迹`、`② 样式`、`③ 导出` 开头，
   顺序一致；旧的 `.section` 卡片类不再用于这三个容器。
2. `.step` 的规则体不含 `border:1px solid var(--line)`，也不含 `background:var(--panel)`。
3. 三个步骤不再被卡片容器包裹：CSS 里同时带 `background:var(--panel)` 与实线
   `border:1px solid var(--line)` 的规则，选择器只允许出现在这个白名单里——
   `.export-actions`（悬浮层）、`.map-subpanel`（从属层）、`.cp-popup`（取色器弹层）、
   `.file-row`（文件列表的列表行）。`.step` 与任何包住步骤的选择器都不得出现在这类规则里。
   `.drop` 用虚线 `dashed` 边框，不受这条约束。
4. `.map-subpanel` 规则存在，含 `background:var(--panel)`、`border-left:2px solid var(--line)`、
   `padding-left:12px`（或等效的 12px 缩进声明）；`#bgMapFields` 带上这个 class。
5. `#bgMapFields` 内部依次包含 `amapKey`、`mapTraffic`、`mapOverlayMode` 单选、
   `mapMaskOpacityField`、`mapViewScale`、`mapPreview`、`mapOverlayStatus`。
6. ② 区内三个子组标题 `.subhead` 文本依次为 `卡片`、`线路`、`定位点`；`.subhead` 的
   font-size 为 `13px`、font-weight `600`、color `var(--fg)`。
7. `radius`、`pad`、`bgColor`、`bgOpacity`、`bgModeSegmented` 都落在「卡片」子组内
   （即位于 `卡片` 子组标题之后、`线路` 子组标题之前）。
8. `startColor` 与 `endColor` 落在同一个 `.color-pair` 容器里。
9. 下列定稿文案逐条出现在 HTML 中（比较前把连续空白折叠成单空格）：
   - `把骑行轨迹导出成剪映可用的透明 PNG 贴图和 MP4 动画，文件全程在本地处理`
   - `拖入轨迹文件，或点击选择。可以一次选多个，多条轨迹会按列表顺序连成一条`
   - `支持 .gpx / .kml / .tcx / .fit / .geojson / .csv；文件全程在本地处理，不会上传`
   - `前往高德开放平台申请 key（免费）`
   - `调整轨迹在卡片中所占的比例；数值调小后底图会缩小，露出的边缘显示「底色」里设置的颜色`
   - `导出的 PNG 会保留这里设置的透明度`
   - `开启地图底图后，轨迹范围的坐标会发送给高德用于获取底图，其余处理仍然全部在本地完成；key 只保存在你自己的浏览器里`
   - `定位点是沿线路移动的圆点，会出现在预览和 MP4 动画里；轨迹卡片 PNG 不包含它，用「导出定位点 PNG」单独导出`
10. 下列旧文案不再出现：`地图底图（需免费 key）`、`纯色模式下是卡片底`、
    `定位点只出现在预览与 MP4 里`、`开启后轨迹范围坐标会发送给高德`、
    `把 GPX / KML / TCX / FIT / GeoJSON / CSV 骑行轨迹导出成透明 PNG 或 MP4 动画`。
11. segmented 两个选项文案为 `纯色` 与 `地图底图`。
12. 「定位点是沿线路移动的圆点…」这句在整份 HTML 里只出现一次。

### T3 · uiExport（目标态）
1. 存在产物切换 segmented：容器 id `exportKindSegmented`（`role="radiogroup"`），两个 radio
   `name="exportKind"`，id `exportKindPng`（value `png`，默认 checked）与 `exportKindMp4`
   （value `mp4`），两个 label id `exportKindPngLabel` / `exportKindMp4Label`，
   文案 `贴图 PNG` 与 `动画 MP4`。
2. 存在两个参数面板 `#exportPngFields` 与 `#exportMp4Fields`。
3. `#exportPngFields` 含定稿说明
   `会导出两张图：轨迹卡片和定位点。在剪映里把卡片当作画中画放在角落；把定位点也拖进去，沿线路打几个位置关键帧，它就会跟着线路移动`。
4. `#exportMp4Fields` 含 `mp4Duration`、`mp4Fps`、`mp4BgMode`、`mp4PageColorField`、
   `mp4GreenColorField`、`mp4UnsupportedHint`，以及说明 `最长 600 秒；1080p 的文件大小约为每分钟 90 MB`。
5. 旧的剪映用法 `.hint` 块（含 `剪映用法：`）不再出现；旧文案
   `上限 600 秒；文件大小约与时长成正比` 不再出现。
6. 分辨率 label 文案为 `分辨率（PNG 与 MP4 共用）`。
7. 画布颜色 label 文案为 `画布颜色（卡片圆角以外的部分）`，说明句为
   `卡片本体的底色仍然用「底色」里的设置`。
8. 内联 script 里存在 `updateExportKindUI` 函数，函数体同时提到 `expCard`、`expDot`、
   `expMp4`、`exportPngFields`、`exportMp4Fields`；存在 `localStorage.getItem('exportKind')`
   与 `localStorage.setItem('exportKind'`；`exportKind` radio 的 change 事件接到这个函数。
9. 卡片 PNG 成功提示为 `已下载「轨迹卡片.png」`，且不再包含 `不含定位点`。
10. 吸底条 `.export-actions` 内仍含 `mp4ProgressWrap`、`exportStatus`、`expCard`、`expDot`、
    `expMp4` 五者。

### T4 · uiStage（目标态）
1. `.stage` 容器的直接子元素只有三个：`.cardbox`、`#previewScrub`、`#info`。
2. `#dot` 与它的 `.dotbox` 出现在「定位点」子组标题所在的行内（HTML 中 `#dot` 的位置在
   `定位点` 子组标题之后、在 `dotColor` 之前）；旧的 `.dotwrap` 两行说明文字
   （`单独的定位点`、`放进剪映后用位置关键帧`）不再出现。
3. `.dotbox` 的 width 与 height 为 `32px`。
4. 内联 script 的 `render()` 把 `#dot` 的显示尺寸按 `dotSize` 线性映射进小盒子：
   `6 + (dotSize-8)/(160-8)*(28-6)` 四舍五入，单位 px，随 `dotSize` 实时变化。
5. `renderCard` 空状态主行文案为 `拖入轨迹文件，或点击这里选择文件`，副行为
   `也可以先载入示例轨迹`（副行仍以 `loadSample` 未 hidden 为条件）；旧文案
   `拖入轨迹文件开始`、`或点上方「试试示例轨迹」` 不再出现。
6. gate：每个 `.step` 的内容包在 `.step-body` 里；CSS 含 `.needs-track .step-body{display:none}`
   与 `.step.needs-track > h2` 的 `opacity:.45`；`.export-actions.needs-track{display:none}`。
7. `#trackGateHint` 位于 ② 样式的标题行内，文案为 `载入轨迹后可用`。
8. `setTrackGate` 里含 `document.body.classList.toggle('has-track'`。
9. `#loadSample` 是 `.drop` 的兄弟节点，位置紧随 `.drop` 之后，且不在 `<header>` 内；
   CSS 含 `body.has-track #loadSample{display:none}`（或等效规则）。
10. 内联 script 里 `.cardbox` 绑了 click → `$('file').click()`，并在 `trackPoints` 存在时
    直接返回；CSS 里 `.cardbox` 的 `cursor:pointer` 只在 `body:not(.has-track)` 下生效。
