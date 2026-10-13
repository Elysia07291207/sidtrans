/* 旁译 · OCR 离屏文档（只在 Chrome / Edge 上跑）
 *
 * 职责只有一件：在这个有 DOM 的上下文里把 Tesseract 跑起来，替后台做 OCR。
 * 后台（service worker）通过 { type:'ocr-run', image, to:'offscreen' } 把图递过来，
 * 这里回 { ok, text, conf, langs }。
 *
 * 与 background.js 里那套参数保持一致——workerBlobURL:false 是必须的，
 * 不然 Blob worker 会被扩展 CSP 挡掉（而且报错是 undefined，很难查）。
 */
let worker = null;
let booting = null;

const LANGS = ['chi_sim', 'eng'];

function getWorker() {
  if (worker) return Promise.resolve(worker);
  if (booting) return booting;
  const U = (p) => chrome.runtime.getURL(p);
  booting = (async () => {
    const w = await Tesseract.createWorker(LANGS, 1, {
      workerPath: U('worker.min.js'),
      corePath: U('tesseract-core-simd-lstm.wasm.js'),
      langPath: U('lang'),
      gzip: true,
      workerBlobURL: false
    });
    worker = w;
    booting = null;
    return w;
  })().catch(e => {
    booting = null;
    throw e;
  });
  return booting;
}

/* 中文识别会在字间插空格，去掉；保留真正的换行（跟 background.js 里同一套处理） */
function tidy(text) {
  return String(text || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  if (!m || m.to !== 'offscreen') return;

  if (m.type === 'ocr-run') {
    (async () => {
      const w = await getWorker();
      const r = await w.recognize(m.image);
      const text = tidy(r && r.data && r.data.text);
      const conf = r && r.data && isFinite(r.data.confidence) ? Number(r.data.confidence) : null;
      return { ok: true, text: text, conf: conf, langs: LANGS.join(','), engine: 'Tesseract(本地)' };
    })()
      .then(sendResponse)
      .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;      // 异步回，必须占住通道
  }

  if (m.type === 'ocr-warmup') {
    getWorker()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
});
