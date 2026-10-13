/* 打包后的自检：manifest 引用了什么，产物里就必须有什么。
 *
 * 为什么单独立这一道：这类错（引用了不存在的文件）浏览器是**直接拒绝加载**的，
 * 而且不看报错很难联想——被 icons/ 咬过一次。
 *
 * 用法： 先跑 build.ps1，再  node check_packages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const CASES = [
  {
    name: 'Firefox (MV2)', manifest: 'manifest.json', dir: '_build/unpacked-firefox',
    /* manifest 没写、但代码里要用的：OCR 三件套与语言模型 */
    also: ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.wasm.js',
      'tesseract-core-simd-lstm.wasm', 'lang/chi_sim.traineddata.gz', 'lang/eng.traineddata.gz']
  },
  {
    name: 'Chromium (MV3)', manifest: 'manifest.chromium.json', dir: '_build/unpacked-chromium',
    also: ['offscreen.html', 'offscreen.js',
      'tesseract.min.js', 'worker.min.js', 'tesseract-core-simd-lstm.wasm.js',
      'tesseract-core-simd-lstm.wasm', 'lang/chi_sim.traineddata.gz', 'lang/eng.traineddata.gz']
  }
];

/* manifest 里所有「看着像相对路径」的字符串 */
function collectRefs(node, out) {
  if (typeof node === 'string') {
    if (/^[^:<>\s]+\.(js|html|css|png|svg|wasm|gz|json)$/i.test(node)) out.add(node);
    return out;
  }
  if (Array.isArray(node)) { for (const v of node) collectRefs(v, out); return out; }
  if (node && typeof node === 'object') { for (const k of Object.keys(node)) collectRefs(node[k], out); }
  return out;
}

let bad = 0;
let versionA = null;

for (const c of CASES) {
  console.log('\n=== ' + c.name + ' ===');
  const mf = path.join(root, c.manifest);
  const dir = path.join(root, c.dir);
  if (!fs.existsSync(mf)) { console.log('  ✗ 找不到 ' + c.manifest); bad++; continue; }
  if (!fs.existsSync(dir)) { console.log('  ✗ 找不到产物目录 ' + c.dir + '（先跑 build.ps1）'); bad++; continue; }

  let m;
  try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); }
  catch (e) { console.log('  ✗ manifest 不是合法 JSON: ' + e.message); bad++; continue; }

  console.log('  manifest 合法 ✓  version=' + m.version);
  if (versionA === null) versionA = m.version;
  else if (versionA !== m.version) { console.log('  ✗ 两个 manifest 版本号不一致：' + versionA + ' vs ' + m.version); bad++; }

  const refs = [...collectRefs(m, new Set())].sort();
  let miss = 0;
  for (const r of refs) {
    if (!fs.existsSync(path.join(dir, r))) { console.log('  ✗ manifest 引用了但产物里没有：' + r); miss++; }
  }
  console.log('  manifest 引用的 ' + refs.length + ' 个文件：' + (miss ? miss + ' 个缺失' : '全在 ✓'));
  bad += miss;

  let miss2 = 0;
  for (const r of c.also) {
    if (!fs.existsSync(path.join(dir, r))) { console.log('  ✗ 代码要用但产物里没有：' + r); miss2++; }
  }
  console.log('  代码依赖的 ' + c.also.length + ' 个文件：' + (miss2 ? miss2 + ' 个缺失' : '全在 ✓'));
  bad += miss2;
}

/* ---------- 商店上架包（dist\） ---------- */
console.log('\n=== 商店上架包 ===');
const dist = path.join(root, 'dist');
if (!fs.existsSync(dist)) {
  console.log('  ⚠ 还没出商店包（跑 package.ps1）。跳过这几项。');
} else {
  const ver = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
  const zips = [
    { f: `sidtrans-${ver}-firefox-mv2.zip`, need: ['manifest.json', 'icons/icon-128.png'] },
    { f: `sidtrans-${ver}-chromium-mv3.zip`, need: ['manifest.json', 'icons/icon-128.png', 'offscreen.html', 'offscreen.js'] }
  ];
  for (const z of zips) {
    const p = path.join(dist, z.f);
    if (!fs.existsSync(p)) { console.log('  ✗ 缺 ' + z.f); bad++; continue; }
    /* 关键：zip 的根目录要有 manifest.json，而且不能套一层文件夹。
       条目顺序无所谓——我第一版写成「第一项必须是 manifest.json」，
       那是把尺子做紧了，不是包错了。 */
    const r = spawnSync('tar', ['-tf', p], { encoding: 'utf8' });
    const entries = String(r.stdout || '').split(/\r?\n/).filter(Boolean);
    console.log('  ' + z.f + '：' + entries.length + ' 项，' + Math.round(fs.statSync(p).size / 1024 / 1024 * 10) / 10 + ' MB');
    if (entries.indexOf('manifest.json') === -1) { console.log('    ✗ 根目录没有 manifest.json——商店会直接拒'); bad++; }
    const wrapped = entries.filter(e => /^(unpacked|sidtrans|_build|dist)\//.test(e));
    if (wrapped.length) { console.log('    ✗ 包里套了一层文件夹（如 ' + wrapped[0] + '）'); bad++; }
    for (const n of z.need) {
      if (entries.indexOf(n) === -1) { console.log('    ✗ 包里缺 ' + n); bad++; }
    }
  }

  const store = path.join(dist, 'store');
  for (const n of ['icon-128.png', 'icon-300.png']) {
    const p = path.join(store, n);
    if (!fs.existsSync(p)) { console.log('  ✗ 缺 store/' + n); bad++; continue; }
    const b = fs.readFileSync(p);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    const want = Number(n.match(/icon-(\d+)/)[1]);
    const okDim = w === want && h === want;
    console.log('  store/' + n + '：' + w + '×' + h + (okDim ? ' ✓' : ' ✗ 应为 ' + want + '²'));
    if (!okDim) bad++;
  }

  const sh = path.join(store, 'screenshots');
  const shots = fs.existsSync(sh) ? fs.readdirSync(sh).filter(f => /\.png$/i.test(f)) : [];
  if (!shots.length) { console.log('  ✗ 没有商店截图（跑 make_store_shots.mjs）'); bad++; }
  for (const f of shots) {
    const b = fs.readFileSync(path.join(sh, f));
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    const okDim = w === 1280 && h === 800;
    console.log('  store/screenshots/' + f + '：' + w + '×' + h + (okDim ? ' ✓' : ' ✗ 商店要 1280×800'));
    if (!okDim) bad++;
  }
}

console.log('');
if (bad === 0) console.log('✓ 两个包 + 商店素材都是完整的');
else console.log('× 有 ' + bad + ' 处问题——商店会拒，别发');
process.exit(bad ? 1 : 0);
