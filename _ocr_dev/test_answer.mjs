/* 答题输出解析 · 离线自检
 * 抽 content.js 里的真函数跑，不复制——复制一份就会各自漂移。
 * 用法： node test_answer.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'content.js'), 'utf8');

const A = src.indexOf('  function splitAnswer(raw) {');
const B = src.indexOf('\n  }', A);
if (A < 0 || B < 0) { console.error('× 没在 content.js 里定位到 splitAnswer'); process.exit(1); }
const { splitAnswer } = new Function(
  src.slice(A, B + 4) + '\nreturn { splitAnswer };'
)();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  × ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('\n[1] 标准两行');
let r = splitAnswer('BDACA CADCB\nu 3 7');
ok('答案拼成一行', r.main === 'BDACA CADCB', JSON.stringify(r.main));
ok('没把握的题号取到', r.unsure === '3 7', JSON.stringify(r.unsure));

console.log('\n[2] 全部有把握（第二行只有一个 u）');
r = splitAnswer('BDACA CADCB\nu');
ok('答案正确', r.main === 'BDACA CADCB', JSON.stringify(r.main));
ok('没把握为空', r.unsure === '', JSON.stringify(r.unsure));

console.log('\n[3] 选词填空（填单词）');
r = splitAnswer('1 range 2 subtle 3 deny\nu 5');
ok('答案保留', r.main === '1 range 2 subtle 3 deny', JSON.stringify(r.main));
ok('没把握 = 5', r.unsure === '5', JSON.stringify(r.unsure));

console.log('\n[4] 模型偷懒：只给一行答案');
r = splitAnswer('BDACA');
ok('照样出答案', r.main === 'BDACA', JSON.stringify(r.main));
ok('没把握为空', r.unsure === '', JSON.stringify(r.unsure));

console.log('\n[5] 模型话多：前面多出一行说明');
r = splitAnswer('答案如下：\nBDACA\nu 2');
ok('说明行也不丢', r.main.indexOf('BDACA') !== -1, JSON.stringify(r.main));
ok('没把握 = 2', r.unsure === '2', JSON.stringify(r.unsure));

console.log('\n[6] 空/异常输入不炸');
ok('空串', splitAnswer('').main === '');
ok('null', splitAnswer(null).main === '');
ok('只有换行', splitAnswer('\n\n  \n').main === '');

console.log('\n[7] 做题带解析（答案不能被解析污染）');
r = splitAnswer('BDACA CADCB\nu 3 7\n\n解析：\n1. 选 B。denied 表示“否认”；argued 是“主张”，与“太贵”不搭。\n2. 选 A。subtle 是“微妙的”；visible 是“看得见的”，与“没人注意到”矛盾。');
ok('答案只取到答案那一行', r.main === 'BDACA CADCB', JSON.stringify(r.main));
ok('没把握 = 3 7', r.unsure === '3 7', JSON.stringify(r.unsure));
ok('解析被单独拆出来', /^解析：/.test(r.explain), JSON.stringify(String(r.explain).slice(0, 24)));
ok('解析里保留逐空内容', r.explain.indexOf('subtle') !== -1);
ok('答案行里没有混进解析', r.main.indexOf('denied') === -1);

r = splitAnswer('1 range 2 subtle\nu\n解析：\n1. 与句意“范围”对应。');
ok('选词填空 + 解析：答案照样取对', r.main === '1 range 2 subtle', JSON.stringify(r.main));
ok('没把握为空（只写了 u）', r.unsure === '', JSON.stringify(r.unsure));

r = splitAnswer('BDACA CADCB\nu 3 7');
ok('不带解析时 explain 为空', r.explain === '', JSON.stringify(r.explain));

r = splitAnswer('BDACA CADCB\nu 3 7\n\n【解析】\n1. 选 B。');
ok('标记写成【解析】也能拆出来', /选 B/.test(r.explain) && r.main === 'BDACA CADCB', JSON.stringify(String(r.explain).slice(0, 16)));

console.log('\n' + (fail ? '× ' + fail + ' 项没过' : '✓ 全部通过') + '（' + pass + ' passed' + (fail ? ', ' + fail + ' failed' : '') + '）');
process.exit(fail ? 1 : 0);
