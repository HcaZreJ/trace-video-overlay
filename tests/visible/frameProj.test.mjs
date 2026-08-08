// frameProj · 逐帧投影缓存（opts.proj）— visible 样例测试
//
// Node 里没有真实 canvas，用「记录调用的 mock context」测：把 Canvas 2D 的每个方法变成
// 往数组里追加 [方法名, ...参数] 的记录函数，属性做成普通可写属性（Proxy 兜住任意方法名）。
// 断言的抓手是描线坐标（moveTo / lineTo）与标记圆心（arc）。
//
// proj.points 用「等距共线的水平线」构造：这种形状自动投影不可能产出，
// 且无论描线是逐点连线还是经过平滑加密，采样点都仍落在同一条水平线上、
// x 跨度仍是首末两点 —— 断言因此既严格又不依赖描线的加密方式。

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderFrame } from '../../src/render/card.mjs';
import { state } from '../../src/state.mjs';

/* ------------------------------------------------------------------ mock ctx */

const SHARED_GRADIENT = { addColorStop() {} };

const CTX_DEFAULT_PROPS = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  filter: 'none',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  imageSmoothingEnabled: true,
};

/** 造一个记录全部调用与属性写入的 Canvas 2D mock。返回 { ctx, calls }。 */
function createMockCtx(size = 600) {
  const calls = [];
  const props = { ...CTX_DEFAULT_PROPS };
  const fnCache = new Map();
  const canvas = { width: size, height: size };

  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        if (prop === 'canvas') return canvas;
        if (Object.prototype.hasOwnProperty.call(props, prop)) return props[prop];
        if (!fnCache.has(prop)) {
          fnCache.set(prop, (...args) => {
            calls.push([prop, ...args]);
            if (prop.startsWith('create')) return SHARED_GRADIENT;
            if (prop === 'measureText') return { width: 0 };
            return undefined;
          });
        }
        return fnCache.get(prop);
      },
      set(_target, prop, value) {
        props[prop] = value;
        calls.push([`set:${String(prop)}`, value]);
        return true;
      },
      has() {
        return true;
      },
    },
  );

  return { ctx, calls };
}

/* ------------------------------------------------------- 调用记录的读取工具 */

/** 把调用记录切成一条条折线：moveTo 开一条，lineTo 续一条，beginPath 断开。 */
function polylines(calls) {
  const groups = [];
  let current = null;
  for (const [name, ...args] of calls) {
    if (name === 'moveTo') {
      current = [[args[0], args[1]]];
      groups.push(current);
    } else if (name === 'lineTo') {
      if (current) current.push([args[0], args[1]]);
    } else if (name === 'beginPath') {
      current = null;
    }
  }
  return groups;
}

/** 顶点最多的一条折线即轨迹本身。 */
function trackPath(calls) {
  const groups = polylines(calls).filter((g) => g.length >= 2);
  if (!groups.length) return null;
  return groups.reduce((a, b) => (b.length > a.length ? b : a));
}

/** 取出全部 arc 的圆心（半径不由投影结果决定，忽略）。 */
function arcCenters(calls) {
  return calls.filter(([name]) => name === 'arc').map(([, x, y]) => [x, y]);
}

function near(a, b, tol = 1e-6) {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
}

function describePath(path) {
  if (!path || !path.length) return '(无轨迹路径)';
  const xs = path.map((p) => p[0]);
  const ys = path.map((p) => p[1]);
  return (
    `顶点数=${path.length} 首=(${path[0][0].toFixed(2)},${path[0][1].toFixed(2)}) ` +
    `末=(${path.at(-1)[0].toFixed(2)},${path.at(-1)[1].toFixed(2)}) ` +
    `x范围=[${Math.min(...xs).toFixed(2)},${Math.max(...xs).toFixed(2)}] ` +
    `y范围=[${Math.min(...ys).toFixed(2)},${Math.max(...ys).toFixed(2)}]`
  );
}

/** 断言轨迹描线落在 proj.points 定义的那条水平线段上，且首末覆盖整段。 */
function assertPathOnLine(calls, line, tol = 0.5) {
  const path = trackPath(calls);
  assert.ok(path, '期望存在一条轨迹描线');
  for (const [x, y] of path) {
    assert.ok(near(y, line.y, tol), `描线应落在 y=${line.y} 上，实际路径 ${describePath(path)}`);
    assert.ok(
      x >= line.xMin - tol && x <= line.xMax + tol,
      `描线 x 应落在 [${line.xMin}, ${line.xMax}] 内，实际路径 ${describePath(path)}`,
    );
  }
  const xs = path.map((p) => p[0]);
  assert.ok(near(Math.min(...xs), line.xMin, tol), `描线应从首点 x=${line.xMin} 起，实际 ${describePath(path)}`);
  assert.ok(near(Math.max(...xs), line.xMax, tol), `描线应到末点 x=${line.xMax} 止，实际 ${describePath(path)}`);
}

/* --------------------------------------------------------------- 测试夹具 */

const TRACK = [
  { lng: 120.100, lat: 30.900 },
  { lng: 120.140, lat: 30.930 },
  { lng: 120.180, lat: 30.910 },
  { lng: 120.220, lat: 30.960 },
  { lng: 120.260, lat: 30.940 },
];

const BASEMAP_IMAGE = { width: 1024, height: 1024 };

const PROJ_POINTS = [
  { x: 111, y: 333 },
  { x: 222, y: 333 },
  { x: 333, y: 333 },
  { x: 444, y: 333 },
  { x: 555, y: 333 },
];
const PROJ_LINE = { y: 333, xMin: 111, xMax: 555 };

function makeProj(points = PROJ_POINTS, fullSize = 520) {
  return { points: points.map((p) => ({ x: p.x, y: p.y })), fullSize };
}

function baseOpts(over = {}) {
  return {
    radius: 24,
    pad: 40,
    lineWidth: 6,
    markerSize: 10,
    dotSize: 12,
    bgMode: 'card',
    pageColor: '#f2f2f7',
    greenColor: '#00b140',
    bgColor: '#ffffff',
    lineColor: '#ff3b30',
    startColor: '#34c759',
    endColor: '#007aff',
    dotColor: '#ffffff',
    bgOpacity: 1,
    showMarkers: false,
    basemapImage: null,
    mapCenter: null,
    mapZoom: null,
    spanPx: 520,
    contentSize: 520,
    viewScale: 1,
    overlayMode: 'none',
    overlayMaskOpacity: 0.35,
    ...over,
  };
}

function basemapOpts(over = {}) {
  return baseOpts({
    basemapImage: BASEMAP_IMAGE,
    mapCenter: { lng: 120.18, lat: 30.93 },
    mapZoom: 13,
    spanPx: 600,
    contentSize: 600,
    viewScale: 1,
    ...over,
  });
}

/** 设定 state.trackPoints 跑一帧，结束后复位，测试之间互不影响。返回调用记录。 */
function renderOnce({ size = 600, progress = 0.5, opts = baseOpts(), track = TRACK } = {}) {
  const { ctx, calls } = createMockCtx(size);
  const previous = state.trackPoints;
  state.trackPoints = track;
  try {
    renderFrame(ctx, size, progress, opts);
  } finally {
    state.trackPoints = previous;
  }
  return calls;
}

/* ------------------------------------------------------------------- 测试 */

test('frameProj · renderFrame(非底图分支): 提供 opts.proj 时描线取自 proj.points', () => {
  const calls = renderOnce({ opts: baseOpts({ proj: makeProj() }) });
  assertPathOnLine(calls, PROJ_LINE);
});

test('frameProj · renderFrame(底图分支): 提供 opts.proj 时描线取自 proj.points', () => {
  const calls = renderOnce({ opts: basemapOpts({ proj: makeProj(PROJ_POINTS, 600) }) });
  assertPathOnLine(calls, PROJ_LINE);
});

test('frameProj · renderFrame(缺省 opts.proj): 自动投影照旧生效并 translate(pad, pad)', () => {
  const size = 600;
  const calls = renderOnce({ size, opts: baseOpts() });

  const path = trackPath(calls);
  assert.ok(path, '缺省 proj 时应自行投影并描线');
  for (const [x, y] of path) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `坐标应为有限数，实际 (${x}, ${y})`);
    assert.ok(x >= -1 && x <= size + 1 && y >= -1 && y <= size + 1, `坐标应落在画面内：${describePath(path)}`);
  }

  // 非底图分支的坐标约定：绘制前平移 pad（size=600 时缩放系数为 1）。
  const translated = calls.some(([n, x, y]) => n === 'translate' && near(x, 40) && near(y, 40));
  assert.ok(translated, '非底图分支应调用 ctx.translate(pad, pad)');

  // 定位点用 arc 绘制。
  assert.ok(arcCenters(calls).length > 0, '应存在定位点的 arc 调用');
});
