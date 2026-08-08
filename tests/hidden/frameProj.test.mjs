// frameProj · 逐帧投影缓存（opts.proj）— hidden 全面测试
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

// 全局共用一个渐变对象，保证两次渲染的调用记录可以结构化比较。
const SHARED_GRADIENT = { addColorStop() {} };

const CTX_DEFAULT_PROPS = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  lineDashOffset: 0,
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
  imageSmoothingQuality: 'low',
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
            if (prop === 'measureText') {
              return { width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 };
            }
            if (prop === 'getImageData') {
              return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
            }
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

/** showMarkers=false 时全部 arc 同心，即定位点位置。 */
function dotCenter(calls) {
  const centers = arcCenters(calls);
  assert.ok(centers.length > 0, '应存在定位点的 arc 调用');
  for (const c of centers) {
    assert.ok(
      samePoint(c, centers[0], 1e-9),
      `showMarkers=false 时全部 arc 应共用定位点圆心，实际 ${JSON.stringify(centers)}`,
    );
  }
  return centers[0];
}

function countCalls(calls, name) {
  return calls.filter(([n]) => n === name).length;
}

function fmt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(4) : String(value);
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return value === BASEMAP_IMAGE ? '<image>' : '<obj>';
  return String(value);
}

/** 整条调用记录的可比较快照（浮点归一到 4 位小数，对象归一成标签）。 */
function snapshot(calls) {
  return calls.map(([name, ...args]) => `${name}(${args.map(fmt).join(', ')})`);
}

function near(a, b, tol = 1e-6) {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
}

function samePoint(got, want, tol = 1e-6) {
  return near(got[0], want[0], tol) && near(got[1], want[1], tol);
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

/** 断言描线逐点等于给定坐标（点数少到不会被平滑加密时用）。 */
function assertPolyline(calls, points, tol = 1e-6) {
  const want = points.map((p) => [p.x, p.y]);
  const groups = polylines(calls);
  const hit = groups.some(
    (g) => g.length === want.length && g.every((c, i) => samePoint(c, want[i], tol)),
  );
  assert.ok(
    hit,
    `期望存在折线 ${JSON.stringify(want)}，实际折线为 ${JSON.stringify(groups.map((g) => g.slice(0, 4)))}`,
  );
}

/** 断言存在一个 arc 圆心落在 want 上。 */
function assertArcAt(calls, want, message, tol = 0.5) {
  const centers = arcCenters(calls);
  const hit = centers.some((c) => samePoint(c, want, tol));
  assert.ok(
    hit,
    `${message}：期望存在圆心 ${JSON.stringify(want)}，实际圆心 ${JSON.stringify(centers)}`,
  );
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

// 等距共线的水平线：自动投影不可能产出这种形状；
// 等距还让 progress=0.5 的定位点无歧义地落在正中间 x=333。
const PROJ_POINTS = [
  { x: 111, y: 333 },
  { x: 222, y: 333 },
  { x: 333, y: 333 },
  { x: 444, y: 333 },
  { x: 555, y: 333 },
];
const PROJ_LINE = { y: 333, xMin: 111, xMax: 555 };
const PROJ_FIRST = [111, 333];
const PROJ_MIDDLE = [333, 333];
const PROJ_LAST = [555, 333];

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

/* --------------------------------------------------- 1. proj 真的被采用（分支） */

test('frameProj · renderFrame(非底图分支): 提供 opts.proj 时描线取自 proj.points', () => {
  const calls = renderOnce({ opts: baseOpts({ proj: makeProj() }) });
  assertPathOnLine(calls, PROJ_LINE);
});

test('frameProj · renderFrame(底图分支): bgMode=card 且有底图时描线取自 proj.points', () => {
  const calls = renderOnce({ opts: basemapOpts({ proj: makeProj(PROJ_POINTS, 600) }) });
  assertPathOnLine(calls, PROJ_LINE);
});

test('frameProj · renderFrame(绿幕分支): bgMode=green 且有底图时走非底图分支并采用 proj', () => {
  const calls = renderOnce({ opts: basemapOpts({ bgMode: 'green', proj: makeProj() }) });
  assertPathOnLine(calls, PROJ_LINE);
  const translated = calls.some(([n, x, y]) => n === 'translate' && near(x, 40) && near(y, 40));
  assert.ok(translated, 'bgMode=green 属非底图分支，应调用 ctx.translate(pad, pad)');
});

test('frameProj · renderFrame(size=1080): 提供 opts.proj 时坐标按原值使用，不再二次缩放', () => {
  // proj 由调用方按目标尺寸算好，函数直接采用，不对缓存坐标再乘 size/600。
  const calls = renderOnce({ size: 1080, opts: baseOpts({ proj: makeProj(PROJ_POINTS, 936) }) });
  assertPathOnLine(calls, PROJ_LINE);
});

test('frameProj · renderFrame(两点最小轨迹): 描线坐标逐点等于 proj.points', () => {
  const twoPoints = [
    { x: 100, y: 100 },
    { x: 500, y: 400 },
  ];
  const calls = renderOnce({
    track: TRACK.slice(0, 2),
    opts: baseOpts({ proj: makeProj(twoPoints) }),
  });
  assertPolyline(calls, twoPoints);
});

test('frameProj · renderFrame(平移 proj): proj 整体平移后描线整体平移相同量', () => {
  const dx = 30;
  const dy = -25;
  const shifted = PROJ_POINTS.map((p) => ({ x: p.x + dx, y: p.y + dy }));

  const basePath = trackPath(renderOnce({ opts: baseOpts({ proj: makeProj() }) }));
  const shiftedPath = trackPath(renderOnce({ opts: baseOpts({ proj: makeProj(shifted) }) }));

  assert.ok(basePath && shiftedPath, '两次渲染都应画出轨迹');
  assert.equal(shiftedPath.length, basePath.length, '平移不应改变描线的顶点数');
  const allShifted = shiftedPath.every((p, i) => near(p[0], basePath[i][0] + dx, 1e-6) && near(p[1], basePath[i][1] + dy, 1e-6));
  assert.ok(
    allShifted,
    `描线应随 proj 整体平移 (${dx}, ${dy})：原 ${describePath(basePath)}；平移后 ${describePath(shiftedPath)}`,
  );
});

/* ------------------------------------------------------- 2. 缺省 proj 行为不变 */

test('frameProj · renderFrame(缺省 opts.proj): 自动投影画出轨迹且坐标落在画面内', () => {
  const size = 600;
  const calls = renderOnce({ size, opts: baseOpts() });

  const path = trackPath(calls);
  assert.ok(path, '缺省 proj 时应自行投影并描线');
  for (const [x, y] of path) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `坐标应为有限数，实际 (${x}, ${y})`);
    assert.ok(
      x >= -1 && x <= size + 1 && y >= -1 && y <= size + 1,
      `自动投影坐标应落在画面内：${describePath(path)}`,
    );
  }
  assert.ok(arcCenters(calls).length > 0, '应存在定位点的 arc 调用');
});

test('frameProj · renderFrame(缺省 opts.proj): 同一组入参两次调用的记录完全一致', () => {
  assert.deepStrictEqual(
    snapshot(renderOnce({ opts: baseOpts() })),
    snapshot(renderOnce({ opts: baseOpts() })),
  );
});

test('frameProj · renderFrame(proj 为 null / undefined): 与完全不传 proj 的记录完全一致', () => {
  const withoutKey = snapshot(renderOnce({ opts: baseOpts() }));
  assert.deepStrictEqual(
    snapshot(renderOnce({ opts: baseOpts({ proj: null }) })),
    withoutKey,
    'proj=null 应回落到自行投影',
  );
  assert.deepStrictEqual(
    snapshot(renderOnce({ opts: baseOpts({ proj: undefined }) })),
    withoutKey,
    'proj=undefined 应回落到自行投影',
  );
});

test('frameProj · renderFrame(缺省 opts.proj 底图分支): 记录同样保持确定性', () => {
  assert.deepStrictEqual(
    snapshot(renderOnce({ opts: basemapOpts() })),
    snapshot(renderOnce({ opts: basemapOpts({ proj: null }) })),
    '底图分支下 proj=null 也应回落到自行投影',
  );
});

/* --------------------------------------------------------- 3. 坐标约定与分支 */

test('frameProj · renderFrame(非底图分支): 有无 proj 都执行 translate(pad, pad)', () => {
  const hasPadTranslate = (calls) =>
    calls.some(([n, x, y]) => n === 'translate' && near(x, 40) && near(y, 40));

  assert.ok(hasPadTranslate(renderOnce({ opts: baseOpts() })), '缺省 proj 时应 translate(pad, pad)');
  assert.ok(
    hasPadTranslate(renderOnce({ opts: baseOpts({ proj: makeProj() }) })),
    '提供 proj 时同样应 translate(pad, pad)',
  );
});

test('frameProj · renderFrame(size=1080 非底图分支): translate 为按 size/600 缩放后的 pad', () => {
  const expected = 40 * (1080 / 600); // 72
  const check = (calls, label) => {
    const translates = calls.filter(([n]) => n === 'translate');
    assert.ok(
      translates.some(([, x, y]) => near(x, expected) && near(y, expected)),
      `${label}：期望 translate(${expected}, ${expected})，实际 ${JSON.stringify(translates)}`,
    );
  };
  check(renderOnce({ size: 1080, opts: baseOpts() }), '缺省 proj');
  check(renderOnce({ size: 1080, opts: baseOpts({ proj: makeProj(PROJ_POINTS, 936) }) }), '提供 proj');
});

test('frameProj · renderFrame(底图分支): 不执行非底图分支的 translate(pad, pad)', () => {
  const check = (calls, label) => {
    const padTranslate = calls.some(([n, x, y]) => n === 'translate' && near(x, 40) && near(y, 40));
    assert.equal(padTranslate, false, `${label}：底图分支的坐标约定不含 pad 平移`);
  };
  check(renderOnce({ opts: basemapOpts() }), '缺省 proj');
  check(renderOnce({ opts: basemapOpts({ proj: makeProj(PROJ_POINTS, 600) }) }), '提供 proj');
});

/* ------------------------------------------------------------- 4. 边界与错误 */

test('frameProj · renderFrame(proj.points 为空数组): 不抛错', () => {
  assert.doesNotThrow(() => renderOnce({ opts: baseOpts({ proj: makeProj([]) }) }), '非底图分支空 points 应静默跳过');
  assert.doesNotThrow(
    () => renderOnce({ opts: basemapOpts({ proj: makeProj([], 600) }) }),
    '底图分支空 points 应静默跳过',
  );
});

test('frameProj · renderFrame(proj.points 为空数组): 与空轨迹一致地跳过描线与定位点', () => {
  const full = renderOnce({ opts: baseOpts() });
  const empty = renderOnce({ opts: baseOpts({ proj: makeProj([]) }) });

  assert.ok(
    countCalls(empty, 'lineTo') + (TRACK.length - 1) <= countCalls(full, 'lineTo'),
    `空 points 应少掉整条轨迹的描线：空=${countCalls(empty, 'lineTo')}，全量=${countCalls(full, 'lineTo')}`,
  );
  assert.ok(
    countCalls(empty, 'arc') < countCalls(full, 'arc'),
    `空 points 应跳过定位点绘制：空 arc=${countCalls(empty, 'arc')}，全量 arc=${countCalls(full, 'arc')}`,
  );
});

test('frameProj · renderFrame(state.trackPoints 为 null): 即便提供 proj 也不作画', () => {
  const calls = renderOnce({ track: null, opts: baseOpts({ proj: makeProj() }) });
  const drawing = calls.filter(([n]) =>
    ['moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'drawImage'].includes(n),
  );
  assert.deepStrictEqual(
    drawing,
    [],
    `轨迹为 null 时应直接返回，实际产生了绘制调用 ${JSON.stringify(snapshot(drawing))}`,
  );
});

test('frameProj · renderFrame(复用同一 proj 对象): 渲染过程不改写调用方的缓存', () => {
  const proj = makeProj();
  const before = JSON.stringify(proj);
  renderOnce({ progress: 0.25, opts: baseOpts({ proj }) });
  assert.equal(JSON.stringify(proj), before, 'proj 是逐帧复用的缓存，渲染不应就地改写它');
});

/* ------------------------------------------------------- 5. progress 与定位点 */

test('frameProj · renderFrame(progress=0): 定位点落在 proj.points 的首点', () => {
  const calls = renderOnce({ progress: 0, opts: baseOpts({ proj: makeProj() }) });
  assertArcAt(calls, PROJ_FIRST, 'progress=0 的定位点');
});

test('frameProj · renderFrame(progress=1): 定位点落在 proj.points 的末点', () => {
  const calls = renderOnce({ progress: 1, opts: baseOpts({ proj: makeProj() }) });
  assertArcAt(calls, PROJ_LAST, 'progress=1 的定位点');
});

test('frameProj · renderFrame(progress=0.5): 定位点落在 proj.points 的正中间', () => {
  // 5 个等距共线点，按里程插值或按索引取点，中点都是 (333, 333)。
  const calls = renderOnce({ progress: 0.5, opts: baseOpts({ proj: makeProj() }) });
  assertArcAt(calls, PROJ_MIDDLE, 'progress=0.5 的定位点');
});

test('frameProj · renderFrame(progress 递增): 定位点沿 proj 线段单调前进', () => {
  const xs = [0, 0.25, 0.5, 0.75, 1].map((progress) => {
    const calls = renderOnce({ progress, opts: baseOpts({ proj: makeProj() }) });
    const [x, y] = dotCenter(calls);
    assert.ok(near(y, PROJ_LINE.y, 0.5), `progress=${progress} 的定位点应落在 y=${PROJ_LINE.y}，实际 y=${y}`);
    assert.ok(
      x >= PROJ_LINE.xMin - 0.5 && x <= PROJ_LINE.xMax + 0.5,
      `progress=${progress} 的定位点 x 应落在 [${PROJ_LINE.xMin}, ${PROJ_LINE.xMax}]，实际 ${x}`,
    );
    return x;
  });
  for (let i = 1; i < xs.length; i += 1) {
    assert.ok(xs[i] >= xs[i - 1] - 1e-6, `定位点应随 progress 单调前进，实际 x 序列 ${JSON.stringify(xs)}`);
  }
});

test('frameProj · renderFrame(showMarkers=true): 起终点标记落在 proj.points 的首末点', () => {
  const calls = renderOnce({ progress: 0.5, opts: baseOpts({ proj: makeProj(), showMarkers: true }) });
  assertArcAt(calls, PROJ_FIRST, '起点标记');
  assertArcAt(calls, PROJ_LAST, '终点标记');
});

test('frameProj · renderFrame(逐帧复用): 不同 progress 下描线恒等于同一份 proj', () => {
  const proj = makeProj();
  for (const progress of [0, 0.1, 0.5, 0.9, 1]) {
    assertPathOnLine(renderOnce({ progress, opts: baseOpts({ proj }) }), PROJ_LINE);
  }
});

test('frameProj · renderFrame(底图分支逐帧复用): 定位点沿 proj.points 从首点走到末点', () => {
  const makeOpts = () => basemapOpts({ proj: makeProj(PROJ_POINTS, 600) });
  assertArcAt(renderOnce({ progress: 0, opts: makeOpts() }), PROJ_FIRST, '底图分支 progress=0 的定位点');
  assertArcAt(renderOnce({ progress: 1, opts: makeOpts() }), PROJ_LAST, '底图分支 progress=1 的定位点');
});

/* --------------------------------------------- 6. proj 被原样采用，不再二次加工 */

// 五个非共线点：proj 已是调用方算好的最终屏幕坐标，描线应逐点连它们。
// 若实现拿到 proj 后又送去平滑加密，顶点数会从 5 涨到几百，本用例即失败。
const PROJ_FIVE = [
  { x: 100, y: 120 },
  { x: 180, y: 260 },
  { x: 300, y: 140 },
  { x: 420, y: 330 },
  { x: 520, y: 200 },
];

test('frameProj · renderFrame(五点非共线 proj): 描线顶点逐点等于 proj.points', () => {
  const calls = renderOnce({ opts: baseOpts({ proj: makeProj(PROJ_FIVE) }) });
  assertPolyline(calls, PROJ_FIVE);
});

test('frameProj · renderFrame(五点非共线 proj 底图分支): 描线顶点逐点等于 proj.points', () => {
  const calls = renderOnce({ opts: basemapOpts({ proj: makeProj(PROJ_FIVE, 600) }) });
  assertPolyline(calls, PROJ_FIVE);
});

/* ------------------------------------------------ 7. 空轨迹数组不再是崩溃路径 */

test('frameProj · renderFrame(state.trackPoints 为空数组): 不抛错且不作画', () => {
  // 解析器对无法识别的文件会产出空点数组，拼接后 trackPoints 可能是 [] 而非 null。
  // 空数组与 null 走同一条守卫：直接返回，不描线不画点。
  let calls = null;
  assert.doesNotThrow(() => {
    calls = renderOnce({ track: [], opts: baseOpts() });
  }, 'state.trackPoints 为空数组时应被守卫拦下，不应抛错');

  const drawing = calls.filter(([n]) =>
    ['moveTo', 'lineTo', 'arc', 'stroke', 'drawImage'].includes(n),
  );
  assert.deepStrictEqual(
    drawing,
    [],
    `空轨迹数组应与 null 一样直接返回，实际产生了绘制调用 ${JSON.stringify(snapshot(drawing))}`,
  );
});

test('frameProj · renderFrame(state.trackPoints 为空数组 + 底图分支): 同样被守卫拦下', () => {
  let calls = null;
  assert.doesNotThrow(() => {
    calls = renderOnce({ track: [], opts: basemapOpts() });
  }, '底图分支下空轨迹数组同样不应抛错');

  const drawing = calls.filter(([n]) => ['moveTo', 'lineTo', 'arc', 'stroke'].includes(n));
  assert.deepStrictEqual(drawing, [], '底图分支下空轨迹数组也不应画出轨迹与定位点');
});
