/* OCR 复现实验：拿真图跑一遍 Tesseract，看它到底吐什么。
 * 不猜，直接看结果。
 * 用法： node probe_ocr.mjs <图片...>
 */
import { createWorker } from 'tesseract.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const langPath = process.env.TESS_LANG_DIR || path.join(here, 'lang');
const targets = process.argv.slice(2);

const langs = (process.env.TESS_LANGS || 'chi_sim,eng').split(',').map(s => s.trim()).filter(Boolean);
const opts = { langPath, gzip: true };
if (process.env.TESS_CACHE !== 'default') opts.cacheMethod = 'none';
const worker = await createWorker(langs, 1, opts);
console.log('语言: ' + langs.join('+') + '  cacheMethod=' + (opts.cacheMethod || '默认'));
for (const t of targets) {
  const { data } = await worker.recognize(t);
  console.log('\n— ' + path.basename(t));
  console.log('  文字: ' + JSON.stringify(data.text.trim()));
  console.log('  置信度: ' + data.confidence);
  const words = (data.words || []).filter(w => (w.text || '').trim());
  console.log('  词块: ' + words.slice(0, 24).map(w => JSON.stringify(w.text) + '@' + Math.round(w.confidence)).join(' '));
}
await worker.terminate();
