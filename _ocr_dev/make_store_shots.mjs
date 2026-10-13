/* 出商店用的截图（1280×800）：Chrome Web Store / Edge Add-ons 都要这个尺寸。
 *
 * 图里的浮层样式是从 content.js 里抠的**真 CSS**、结构是**真模板**（跟 make_preview.mjs 同一招），
 * 只是外面套了一张假的网页当背景，让它看起来是"正在用的样子"。
 *
 * 用法： node make_store_shots.mjs <输出目录>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || path.join(here, '..', 'dist', 'store', 'screenshots');
const src = fs.readFileSync(path.join(here, '..', 'content.js'), 'utf8');

const CSS = (src.match(/const CSS = `([\s\S]*?)`;/) || [])[1];
let TPL = (src.match(/panel\.innerHTML = `([\s\S]*?)`;/) || [])[1];
if (!CSS || !TPL) { console.error('× 没从 content.js 里抠到 CSS 或模板'); process.exit(1); }

const esc = s => String(s == null ? '' : s);

function fill(st) {
  let h = TPL;
  h = h.replace('<span class="st-dir">译</span>', `<span class="st-dir">${esc(st.dir)}</span>`);
  h = h.replace('<span class="st-engine"></span>', `<span class="st-engine">${esc(st.engine)}</span>`);
  h = h.replace(/class="st-mode" data-mode="(\w+)"/g, (m, k) => `class="st-mode${k === st.mode ? ' on' : ''}" data-mode="${k}"`);
  h = h.replace('<span class="st-restitle">译文</span>', `<span class="st-restitle">${esc(st.resTitle)}</span>`);
  h = h.replace('<span class="st-status"></span>', `<span class="st-status">${esc(st.status)}</span>`);
  h = h.replace('>复制译文<', `>${esc(st.copyLabel)}<`);
  h = h.replace('<div class="st-src"></div>', `<div class="st-src">${esc(st.src)}</div>`);
  h = h.replace('<div class="st-dst"></div>', `<div class="st-dst${st.dstCls ? ' ' + st.dstCls : ''}">${st.dst || ''}</div>`);
  h = h.replace('<div class="st-pending"></div>', `<div class="st-pending">${esc(st.pending)}</div>`);
  if (st.shot) {
    h = h.replace('class="st-sec st-shot-sec"', 'class="st-sec st-shot-sec on"');
    h = h.replace('<img class="st-shot" alt="">',
      '<div class="st-shot" style="background:#cdbba6;background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.07) 0 1px,transparent 1px 13px),repeating-linear-gradient(90deg,rgba(0,0,0,.07) 0 1px,transparent 1px 13px)"></div>');
    h = h.replace('<span class="st-shotinfo"></span>', `<span class="st-shotinfo">${esc(st.shotinfo)}</span>`);
  }
  return h;
}

/* 假网页：左边一段英文，右边留给浮层 */
const PAGE = (title, bodyText, highlight) => `
  <div class="web">
    <div class="browserbar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
      <span class="url">${esc(title)}</span></div>
    <div class="doc">
      <h2>Helium Supply Chain — Draft</h2>
      <p>${bodyText.replace(highlight, `<mark>${highlight}</mark>`)}</p>
      <p class="muted">Draft section. Numbers pending.</p>
    </div>
  </div>`;

const SHOTS = [
  {
    file: '01-划词翻译.png',
    cap: '划词即译：译文落在选区旁边，长文自动分段',
    page: ['itestcloud.unipus.cn/paper/1032', 'Helium is a strategic resource that is largely imported, so the study builds a mixed-integer programming model covering production, transport and storage.', 'Helium is a strategic resource that is largely imported'],
    st: {
      dir: '译', mode: 'translate', resTitle: '译文', copyLabel: '复制译文', engine: 'cn:deepseek-v4.1-flash',
      status: '· 已出 2/5 段',
      src: 'Helium is a strategic resource that is largely imported, so the study builds a mixed-integer programming model covering production, transport and storage.',
      dst: '氦是战略性资源，目前主要依赖进口，因此本研究构建了一个覆盖生产、运输与储存的混合整数规划模型。',
      pending: '正在翻第 3 段…'
    }
  },
  {
    file: '02-做题带解析.png',
    cap: '做题：答案一眼扫完；想弄懂就点「看解析」',
    page: ['itestcloud.unipus.cn/paper/1032', 'For each blank, choose the best option. The report denied that the plan was too costly. Her tone was so subtle that nobody noticed the irony.', 'The report denied that the plan was too costly.'],
    st: {
      dir: '答题', mode: 'answer', resTitle: '答案', copyLabel: '复制答案', engine: 'cn:deepseek-v4.1-flash', status: '',
      src: '1) The report ______ that the plan was too costly.  A) argued  B) denied  C) ranged  D) settled\n2) Her tone was so ______ that nobody noticed the irony.  A) subtle  B) visible  C) deny  D) range',
      dst: 'BDACA CADCB<span class="st-explain">解析：\n1. 选 B。denied 是“否认”，与“计划太贵”这一说法相印；argued 是“主张”，后面的 that 从句不是主张的内容。\n2. 选 A。subtle 是“微妙的”；visible 是“看得见的”，与“没人注意到”直接矛盾。</span>',
      dstCls: 'is-answer', pending: '没把握：3 7'
    }
  },
  {
    file: '03-取字.png',
    cap: '字选不中也不要紧：双击图片本地 OCR，截图与准度都摊给你看',
    page: ['zhtj.youth.cn/tj/', '网上共青团 · 智慧团建', '智慧团建'],
    st: {
      dir: '取字', mode: 'translate', resTitle: '译文', copyLabel: '复制译文',
      engine: 'Tesseract（本地）· 准度 52', status: '', shot: true,
      shotinfo: '截图 1921×1279 · dpr 1.5 · 裁 (42,184) 977×197 · 拉对比 46→214 · 放大 2x',
      src: '网上共青团·智慧团建',
      dst: 'Online Communist Youth League · Smart League Building',
      pending: '这次认得不准（准度 52），结果只能当参考'
    }
  }
];

fs.mkdirSync(outDir, { recursive: true });
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const shots = [];
for (const s of SHOTS) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(s.cap)}</title>
<style>
  html,body{margin:0;width:1280px;height:800px;overflow:hidden;background:#F2EFE9;
    font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#2b2620}
  .web{position:absolute;left:0;top:0;width:1280px;height:800px;background:#fff}
  .browserbar{height:34px;background:#EDE8E1;display:flex;align-items:center;gap:7px;padding:0 14px;border-bottom:1px solid #DED6CB}
  .dot{width:10px;height:10px;border-radius:50%;background:#CFC6BA}
  .url{margin-left:10px;font-size:12px;color:#8b8073}
  .doc{padding:26px 40px;max-width:900px}
  .doc h2{font-size:20px;margin:0 0 14px;color:#1f1b16}
  .doc p{font-size:16px;line-height:1.9;color:#3b352e}
  .doc mark{background:#FDE9A8;padding:0 2px}
  .muted{color:#a49a8d;font-size:13px}
  .panelwrap{position:absolute;right:28px;top:70px}
  .cap{position:absolute;left:40px;bottom:26px;font-size:15px;color:#6b6157;background:rgba(255,255,255,.92);
    border:1px solid #E1D8CB;border-radius:10px;padding:10px 14px;max-width:560px}
  .cap b{color:#8a6a3c}
  ${CSS}
</style></head>
<body>
  ${PAGE(s.page[0], s.page[1], s.page[2])}
  <div class="panelwrap"><div class="st-panel" data-theme="light" data-mode="${s.st.mode}">${fill(s.st)}</div></div>
  <div class="cap">${s.cap}</div>
</body></html>`;
  const f = path.join(here, 'e2e', 'store-' + s.file.replace('.png', '.html'));
  fs.writeFileSync(f, html, 'utf8');
  shots.push({ png: path.join(outDir, s.file), html: f });
}

/* 截图在 node 里做：路径里有中文，交给 PowerShell 转一圈会因为编码把路径弄坏 */
if (!fs.existsSync(EDGE)) { console.error('× 找不到 msedge.exe，HTML 已生成，截图跳过'); process.exit(2); }
let bad = 0;
for (const s of shots) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge_shot_'));
  spawnSync(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${tmp}`,
    '--hide-scrollbars', '--window-size=1280,800', `--screenshot=${s.png}`, pathToFileURL(s.html).href], { stdio: 'ignore' });
  fs.rmSync(tmp, { recursive: true, force: true });
  const okPng = fs.existsSync(s.png);
  if (!okPng) bad++;
  console.log((okPng ? '✓ ' : '× ') + path.basename(s.png) + (okPng ? '  ' + Math.round(fs.statSync(s.png).size / 1024) + ' KB' : '  没生成'));
}
console.log(bad ? '× 有 ' + bad + ' 张没出' : '✓ ' + shots.length + ' 张商店截图都在 ' + outDir);
process.exit(bad ? 1 : 0);
