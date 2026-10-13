/* Chromium（Edge）上的**完整链路**实测。
 *
 * ⚠️ 一个必须记住的坑：扩展的 content script 跑在**隔离世界**里，
 *    它在 window 上挂的 __sideTransLoaded / __stCheck，页面主世界看不见；
 *    而浮层又用闭合 shadow DOM（页面脚本看不见内部）。
 *    所以这里不去"读内部状态"，只认**页面里看得见的客观事实**：
 *      · 浮层宿主元素出现了、且 visibility=visible（宿主是普通 DOM 节点）
 *      · 框选模式的遮罩层出现了（有 cursor:crosshair 的内联样式）
 *      · SW 里能直接调 captureVisibleTab 拿到图
 *      · 离屏文档能真的跑出 OCR（另见 test_chromium_e2e.mjs）
 *
 * 用法： node test_chromium_ui.mjs      （要先跑 build.ps1）
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
const PORT = 9336;
const SRV = 8782;             // 避开 8765：这台机器上被百度输入法占着
const PAGE = `http://127.0.0.1:${SRV}/index.html`;

if (!fs.existsSync(EXT)) { console.error('× 先跑 build.ps1，没有 ' + EXT); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edgeui-'));
let edge = null, srv = null;
const kill = () => {
  try { if (edge) edge.kill('SIGKILL'); } catch (e) {}
  try { if (srv) srv.kill('SIGKILL'); } catch (e) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
};
process.on('exit', kill);
process.on('SIGINT', () => { kill(); process.exit(130); });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
  catch (e) { return []; }
}

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    };
    ws.onerror = () => reject(new Error('调试端口连不上'));
    ws.onopen = () => resolve({
      send: (method, params) => new Promise(res => {
        const myId = ++id; waiting.set(myId, res);
        ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
      }),
      close: () => ws.close()
    });
  });
}

async function evalIn(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const v = r && r.result && r.result.result && r.result.result.value;
  if (v === undefined) {
    const ex = r && r.result && r.result.exceptionDetails;
    throw new Error('求值失败：' + JSON.stringify(ex || r).slice(0, 300));
  }
  return v;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  × ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  /* 1) 本地测试页 */
  srv = spawn(process.execPath, [path.join(here, 'report-server.cjs')], { stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(SRV) }) });
  await sleep(1200);
  try { const r = await fetch(PAGE); console.log('测试页 ' + PAGE + ' → HTTP ' + r.status); }
  catch (e) { console.log('× 测试页起不来：' + e.message); kill(); process.exit(1); }

  /* 2) 带扩展起 Edge */
  console.log('\n起临时 Edge（headless，载入扩展）…');
  edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
    `--remote-debugging-port=${PORT}`,
    '--window-size=1400,900',
    PAGE
  ], { stdio: 'ignore' });

  let sw = null, page = null;
  for (let i = 0; i < 40 && !(sw && page); i++) {
    const list = await targets();
    sw = sw || list.find(t => t.type === 'service_worker' && /\/background\.js$/.test(t.url || ''));
    page = page || list.find(t => t.type === 'page' && (t.url || '').startsWith(PAGE));
    if (!(sw && page)) await sleep(700);
  }

  console.log('\n=== 1. 扩展与页面就位 ===');
  ok('MV3 service worker 起来了', !!sw, sw ? sw.url : '没等到');
  ok('测试页开了', !!page, page ? page.url : '没等到');
  if (!sw || !page) { kill(); process.exit(1); }

  const cp = await cdp(page.webSocketDebuggerUrl);
  const cs = await cdp(sw.webSocketDebuggerUrl);

  /* 3) 划词 → 浮层（只看页面里看得见的：宿主元素） */
  console.log('\n=== 2. content script 注入 + 划词出浮层 ===');
  await evalIn(cp, `(async () => {
    document.body.innerHTML = '<p id="t" style="font:16px sans-serif;max-width:700px">The quick brown fox jumps over the lazy dog. This paragraph exists only for the end-to-end check.</p>'
      + '<img id="im" alt="" src="clean_cn.png" style="width:320px;display:block;margin-top:12px">';
    await new Promise(r => setTimeout(r, 200));
    return 'ok';
  })()`);

  const selectRes = await evalIn(cp, `(async () => {
    const el = document.getElementById('t');
    const rg = document.createRange(); rg.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
    const b = el.getBoundingClientRect();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window,
      clientX: Math.round(b.left + 6), clientY: Math.round(b.top + 6), button: 0 }));
    await new Promise(r => setTimeout(r, 3000));
    const host = document.querySelector('[id^="__st_"]');
    return JSON.stringify(host ? { found: true, vis: host.style.visibility, w: host.offsetWidth, h: host.offsetHeight, left: host.style.left, top: host.style.top } : { found: false });
  })()`);
  const s1 = JSON.parse(selectRes);
  ok('content script 活着（划词后浮层宿主出现了）', s1.found, selectRes);
  ok('浮层可见', s1.vis === 'visible', JSON.stringify(s1));
  ok('浮层真的排版了（有宽高）', (s1.w || 0) > 300 && (s1.h || 0) > 80, JSON.stringify({ w: s1.w, h: s1.h }));

  /* 4) 双击图片 → 浮层仍在（取字链路本身另用 SW 直测） */
  console.log('\n=== 3. 双击图片走取字 ===');
  const dblRes = await evalIn(cp, `(async () => {
    const im = document.getElementById('im');
    const b = im.getBoundingClientRect();
    im.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window,
      clientX: Math.round(b.left + 20), clientY: Math.round(b.top + 20), button: 0 }));
    await new Promise(r => setTimeout(r, 20000));
    const host = document.querySelector('[id^="__st_"]');
    return JSON.stringify(host ? { vis: host.style.visibility, h: host.offsetHeight } : { found: false });
  })()`);
  const s2 = JSON.parse(dblRes);
  ok('取字过程中浮层没被拆掉', s2.found !== false && s2.vis === 'visible', dblRes);

  /* 5) MV3 里 SW 能不能截当前标签页（取字第一步；离屏 OCR 另测） */
  console.log('\n=== 4. MV3：SW 里 captureVisibleTab ===');
  const capRes = await evalIn(cs, `(async () => {
    const tabs = await chrome.tabs.query({ active: true });
    const t = tabs && tabs[0];
    if (!t) return 'no-tab';
    return await new Promise(res => chrome.tabs.captureVisibleTab(null, { format: 'png' }, d => {
      if (chrome.runtime.lastError) return res('ERR:' + chrome.runtime.lastError.message);
      res(d && d.indexOf('data:image/png;base64,') === 0 ? 'ok:' + d.length : 'bad:' + String(d).slice(0, 30));
    }));
  })()`);
  ok('SW 能截图', String(capRes).indexOf('ok:') === 0, String(capRes));

  /* 6) 工具栏图标那条路的后半段：SW → 标签页 {type:'pick'} → 页面出现框选遮罩 */
  console.log('\n=== 5. 工具栏图标 → 页面进框选 ===');
  const pickRes = await evalIn(cs, `(async () => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(x => (x.url || '').startsWith('http://127.0.0.1:' + ${SRV} + '/'));
    if (!t) return 'no-tab';
    try { await chrome.tabs.sendMessage(t.id, { type: 'pick' }); return 'sent'; }
    catch (e) { return 'ERR:' + ((e && e.message) || e); }
  })()`);
  await sleep(600);
  const overlay = await evalIn(cp, `JSON.stringify(!!Array.prototype.find.call(document.documentElement.children, el => el.style && el.style.cursor === 'crosshair'))`);
  ok('pick 消息发出去了', String(pickRes) === 'sent', String(pickRes));
  ok('页面里出现了框选遮罩', overlay === 'true', overlay);

  /* 7) 设置页 */
  console.log('\n=== 6. 设置页（扩展页面） ===');
  await evalIn(cs, `(async () => { await chrome.tabs.create({ url: chrome.runtime.getURL('options.html') }); return 'ok'; })()`);
  await sleep(2500);
  const optPage = (await targets()).find(t => t.type === 'page' && (t.url || '').indexOf('options.html') !== -1);
  ok('设置页打开了', !!optPage);
  if (optPage) {
    const co = await cdp(optPage.webSocketDebuggerUrl);
    const rep = await evalIn(co, `JSON.stringify({
      title: document.title,
      theme: document.body.dataset.theme,
      segs: ['actionMode','transStyle','panelTheme','answerExplain'].map(id => {
        const el = document.getElementById(id);
        return id + '=' + (el ? (el.querySelector('.on') ? el.querySelector('.on').dataset.v : '(无高亮)') : '(缺)');
      }),
      presetBtns: document.querySelectorAll('#promptPreset button').length
    })`);
    const o = JSON.parse(rep);
    console.log('  ' + rep);
    ok('设置页渲染了', /旁译/.test(o.title || ''), o.title);
    ok('四组开关都在且各有高亮', o.segs.every(s => s.indexOf('(缺)') === -1 && s.indexOf('(无高亮)') === -1), o.segs.join(' / '));
    ok('五颗预设按钮在', o.presetBtns === 5, String(o.presetBtns));
    co.close();
  }

  cp.close(); cs.close();
  console.log('\n=== 结果：' + pass + ' 项通过' + (fail ? '，' + fail + ' 项没过' : '') + ' ===');
  kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('\n× ' + (e && e.message)); kill(); process.exit(1); });
