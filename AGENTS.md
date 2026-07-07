# AGENTS

## 文档地图
| 文档 | 内容 |
|---|---|
| [PROJECT.md](PROJECT.md) | 项目目的、功能清单与状态、核心 data model、模块地图 |
| [PATTERNS.md](PATTERNS.md) | 模块边界、命名、错误处理、渲染与测试范式 |
| [TECHSTACK.md](TECHSTACK.md) | 技术栈、依赖、外部服务、目录结构、部署 |
| [DEVFLOW.md](DEVFLOW.md) | 运行/测试/部署命令、分支工作流 |
| `.claude/plans/` | 跨 session 权威设计文档；进 repo 先查 Status 非 Completed 的 plan |
| `BACKLOG.md` | 当前 session 的任务板 |

## 本 repo 铁律
1. **core.mjs ↔ index.html 内联同步**：改动 `core.mjs` 中被页面使用的函数后，把函数体
   逐字符同步进 `index.html` 内联 script（内联副本去掉 `export`）。
2. **纯函数进 core.mjs**：几何/解析/构造逻辑写 core.mjs 并配 node:test；fetch/DOM/Canvas
   运行时逻辑只写 index.html。
3. **零依赖约束**：新能力优先用浏览器原生 API；引入第三方库需 vendored 单文件并经用户确认。
4. **测试命令**：`node --test 'tests/**/*.test.mjs'`（harness 盲测）；根目录早期测试
   `node --test core.test.mjs fit.test.mjs`。
5. **渲染同构**：改 renderCard 的行为时同步 renderFrame（MP4 逐帧），反之亦然。
