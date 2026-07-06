## 执行中 · Plan: mp4-export   (→ .claude/plans/mp4-export.md)

### Wave 1 — 无依赖 · test-first 盲测
- [ ] T1  沿弧长匀速插值定位点   file: core.mjs (+ index.html 内联同步)
        spec: pointAtProgress(points, progress) → {x,y} | null，按累计弧长匀速插值
        流程: @test-author 写测试 → 架构师审 → @function-implementer 实现
        验收: node --test 全绿；progress=0/0.5/1 得起点/弧长中点/终点，含零长段不出 NaN

### Wave 2 — deps: T1 · 浏览器实测验收
- [ ] T2  renderFrame 逐帧渲染   file: index.html   deps: T1
        spec: renderFrame(ctx,size,progress,opts)；卡片/绿幕背景 + 全线常显 + 移动定位点
        流程: @function-implementer 实现（复用 renderCard/renderDot）
        验收: 载入 sample-ride.gpx，progress=0/0.5/1 定位点在起点/中段/终点；两背景模式正确

### Wave 3 — deps: T2 · 浏览器实测验收（与 T2 同文件，串行）
- [ ] T3  vendor mp4-muxer + WebCodecs 编码 + 导出 UI   file: index.html (+ vendored muxer)
        spec: 时长/帧率/分辨率/背景控件 + 支持检测 + 逐帧编码 + 进度条 + 下载 .mp4
        流程: 架构师 vendor 库 → @function-implementer 实现
        验收: sample-ride.gpx 导出 mp4；ffprobe 验 H.264/分辨率/帧数；首帧起点末帧终点；剪映可播
