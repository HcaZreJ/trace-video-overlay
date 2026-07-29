# BACKLOG

## 执行中 · Plan: split-index-html   (→ .claude/plans/split-index-html.md)

工作树：`.claude/worktrees/split-index-html`，分支 `worktree-split-index-html`。
基线：572 个测试全绿（`tests/**` 505 + `core.test.mjs` 64 + `fit.test.mjs` 3）。

### Wave 1 — 无依赖 · 可并行

- [x] T1a UI 测试取材抽共享模块（架构师亲做）   file: tests/helpers/source.mjs, 十个 UI 测试文件
        spec: readCss / readJs / readAll 覆盖拆分前后两种形态，T1 与 T2 无需再改测试
        验收: 改造前 505 全绿 → 改造后 505 全绿，零回归 ✅
- [x] T0  core.mjs 权威化   file: core.mjs, core.test.mjs, tests/{visible,hidden}/geojsonCoords
        spec: extractGeoJSONCoords 点构造加 ele · 移除 crc32 / buildStoreZip / layoutTextBlockX
        流程: 走完了 test-first（test-author 72 例 → 架构师审过放行 → implementer）
        验收: hidden 跑分 81/81 ✅；tests/ 577/577 ✅；根目录 57/57 ✅；
              core.test.mjs 测试块 64 → 54 ✅；三个被删导出零残留 ✅
### Wave 2 — deps: T1a

- [x] T1  CSS 拆六个文件   file: styles/*.css, index.html
        spec: 按行号连续切段 tokens(8–9) base(10–22) layout(23–98) forms(99–126)
              components(127–164) color-picker(165–193)；<style> 删除改六条 <link>
        验收: 拼接与原 8–193 行逐字节一致 ✅；index.html 2550 → 2368 行、零 <style> ✅；
              body 段逐字节未动 ✅；页面外观人眼确认待 T2 后与 JS 一并过

### Wave 3 — deps: T0, T1

- [x] T2  应用逻辑迁出 src/main.mjs   file: src/main.mjs, index.html, vendor/mp4-muxer.js
        spec: 294–2365 行整体切出；删 28 个副本 + 3 个 gcj helper + 3 个私有常量改 import；
              mp4-muxer.js git mv 进 vendor/；index.html 换 module 入口
        验收: index.html 2368 → 295 行、零内联逻辑 ✅；守恒 diff 正文零新增行、526 行纯删除 ✅；
              tests/ 577/577 + 根目录 57/57 ✅；无头 Chrome 实测六份 CSS 生效、module 跑通、
              Mp4Muxer 全局就位、零控制台错误 ✅

### Wave 3–9 — 逐层拆分（依次串行，各自依赖前一个）

- [x] T3  core 层拆九个模块  file: src/core/{geo,gcj02,amap,metrics,color,track-files,export-params}.mjs
                             + src/parse/{geojson,csv}.mjs
        deps: T2   验收: 33 个导出守恒无重名 ✅；函数体 md5 逐个一致 ✅；最大模块 167 行 ✅；
              依赖边正好 3 条无环 ✅；core.mjs 已删 ✅；634 个测试全绿 ✅；
              浏览器实测九模块全部 200 加载 ✅
- [x] T3a 共享状态与 DOM 工具外置（架构师亲做）  file: src/state.mjs, src/dom.mjs, src/main.mjs
        spec: 4 个跨层可变状态收进 state 对象；CARD_SIZE 具名导出；$ 迁入 dom.mjs。
              两者都是叶子模块，避免 render/export → ui 反向依赖。
        验收: 逆变换 diff 为空，改动面严格限于两类机械替换 ✅；634 个测试全绿 ✅；
              浏览器载入示例轨迹走通完整链路（info 文案 · 文件列表 · has-track gate ·
              canvas 356696 像素 · 导出解锁 · 扫拨标签）✅
- [x] T4  parse 层           file: src/parse/{index,fit,geojson,csv,xml}.mjs
        deps: T3   验收: xml.mjs 去 export 后与原 66–123 行逐字节一致 ✅；fit.mjs blob 哈希不变 ✅；
              main.mjs 净增 1 行 import、删 85 行 ✅；634 测试全绿 ✅；
              浏览器载入 GPX 走通（格式识别为 GPX · 6 点，canvas 356696 像素）✅
- [x] T5  basemap 层         file: src/basemap/{diagnose,image,fetch}.mjs
        deps: T4   验收: 三模块逐个与原行段逐字节一致 ✅；main.mjs 净增 1 行 import、删 114 行 ✅；
              最大 56 行 ✅；634 测试全绿 ✅；浏览器实测无 key 两条路径只出状态文本、
              零未捕获异常，假 key 活体探针命中 diagnoseAmapApiError 的 INVALID_USER_KEY 分支 ✅
- [x] T6  render 层          file: src/render/{primitives,card,dot}.mjs
        deps: T5   验收: 四个函数体逐字节一致 ✅；最大 158 行 ✅；634 测试全绿 ✅；
              HEAD 版与改动版双端口跑像素签名，card/dot 两块 canvas 的非透明像素数、
              字节和、FNV-1a/djb2、色数分布、25 个网格采样点 RGBA 全等 ✅；
              renderFrame 两个 bgMode 分支运行时冒烟通过 ✅；
              顺带清掉 8 个随搬迁积下的死 import（架构师做）✅
- [x] T7  export 层          file: src/export/{status,png,mp4}.mjs
        deps: T6   验收: 11 个函数体逐字节一致 ✅；最大 183 行 ✅；src/ 零未使用导入 ✅；
              浏览器真抓产物：卡片 PNG 53511 字节 · 定位点 PNG 11290 字节（均命中 PNG 魔数）
              · MP4 73355 字节 video/mp4 ✅；底图缺失 → 「改用无底图导出」的 exportState
              三模块共读共写跑通 ✅；导出中取消与关页拦截跑通 ✅
        遗留: 引入 main.mjs ↔ export/ 循环 import（exportCard/exportMp4 要调仍住在
              main.mjs 的 onPreviewMapOverlay / stopPreviewPlay）。已写成断言
              「没有任何模块反向导入入口 main.mjs」现在红着，T8 迁走 ui 层后必须转绿。
- [ ] T8  ui 层              file: src/ui/{track-errors,track-panel,map-panel,preview,controls}.mjs
        （dom.mjs 与 state.mjs 已在 T3a 落到 src/ 顶层，不在 ui/ 下）
        deps: T7   验收: 各 ≤ 200 行；main.mjs ≤ 200 行；全量测试全绿含那条反向依赖断言转绿；
              面板交互手测通过
- [ ] T9  取色器四拆         file: src/ui/color-picker/{index,popup,canvas,inputs}.mjs
        deps: T8   验收: 各 ≤ 200 行；全量测试全绿；取色器七条交互路径手测通过

### Wave 10–11 — 收尾

- [ ] T10 测试收拢单一入口   file: tests/unit/{core,fit}.test.mjs
        deps: T9   验收: `node --test 'tests/**/*.test.mjs'` 一条命令全量全绿；根目录无 *.test.mjs
- [ ] T11 文档全面更新       file: AGENTS.md, PROJECT.md, PATTERNS.md, TECHSTACK.md, DEVFLOW.md, README.md
        deps: T10  验收: 六份文档无 file:// / 双击 / 单文件 / 副本 / 抄；命令实测通过；
              目录结构与 ls 一致

### 全部完成后

- [ ] 全量测试 + 只读终审（spec-compliance-reviewer ∥ quality-security-reviewer）
- [ ] 拉 PR（不合并、不 push main，等用户处置）
- [ ] 开 SEO GitHub issue（不在本 plan 实现范围内）
