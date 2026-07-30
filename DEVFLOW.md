# DEVFLOW

## 本地开发
- 起静态服务器：`python3 -m http.server 8137`（端口固化在 `.claude/launch.json`），
  访问 http://localhost:8137/ 。ES module 的 import 要求 HTTP(S) 协议。
- 无构建步骤、无热重载：改完文件刷新浏览器即可。
- 手测样例数据：`sample-ride.gpx`、`sample-route.gpx`；页面 drop 区下方的
  「试试示例轨迹」按钮直接加载前者。

## 测试
测试框架为 Node 内置 `node:test`（Node v22+），命令直接跑 `node`：

| 目的 | 命令 |
|---|---|
| 全量 | `node --test 'tests/**/*.test.mjs'` |
| 纯逻辑单测 | `node --test 'tests/unit/*.test.mjs'` |
| 某单元 visible（implementer 自查） | `node --test tests/visible/<unit>.test.mjs` |
| 某单元 hidden（架构师验收） | `node --test tests/hidden/<unit>.test.mjs` |
| 某单元 hidden 跑分（implementer 只见 PASSED: X/Y） | `~/.claude/scripts/run-hidden-tests.sh <repo-root> <unit>` |
| 单个模块语法检查 | `node --check src/<path>.mjs` |

- `node --test` 的路径参数须是**具体文件或 glob**（如上表）；目录路径以 glob 形式
  `'tests/**/*.test.mjs'` 展开传入（Node 对裸目录参数按模块解析，报 `MODULE_NOT_FOUND`）。

## 静态断言够不着的部分怎么验

canvas 像素、fetch 行为、交互链路这些测试断言碰不到，用无头 Chrome 实测：

```
python3 -m http.server 8137 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --no-sandbox --virtual-time-budget=9000 --dump-dom http://localhost:8137/<harness>.html
```

- 承载页放在仓库根、经同源 iframe 载入 `/index.html`，才能跨 frame 读 DOM 与 canvas。
- 页面里有 `setInterval` 时 `--virtual-time-budget --dump-dom` 可能挂住，
  改用 CDP `Runtime.evaluate` 配 `awaitPromise` 更稳。
- 渲染改动比对像素签名：非透明像素数 + FNV-1a 哈希 + 若干固定采样点 RGBA。
  载入 `sample-ride.gpx` 后 `#card` 的基线是 356696 像素 / FNV `2995975869`。

## 构建与部署
- **push 到 `main` 即上线**：GitHub Pages（legacy 流水线）从 `main` 分支根目录直接发布到
  https://hcazrej.github.io/trace-video-overlay/ ，无构建产物、无 staging 环境。
- 因此 merge/push `main` 前本地全量测试必须全绿 + 浏览器手测通过。

## 分支与 commit
- 长期分支只有 `main`。大功能走 `worktree-<feature-slug>` 分支 + PR 合并；小改动直接
  提交 `main`（混合式，无分支保护）。
- Commit message：`feat:`/`fix:`/`refactor:`/`docs:`/`test:` 前缀 + 中文一句话；
  body 列涉及单元/文件 + 测试通过情况 + 引用对应 plan 文件路径。
- 质量门完全在本地：repo 无 CI/CD、无 lint/format 工具链、无 package.json 脚本入口。
