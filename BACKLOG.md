# BACKLOG

## 执行中 · Plan: issue-22-time-true-export   (→ .claude/plans/issue-22-time-true-export.md)

### Wave 1 — 无依赖 · 五个文件全并行 ✅ 全部完成
- [x] T1  轨迹时间索引与时刻↔进度换算   file: src/core/track-time.mjs   hidden 46/46
- [x] T2  导出参数：时长上限参数化 · 画质码率 · 体积估算   file: src/core/export-params.mjs   hidden 38/38
- [x] T3  导出元数据：文件名编码与 sidecar   file: src/core/export-meta.mjs   hidden 79/79
- [x] T4  界面结构：时间真实面板与画质选项   file: index.html + styles/   hidden 39/39
- [x] T5  逐帧投影缓存   file: src/render/card.mjs   hidden 45/45

架构师审测试时改掉的三处 spec 缺陷（已同步 plan）：
  · mp4Bitrate 调用点漏了分辨率的数值转换，会让 720p 用上 1080p 码率
  · 段间空隙折叠改用 +1ms，避免锚点被严格递增规则丢弃、段内速度失真
  · 零长度轨迹的边界规则冲突，定为「零长度优先」
另修一条过脆的既有 a11y 断言（把「恰好 1 个例外」写成了规则，改为按「是否滑杆旁」判定）。

### Wave 2 — deps: Wave 1 · 三个文件全并行
- [ ] T6  MP4 输出端：流式/内存双路径与 sidecar 落盘   file: src/export/mp4-sink.mjs（新建）   deps: T2, T3
        spec: streamSinkSupported, MP4_MAX_DURATION_*, createMp4Sink, downloadSidecar
        验收: visible + hidden 全绿；fastStart 随 kind 分流、AbortError 原样上抛
- [ ] T7  MP4 帧参数：预投影与时间真实帧映射   file: src/export/mp4-opts.mjs（新建）   deps: T1, T5
        spec: buildFrameOpts（从 mp4.mjs 迁入并加 proj）, buildTimeTruePlan
        验收: visible + hidden 全绿；frameTimeMs 满足「第 x 秒 = t0 + x×scale」契约
- [ ] T8  界面逻辑：时间真实模式状态与联动   file: src/ui/time-mode.mjs（新建）   deps: T1, T2, T4
        spec: timeMode 状态对象, refreshTimeMode, isTimeTrueMode, updateTimeModeUI, currentExportWindow
        验收: visible + hidden 全绿；无时间戳轨迹自动回落匀速并给出原因、体积估算随参数变

### Wave 3 — deps: Wave 2 · 两个文件并行
- [ ] T9  MP4 编码主流程接时间真实与流式写盘   file: src/export/mp4.mjs   deps: T2, T5, T6, T7, T8
        spec: exportMp4 换掉「progress 从哪来 / 码率从哪来 / 产物往哪写」三处接缝
        验收: visible + hidden 全绿；文件仍 ≤200 行；现有 uiExport 测试不修改即通过
- [ ] T10 扫拨条时间轴   file: src/ui/preview.mjs   deps: T1, T8
        spec: updatePreviewScrubLabel 显示真实时刻, previewPlayStep 按真实时间轴推进
        验收: visible + hidden 全绿；匀速模式标签文案断言不修改即通过

### Wave 4 — deps: Wave 3
- [ ] T11 装配接线   file: src/main.mjs（+ src/ui/track-panel.mjs 一行）   deps: T8, T9, T10
        spec: 新控件事件绑定 + 首屏 refreshTimeMode/updateTimeModeUI + 轨迹变化时重算
        验收: 全量 node --test 绿；无头 Chrome 实测载入 淀山湖.fit 走通时间真实模式

### 集成验证（全部单元完成后，架构师执行）
- [ ] 全量 `node --test 'tests/**/*.test.mjs'`
- [ ] 无头 Chrome 实测流式写盘导出 60 秒窗口，核对 sidecar t0Epoch 与文件名一致
- [ ] 淀山湖.fit 导 15:59:04 起 60 秒窗口，与 roughcut 现有 PiP 预览逐帧比对定位点
- [ ] 匀速模式导出与改动前做像素签名比对，确认无变化
- [ ] 终审：@spec-compliance-reviewer + @quality-security-reviewer
- [ ] 文档更新：PROJECT.md 功能清单 · PATTERNS.md 渲染/状态约定 · AGENTS.md 模块地图
