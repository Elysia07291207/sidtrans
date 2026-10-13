/* 工具栏图标候选：3 个，都是几何形状，为 16px 而画。
   生成 e2e/icons.html（放大 + 工具栏真实大小 + 亮/暗两条工具条），Edge 截成一张图。
   注意：Firefox MV2 的 browser_action 不支持 theme_icons，所以图标必须自己带颜色、
   在亮底暗底上都看得见 —— 所以三个方案都是「实心或粗描边」，不用细线。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const WARM = '#9B6B4D';   // 暖褐（浅色主题的强调色）
const PINK = '#A85F68';   // 淡粉酒红（结果色）

const CANDS = [
  {
    id: 'A', name: '两格 · 译文在原文旁边',
    why: '左边一页描边（原文），右边一页实心（译文）压在旁边——把「旁译」两个字直接画出来。几何形状，16px 不糊。',
    svg: `<rect x="3" y="9" width="13" height="15" rx="2.5" fill="none" stroke="${WARM}" stroke-width="2.6"/>
          <rect x="16" y="6" width="13" height="20" rx="2.5" fill="${PINK}"/>`
  },
  {
    id: 'B', name: '一页字 · 浮层本身',
    why: '一块暖色的纸，里面两条白横线当文字。最朴素、最像「页面里浮出来的一张纸」，缩到 16px 也稳。',
    svg: `<rect x="4" y="5" width="24" height="22" rx="4.5" fill="${WARM}"/>
          <rect x="9.5" y="12" width="13" height="3" rx="1.5" fill="#FFF8F3"/>
          <rect x="9.5" y="18" width="8" height="3" rx="1.5" fill="#FFF8F3"/>`
  },
  {
    id: 'C', name: '圆环 + 旁边一竖',
    why: '跟页面里那颗悬浮球同形（都是圆），右边一竖是「出现在旁边」这件事。三个里最轻、最不抢眼。',
    svg: `<circle cx="13.5" cy="16" r="8.5" fill="none" stroke="${WARM}" stroke-width="3"/>
          <rect x="24" y="10" width="4.5" height="12" rx="2.2" fill="${PINK}"/>`
  }
];

const svgTag = (c, px) => `<svg viewBox="0 0 32 32" width="${px}" height="${px}" aria-label="${c.name}">${c.svg}</svg>`;

const cols = CANDS.map(c => `
  <section class="col">
    <h2><span class="tag">候选 ${c.id}</span>${c.name}</h2>
    <p class="why">${c.why}</p>
    <div class="big">${svgTag(c, 96)}</div>
    <div class="bars">
      <div class="bar light"><span class="lbl">亮色工具条</span>${svgTag(c, 32)}<span class="gap"></span>${svgTag(c, 16)}<span class="hint16">← 16px 真实大小</span></div>
      <div class="bar dark"><span class="lbl">暗色工具条</span>${svgTag(c, 32)}<span class="gap"></span>${svgTag(c, 16)}</div>
    </div>
  </section>`).join('\n');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>旁译 · 工具栏图标候选</title>
<style>
  body{margin:0;padding:20px;background:#EFEAE1;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#4a423a}
  h1{margin:0 0 3px;font-size:17px}
  .note{margin:0 0 16px;font-size:12px;color:#8b8073}
  .cols{display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:16px}
  .col{background:#FFFDFA;border:1px solid #E4D8C8;border-radius:12px;padding:14px}
  h2{margin:0 0 6px;font-size:14px}
  .tag{font-size:10.5px;letter-spacing:.12em;color:#a4988a;font-weight:700;margin-right:8px}
  .why{margin:0 0 12px;font-size:12px;color:#6b6157;min-height:52px}
  .big{display:flex;align-items:center;justify-content:center;padding:10px 0 14px;background:#F3EEE4;border-radius:9px}
  .bar{display:flex;align-items:center;gap:10px;padding:7px 11px;border-radius:8px;margin-top:8px}
  .bar.light{background:#F0EDE8;border:1px solid #DED8CE}
  .bar.dark{background:#2B2B2B;border:1px solid #3B3B3B}
  .lbl{font-size:10.5px;width:60px;flex:none}
  .bar.light .lbl{color:#8b8073}
  .bar.dark .lbl{color:#9a9a9a}
  .hint16{font-size:10.5px;color:#a4988a}
  .gap{width:6px}
</style></head>
<body>
  <h1>工具栏图标 · 三个候选</h1>
  <p class="note">每个都按 16px 画的（细线在 16px 会消失，所以三个都是实心或粗描边）。上面是放大 96px 看形状，下面是它在真实工具条上的样子——亮底和暗底各一条，右边那个小的就是 16px 实际大小。</p>
  <div class="cols">${cols}</div>
</body></html>`;

fs.writeFileSync(path.join(here, 'e2e', 'icons.html'), html, 'utf8');
console.log('已生成 e2e/icons.html（' + CANDS.length + ' 个候选）');
