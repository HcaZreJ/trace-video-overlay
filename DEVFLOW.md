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

canvas 像素、fetch 行为、交互链路这些测试断言碰不到，用无头 Chrome 实测。
凡是异步流程（载入文件、切模式、编码导出）都用 CDP 实时驱动：`--dump-dom` 在 load 事件时
就抓快照，那一刻异步逻辑还没跑完，只会抓到初始状态。

起服务与带调试端口的浏览器：

```
python3 -m http.server 8137 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-sandbox --remote-debugging-port=9222 --user-data-dir=/tmp/cdp-profile about:blank
```

Node v22 自带 global `WebSocket`，零依赖即可驱动：`fetch http://localhost:9222/json` 取
page target 的 `webSocketDebuggerUrl` → `Page.navigate` 到 `/index.html` →
`Runtime.evaluate` 配 `awaitPromise: true` + `returnByValue: true` 执行验证脚本并取回结果。
脚本跑在页面上下文里，`document` 就是应用本身，不需要 iframe 承载页。

- 验证导出前先 `delete window.showSaveFilePicker`：无头环境弹不出「保存到哪」的对话框
  也没人点，摘掉它让流程走全内存路径。
- 拦下 `URL.createObjectURL` 与 `HTMLAnchorElement.prototype.click`，就能记下产物的类型、
  字节数与文件名（`application/json` 的还可以 `blob.text()` 读出内容核对），不必真落盘。
- 用真实文件驱动载入链路：`new DataTransfer()` 装一个 `File` 赋给 `#file` 的 `files`，
  再派发 `change`，走的就是用户选文件的那条路径。
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
