// tests/visible/exportSink.test.mjs
//
// Work unit `exportSink` — MP4 输出端：流式/内存双路径与 sidecar 落盘。
// Node 里没有 window / document / URL.createObjectURL，用例自行安装浏览器替身，
// 在 t.after 里还原，用例之间零共享可变状态。

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

/** 把 showSaveFilePicker 收到的所有 accept MIME 拍平，便于断言含 video/mp4。 */
function acceptMimes(opts) {
  const types = Array.isArray(opts?.types) ? opts.types : [];
  return types.flatMap((entry) => Object.keys(entry?.accept ?? {}));
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test('exportSink · streamSinkSupported(能力检测): showSaveFilePicker 与 FileSystemWritableFileStreamTarget 齐备时为 true', (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  assert.equal(streamSinkSupported(), true);
});

test('exportSink · createMp4Sink(输出端): preferStream 为 true 且浏览器支持时走流式路径', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'taihu-ride.mp4', preferStream: true });

  assert.equal(sink.kind, 'stream');
  assert.equal(sink.fastStart, false);
  assert.ok(sink.target instanceof env.FileSystemWritableFileStreamTarget);

  // 保存框收到建议文件名与 video/mp4 类型过滤。
  assert.equal(env.record.pickerCalls.length, 1);
  assert.equal(env.record.pickerCalls[0].suggestedName, 'taihu-ride.mp4');
  assert.ok(acceptMimes(env.record.pickerCalls[0]).includes('video/mp4'));

  // finish 关闭可写流；文件名在选择时已定，不再另起下载。
  await sink.finish('taihu-ride.mp4');
  assert.equal(env.record.writable.closeCalls, 1);
  assert.equal(env.record.objectUrls.length, 0);
});

test('exportSink · createMp4Sink(输出端): preferStream 为 false 时走内存路径并触发下载', async (t) => {
  const env = installBrowserEnv();
  t.after(() => env.restore());

  const sink = await createMp4Sink({ suggestedName: 'taihu-ride.mp4', preferStream: false });

  assert.equal(sink.kind, 'memory');
  assert.equal(sink.fastStart, 'in-memory');
  assert.ok(sink.target instanceof env.ArrayBufferTarget);
  assert.equal(env.record.pickerCalls.length, 0, '内存路径不弹系统保存框');

  await sink.finish('taihu-ride-2026.mp4');

  const anchor = env.record.anchors.at(-1);
  assert.ok(anchor, '内存路径应经 <a> 元素触发下载');
  assert.equal(anchor.download, 'taihu-ride-2026.mp4');
  assert.equal(anchor.clicks, 1);

  const last = env.record.objectUrls.at(-1);
  assert.ok(last, 'finish 应经 URL.createObjectURL 生成下载链接');
  assert.equal(last.blob.type, 'video/mp4');
  assert.equal(anchor.href, last.url);

  // 两个时长上限常量：流式 6 小时、内存 10 分钟。
  assert.equal(MP4_MAX_DURATION_STREAM, 21600);
  assert.equal(MP4_MAX_DURATION_MEMORY, 600);
});
