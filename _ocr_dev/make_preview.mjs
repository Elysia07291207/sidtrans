/* 生成「浮层预览」页：把 content.js 里**真的** CSS 和**真的**面板模板抠出来，
   拼成一张多状态的对照图，用 Edge 无头截成一张 PNG。
   ——不是手抄一份样式，抄会各自漂移；真 CSS + 真模板，改了这里就跟着改。
   用法： node make_preview.mjs   → 写 e2e/preview.html */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'content.js'), 'utf8');

const cssM = src.match(/const CSS = `([\s\S]*?)`;/);
const tplM = src.match(/panel\.innerHTML = `([\s\S]*?)`;/);
if (!cssM || !tplM) { console.error('× 没从 content.js 里抠到 CSS 或面板模板'); process.exit(1); }
const CSS = cssM[1];
let TPL = tplM[1];

/* 模板一变，下面的填法就该失效——先钉住几个必须存在的片段，让它坏得响一点 */
for (const need of ['st-res-sec', 'st-restitle', 'st-pending', 'st-shotinfo', 'st-more', 'st-write']) {
  if (TPL.indexOf(need) === -1) { console.error('× 面板模板里找不到 ' + need + '（模板改了，预览填法要跟着改）'); process.exit(1); }
}

const esc = s => String(s == null ? '' : s);

function fill(st) {
  let h = TPL;
  h = h.replace('<span class="st-dir">译</span>', `<span class="st-dir">${esc(st.dir)}</span>`);
  h = h.replace('<span class="st-engine"></span>', `<span class="st-engine">${esc(st.engine)}</span>`);
  h = h.replace(/class="st-mode" data-mode="(\w+)"/g,
    (m, k) => `class="st-mode${k === st.mode ? ' on' : ''}" data-mode="${k}"`);
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
    h = h.replace('<span class="st-shotinfo"></span>',
      `<span class="st-shotinfo${st.shotWarn ? ' is-warn' : ''}">${esc(st.shotinfo)}</span>`);
  }
  h = h.replace('<textarea class="st-input" placeholder="在这里写你的译文 / 想法…" spellcheck="false"></textarea>',
    st.write ? `<textarea class="st-input" spellcheck="false">${esc(st.write)}</textarea>`
      : '<textarea class="st-input" placeholder="在这里写你的译文 / 想法…" spellcheck="false"></textarea>');
  return h;
}

const TTERM = (k, v) => `<div class="st-tterm"><span class="st-tk">${k}</span><span class="st-tv">${v}</span></div>`;
const TROW = (k, v) => `<div class="st-trow"><span class="st-tk">${k}</span><span class="st-tx">${v}</span></div>`;

const STATES = [
  {
    cap: '翻译 · 长文进行中', theme: 'light', dir: '译', mode: 'translate', resTitle: '译文', copyLabel: '复制译文',
    engine: 'cn:deepseek-v4.1-flash', status: '· 已出 2/5 段',
    src: 'Helium is a strategic resource that is largely imported. To reduce the risk of supply disruption, the study builds a mixed-integer programming model covering production, transport and storage.',
    dst: '氦是战略性资源，目前主要依赖进口。为降低供应中断的风险，本研究构建了一个覆盖生产、运输与储存的混合整数规划模型。',
    pending: '正在翻第 3 段…'
  },
  {
    cap: '做题 · 只给答案', theme: 'light', dir: '答题', mode: 'answer', resTitle: '答案', copyLabel: '复制答案',
    engine: 'cn:deepseek-v4.1-flash', status: '',
    src: 'For each blank, choose the best option.\n1) The report ______ that the plan was too costly. A) argued B) denied C) ranged D) settled\n2) Her tone was so ______ that nobody noticed the irony. A) subtle B) visible C) deny D) range',
    dst: 'BDACA CADCB', dstCls: 'is-answer', pending: '没把握：3 7'
  },
  {
    cap: '术语 · 官方译法单独一行', theme: 'light', dir: '术语', mode: 'term', resTitle: '术语', copyLabel: '复制译法',
    engine: 'cn:deepseek-v4.1-flash', status: '',
    src: '全过程人民民主',
    dst: TTERM('译法', 'whole-process people&#39;s democracy') + TROW('备选', 'whole-process democracy / people&#39;s democracy in the whole process') + TROW('说明', '英文为官方定译，通常加定冠词；people&#39;s 不可省略，不用复数、不作缩略。'),
    dstCls: 'is-term', pending: ''
  },
  {
    cap: '取字 · 截图预览 + 诊断 + 准度', theme: 'light', dir: '取字', mode: 'translate', resTitle: '译文', copyLabel: '复制译文',
    engine: 'Tesseract（本地）· 准度 52', status: '', shot: true, shotWarn: false,
    shotinfo: '截图 1921×1279 · dpr 1.5 · 裁 (42,184) 977×197 · 拉对比 46→214 · 放大 2x',
    src: '网上共青团·智慧团建', dst: 'Online Communist Youth League · Smart League Building', pending: '这次认得不准（准度 52），结果只能当参考'
  },
  {
    cap: '失败 · 余额不足（说人话）', theme: 'light', dir: '术语', mode: 'term', resTitle: '术语', copyLabel: '复制译法',
    engine: '', status: '', src: '国际中文组', dst: 'API 账户余额不足（402）。去服务商那边充值；只想翻译的话，把引擎切成「免费在线」也能用。　（做题和术语没有免费替代，得先让 API 能用。）',
    dstCls: 'is-error', pending: ''
  },
  {
    cap: '引导 · 「字是画上去的」', theme: 'light', dir: '取字', mode: 'translate', resTitle: '译文', copyLabel: '复制译文',
    engine: '', status: '', src: '',
    dst: '这一块的字是<b>画上去的</b>，在页面上选不中。<div class="st-hintrow"><button class="st-hintbtn">取这块的字</button></div>',
    dstCls: 'is-hint', pending: '也可以直接双击那块图，或者点工具栏图标自己框一块。'
  },
  {
    cap: '做题 · 带解析（可选）', theme: 'light', dir: '答题', mode: 'answer', resTitle: '答案', copyLabel: '复制答案',
    engine: 'cn:deepseek-v4.1-flash', status: '',
    src: '1) The report ______ that the plan was too costly. A) argued B) denied C) ranged D) settled\n2) Her tone was so ______ that nobody noticed the irony. A) subtle B) visible C) deny D) range',
    dst: 'BDACA CADCB' + '<span class="st-explain">' +
      '解析：&#10;1. 选 B。denied 是“否认”，与“计划太贵”的说法相印；argued 是“主张”，后面的 that 从句不是主张的内容。&#10;2. 选 A。subtle 是“微妙的”；visible 是“看得见的”，与“没人注意到”直接矛盾。' +
      '</span>',
    dstCls: 'is-answer', pending: '没把握：3 7'
  },
  {
    cap: '翻译 · 深色主题', theme: 'dark', dir: '译', mode: 'translate', resTitle: '译文', copyLabel: '复制译文',
    engine: 'cn:deepseek-v4.1-flash', status: '',
    src: 'The quick brown fox jumps over the lazy dog.',
    dst: '敏捷的棕色狐狸跳过了那只懒狗。', pending: ''
  },
  {
    cap: '做题 · 深色主题（答案 24px）', theme: 'dark', dir: '答题', mode: 'answer', resTitle: '答案', copyLabel: '复制答案',
    engine: 'cn:deepseek-v4.1-flash', status: '',
    src: '1) The report ______ that the plan was too costly. A) argued B) denied C) ranged D) settled',
    dst: 'BDACA CADCB', dstCls: 'is-answer', pending: '没把握：3 7'
  }
];

const cells = STATES.map(st => `
  <figure class="cell">
    <figcaption>${st.cap}</figcaption>
    <div class="stage"><div class="st-panel" data-theme="${st.theme}" data-mode="${st.mode || 'translate'}">${fill(st)}</div></div>
  </figure>`).join('\n');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>旁译 · 浮层预览</title>
<style>
  body{margin:0;padding:22px;background:#EFEAE1;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#4a423a}
  h1{margin:0 0 2px;font-size:17px;color:#2f2a24}
  .note{margin:0 0 18px;font-size:12px;color:#8b8073}
  .grid{display:grid;grid-template-columns:repeat(4,432px);gap:20px 18px}
  .cell{margin:0}
  figcaption{font-size:11.5px;font-weight:700;color:#6b6157;margin:0 0 7px;letter-spacing:.02em}
  .stage{padding:14px;background:#E6DFD3;border-radius:12px}
  .st-panel[data-theme="dark"]{outline:1px solid rgba(0,0,0,.2)}
  ${CSS}
</style></head>
<body>
  <h1>旁译浮层 · 预览</h1>
  <p class="note">样式是从 content.js 里真的 CSS 抠出来的，面板结构也是真的模板（预览页只负责把状态填进去）。色块、字号、间距都是要放进扩展的那一套。</p>
  <div class="grid">
${cells}
  </div>
</body></html>`;

fs.writeFileSync(path.join(here, 'e2e', 'preview.html'), html, 'utf8');
console.log('已生成 e2e/preview.html，' + STATES.length + ' 个状态，' + html.length + ' B');
