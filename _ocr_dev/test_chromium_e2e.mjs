/* 在 Edge 里把 Chromium 那份包真跑一遍（不是静态检查）。
 *
 * 做三件事：
 *   1. 用 --load-extension 起一个临时 Edge，等扩展的 service worker 出现
 *      —— 它出现就说明 MV3 清单被接受、background.js 在 SW 里跑起来了；
 *   2. 通过调试协议在那个 worker 里直接调 ocrImage() —— 这会走
 *      「SW → 建离屏文档 → 离屏里跑 Tesseract → 结果回传」整条链；
 *   3. 收尾：杀 Edge、删临时 profile。
 *
 * 用法： node test_chromium_e2e.mjs     （要先跑 build.ps1）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const EXT = path.join(root, '_build', 'unpacked-chromium');
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;

if (!fs.existsSync(EXT)) { console.error('× 先跑 build.ps1，没有 ' + EXT); process.exit(1); }

/* 一张有字的图：复用 OCR 自检用的那张中文图 */
const imgPath = path.join(here, 'e2e', 'clean_cn.png');
const IMG = 'data:image/png;base64,' + fs.readFileSync(imgPath).toString('base64');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeext-'));
let child = null;
const kill = () => {
  try { if (child) child.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
};
process.on('exit', kill);
process.on('SIGINT', () => { kill(); process.exit(130); });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findWorker(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const sw = list.find(t => t.type === 'service_worker' && /\/background\.js$/.test(t.url || ''));
      if (sw) return { sw, list };
    } catch (e) {}
    await sleep(700);
  }
  return null;
}

/* 极简 CDP 客户端 */
function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    };
    ws.onerror = e => reject(new Error('WS 出错'));
    ws.onopen = () => {
      const send = (method, params) => new Promise(res => {
        const myId = ++id;
        waiting.set(myId, res);
        ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
      });
      resolve({ send, close: () => ws.close() });
    };
  });
}

(async () => {
  console.log('起一个临时 Edge，带扩展：' + EXT);
  child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank'
  ], { stdio: 'ignore' });

  const found = await findWorker(25000);
  if (!found) { console.log('× 25 秒内没等到扩展的 service worker——MV3 清单或 background.js 有问题'); kill(); process.exit(1); }
  console.log('✓ 扩展的 service worker 起来了：' + found.sw.url);

  const c = await cdp(found.sw.webSocketDebuggerUrl);
  await c.send('Runtime.enable');

  const expr = `(async () => {
    const out = { isServiceWorker: IS_SW, tessGlobal: HAS_TESSERACT, hasAction: !!ACTION };
    try {
      const r = await ocrImage(${JSON.stringify(IMG)});
      out.ocr = { ok: r.ok, text: String(r.text || '').slice(0, 40), conf: r.conf, engine: r.engine };
    } catch (e) { out.ocrError = String((e && e.message) || e); }
    return JSON.stringify(out);
  })()`;

  console.log('在 worker 里调 ocrImage()（会走离屏文档 + Tesseract，第一次要十几秒）…');
  const res = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const val = res && res.result && res.result.result && res.result.result.value;
  if (!val) {
    console.log('× 求值没返回：' + JSON.stringify(res).slice(0, 400));
  } else {
    const o = JSON.parse(val);
    console.log('  IS_SW=' + o.isServiceWorker + '  Tesseract 全局=' + o.tessGlobal + '  ACTION=' + o.hasAction);
    if (o.ocr) console.log('  OCR → ok=' + o.ocr.ok + '  conf=' + o.ocr.conf + '  文字=' + JSON.stringify(o.ocr.text));
    else console.log('  OCR 失败：' + o.ocrError);
    const ok = o.isServiceWorker && o.ocr && o.ocr.ok && (o.ocr.text || '').length > 0;
    console.log(ok ? '\n✓ Chromium 侧 OCR 走通了（SW → 离屏文档 → Tesseract → 回传）' : '\n× 没走通');
    c.close(); kill();
    process.exit(ok ? 0 : 1);
  }
  c.close(); kill();
  process.exit(1);
})().catch(e => { console.log('× ' + e.message); kill(); process.exit(1); });
