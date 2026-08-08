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

### Wave 4 — deps: Wave 3 ✅ 完成
- [x] T9  MP4 导出：决策层与主流程接线   file: src/export/mp4-plan.mjs + mp4.mjs   hidden 58/58
- [x] T10 扫拨条时间轴   file: src/ui/preview.mjs   hidden 62/62

### Wave 5 — deps: Wave 4 ✅ 完成
- [x] T11 装配接线   file: src/main.mjs + src/ui/track-panel.mjs   hidden 50/50

### 集成验证（架构师执行）
- [x] 全量 `node --test 'tests/**/*.test.mjs'` → 1099/1099
- [x] 淀山湖.fit（8995 点 / 59.3 km / 2h44m）与 roughcut 现有对齐结果逐段比对：
      7 个镜头段最大差 0.0003（0.03%），残差源自「墨卡托平面距离 vs 大圆距离」的度量差
- [x] 停留段实测：最长 6.3 分钟停留期间定位点在 1080 画布上移动 0.84 px（点直径 104 px）
- [x] 无头浏览器实测（CDP 驱动）：全链路走通，sidecar 内容逐字段核对无误
- [x] 匀速模式回归：文案 / 文件名 / 无 sidecar 全部照旧
- [x] 终审：@spec-compliance-reviewer（7 条跨单元契约全 PASS，1 FAIL + 8 WARN）
      + @quality-security-reviewer（5 HIGH + 若干 WARN，无注入类问题、无新增依赖）
- [x] 文档更新：PROJECT.md · PATTERNS.md · TECHSTACK.md · DEVFLOW.md

### Wave 6 — 终审整改 · deps: 终审结论
- [ ] T12 导出链路加固   file: ui/time-mode · export/mp4-plan · mp4 · mp4-sink · png   deps: T8, T9
        spec: A 模式 segmented 选中态 · B scale/fps 用已消毒的窗口值 · C 折叠后按 index 定边界
              · D 算不出窗口时阻断而非静默降级 · E sink 建立后不留无保护区 · F 取消保存框归还
              forceNoBasemap · G sidecar 跟随实际保存名 · H sidecar 失败不误报导出失败
              · I 空轨迹守卫贯彻到导出入口 · J 体积估算按上限夹取
        验收: visible + hidden 全绿；终审 5 项 HIGH 全部消解
- [ ] T13 本地时刻格式化与分段起点进 core   file: src/core/time-format.mjs（新建）+ core/track-files.mjs
        deps: T12
        spec: toLocalInputValue, parseLocalInputValue, formatLocalHms, formatLocalIso, segmentStartIndices
        验收: visible + hidden 全绿；三处重复实现改为 import；时区往返获得 core 单测覆盖
