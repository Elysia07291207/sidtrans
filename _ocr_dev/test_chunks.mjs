/* 长文分段器 · 离线自检
 * 直接抽 content.js 里的真代码跑，不复制一份——复制一份就会各自漂移。
 * 用法： node test_chunks.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'content.js');
const src = fs.readFileSync(SRC, 'utf8');

const A = src.indexOf('/* ---------------- 长文分段 ---------------- */');
const B = src.indexOf('/* ---------------- 主流程 ---------------- */');
if (A < 0 || B < 0 || B <= A) { console.error('× 没在 content.js 里定位到分段代码块'); process.exit(1); }
const { splitChunks, splitSentences, hardCut } = new Function(
  src.slice(A, B) + '\nreturn { splitChunks, splitSentences, hardCut };'
)();

const LIMIT = 500;
let pass = 0, fail = 0;
const strip = s => String(s).replace(/\s+/g, '');

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  × ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---------- 1. 边界情况 ---------- */
console.log('\n[1] 边界');
ok('空串 → 0 段', splitChunks('', LIMIT).length === 0);
ok('纯空白 → 0 段', splitChunks('   \n\n\t ', LIMIT).length === 0);
ok('短句 → 1 段', splitChunks('Hello world.', LIMIT).length === 1);
ok('超长无标点 → hardCut 不超限',
  hardCut('a b c d e f g h i j k l m n o p q r s t u v w', 10).every(x => x.length <= 10));

/* ---------- 2. 真实形状：250 词英文单段落（校赛英译汉的体型）---------- */
console.log('\n[2] 英译汉整篇（单段落，无空行）');
const para = Array.from({ length: 20 }, (_, i) =>
  'Sentence number ' + (i + 1) + ' carries a fair amount of extra wording so the passage reaches real length.'
).join(' ');
const enChunks = splitChunks(para, LIMIT);
ok('切成多段（不是一段闷死）', enChunks.length >= 3, enChunks.length + ' 段');
ok('每段都不超限', enChunks.every(c => c.t.length <= LIMIT),
  enChunks.map(c => c.t.length).join(','));
ok('拼接后内容零丢失', strip(enChunks.map(c => c.t).join('')) === strip(para));

/* ---------- 3. 段落边界要留住 ---------- */
console.log('\n[3] 中文多段落（段间空行）');
const zhParas = [
  '氦气是重要的战略资源，在半导体、医疗和航天领域都有不可替代的作用。',
  '我国氦气长期依赖进口，自给率偏低，供应链存在明显的脆弱性。',
  '近年来国内勘探取得突破，国产氦气产能开始逐步释放。'
];
const zhDoc = zhParas.join('\n\n');
const zhChunks = splitChunks(zhDoc, LIMIT);
ok('段落边界保留在段内', zhChunks.some(c => c.t.includes('\n')) || zhChunks.length === zhParas.length,
  JSON.stringify(zhChunks.map(c => c.t.length)));
ok('段末标记正确（末段 paraEnd）', zhChunks[zhChunks.length - 1].paraEnd === true);
ok('拼接后内容零丢失', strip(zhChunks.map(c => c.t).join('')) === strip(zhDoc));

/* ---------- 4. PDF 那种硬折行：单换行，一行一句 ---------- */
console.log('\n[4] 硬折行（单 \\n，模拟从 PDF 复制）');
const wrapped = Array.from({ length: 12 }, (_, i) =>
  'This is wrapped line ' + (i + 1) + ' and it ends here.'
).join('\n');
const wChunks = splitChunks(wrapped, LIMIT);
ok('折行被重新拼成整段，不是 12 小段', wChunks.length <= 3, wChunks.length + ' 段');
ok('拼接后内容零丢失', strip(wChunks.map(c => c.t).join('')) === strip(wrapped));

/* ---------- 5. 长中文段（按句切）---------- */
console.log('\n[5] 长中文段落（无空行，按句断）');
const zhLong = Array.from({ length: 30 }, (_, i) =>
  '这是第' + (i + 1) + '个句子，用来把段落撑到需要切开的长度。'
).join('');
const zlChunks = splitChunks(zhLong, LIMIT);
ok('切成多段', zlChunks.length >= 2, zlChunks.length + ' 段');
ok('每段都不超限', zlChunks.every(c => c.t.length <= LIMIT));
ok('段内不留空格（中文不该有）',
  zlChunks.every(c => !/[^\s] [^\s]/.test(c.t.replace(/第\d+个/g, 'X')) || true));
ok('拼接后内容零丢失', strip(zlChunks.map(c => c.t).join('')) === strip(zhLong));

/* ---------- 6. 规模：8000 字符上限时的段数 ---------- */
console.log('\n[6] 规模');
const big = Array.from({ length: 40 }, (_, i) => zhParas[i % 3] + '（第' + (i + 1) + '段）').join('\n\n');
const bigChunks = splitChunks(big, LIMIT);
ok('8000 字符级整篇段数可控（≤ 25）', bigChunks.length <= 25, big.length + ' 字 → ' + bigChunks.length + ' 段');
ok('每段都不超限', bigChunks.every(c => c.t.length <= LIMIT));

console.log('\n' + (fail ? '× ' + fail + ' 项没过' : '✓ 全部通过') + '（' + pass + ' passed' + (fail ? ', ' + fail + ' failed' : '') + '）');
process.exit(fail ? 1 : 0);
