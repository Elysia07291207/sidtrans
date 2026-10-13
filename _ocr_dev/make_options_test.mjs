/* 生成「设置页自检」页：把真的 options.html 拿来，塞进桩 chrome + 一段操作脚本。
   这样验的是真文件，不是复刻的副本——复刻会各自漂移（踩过）。
   用法： node make_options_test.mjs   → 写 e2e/options_test.html
   然后 Edge 无头跑它，dump-dom 看 #out。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(here, '..', 'options.html');
const outPath = path.join(here, 'e2e', 'options_test.html');

let html = fs.readFileSync(srcPath, 'utf8');

const STUB = `
<pre id="out" style="white-space:pre-wrap;font:12px/1.6 Consolas,monospace;background:#141210;color:#8fdc8f;padding:10px;border-radius:6px;margin-top:14px"></pre>
<script>
/* 桩：只给 options.js 用到的那几样。
   orb 故意设成 true —— 保存时 collect() 不带它，正好验它会不会被冲掉。 */
var __store = {
  enabled: true, autoTranslate: true, maxLen: 4000, actionMode: 'translate',
  transStyle: 'lit', orb: true, targetMode: 'auto', engine: 'openai',
  openai: { baseUrl: 'http://127.0.0.1:7863/v1', apiKey: 'sk-test', model: 'cn:deepseek-v4.1-flash', prompt: '' },
  local: { url: 'http://127.0.0.1:8787/translate' }
};
window.__store = __store;
const OUT = [];
window.__log = m => { OUT.push(m); const o = document.getElementById('out'); if (o) o.textContent = OUT.join('\\n'); };
window.onerror = (m, s, l, c, e) => { window.__log('✗ 未捕获错误: ' + m + ' @' + l + ':' + c); if (e && e.stack) window.__log('    ' + String(e.stack).split('\\n').slice(0, 3).join(' / ')); };
window.chrome = {
  storage: { local: { get: (k, cb) => setTimeout(() => cb(Object.assign({}, __store)), 0), set: (o, cb) => { Object.assign(__store, o); if (cb) cb(); } }, onChanged: { addListener() {} } },
  runtime: { getURL: p => p, lastError: null, onMessage: { addListener() {} }, sendMessage: (m, cb) => cb({ ok: true, dir: '英 → 中', engine: '桩', translated: '[桩译文]' }) }
};
</script>
`;

const HARNESS = `
<script>
const L = window.__log;
const chip = p => document.querySelector('#promptPreset button[data-p="' + p + '"]');
const onChip = () => { const b = document.querySelector('#promptPreset .on'); return b ? b.dataset.p : '(无)'; };
const ta = document.getElementById('oa-prompt');
const setTa = v => { ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); };

setTimeout(() => {
  L('预设按钮: ' + [...document.querySelectorAll('#promptPreset button')].map(b => b.dataset.p).join(','));
  L('诊断: oa-prompt=' + !!document.getElementById('oa-prompt') + '  oa-base 值=' + JSON.stringify((document.getElementById('oa-base') || {}).value));
  L('诊断: enabled.checked=' + document.getElementById('enabled').checked + '   （true = paint 跑过）');
  document.getElementById('save').click();
  L('诊断: 点保存后 #msg=' + JSON.stringify(document.getElementById('msg').textContent) + '   （非空 = 保存的监听已挂）');
  document.getElementById('logExport').click();
  L('诊断: 点导出日志后 #logBox 还 hidden 吗: ' + document.getElementById('logBox').classList.contains('hide') + '   （false = 后面的监听也挂了）');
  L('诊断: 先看看原有控件还能不能点（engine → local）');
  document.querySelector('#engine button[data-v="local"]').click();
  L('  engine=local 后，#box-local 还 hidden 吗: ' + document.getElementById('box-local').classList.contains('hide'));
  document.querySelector('#engine button[data-v="openai"]').click();
  document.addEventListener('click', e => L('  [捕获] click → ' + (e.target.id || e.target.dataset.p || e.target.tagName)), true);
  L('初始高亮: ' + onChip() + '   （提示词为空 → 应该是 none）');
  L('初始提示语: ' + document.getElementById('presetHint').textContent.slice(0, 30));

  chip('lit').click();
  L('');
  L('点「笔译风格」→ 框里前 26 字: ' + ta.value.slice(0, 26).replace(/\\n/g, '⏎'));
  L('  高亮: ' + onChip() + '   长度=' + ta.value.length);
  L('  提示语: ' + document.getElementById('presetHint').textContent.slice(0, 34));

  chip('tech').click();
  L('点「技术文档」→ 高亮: ' + onChip() + '   含"标识符"吗: ' + /标识符/.test(ta.value));
  L('  开头: ' + ta.value.slice(0, 22).replace(/\\n/g, '⏎'));

  setTa(ta.value + '　（我自己加一句）');
  L('手改一下 → 高亮: ' + onChip() + '  （改了就不该再高亮）');
  L('  提示语: ' + document.getElementById('presetHint').textContent.slice(0, 24));

  chip('none').click();
  L('点「默认」→ 框里长度: ' + ta.value.length + '   高亮: ' + onChip());
  chip('academic').click();

  L('');
  L('--- 主题 ---');
  const th = document.getElementById('panelTheme');
  const thOn = () => { const b = th.querySelector('.on'); return b ? b.dataset.v : '(无)'; };
  L('初始: body[data-theme]=' + String(document.body.dataset.theme) + '  高亮=' + thOn());
  th.querySelector('button[data-v="dark"]').click();
  L('点「深色」→ body=' + String(document.body.dataset.theme) + '  高亮=' + thOn());
  th.querySelector('button[data-v="light"]').click();
  L('点回「浅色」→ body=' + String(document.body.dataset.theme) + '  高亮=' + thOn());

  L('');
  L('点保存…');
  document.getElementById('save').click();
  setTimeout(() => {
    const s = window.__store, o = s.openai || {};
    L('存储: engine=' + s.engine + '  baseUrl=' + o.baseUrl + '  model=' + o.model);
    L('  prompt 长度=' + (o.prompt || '').length + '  开头: ' + (o.prompt || '').slice(0, 18).replace(/\\n/g, '⏎'));
    L('  没动的字段还在吗: maxLen=' + s.maxLen + '  transStyle=' + s.transStyle + '  actionMode=' + s.actionMode + '  orb=' + s.orb + '  panelTheme=' + s.panelTheme + '  local=' + (s.local && s.local.url));
    L('  保存提示: ' + document.getElementById('msg').textContent);
    L('完成');
  }, 80);
}, 400);
</script>
`;

html = html.replace('<script src="options.js"></script>', STUB + '\n<script src="options.js"></script>\n' + HARNESS);
if (html.indexOf('__log') === -1) { console.error('× 注入失败：没找到 options.js 的 script 标签'); process.exit(1); }
fs.writeFileSync(outPath, html, 'utf8');
/* ⚠️ 测试页里是 <script src="options.js">，所以必须把真 options.js 也放到旁边，
   不然 404、脚本根本没执行——而页面看起来一切正常（我就是这么白绕了一圈）。 */
fs.copyFileSync(path.join(here, '..', 'options.js'), path.join(here, 'e2e', 'options.js'));
console.log('已生成 ' + outPath + '（' + html.length + ' B）+ 同步 options.js');
