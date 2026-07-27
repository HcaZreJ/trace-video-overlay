# trace-video-overlay

从 GPS 轨迹生成两种视频剪辑素材：一张透明背景的轨迹图 PNG，或者一个代表「当前位置」的小圆点沿轨迹匀速移动的 MP4。填入自己的高德 API Key 后（免费申请），可以在素材里的轨迹下面额外叠一层高德的静态地图。静态地图会展示街道、河流、地名等地图信息。

**在线使用**：https://hcazrej.github.io/trace-video-overlay/

## Features

- 六种轨迹格式在浏览器里解析：GPX、KML、TCX、FIT、GeoJSON、CSV。文件不上传服务器。
- 多个轨迹文件按加载顺序首尾拼接成一条轨迹。
- 导出三种素材，分辨率 720 / 1080 / 1440 通用：
  - 透明背景的轨迹图 PNG，底色透明度、圆角、内边距可调。
  - 单独一张「当前位置」小圆点 PNG，供在剪辑软件里对它打位置关键帧沿轨迹移动。
  - MP4 动画，小圆点沿轨迹从起点匀速移动到终点，用 WebCodecs `VideoEncoder` 加一份 vendored 的 `mp4-muxer.js` 编码。
- 可选叠加一层高德静态地图作为底图。默认关闭，需要用户手动勾选并填入自己的高德 Web 服务 API Key 才启用；境内点位用国测局公式（WGS84 → GCJ-02）自动转换后再投影，避免中国境内地图错位。
- 无 build 步骤、无 npm 依赖，浏览器打开 `index.html` 即可运行。

## Usage

打开 [在线站点](https://hcazrej.github.io/trace-video-overlay/)，拖入一个或多个轨迹文件，调整样式，点击导出。

想在本地运行代码：用浏览器直接打开 `index.html`，或者启动一个静态服务器：

```
python3 -m http.server 8137
```

然后访问 `http://localhost:8137/`。

## Project Structure

| 文件 | 内容 |
|---|---|
| `core.mjs` | 纯函数：Web Mercator 投影、WGS84 → GCJ-02 坐标转换、高德静态地图 URL 构造与对齐数学、轨迹平滑与拼接、几何计算（`dotGeometry`、`pointAtProgress`）、指标计算（距离、时长、均速、配速、爬升）、GeoJSON 与 CSV 坐标提取。ES module 具名导出，`node:test` 覆盖。 |
| `fit.mjs` | FIT 二进制格式解析。 |
| `index.html` | 应用本体：CSS、DOM、内联 script（含 `core.mjs` 中所有被页面使用的函数的逐字符同步副本）、Canvas 渲染（`renderCard` / `renderDot` / `renderFrame`）、高德底图 fetch 与错误诊断、MP4 导出管线（含取消与关页拦截）。 |
| `mp4-muxer.js` | Vendored [Vanilagy/mp4-muxer](https://github.com/Vanilagy/mp4-muxer)，把 WebCodecs 编码出的 chunk 封装成 MP4 容器。 |
| `tests/visible/`、`tests/hidden/` | `node:test` 单元测试，覆盖 `core.mjs` 的纯逻辑。 |

## Testing

需要 Node v22+：

```
node --test 'tests/**/*.test.mjs'
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE)。禁止商用。
