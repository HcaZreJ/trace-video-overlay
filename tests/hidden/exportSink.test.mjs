// tests/hidden/exportSink.test.mjs
//
// Work unit `exportSink` — MP4 输出端：流式/内存双路径与 sidecar 落盘。
// Node 里没有 window / document / URL.createObjectURL，用例自行安装浏览器替身，
// 在 t.after 里还原，用例之间零共享可变状态、不依赖执行顺序。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  streamSinkSupported,
  createMp4Sink,
  downloadSidecar,
  MP4_MAX_DURATION_STREAM,
  MP4_MAX_DURATION_MEMORY,
} from '../../src/export/mp4-sink.mjs';

// ---------------------------------------------------------------------------
// 浏览器替身
// ---------------------------------------------------------------------------

/** ArrayBufferTarget 替身持有的字节，用来验证内存路径确实拿 target.buffer 造 Blob。 */
const MUXED_BYTES = [0x00, 0x01, 0x02, 0x03, 0xfa, 0xfb, 0xfc, 0xfd];

const NativeURL = globalThis.URL;

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    href: '',
    download: '',
    rel: '',
    target: '',
    style: {},
    clicks: 0,
    removed: false,
    click() {
      el.clicks += 1;
    },
    setAttribute(key, value) {
      el[key] = value;
    },
    getAttribute(key) {
      return el[key];
    },
    remove() {
      el.removed = true;
    },
    appendChild(child) {
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return el;
}

function makeWritable(options = {}) {
  const writable = {
    closeCalls: 0,
    abortCalls: 0,
    writes: [],
    async write(chunk) {
      writable.writes.push(chunk);
    },
    async close() {
      writable.closeCalls += 1;
      if (options.closeThrows) throw options.closeThrows;
    },
    // 同步抛错：无论实现 await 与否，try/catch 都能吞住。
    abort() {
      writable.abortCalls += 1;
      if (options.abortThrows) throw options.abortThrows;
    },
    async seek() {},
    async truncate() {},
  };
  return writable;
}

function installBrowserEnv(config = {}) {
  const {
    withWindow = true,
    withPicker = true,
    withMuxer = true,
    withStreamTarget = true,
    pickerError = null,
    createWritableError = null,
    writableOptions = {},
  } = config;

  const record = {
    pickerCalls: [],
    createWritableCalls: 0,
    createWritableOpts: undefined,
    arrayBufferTargets: [],
    streamTargets: [],
    elements: [],
    anchors: [],
    objectUrls: [],
    revoked: [],
    timers: [],
  };

  const writable = makeWritable(writableOptions);
  const handle = {
    kind: 'file',
    name: 'chosen-by-user.mp4',
    async createWritable(opts) {
      record.createWritableCalls += 1;
      record.createWritableOpts = opts;
      if (createWritableError) throw createWritableError;
      return writable;
    },
  };
  record.writable = writable;
  record.handle = handle;

  class FakeArrayBufferTarget {
    constructor(...args) {
      this.ctorArgs = args;
      this.buffer = new Uint8Array(MUXED_BYTES).buffer;
      record.arrayBufferTargets.push(this);
    }
  }

  class FakeFileSystemWritableFileStreamTarget {
    constructor(stream) {
      this.stream = stream;
      this.writable = stream;
      record.streamTargets.push(this);
    }
  }

  const documentStub = {
    createElement(tag) {
      const el = makeElement(tag);
      record.elements.push(el);
      if (String(tag).toLowerCase() === 'a') record.anchors.push(el);
      return el;
    },
    body: {
      appendChild(el) {
        return el;
      },
      removeChild(el) {
        return el;
      },
    },
  };

  let urlSeq = 0;
  const createObjectURL = (blob) => {
    urlSeq += 1;
    const url = `blob:exportSink/${urlSeq}`;
    record.objectUrls.push({ url, blob });
    return url;
  };
  const revokeObjectURL = (url) => {
    record.revoked.push(url);
  };

  let flushedUpTo = 0;
  const fakeSetTimeout = (fn, delay, ...args) => {
    record.timers.push({ fn, delay, args });
    return record.timers.length;
  };
  /** 同步跑掉尚未执行的定时回调，避免真等 1 秒。 */
  record.flushTimers = () => {
    while (flushedUpTo < record.timers.length) {
      const timer = record.timers[flushedUpTo];
      flushedUpTo += 1;
      timer.fn(...timer.args);
    }
  };

  const muxer = { ArrayBufferTarget: FakeArrayBufferTarget };
  if (withStreamTarget) muxer.FileSystemWritableFileStreamTarget = FakeFileSystemWritableFileStreamTarget;

  const windowStub = {
    document: documentStub,
    URL: NativeURL,
    Blob,
    setTimeout: fakeSetTimeout,
    clearTimeout() {},
  };
  if ('showSaveFilePicker' in config) {
    windowStub.showSaveFilePicker = config.showSaveFilePicker;
  } else if (withPicker) {
    windowStub.showSaveFilePicker = async (opts) => {
      record.pickerCalls.push(opts);
      if (pickerError) throw pickerError;
      return handle;
    };
  }
  if (withMuxer) windowStub.Mp4Muxer = muxer;

  const savedGlobals = new Map();
  const setGlobal = (key, value) => {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  };
  const dropGlobal = (key) => {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    delete globalThis[key];
  };

  if (withWindow) setGlobal('window', windowStub);
  else dropGlobal('window');
  setGlobal('document', documentStub);
  setGlobal('setTimeout', fakeSetTimeout);

  const savedUrlMethods = new Map();
  for (const [key, value] of [
    ['createObjectURL', createObjectURL],
    ['revokeObjectURL', revokeObjectURL],
  ]) {
    savedUrlMethods.set(key, Object.getOwnPropertyDescriptor(NativeURL, key));
    Object.defineProperty(NativeURL, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }

  const restore = () => {
    for (const [key, desc] of savedGlobals) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
    savedGlobals.clear();
    for (const [key, desc] of savedUrlMethods) {
      if (desc) Object.defineProperty(NativeURL, key, desc);
      else delete NativeURL[key];
    }
    savedUrlMethods.clear();
  };

  return {
    record,
    restore,
    window: windowStub,
    Mp4Muxer: muxer,
    ArrayBufferTarget: FakeArrayBufferTarget,
    FileSystemWritableFileStreamTarget: FakeFileSystemWritableFileStreamTarget,
  };
}

/** 把 showSaveFilePicker 收到的所有 accept MIME 拍平。 */
function acceptMimes(opts) {
  const types = Array.isArray(opts?.types) ? opts.types : [];
  return types.flatMap((entry) => Object.keys(entry?.accept ?? {}));
}

/** 取某个 MIME 对应的扩展名列表。 */
function acceptExtensions(opts, mime) {
  const types = Array.isArray(opts?.types) ? opts.types : [];
  for (const entry of types) {
    const value = entry?.accept?.[mime];
    if (value) return Array.isArray(value) ? value : [value];
  }
  return [];
}

/** 捕获一次调用抛出/拒绝的错误；正常返回则用例失败。 */
async function captureError(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail('预期抛出错误，实际正常返回');
}

function makeAbortError(message = '用户取消了保存') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

async function blobBytes(blob) {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

// ---------------------------------------------------------------------------
// streamSinkSupported —— 能力检测
// ---------------------------------------------------------------------------

test('exportSink · streamSinkSupported(能力检测): showSaveFilePicker 与 FileSystemWritableFileStreamTarget 齐备时为 true', (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  assert.equal(streamSinkSupported(), true);
});

test('exportSink · streamSinkSupported(能力检测): 缺 showSaveFilePicker 时为 false', (t) => {
  const env = installBrowserEnv({ withPicker: false });
  t.after(() => env.restore());

  assert.equal('showSaveFilePicker' in env.window, false, '前置条件：替身 window 上没有该 API');
  assert.equal(streamSinkSupported(), false);
});

for (const [label, value] of [
  ['对象', {}],
  ['字符串', 'showSaveFilePicker'],
  ['null', null],
  ['数字', 42],
  ['true', true],
]) {
  test(`exportSink · streamSinkSupported(能力检测): showSaveFilePicker 是${label}而非函数时为 false`, (t) => {
    const env = installBrowserEnv({ showSaveFilePicker: value });
    t.after(() => env.restore());

    assert.equal(streamSinkSupported(), false);
  });
}

test('exportSink · streamSinkSupported(能力检测): window.Mp4Muxer 整体缺席时为 false', (t) => {
  const env = installBrowserEnv({ withMuxer: false });
  t.after(() => env.restore());

  assert.equal(streamSinkSupported(), false);
});

test('exportSink · streamSinkSupported(能力检测): Mp4Muxer 缺 FileSystemWritableFileStreamTarget 时为 false', (t) => {
  const env = installBrowserEnv({ withStreamTarget: false });
  t.after(() => env.restore());

  assert.equal(typeof env.window.showSaveFilePicker, 'function', '前置条件：保存框 API 在位');
  assert.equal(streamSinkSupported(), false);
});

test('exportSink · streamSinkSupported(能力检测): window 未定义时返回 false 且不抛 ReferenceError', (t) => {
  const env = installBrowserEnv({ withWindow: false });
  t.after(() => env.restore());

  assert.equal(typeof globalThis.window, 'undefined', '前置条件：全局 window 已移除');
  assert.equal(streamSinkSupported(), false);
});

// ---------------------------------------------------------------------------
// createMp4Sink —— 路径选择
// ---------------------------------------------------------------------------

test('exportSink · createMp4Sink(输出端): 流式路径返回 kind/fastStart/target 与两个操作句柄', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true });

  assert.equal(sink.kind, 'stream');
  assert.equal(sink.fastStart, false);
  assert.ok(sink.target instanceof env.FileSystemWritableFileStreamTarget);
  assert.equal(typeof sink.finish, 'function');
  assert.equal(typeof sink.abort, 'function');
  assert.equal(env.record.arrayBufferTargets.length, 0, '流式路径不应同时建内存 target');
});

test('exportSink · createMp4Sink(输出端): 流式路径把 createWritable 拿到的流交给 FileSystemWritableFileStreamTarget', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true });

  assert.equal(env.record.createWritableCalls, 1);
  assert.equal(env.record.streamTargets.length, 1);
  assert.equal(sink.target.stream, env.record.writable, 'target 应持有 handle.createWritable() 返回的那个流');
});

test('exportSink · createMp4Sink(输出端): showSaveFilePicker 收到 suggestedName 与 video/mp4 类型过滤', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  await createMp4Sink({ suggestedName: '太湖-2026.mp4', preferStream: true });

  assert.equal(env.record.pickerCalls.length, 1);
  const opts = env.record.pickerCalls[0];
  assert.equal(opts.suggestedName, '太湖-2026.mp4');
  assert.ok(acceptMimes(opts).includes('video/mp4'), 'accept 里应含 video/mp4');
  assert.ok(acceptExtensions(opts, 'video/mp4').includes('.mp4'), 'video/mp4 应映射到 .mp4 扩展名');
});

test('exportSink · createMp4Sink(输出端): preferStream 为 false 时即便浏览器支持流式也走内存', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  assert.equal(streamSinkSupported(), true, '前置条件：本环境支持流式');
  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: false });

  assert.equal(sink.kind, 'memory');
  assert.equal(sink.fastStart, 'in-memory');
  assert.ok(sink.target instanceof env.ArrayBufferTarget);
  assert.equal(env.record.pickerCalls.length, 0, 'showSaveFilePicker 不应被调用');
  assert.equal(env.record.streamTargets.length, 0);
});

for (const [label, value] of [
  ['undefined', undefined],
  ['null', null],
  ['0', 0],
  ['空字符串', ''],
]) {
  test(`exportSink · createMp4Sink(输出端): preferStream 为假值 ${label} 时走内存路径`, async (t) => {
    const env = installBrowserEnv();
    t.after(() => env.restore());

    const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: value });

    assert.equal(sink.kind, 'memory');
    assert.equal(sink.fastStart, 'in-memory');
    assert.equal(env.record.pickerCalls.length, 0);
  });
}

test('exportSink · createMp4Sink(输出端): 浏览器缺 showSaveFilePicker 时 preferStream 为 true 也回落内存', async (t) => {
  const env = installBrowserEnv({ withPicker: false });
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true });

  assert.equal(sink.kind, 'memory');
  assert.equal(sink.fastStart, 'in-memory');
  assert.ok(sink.target instanceof env.ArrayBufferTarget);
});

test('exportSink · createMp4Sink(输出端): Mp4Muxer 缺流式 target 时 preferStream 为 true 也回落内存', async (t) => {
  const env = installBrowserEnv({ withStreamTarget: false });
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true });

  assert.equal(sink.kind, 'memory');
  assert.equal(sink.fastStart, 'in-memory');
  assert.equal(env.record.pickerCalls.length, 0, '能力检测未过就不该弹保存框');
});

// ---------------------------------------------------------------------------
// createMp4Sink —— 错误路径
// ---------------------------------------------------------------------------

test('exportSink · createMp4Sink(输出端): 用户取消保存时 AbortError 原样上抛且不回落内存', async (t) => {
  const env = installBrowserEnv({ pickerError: makeAbortError() });
  t.after(() => env.restore());

  const err = await captureError(() => createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true }));

  assert.equal(err.name, 'AbortError', '错误名应保持 AbortError，调用方据此识别用户主动取消');
  assert.equal(err.message, '用户取消了保存', '原错误对象应原样上抛，不被包装');
  assert.equal(env.record.arrayBufferTargets.length, 0, '取消不等于失败，不应静默转内存路径');
});

test('exportSink · createMp4Sink(输出端): DOMException 形态的 AbortError 同样原样上抛', async (t) => {
  const domAbort = new DOMException('The user aborted a request.', 'AbortError');
  const env = installBrowserEnv({ pickerError: domAbort });
  t.after(() => env.restore());

  const err = await captureError(() => createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true }));

  assert.equal(err, domAbort, '应是同一个错误对象');
  assert.equal(err.name, 'AbortError');
  assert.equal(env.record.arrayBufferTargets.length, 0);
});

test('exportSink · createMp4Sink(输出端): createWritable 因权限失败时错误原样上抛', async (t) => {
  const denied = new Error('磁盘不可写');
  denied.name = 'NotAllowedError';
  const env = installBrowserEnv({ createWritableError: denied });
  t.after(() => env.restore());

  const err = await captureError(() => createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true }));

  assert.equal(err, denied);
  assert.equal(err.name, 'NotAllowedError');
  assert.equal(env.record.createWritableCalls, 1);
  assert.equal(env.record.arrayBufferTargets.length, 0, '写入句柄失败不应静默转内存路径');
});

// ---------------------------------------------------------------------------
// finish —— 两条路径的收尾
// ---------------------------------------------------------------------------

test('exportSink · finish(收尾): 流式路径关闭 writable，不产生 Blob 下载', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true });
  await sink.finish('这个名字在流式路径不生效.mp4');

  assert.equal(env.record.writable.closeCalls, 1);
  assert.equal(env.record.writable.abortCalls, 0);
  assert.equal(env.record.objectUrls.length, 0, '文件已直接落盘，无需 Blob URL');
  assert.equal(env.record.anchors.length, 0, '流式路径不需要 <a> 触发下载');
});

test('exportSink · finish(收尾): 内存路径用 target.buffer 造 video/mp4 Blob 并以 name 命名下载', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: false });
  await sink.finish('太湖一圈.mp4');

  assert.equal(env.record.objectUrls.length, 1);
  const { url, blob } = env.record.objectUrls[0];
  assert.equal(blob.type, 'video/mp4');
  assert.equal(blob.size, MUXED_BYTES.length, 'Blob 内容应来自 target.buffer');
  assert.deepEqual(await blobBytes(blob), MUXED_BYTES);

  const anchor = env.record.anchors.at(-1);
  assert.ok(anchor, '内存路径应经 <a> 元素触发下载');
  assert.equal(anchor.download, '太湖一圈.mp4');
  assert.equal(anchor.href, url);
  assert.equal(anchor.clicks, 1, '应触发且只触发一次 click');
});

test('exportSink · finish(收尾): 内存路径的 createObjectURL 与 revokeObjectURL 成对，延时 1000ms 释放', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: false });
  await sink.finish('ride.mp4');

  const { url } = env.record.objectUrls[0];
  assert.deepEqual(env.record.revoked, [], '释放应推迟到下载启动之后');

  const timer = env.record.timers.find((entry) => entry.delay === 1000);
  assert.ok(timer, '应安排一个 1000ms 的延时释放');

  env.record.flushTimers();
  assert.deepEqual(env.record.revoked, [url], '延时到点后释放同一个 Blob URL');
});

test('exportSink · finish(收尾): 内存路径连续两次 finish 各自生成并释放独立的 Blob URL', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: false });
  await sink.finish('first.mp4');
  await sink.finish('second.mp4');

  assert.equal(env.record.objectUrls.length, 2);
  assert.notEqual(env.record.objectUrls[0].url, env.record.objectUrls[1].url);
  assert.deepEqual(
    env.record.anchors.map((a) => a.download),
    ['first.mp4', 'second.mp4'],
  );

  env.record.flushTimers();
  assert.deepEqual(
    env.record.revoked.slice().sort(),
    env.record.objectUrls.map((entry) => entry.url).sort(),
  );
});

// ---------------------------------------------------------------------------
// abort —— 中止
// ---------------------------------------------------------------------------

test('exportSink · abort(中止): 流式路径调用 writable.abort()', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true });
  await sink.abort();

  assert.equal(env.record.writable.abortCalls, 1);
  assert.equal(env.record.writable.closeCalls, 0, '中止不该走正常关闭');
});

test('exportSink · abort(中止): writable.abort() 自身抛错时 abort 不向外抛第二个错误', async (t) => {
  const env = installBrowserEnv({
    writableOptions: { abortThrows: new Error('句柄已失效') },
  });
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: true });

  await assert.doesNotReject(async () => {
    await sink.abort();
  }, '中止发生在错误路径上，不该再抛出第二个错误覆盖首因');
  assert.equal(env.record.writable.abortCalls, 1);
});

test('exportSink · abort(中止): 内存路径为空操作，不抛错也不产生下载', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'ride.mp4', preferStream: false });

  await assert.doesNotReject(async () => {
    await sink.abort();
  });
  assert.equal(env.record.objectUrls.length, 0, '中止不产出文件');
  assert.equal(env.record.anchors.length, 0);
  assert.equal(env.record.writable.abortCalls, 0, '内存路径没有可写流可中止');
});

// ---------------------------------------------------------------------------
// downloadSidecar —— 边车 JSON
// ---------------------------------------------------------------------------

test('exportSink · downloadSidecar(边车): 以 application/json 落盘缩进 2 空格的 JSON', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const meta = {
    unit: 'exportSink',
    duration: 12.5,
    tags: ['taihu', 'ride'],
    nested: { deep: { flag: true } },
    missing: null,
  };
  downloadSidecar(meta, 'ride.meta.json');

  assert.equal(env.record.objectUrls.length, 1);
  const { url, blob } = env.record.objectUrls[0];
  assert.equal(blob.type, 'application/json');
  assert.equal(await blob.text(), JSON.stringify(meta, null, 2));

  const anchor = env.record.anchors.at(-1);
  assert.ok(anchor, 'sidecar 应经 <a> 元素触发下载');
  assert.equal(anchor.download, 'ride.meta.json');
  assert.equal(anchor.href, url);
  assert.equal(anchor.clicks, 1);
});

test('exportSink · downloadSidecar(边车): 空对象 meta 也正常落盘并延时释放 URL', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  downloadSidecar({}, 'empty.meta.json');

  const { url, blob } = env.record.objectUrls[0];
  assert.equal(await blob.text(), '{}');
  assert.equal(env.record.anchors.at(-1).download, 'empty.meta.json');

  const timer = env.record.timers.find((entry) => entry.delay === 1000);
  assert.ok(timer, '应安排一个 1000ms 的延时释放');
  assert.deepEqual(env.record.revoked, []);

  env.record.flushTimers();
  assert.deepEqual(env.record.revoked, [url]);
});

test('exportSink · downloadSidecar(边车): 不触碰 showSaveFilePicker，也不依赖已建立的 sink', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  downloadSidecar({ a: 1 }, 'a.json');

  assert.equal(env.record.pickerCalls.length, 0);
  assert.equal(env.record.streamTargets.length, 0);
  assert.equal(env.record.arrayBufferTargets.length, 0);
});

// ---------------------------------------------------------------------------
// 时长上限常量
// ---------------------------------------------------------------------------

test('exportSink · 常量(时长上限): 流式路径上限 21600 秒（6 小时）', () => {
  assert.equal(typeof MP4_MAX_DURATION_STREAM, 'number');
  assert.equal(MP4_MAX_DURATION_STREAM, 21600);
});

test('exportSink · 常量(时长上限): 内存路径上限 600 秒（10 分钟）且严格小于流式上限', () => {
  assert.equal(typeof MP4_MAX_DURATION_MEMORY, 'number');
  assert.equal(MP4_MAX_DURATION_MEMORY, 600);
  assert.ok(MP4_MAX_DURATION_MEMORY < MP4_MAX_DURATION_STREAM);
});
