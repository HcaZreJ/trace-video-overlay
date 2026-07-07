# DEVFLOW

## 本地开发
- 直接用浏览器打开 `index.html`，或起静态服务器：`python3 -m http.server 8137`
  （端口 8137 固化在 `.claude/launch.json`）。
- 无构建步骤、无热重载：改完文件刷新浏览器即可。
- 手测样例数据：`sample-ride.gpx`、`sample-route.gpx`。

## 测试
测试框架为 Node 内置 `node:test`（Node v22+），命令直接跑 `node`：

| 目的 | 命令 |
|---|---|
| 全量（根目录遗留 + visible + hidden，235 cases） | `node --test` |
| harness 测试全量（tests/ 下，visible + hidden） | `node --test 'tests/**/*.test.mjs'` |
| 某单元 visible（implementer 自查） | `node --test tests/visible/<unit>.test.mjs` |
| 某单元 hidden（架构师验收；implementer 走脚本只见跑分） | `node --test tests/hidden/<unit>.test.mjs` 或 `~/.claude/scripts/run-hidden-tests.sh <repo-root> <unit>` |
| 根目录遗留测试（core/fit） | `node --test core.test.mjs fit.test.mjs` |

- `node --test` 的路径参数须是**具体文件或 glob**（如上表）；目录路径以 glob 形式
  `'tests/**/*.test.mjs'` 展开传入（Node 对裸目录参数按模块解析，报 `MODULE_NOT_FOUND`）。
- 无参数的 `node --test` 会递归发现全部 `*.test.mjs`（hidden 与 visible 混跑）。

## 构建与部署
- **push 到 `main` 即上线**：GitHub Pages（legacy 流水线）从 `main` 分支根目录直接发布到
  https://hcazrej.github.io/trace-video-overlay/ ，无构建产物、无 staging 环境。
- 因此 merge/push `main` 前本地全量测试必须全绿 + 浏览器手测通过。

## 分支与 commit
- 长期分支只有 `main`。大功能可走 `worktree-<feature-slug>` 分支 + PR 合并；小改动直接
  提交 `main`（混合式，无分支保护）。
- Commit message：`feat:`/`docs:` 前缀 + 中文一句话；body 列涉及单元/文件 + 测试通过情况 +
  引用对应 plan 文件路径；commit 粒度为 plan 级。
- 质量门完全在本地：repo 无 CI/CD、无 lint/format 工具链、无 package.json 脚本入口。
