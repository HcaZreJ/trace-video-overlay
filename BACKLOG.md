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

### Wave 2 — deps: Wave 1 ✅ 全部完成
- [x] T6  MP4 输出端：流式/内存双路径与 sidecar 落盘   file: src/export/mp4-sink.mjs   hidden 55/55
- [x] T7  MP4 帧参数：预投影与时间真实帧映射   file: src/export/mp4-opts.mjs   hidden 89/89

### Wave 3 — deps: T6 ✅ 完成
- [x] T8  界面逻辑：时间真实模式状态与联动   file: src/ui/time-mode.mjs   hidden 82/82

### Wave 4 — deps: Wave 3 · 两组文件并行
- [ ] T9  MP4 导出：决策层与主流程接线
        file: src/export/mp4-plan.mjs（新建）+ src/export/mp4.mjs（改）   deps: T6, T7, T8
        spec: resolveExportPlan, frameProgress, formatEta, buildExportSidecar + exportMp4 接线
        验收: visible + hidden 全绿；mp4.mjs 仍 ≤200 行；现有 uiExport 测试不修改即通过
- [ ] T10 扫拨条时间轴   file: src/ui/preview.mjs   deps: T1, T8
        spec: updatePreviewScrubLabel 显示真实时刻, 逐帧推进按真实时间轴
        验收: visible + hidden 全绿；匀速模式标签文案与推进速度断言不修改即通过

### Wave 5 — deps: Wave 4
- [ ] T11 装配接线   file: src/main.mjs + src/ui/track-panel.mjs   deps: T8, T9, T10
        spec: 新控件事件绑定 + 首屏 refreshTimeMode/updateTimeModeUI + recomputeTrack/clearTrack 重算
        验收: visible + hidden 全绿；依赖方向恒真（无模块 import main.mjs）

### 集成验证（全部单元完成后，架构师执行）
- [ ] 全量 `node --test 'tests/**/*.test.mjs'`
- [ ] 无头 Chrome 实测流式写盘导出 60 秒窗口，核对 sidecar t0Epoch 与文件名一致
- [ ] 淀山湖.fit 导 15:59:04 起 60 秒窗口，与 roughcut 现有 PiP 预览逐帧比对定位点
- [ ] 匀速模式导出与改动前做像素签名比对，确认无变化
- [ ] 终审：@spec-compliance-reviewer + @quality-security-reviewer
- [ ] 文档更新：PROJECT.md 功能清单 · PATTERNS.md 渲染/状态约定 · AGENTS.md 模块地图
