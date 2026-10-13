/* WASM OCR 可行性验证
 * 1) 能不能编译 WASM
 * 2) Tesseract.js 在扩展后台能不能跑起来
 * 3) 中文语言包能不能从扩展内加载
 * 结果回传给本机 127.0.0.1:8765/report
 */
const U = (p) => chrome.runtime.getURL(p);

function report(msg) {
  const url = 'http://127.0.0.1:8765/report?m=' + encodeURIComponent(String(msg).slice(0, 600));
  try { fetch(url).catch(() => {}); } catch (e) {}
}

(async () => {
  const steps = [];

  // --- 1. WASM 能不能编译 ---
  try {
    const buf = await (await fetch(U('tesseract-core-simd-lstm.wasm'))).arrayBuffer();
    const mod = await WebAssembly.compile(buf);
    steps.push('WASM_COMPILE_OK');
  } catch (e) {
    steps.push('WASM_COMPILE_FAIL:' + (e && e.message));
    report(steps.join(' | '));
    return;
  }

  // --- 2. Tesseract.js 能不能建 worker ---
  let worker;
  try {
    worker = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      workerPath: U('worker.min.js'),
      corePath: U('tesseract-core-simd-lstm.wasm.js'),
      langPath: U('lang'),
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: (m) => { if (m.status === 'recognizing text') steps.push('prog'); }
    });
    steps.push('WORKER_OK');
  } catch (e) {
    let d = '';
    try { d = (e && (e.message || e.reason || e.type)) || JSON.stringify(e) || String(e); } catch (_) { d = String(e); }
    steps.push('WORKER_FAIL:' + d);
    report(steps.join(' | '));
    return;
  }

  // --- 3. 真的认一张图 ---
  try {
    const r = await worker.recognize(U('test.png'));
    const text = String(r.data.text || '').replace(/\s+/g, ' ').trim();
    steps.push('OCR_OK[' + text.slice(0, 120) + ']');
  } catch (e) {
    steps.push('OCR_FAIL:' + (e && e.message));
  }

  try { await worker.terminate(); } catch (e) {}
  report(steps.filter(s => s !== 'prog').join(' | '));
})();
