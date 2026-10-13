/* 批量 OCR：把一组图片里的文字识别出来，输出 markdown。
 * 用法: node ocr_batch.mjs <图片目录> <输出md> [每目录上限]
 */
import { createWorker } from 'tesseract.js';
import fs from 'node:fs';
import path from 'node:path';

const langPath = process.env.TESS_LANG_DIR || 'C:\\Users\\ELYSIA\\.hanako\\app-data\\_ocr_lang';
const root = process.argv[2];
const outFile = process.argv[3];
const perDir = Number(process.argv[4] || 99);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(jpe?g|png)$/i.test(e.name)) acc.push(p);
  }
  return acc;
}

const all = walk(root);
const byDir = new Map();
for (const f of all) {
  const d = path.dirname(f);
  if (!byDir.has(d)) byDir.set(d, []);
  byDir.get(d).push(f);
}
const targets = [];
for (const [d, files] of byDir) {
  files.sort();
  targets.push(...files.slice(0, perDir));
}
console.log(`files=${all.length} targets=${targets.length}`);

const worker = await createWorker(['chi_sim', 'eng'], 1, { langPath, gzip: true, cacheMethod: 'none' });
const out = [];
for (const t of targets) {
  try {
    const { data } = await worker.recognize(t);
    const text = (data.text || '').replace(/\n{3,}/g, '\n\n').trim();
    const rel = path.relative(root, t);
    console.log(`${rel} conf=${Math.round(data.confidence)} chars=${text.length}`);
    out.push(`### ${rel}\n- 置信度: ${Math.round(data.confidence)}  字符: ${text.length}\n\n\`\`\`\n${text}\n\`\`\`\n`);
  } catch (e) {
    console.log(`${t} FAIL ${e.message}`);
    out.push(`### ${path.relative(root, t)}\n- OCR 失败: ${e.message}\n`);
  }
}
await worker.terminate();
fs.writeFileSync(outFile, out.join('\n'), 'utf8');
console.log('written:', outFile);
