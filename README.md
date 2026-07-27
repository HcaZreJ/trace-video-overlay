# trace-video-overlay

一份纯前端网页，把骑行 GPS 轨迹渲染成可以直接放进剪映等剪辑软件的角落贴图素材。

在线使用：https://hcazrej.github.io/trace-video-overlay/

## 这个 repo 解决什么问题

剪辑软件里在成品视频上贴一条骑行轨迹，常见做法是把轨迹渲染成图片，作为画中画放在角落。这里有两个具体的限制卡住用户：

- **透明背景**：贴图需要透明背景才能浮在原素材之上。H.264 / H.265 编码的 MP4 不带 alpha 通道，剪映也不支持导入图片序列或者透明视频；能被剪映当画中画使用、又能带透明背景的，只有单张 PNG。
- **让当前位置随视频进度移动**：想让「当前所在位置」的小圆点从起点沿线路移动到终点，需要一段动画。剪映本身只能对静态图打几个位置关键帧手动模拟。

这个 repo 把这两条路都做完，省掉用户自己搭 Canvas 或者找第三方脚本的工序：

- 想要**手动打关键帧**的用户：导出两张透明 PNG（一张轨迹卡片、一张定位点），拖进剪映，对定位点打几个位置关键帧沿线路走。
- 想要**一键出成品**的用户：直接导出一段 MP4，里面已经把定位点从起点匀速移到终点。

## 支持的输入格式

浏览器端解析，全程不上传服务器。

| 格式 | 解析实现 |
|---|---|
| GPX | `extractGPXCoords` — DOMParser 读 `<trkpt>` / `<rtept>` |
| KML | `extractKMLCoords` — 读 `gx:Track` / `LineString` / `Placemark` |
| TCX | `extractTCXCoords` — 读 `<Trackpoint>` |
| FIT | `parseFIT`（`fit.mjs`）— 自写的二进制解析器，读定义与数据消息里的 lat / lng / ele / time |
| GeoJSON | `extractGeoJSONCoords` — 递归收集 LineString / MultiLineString |
| CSV / TXT | `extractTextCoords` — 从任意分隔的文本里嗅探两列坐标 |

多个轨迹文件可以按拖入顺序首尾相连（`concatTrackPoints`），列表里支持上移、下移、删除、撤销。

## 产出什么

三种导出，共用同一份分辨率设置（720 / 1080 / 1440，正方形）：

- **轨迹卡片 PNG** — 圆角画布、可调透明度的底色、轨迹线路加起终点标记。底色透明度设成 0 就得到完全透明的贴图。渲染函数 `renderCard`。
- **定位点 PNG** — 单独一个白环加彩色核的小圆点，用户在剪辑软件里对它打几个位置关键帧沿线路走。渲染函数 `renderDot`。
- **MP4 动画** — 卡片背景加定位点，从进度 0 到 1 匀速走完整条线路。走 WebCodecs `VideoEncoder` 加一份 vendored 的 `mp4-muxer.js` 封装。时长上限 600 秒，帧率可选 24 / 30 / 60，画布可选卡片或者绿幕。导出过程中可以取消，关标签页会拦截。逐帧渲染函数 `renderFrame`，参数由 `buildFrameOpts` 打包，跟 DOM 解耦。

`renderCard` 和 `renderFrame` 复用 `core.mjs` 里的同一批投影 / 几何 / 拼接函数，改一处渲染行为要同步改另一处。

## 可选：地图底图

默认关闭。开启后，卡片上会叠一层高德静态地图作为底图，让轨迹背后同时显示街道、河流、地名。开启需要用户填入自己的高德 Web 服务 API Key。

- **网络请求只有这一处**：向 `https://restapi.amap.com/v3/staticmap` 发一次请求（`fetchAmapBasemap`），把当前轨迹的中心点、zoom、canvas 尺寸和 key 传过去，拿回一张 PNG。MP4 导出的全部帧共用同一张底图，不逐帧请求。
- **坐标系转换**：GPS 数据是 WGS84 坐标，高德底图是 GCJ-02。境内点走国测局公式（`wgs84ToGcj02`）转换到 GCJ-02 再投影，境外点原样发送。
- **对齐**：高德静图 zoom 用 512px tile 基准，代码里用常量 `AMAP_STATIC_ZOOM_BIAS = 1` 换算到标准 256px Web Mercator，然后让底图和轨迹共享同一份 world → canvas 仿射变换。高德整数 zoom 之间的空隙由 `computeOverlayScale` 得到的一个连续缩放因子吸收。
- **失败时的降级**：填错 key、请求失败、断网，卡片会自动回退到无底图渲染，其它导出功能不受影响。UI 会用中文提示对应的错误码（`diagnoseAmapApiError` 覆盖 `INVALID_USER_SCODE` 等常见返回）。
- **key 的存放**：仅明文写入浏览器的 `localStorage.amap_key`，不上传到任何服务器。

个人开发者的高德免费额度是每天 5000 次静态图请求，一次骑行的日常导出用不完。

## 代码结构

无 build 步骤、无 npm 依赖、无框架、无 TypeScript。直接用浏览器打开 `index.html` 就能跑。

| 文件 | 内容 |
|---|---|
| `core.mjs` | 纯函数集合：墨卡托投影、WGS84 → GCJ-02 转换、高德静图 URL 构造与对齐数学、轨迹平滑（`smoothTrack`）、多文件拼接（`concatTrackPoints`）、进度插值（`pointAtProgress`）、定位点几何（`dotGeometry`）、MP4 时长合法化（`clampMp4Duration`）、指标计算（距离、时长、均速、配速、爬升）、GeoJSON 与 CSV 解析。全部以 ES module 具名导出，node:test 覆盖。 |
| `fit.mjs` | FIT 二进制解析，独立一个模块。 |
| `index.html` | 应用本体：CSS、DOM、内联 script（含 core.mjs 里所有被页面使用的函数的逐字符同步副本，方便浏览器不通过 module 就能跑），文件载入、Canvas 渲染、动画预览、高德请求、MP4 导出管线（含取消与关页拦截）都在这一个文件里。 |
| `mp4-muxer.js` | Vendored [Vanilagy/mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 单文件构建，暴露全局 `Mp4Muxer`，把 WebCodecs 编码出的 chunk 封装成 MP4 容器。 |
| `tests/visible/`、`tests/hidden/` | 用 Node 内置 `node:test` 跑的单元测试，覆盖 `core.mjs` 里的坐标转换、几何、URL 构造、参数合法化等纯逻辑。 |
| `sample-ride.gpx`、`sample-route.gpx` | 内置示例轨迹；页面上「试试示例轨迹」按钮加载 `sample-ride.gpx`。 |

## 本地运行

直接用浏览器打开 `index.html` 即可。想起一个静态服务器：

```
python3 -m http.server 8137
```

然后访问 `http://localhost:8137/`。

## 测试

Node v22+ 内置的 `node:test`：

```
node --test 'tests/**/*.test.mjs'
```

## 许可证

PolyForm Noncommercial 1.0.0，见 [LICENSE](LICENSE)。禁止商用。
