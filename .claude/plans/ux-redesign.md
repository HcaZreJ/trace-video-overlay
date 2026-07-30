# Feature: UI/UX 重构 —— 素材工作台

> 本 plan 已完成，作为设计记录保留。仓库现为按层分模块的多文件结构，
> 代码位置与仓库级规则以 [AGENTS.md](../../AGENTS.md) 与 [PATTERNS.md](../../PATTERNS.md) 为准。

## Overview
把 index.html 的 UI 从"文档流长页 + 单容器参数墙"重构为"预览常驻的工作台"：左列 sticky 预览舞台（卡片 + 定位点叠加 + 动画进度扫拨），右列按任务阶段分为 ①轨迹 ②背景与卡片 ③线路与标记 ④导出 四个分区卡片，导出区吸底。解决三类核心问题：预览与控件不同屏、信息架构不体现参数依赖、控件系统不一致。基线评分 24/40（dual-agent critique，2026-07-07），目标复评 ≥32/40。

## Intent Brief
- **Goal**：预览在任何操作位置可见；每个控件的任务归属与参数依赖从布局即可读出；三条原始抱怨（面板过长遮预览、两个"大小"slider 不一致、UI 摆放无逻辑）全部消除。
- **Motivation**：实时预览是核心价值主张，旧布局在面板下半段将其关闭；用户判定"UX 完全没法用"。
- **Known context**：面板实测 1703px vs 900px 视口；`.stage` 无 sticky；「导出分辨率+导出 PNG」寄居地图分区 DOM 流内；markerSize 全宽(8-60) vs dotSize 半宽(8-200) 精度差 7.7×，且 marker r=size/2、dot r=size×0.385 语义不同；390px 视口横向溢出（canvas 固定 360px + padding 48px）；0 for/aria/focus；主按钮对比度 3.65:1；MP4 时长 JS clamp(≥0.1 无上限) 与 HTML(1-60) 不一致；文件名未转义直插 innerHTML；导出 PNG 成功零反馈；底图失败后静默导出无图成品。
- **Constraints**：零依赖；core.mjs↔index.html 内联同步铁律；renderCard↔renderFrame 渲染同构铁律；全部 UI 单元落在 index.html → **同文件单元强制串行**；push main 即上线（GitHub Pages）。
- **Non-goals**：不改轨迹解析/投影/MP4 编码管线行为；不引入构建步骤/框架/后端；不做无 key 底图兜底、素材包 zip、多语言。
- **Success criteria**：①1440×900 下操作任意控件时预览 canvas ≥50% 可见；②全部 slider 同宽同模式（slider+数值输入），标记/定位点"大小"统一为彩色核直径，同数值视觉等大；③390px 视口无横向滚动；④三种产物均按钮导出且有成功反馈；⑤地图底图失败时导出被阻断并显性告知；⑥键盘可完成载入→调参→导出全流程；⑦复评 ≥32/40。

## Alignment Gate
- **Will**：工作台布局（1A）、全量单元（2a）、MP4 动画进度扫拨条、地图 key 分步引导与错误诊断（3 全要）。用户已批准拆分后直接开工（2026-07-07）。
- **Won't**：无 key 兜底底图、zip 素材包、剪映参数计算器、多语言、移动优先重设计（修到"可用无溢出"）。
- **Open assumptions**：见 Ledger，均为用户已接受的默认或低风险项。
- **Acceptance**：Success criteria ①-⑦ + 每波 headless Chrome 截图核验 + `node --test` 全绿。

## Assumption Ledger
| Assumption | Confidence | Impact if Wrong | Status |
|---|---:|---:|---|
| 标记/定位点"大小"统一为彩色核直径，dotSize 默认 75→58 保持视觉不变 | high | medium | 用户接受的默认（预览可自查） |
| `color-scheme:dark` 足以统一原生控件观感（Chrome/Edge/Safari） | high | low | 实现时验证 |
| 「试试示例轨迹」按钮以 fetch('sample-ride.gpx') 实现，file:// 打开时该按钮自动隐藏 | high | low | 用户接受的默认 |
| restapi.amap.com 静图接口允许 CORS fetch（现有 Image crossOrigin=anonymous 已工作） | medium | medium | T4 实现时先验证，失败则保留 Image 方案+超时诊断降级 |

## Critique 基线（dual-agent，2026-07-07）
Nielsen 24/40（可见性3/真实3/控制2/一致2/防错3/识别3/效率1/极简2/恢复2/帮助3）；认知负荷 5/8 fail；机械扫描 60 findings。高危：预览失联（scrollY≥733 后 canvas 0px 可见）、导出动线寄居地图区、dotSize 精度 0.67px/单位、移动端溢出 18px、0 a11y 属性、主按钮 3.65:1、底图失败静默导出、MP4 无取消、定位点仅右键导出。

## 目标设计（全局规格，各单元 spec 引用此节）

### 布局
- App-shell：`.workspace{display:grid;grid-template-columns:1fr 340px;gap:24px;max-width:1200px;margin:0 auto;padding:24px;align-items:start}`。
- 左列 `.stage{position:sticky;top:24px}`：cardbox（canvas#card 自适应 `width:min(100%,360px)`，`aspect-ratio:1`；短视口 `@media(max-height:820px)` 降至 `min(100%,300px)`）→ 动画扫拨行（T6 前为占位不渲染）→ 轨迹统计行（#info 移入）→ 定位点图例（.dotwrap）。
- 右列 `.controls`：4 个 `.section` 卡片（panel 底+边框+圆角+内 padding，h2 分区标题去 uppercase）：①轨迹（紧凑拖放区+文件列表）②背景与卡片 ③线路与标记 ④导出（普通流内卡片；吸底只作用于 T5 落地的紧凑按钮行——整卡吸底会遮挡其余分区）。
- ≤760px 单列：`.stage` 吸顶（`top:0;z-index:10;background:var(--bg)`），canvas `max-height:32vh`；滚到 ④ 时预览仍 ≥120px 可见。
- `:root{color-scheme:dark}`。

### 信息架构（控件归属，id 全部保留）
- **①轨迹**：drop 区（紧凑高度）、fileList、解析失败就地错误区（T7 替代 alert）。
- **②背景与卡片**：segmented「纯色｜地图底图」（T4 起生效；T1 仅结构堆放）→ 纯色：bgColor、bgOpacity；地图底图：amapKey（+分步申请引导 details 折叠）、mapTraffic、mapOverlayMode radio、mapMaskOpacity（仅蒙层模式显示）、mapViewScale、状态行；卡片几何常驻：radius、pad。
- **③线路与标记**：lineColor、lineWidth；showMarkers、startColor、endColor、markerSize；dotColor、dotSize + "定位点只出现在预览与 MP4，卡片 PNG 不含"就地说明。
- **④导出**：exportRes（标注 N×N px）、expCard（主按钮，文案「导出卡片 PNG」）、expDot（新增「导出定位点 PNG」）、MP4 子组（mp4Duration/mp4Fps/mp4BgMode/mp4PageColor/mp4GreenColor/进度条）、expMp4、导出状态行（toast 语义，aria-live）。

### 控件系统（field 范式）
- 数值参数统一为：标签（含单位：px/%/秒/×）+ 全宽 slider + 右侧 `input[type=number].val{width:60px}`，双向同步（slider input↔number change→render）。
- dotSize：全宽、range 8-160、默认 58；markerSize：全宽、range 8-60、默认 20。两者语义 = 彩色核直径（600 坐标系），几何由 core.mjs `dotGeometry` 提供（渲染层 renderDot/renderCard previewDot/renderFrame 三处统一，遵守渲染同构铁律；core.mjs↔index.html 内联同步）。
- 术语表：「地图 overlay」→「地图底图」；「导出地图卡片 PNG」→「导出卡片 PNG」；分辨率 options 显示「720 × 720」等；用户可见报错一律中文人话（内部 Error message 保留英文供 console）。

### 反馈与防错
- 导出成功 → ④ 内状态行「已下载「<文件名>」」4s 自清；失败持久显示，✕/⚠/✓ 前缀（非纯色）。
- 地图底图激活但 basemap 缺失/过期 → 导出前 await 拉取；失败则**中止导出**，状态行给「重试」/「改用无底图导出」两个行动。
- 地图参数（key/traffic）变化 → debounce 600ms 自动重拉底图（状态行反馈）；蒙层/取景保持本地实时。手动「重新拉取」按钮保留作失败重试口。
- key 错误诊断：静图响应为 JSON（非图片）时解析 info/infocode，INVALID_USER_SCODE/USERKEY_PLAT_NOMATCH → 提示「key 类型应为『Web服务』，你申请的可能是『Web端(JS API)』」。
- MP4：时长经 core.mjs `clampMp4Duration`（[1,60]，非法→6）；导出中按钮变「取消」；导出中 `beforeunload` 拦截。
- 空状态：canvas 内绘制引导文案；②③④ 区加 `.needs-track` 降透明度 + ① 内一行说明；「试试示例轨迹」按钮。
- 文件名以 textContent 插入；✕ 删除后 ① 内提供 5s「撤销」。

## Work-Unit Specs

```yaml
- id: T1
  title: 布局骨架与移动端修复（工作台化，零 JS 改动）
  file_path: index.html
  spec: |
    仅改 <style> 与 <body> 的 HTML 结构，<script> 区一个字节都不改。
    1. 按「目标设计·布局」建 .workspace 两列 app-shell；.stage sticky；canvas#card
       自适应宽度（min(100%,360px) + aspect-ratio:1，短视口 300px）；#info 移入 stage。
    2. 按「目标设计·信息架构」把现有控件重新分组进 ①②③④ 四个 .section 卡片，
       全部元素 id/name 原样保留；②内 segmented 仅摆放现有 mapOverlay checkbox
       原样（交互 T4 做）；④内 expDot 按钮暂不添加（T5 做）；扫拨行暂不添加（T6 做）。
    3. h2 去 text-transform:uppercase；文案改动仅限：「地图 overlay」→「地图底图」、
       「导出地图卡片 PNG」→「导出卡片 PNG」、分辨率 option 文本「720 × 720/1080 × 1080/
       1440 × 1440」（value 不变）。
    4. :root 加 color-scheme:dark；≤760px 单列 + stage 吸顶缩略（canvas max-height:32vh）；
       390px 宽零横向溢出（.wrap/.workspace padding 与 canvas 弹性共同保证）。
    5. .file-btns button 尺寸 ≥32px（≤760px 下 ≥40px）。
  acceptance: |
    diff 确认 <script> 区零变更、全部 id 存在；1440×900 截图：任意 scrollY 下 stage 可见、
    四卡片分区清晰、④吸底可触达；390×844 截图：无横向滚动。node --test 全绿（无 JS 改动应天然全绿）。
  dependencies: []

- id: T2
  title: core.mjs 纯函数：dotGeometry / clampMp4Duration（盲测链）
  file_path: core.mjs（tests/visible|hidden/dotGeometry.test.mjs、clampMp4Duration.test.mjs）
  functions:
    - name: dotGeometry
      inputs: [size（彩色核直径，正有限数）]
      outputs: "{ coreR, ringW, outerR, pad, full, shadowBlur, shadowOffsetY }"
      behavioral_contract: |
        统一"大小=彩色核直径"语义的定位点几何。coreR=size/2；ringW=size*0.15；
        outerR=coreR+ringW（=size*0.65）；shadowBlur=size*0.104；shadowOffsetY=size*0.026；
        pad=Math.ceil(size*0.26)；full=size+2*pad。返回全部为 number；
        除 pad/full 依赖 ceil 外均为精确算式（测试用近似相等，容差 1e-9）。
        full ≥ 2*outerR + shadowBlur 恒成立（留白足以容纳白环与阴影）。
      error_cases:
        - { condition: "size 非 number / NaN / Infinity / ≤0", behavior: "throw RangeError，消息含 'dotGeometry'" }
    - name: clampMp4Duration
      inputs: [value（任意）]
      outputs: number（秒）
      behavioral_contract: |
        typeof value==='number' 且 Number.isFinite(value) 时 clamp 到 [1,60]（0.5→1、999→60、
        6→6、边界 1/60 原样）；其余输入（NaN、Infinity、字符串、undefined、null、对象）一律
        返回默认 6。不做步进取整。
      error_cases: []   # 全输入域有定义，不抛错
  reuse_candidates: |
    已搜 core.mjs/index.html：dot 几何常数散落在 renderDot(:841-853)/previewDot(:799-809,
    :827-837)/renderFrame(:896-905) 三处魔数（0.385/0.115/0.08/0.02/1.16），无统一实现——
    本单元即为其收敛点。clamp 逻辑现为 exportMp4 内联 Math.max(0.1,...)，无上限，需替换。
  acceptance: visible + hidden 全绿（run-hidden-tests.sh 跑分）。
  dependencies: []

- id: T3
  title: 控件系统统一（field 范式 + 尺寸语义落地）
  file_path: index.html
  spec: |
    1. 全部数值参数改为「标签(含单位) + 全宽 slider + number 输入」双向同步行；
       改写 bind() 支撑 slider↔number；window resize 时 re-render（修 dot 显示尺寸滞后）。
    2. dotSize range 8-160 默认 58；把 core.mjs 的 dotGeometry/clampMp4Duration 逐字符
       归 src/core/export-params.mjs，renderDot/renderCard previewDot/renderFrame
       三处改用 dotGeometry（渲染同构铁律）；render() 中 ×1.16 显示因子改为 full/size 比值。
    3. 单位标注：线宽/圆角/内边距/大小 px、透明度 %、时长 秒、取景 ×。
  acceptance: |
    截图：全部 slider 同宽；markerSize 与 dotSize 同数值时预览中彩色核等大；
    number 输入键入精确值即时生效。node --test 全绿。
  dependencies: [T1, T2]

- id: T4
  title: 背景 segmented + 地图自动重拉 + key 引导诊断
  file_path: index.html
  spec: |
    1. ② 区 segmented「纯色｜地图底图」（radio 样式化）驱动渐进披露：纯色→bgColor/bgOpacity；
       地图→key/traffic/底图样式/蒙层(仅蒙层模式)/取景/状态行；mapOverlay checkbox 语义并入
       segmented（隐藏原 checkbox 或改造为它）。
    2. key/traffic 变化 debounce 600ms 自动重拉（有 key 且有轨迹时）；recomputeTrack 后若地图
       激活且有 key 也自动重拉；保留「重新拉取底图」按钮为失败重试口；状态行 aria-live=polite。
    3. fetchAmapBasemap 改 fetch()：content-type JSON→解析 info/infocode 出中文诊断
       （key 类型错/配额/无效 key）；图片→blob→Image。CORS 失败则回退现 Image 方案。
    4. key 申请分步引导（details 折叠，4 步 + 常见错误说明）；开启地图时就地一行
       「开启后轨迹范围坐标会发送给高德以获取底图」。
  acceptance: |
    截图：纯色/地图两态渐进披露正确；改 key 后无需手动预览自动出图（用 .env 里的 key 实测）；
    错 key 得到类型诊断中文提示。node --test 全绿。
  dependencies: [T3]

- id: T5
  title: 导出中心（按钮化、反馈、防错、MP4 取消）
  file_path: index.html
  spec: |
    1. ④ 区落地：expDot 新按钮复用 renderDot→离屏→download('定位点.png')（尺寸=现 render()
       中 dotExportPx 算式）；expCard 成功后状态行「已下载「轨迹卡片.png」」4s 自清；
       右键提示降级为补充说明。
    2. 地图激活且 basemap 缺失/过期：导出前 await 拉取，失败→中止 + 状态行「重试」/「改用
       无底图导出」双行动（一次性覆盖）。导出错误一律显示在 ④ 状态行（不再借道地图区）。
    3. exportMp4 用 clampMp4Duration；导出中 expMp4 变「取消导出」（flag 中断帧循环→
       encoder.close→状态「已取消」）；导出中 beforeunload 拦截。
  acceptance: |
    三产物按钮导出且各有成功反馈；模拟底图失败（断网/坏 key）时导出被阻断且给出双行动；
    MP4 导出中可取消。node --test 全绿。
  dependencies: [T4]

- id: T6
  title: 动画进度扫拨条（MP4 所见即所得预览）
  file_path: index.html
  spec: |
    stage 内 canvas 下方加「▶ + 进度 slider(0-1000)」行：拖动→renderCard opts.previewProgress
    （renderCard 的 previewDot 定位从固定 0.5 改为 opts.previewProgress ?? 0.5）；▶ 播放按
    clampMp4Duration($('mp4Duration')) 时长 rAF 推进、循环、再点暂停；任意参数改动不打断播放。
    无轨迹时该行隐藏。renderFrame 无需改（已按 progress 渲染，同构保持）。
  acceptance: 拖动扫拨条定位点沿线移动；播放时长与 MP4 时长一致；暂停/循环正常。node --test 全绿。
  dependencies: [T5]

- id: T7
  title: 空状态、示例轨迹与 a11y 基线
  file_path: index.html
  spec: |
    1. 空状态：renderCard 无轨迹分支在 canvas 居中绘制引导文案；②③④ 加 .needs-track
       （opacity .45，有轨迹时移除）+ ① 内一行原因说明；header 加「试试示例轨迹」按钮
       （fetch sample-ride.gpx→File→loadTrackFiles；fetch 失败则隐藏按钮）。
    2. 解析失败：alert 替换为 ① 内错误区（失败文件列表 + 「从行者/Strava/佳明的活动页可导出
       GPX」引导）；✕ 删除后 5s「撤销」；文件名 textContent 插入。
    3. a11y：全部 field 加 for/id；↑↓✕ 加 aria-label（含文件名）；drop 区 role=button+
       tabindex=0+Enter/Space；:focus-visible 样式；状态行 aria-live；主按钮对比度 ≥4.5:1
       （调 --accent 按钮底色，如 #0066cc 级）；≤760px 触达目标 ≥40px 复核。
  acceptance: |
    键盘完成载入→调参→导出全流程；node 复算按钮对比度 ≥4.5:1；空态截图有引导；
    示例按钮一键出预览。node --test 全绿。
  dependencies: [T6]

- id: T9
  title: 终审修复波（polish：反馈可见性 / 语义文案 / a11y / 状态边界）
  file_path: index.html
  spec: |
    修复四路终审（复评 A 27/40、复评 B 高危清单、spec 合规 T1 FAIL、质量 3 WARN）确认的
    低成本问题：①exportStatus 及阻断双按钮移入吸底操作条（任何滚动位置可见）；②T1 FAIL 补
    「定位点不进卡片 PNG」就地说明；③透明度语义改「不透明度」（底色/蒙层，对齐剪映术语）；
    ④MP4「背景模式/卡片背景色」消歧 + 卡片/画布关系说明；⑤扫拨条 label 联动显示时长；
    ⑥key 预期管理（segmented 标注需 key、帮助去错误码）；⑦WebCodecs 不支持时就地解释；
    ⑧needs-track 加 inert + aria-disabled（真禁用，解对比度豁免）、setTrackGate 去魔法下标；
    ⑨hover 态改 --accent-strong（≥4.5:1）；⑩#info aria-live、canvas role=img+aria-label、
    play 按钮 aria-pressed、summary 进 focus-visible；⑪mp4Duration 回写 clamp + .val 样式；
    ⑫exportForceNoBasemap 早退前复位；⑬增/重排文件时撤销失效；⑭key 为空时 removeItem +
    隐私说明补「key 明文存本地」；⑮空态第二行文案仅在示例按钮可见时绘制；⑯zoom=N 文案、
    GPX·N 点、header 格式清单含 CSV、死 span lineColorV 清理、toast 6s。
  acceptance: |
    tests 全绿；探针：吸底条内可见 toast/阻断按钮、inert 生效（gated 控件不可聚焦）、
    clamp 回写、hover 色；复评（第三轮 A + 架构师机械复核）≥32/40。
  dependencies: [T1-T7 全部]

- id: T8
  title: 文档更新 + 复评
  file_path: PROJECT.md / PATTERNS.md（+ 本 plan Status）
  spec: |
    PROJECT.md：功能表与模块地图就地改写（工作台 UI、扫拨条、定位点按钮导出、key 诊断）；
    PATTERNS.md：field 范式、分区卡片、dotGeometry 语义、状态行反馈范式。
    复评：同方法论 dual-agent 重跑（新截图），出对比分。
  acceptance: 复评 ≥32/40；文档只写当前事实。
  dependencies: [T7]
```

## Dependency Graph
```
T1 ─┐
    ├→ T3 → T4 → T5 → T6 → T7 → T8
T2 ─┘
```

## Execution Waves
- Wave 1（并行）：T1（index.html）∥ T2（core.mjs+tests，盲测链：test-author→架构师审→implementer）
- Wave 2-7（串行，同文件约束）：T3 → T4 → T5 → T6 → T7 → T8
- 每波结束：headless Chrome 截图核验 + `node --test` 全绿；BASE commit 001ce63，实现改动以 git diff 审。

## Status
Completed —— 全部单元（T1-T7、T9、T10）实现并验收；独立复评 33/40（Good），认知负荷低档；
待用户批准后 commit。遗留改进项见 BACKLOG 交接记录（导出时底图拉取反馈断点、样式持久化、
color 控件质感、一键素材包、9:16 画幅、key 零门槛路径等产品级决策）。
