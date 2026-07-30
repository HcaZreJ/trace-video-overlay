# AGENTS

## 文档地图
| 文档 | 内容 |
|---|---|
| [PROJECT.md](PROJECT.md) | 项目目的、功能清单与状态、核心 data model、模块地图 |
| [PATTERNS.md](PATTERNS.md) | 分层与依赖方向、跨模块状态、命名、错误处理、渲染与测试范式 |
| [TECHSTACK.md](TECHSTACK.md) | 技术栈、依赖、外部服务、目录结构、部署 |
| [DEVFLOW.md](DEVFLOW.md) | 运行/测试/部署命令、分支工作流 |
| `.claude/plans/` | 跨 session 权威设计文档；进 repo 先查 Status 非 Completed 的 plan |
| `BACKLOG.md` | 当前 session 的任务板 |

## 本 repo 铁律

1. **按层分模块**：新代码放进它所属的那一层，`src/core` · `src/parse` · `src/basemap`
   · `src/render` · `src/export` · `src/ui`，各层职责与依赖方向见 PATTERNS.md。
   单个 `.mjs` 控制在 200 行以内；超出说明它装了不止一件事，拆。

2. **纯函数进 `src/core/`**：几何、坐标换算、指标、颜色空间这类零浏览器 API 的逻辑写进
   `src/core/`，配 `node:test`。浏览器和 Node 导入同一份实现。
   碰 fetch / DOM / Canvas 的逻辑归 `basemap` / `render` / `ui` 三层。

3. **跨模块共享的可变状态用对象属性**：ES module 的导入绑定只读，多个模块要既读又写
   同一份状态时，把它挂在导出的对象上（`state.trackPoints` · `exportState.forceNoBasemap`
   · `pickerState.currentRgb`）。只服务单一模块的状态用普通 `let` 留在那个模块里。

4. **零依赖约束**：新能力优先用浏览器原生 API；引入第三方库以一个自包含文件的形式
   vendored 进 `vendor/`，并经用户确认。无构建步骤、无包管理器。

5. **测试命令**：`node --test 'tests/**/*.test.mjs'` 一条覆盖全量。
   单元的 hidden 跑分走 `~/.claude/scripts/run-hidden-tests.sh <repo-root> <unit>`。

6. **渲染同构**：`src/render/card.mjs` 里 `renderCard`（预览与 PNG）与 `renderFrame`
   （MP4 逐帧）画的是同一幅画，改一个就同步另一个。两者同处一个文件正是为了让这条
   约束在一屏内可见。

7. **本地开发起静态服务器**：`python3 -m http.server 8137`，经
   http://localhost:8137/ 访问。ES module 的 import 要求 HTTP(S) 协议。
