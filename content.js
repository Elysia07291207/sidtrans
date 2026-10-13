/* 旁译 · SideTrans — content script
 * 划词 → 译文落在选区旁边 → 留一块地方给你写
 */
(() => {
  if (window.__sideTransLoaded) return;
  window.__sideTransLoaded = true;

  /* 宿主节点的 id 每次加载都换一个——固定名字太像“这里有个扩展” */
  const HOST_ID = '__st_' + Math.random().toString(36).slice(2, 9);
  const ORB_ID = '__orb_' + Math.random().toString(36).slice(2, 9);

  const HOSTNAME = (function () { try { return location.hostname || ''; } catch (e) { return ''; } })();

  /* 给后台的本地日志记一笔（只记步骤、错误、页面结构，不记内容） */
  function note(step, detail, extra) {
    try { ask({ type: 'note', step: step, detail: String(detail == null ? '' : detail).slice(0, 200), extra: extra || {} }); } catch (e) {}
  }

  let orb = null, orbMoved = false;

  /* 脚本可能在 iframe 里跑（考试系统爱把试题嵌在 iframe 中）。
     浮层要挂在「最外层能访问的文档」上，否则会被 iframe 的边界剪掉；
     坐标也要加上自己这一层的偏移（多层嵌套要累加）。跨域时退回本 frame。 */
  const TOPWIN = (function () {
    try {
      if (window.top && window.top !== window && window.top.document && window.top.document.documentElement) return window.top;
    } catch (e) {}
    return window;
  })();
  const TOPDOC = TOPWIN.document;
  const IN_FRAME = TOPWIN !== window;

  function frameOffset() {
    if (!IN_FRAME) return { x: 0, y: 0 };
    let x = 0, y = 0, w = window, hops = 0;
    try {
      while (w !== TOPWIN && w.frameElement && hops < 10) {
        const r = w.frameElement.getBoundingClientRect();
        x += r.left; y += r.top;
        w = w.parent; hops++;
      }
    } catch (e) {}
    return { x: x, y: y };
  }

  /* 本 frame 坐标 → 顶层视口坐标（挂给浮层和截图用的都是它） */
  function toViewport(r) {
    if (!r) return r;
    const o = frameOffset();
    if (!o.x && !o.y) return r;
    return {
      left: r.left + o.x, top: r.top + o.y, width: r.width, height: r.height,
      right: (r.right != null ? r.right : r.left + r.width) + o.x,
      bottom: (r.bottom != null ? r.bottom : r.top + r.height) + o.y
    };
  }
  const DEFAULTS = { enabled: true, autoTranslate: true, maxLen: 8000, ocrOnDblclick: true, orb: false, orbPos: null, panelTheme: 'light' };

  let S = Object.assign({}, DEFAULTS);
  let host = null, root = null, panel = null;  let ui = {};
  let seq = 0;
  let lastText = '';
  let lastMode = 'translate';
  let lastExplain = false;   // 上一次做题要不要解析（浮层里那颗按钮靠它翻面）
  let hideTimer = null;

  /* ---------------- 小工具 ---------------- */
  const storeGet = () => new Promise(r => {
    try { chrome.storage.local.get(null, v => r(Object.assign({}, DEFAULTS, v || {}))); }
    catch (e) { r(S); }
  });

  const ask = (m) => new Promise(r => {
    try {
      chrome.runtime.sendMessage(m, resp => { void chrome.runtime.lastError; r(resp); });
    } catch (e) { r(null); }
  });

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.documentElement.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  }

  /* ---------------- 样式 ---------------- */
  /* 主题走 CSS 变量：面板根上挂 data-theme，浅色是默认。
     字号与间距两套主题共用 —— 换主题只换颜色，阅读路线不变（考场里这句话很重要）。
     配色：浅色 = 暖白奶油（底层 #F8F3EB，结果区单独一层），
     深色 = 暖黑 + 金色（跟浅色同一套语义 token，只换值）。 */
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .st-panel{
    pointer-events:auto;
    width:420px; max-width:94vw; max-height:80vh;
    display:flex; flex-direction:column;
    font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
    /* —— 浅色（默认）：暖白奶油 —— */
    --bg:#F8F3EB; --bar:#EEE5D9; --res:#FFF9F2; --inp:#FFF9F1; --shotbg:#E8DED2;
    --line:#D8C9B9; --line2:#C5B3A1;
    --tx:#332A25; --tx2:#695B51; --tx3:#8D7E72;
    --acc:#9B6B4D; --onfg:#FFF8F3; --ans:#A64F62; --term:#8662A1;
    --ok:#5F8D5A; --warn:#9A7041; --err:#B34646; --pend:#958A81;
    --shadow:0 6px 14px rgba(74,54,42,.14),0 1px 3px rgba(74,54,42,.10);
    color:var(--tx); background:var(--bg);
    border:1px solid var(--line); border-radius:8px;
    box-shadow:var(--shadow);
    overflow:hidden;
  }
  /* —— 深色备选：暖黑纸面 + 金色模式信号 —— */
  .st-panel[data-theme="dark"]{
    --bg:#181716; --bar:#211F1D; --res:#24211E; --inp:#151310; --shotbg:#100e0c;
    --line:#3C3834; --line2:#554D46;
    --tx:#F4EEE6; --tx2:#B7AEA4; --tx3:#817870;
    --acc:#D6A85A; --onfg:#191714; --ans:#F2C66E; --term:#C8A0E8;
    --ok:#A8D49C; --warn:#D2AB70; --err:#EE887B; --pend:#77716B;
    --shadow:0 10px 22px rgba(0,0,0,.32),0 2px 4px rgba(0,0,0,.24);
  }
  .st-head{display:flex;align-items:center;gap:8px;padding:6px 10px;height:36px;background:var(--bar);border-bottom:1px solid var(--line);cursor:move;user-select:none}
  .st-dir{font-size:12px;line-height:17px;font-weight:800;letter-spacing:.12em;color:var(--acc)}
  .st-engine{font-size:10.5px;line-height:15px;font-weight:500;color:var(--tx3);margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:132px}
  .st-modes{display:flex;border:1px solid var(--line2);border-radius:5px;overflow:hidden;flex:none}
  .st-mode{appearance:none;border:0;border-right:1px solid var(--line2);background:transparent;color:var(--tx3);font:inherit;font-size:12px;line-height:18px;font-weight:500;padding:3px 8px;cursor:pointer}
  .st-mode:last-child{border-right:0}
  .st-mode:hover{background:color-mix(in srgb,var(--tx) 8%,transparent);color:var(--tx)}
  .st-mode.on{background:var(--acc);color:var(--onfg);font-weight:700}
  .st-close{appearance:none;border:0;background:transparent;color:var(--tx3);font-size:13px;line-height:1;padding:3px 5px;cursor:pointer;border-radius:5px;flex:none}
  .st-close:hover{background:color-mix(in srgb,var(--tx) 10%,transparent);color:var(--tx)}
  .st-body{overflow:auto;flex:1 1 auto}
  .st-sec{padding:8px 12px;border-bottom:1px solid var(--line)}
  .st-sec:last-child{border-bottom:0}
  .st-label{font-size:11px;line-height:16px;letter-spacing:.08em;color:var(--tx3);margin-bottom:5px;display:flex;align-items:center;gap:6px;font-weight:800;text-transform:uppercase}
  .st-status{color:var(--tx3);font-size:10.5px;letter-spacing:0;text-transform:none;font-weight:500;margin-left:auto}
  /* 结果区：单独一层底 + 左侧强调条。
     浅色靠它把边界拉开，深色靠它把结果托起来；左条的颜色跟着结果类型走（用 :has，不动 JS）。 */
  .st-res-sec{background:var(--res);border-left:2px solid var(--line2)}
  .st-res-sec:has(.st-dst.is-answer){border-left-color:var(--ans)}
  .st-res-sec:has(.st-dst.is-term){border-left-color:var(--term)}
  .st-res-sec:has(.st-dst.is-error){border-left-color:var(--err)}
  .st-src{color:var(--tx2);font-size:12.5px;line-height:20px;max-height:128px;overflow:auto;white-space:pre-wrap;word-break:break-word}
  .st-dst{color:var(--tx);font-size:16px;line-height:26px;font-weight:600;white-space:pre-wrap;word-break:break-word;min-height:26px}
  .st-dst.is-pending{color:var(--pend);font-weight:400}
  .st-dst.is-error{color:var(--err);font-size:13px;line-height:20px;font-weight:500}
  /* 「字是画上去的」那条引导：一句话 + 一颗直接取字的按钮。
     用 normal 折行，不然 pre-wrap 会把按钮挤到怪地方。 */
  .st-dst.is-hint{font-size:13px;line-height:20px;font-weight:400;color:var(--tx2);white-space:normal}
  .st-dst.is-hint b{color:var(--acc);font-weight:700}
  .st-hintrow{margin-top:10px}
  .st-hintbtn{appearance:none;border:1px solid var(--acc);background:var(--acc);color:var(--onfg);font:inherit;font-size:12px;line-height:19px;font-weight:800;padding:5px 11px;border-radius:5px;cursor:pointer;min-height:30px}
  /* 答案要一眼扫完：最大的一号字、等宽、宽字距 */
  .st-dst.is-answer{font-size:24px;line-height:36px;font-weight:800;letter-spacing:.16em;
    color:var(--ans);font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;min-height:36px}
  /* 术语：官方译法单独一行、次于答案，用另一个色相跟答案分开 */
  .st-dst.is-term{font-size:inherit;letter-spacing:0;font-weight:400;color:var(--tx)}
  .st-tterm{display:flex;gap:8px;align-items:baseline}
  .st-tterm .st-tk{flex:none;max-width:46%;font-size:11px;line-height:16px;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .st-tterm + .st-tterm{margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}
  .st-tterm .st-tv{font-size:21px;line-height:30px;font-weight:800;color:var(--term);word-break:break-word;
    font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;letter-spacing:.01em}
  .st-trow{display:flex;gap:8px;margin-top:6px;font-size:12.5px;line-height:20px;color:var(--tx2)}
  .st-trow .st-tk{flex:none;font-size:11px;color:var(--tx3);padding-top:2px}
  .st-trow .st-tx{min-width:0;word-break:break-word}
  .st-pending{color:var(--tx3);font-size:12px;line-height:18px;font-weight:600;margin-top:6px;letter-spacing:.01em}
  .st-pending:empty{display:none}
  .st-shot-sec{display:none}
  .st-shot-sec.on{display:block}
  .st-shot{display:block;width:100%;height:104px;object-fit:contain;image-rendering:pixelated;
    border:1px solid var(--line2);border-radius:6px;background:var(--shotbg)}
  .st-shotinfo{font-size:11px;line-height:16px;font-weight:600;color:var(--tx3);letter-spacing:0;text-transform:none;
    margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .st-shotinfo.is-warn{color:var(--warn)}
  /* 写作区默认压扁（考场少占地方），一聚焦或里面有字就自己展开。
     “里面有字”用 :not(:placeholder-shown) 判 —— 纯 CSS，不靠 JS 同步 class，
     程序设 value（译文→写、原文→写）也能正确展开。 */
  .st-input{width:100%;min-height:42px;max-height:200px;resize:vertical;background:var(--inp);border:1px solid var(--line);border-radius:8px;color:var(--tx);padding:8px 10px;font:inherit;font-size:13px;outline:none;line-height:1.6;transition:min-height .12s ease}
  .st-write:focus-within .st-input,
  .st-write:has(.st-input:not(:placeholder-shown)) .st-input{min-height:66px}
  .st-input:focus{border-color:var(--acc)}
  .st-foot{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:8px 10px;min-height:42px;background:var(--bar);border-top:1px solid var(--line)}
  .st-more{display:flex;flex-wrap:wrap;gap:4px;min-width:0}
  .st-btn{appearance:none;border:1px solid var(--line2);background:transparent;color:var(--tx2);font:inherit;font-size:11.5px;line-height:18px;font-weight:600;padding:4px 9px;border-radius:5px;cursor:pointer;white-space:nowrap}
  .st-btn:hover{background:color-mix(in srgb,var(--tx) 9%,transparent);color:var(--tx)}
  .st-btn.primary{background:var(--acc);border-color:var(--acc);color:var(--onfg);font-weight:700;min-width:84px}
  .st-btn.primary:hover{background:var(--acc);color:var(--onfg);filter:brightness(1.08)}
  /* CSS 里那个「看解析」按钮的可见性、以及解析块的样式 */
  .st-panel .st-btn[data-act="explain"]{display:none}
  .st-panel[data-mode="answer"] .st-btn[data-act="explain"]{display:inline-block}
  /* 做题的解析：跟在答案后面，字号回到正文字号——它是「回头细看」的，不抢那一眼。
     用 font 简写把等宽/宽字距一并收掉，不然会继承答案那套。 */
  .st-explain{display:block;margin-top:10px;padding-top:8px;border-top:1px solid var(--line);
    font:400 13px/20px -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
    letter-spacing:normal;color:var(--tx2);white-space:pre-wrap}
  .st-toast{font-size:11.5px;line-height:17px;font-weight:700;color:var(--ok);margin-left:auto;align-self:center;max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .st-toast.is-err{color:var(--err)}
  `;

  /* ---------------- 面板 ---------------- */
  function build() {
    if (host) return;
    /* 只留一个浮层：把上一个收走（用顶层的一个引用，不靠 id 找） */
    try { const prev = TOPWIN.__stHost; if (prev && prev.parentNode) prev.parentNode.removeChild(prev); } catch (e) {}
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText =
      'position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;' +
      'opacity:0;visibility:hidden;transition:opacity .12s ease;';
    try { TOPWIN.__stHost = host; } catch (e) {}
    /* 闭合 shadow：页面脚本看不到浮层内部。
       （代价是我自己也得靠脚本内部引用去摸它，所以下面留了个只读自检口） */
    root = host.attachShadow({ mode: 'closed' });

    const st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);

    panel = document.createElement('div');
    panel.className = 'st-panel';
    /* 主题：浅色是默认，深色是备选。换主题只换颜色，不动字号与顺序。 */
    panel.setAttribute('data-theme', S.panelTheme === 'dark' ? 'dark' : 'light');
    panel.innerHTML = `
      <div class="st-head">
        <span class="st-dir">译</span>
        <span class="st-modes">
          <button class="st-mode" data-mode="translate" title="翻译">翻译</button>
          <button class="st-mode" data-mode="answer" title="当题做，只给答案">做题</button>
          <button class="st-mode" data-mode="term" title="术语：官方译法 + 说明">术语</button>
        </span>
        <span class="st-engine"></span>
        <button class="st-close" title="关闭 (Esc)">✕</button>
      </div>
      <div class="st-body">
        <div class="st-sec st-shot-sec">
          <div class="st-label">取到的那块<span class="st-shotinfo"></span></div>
          <img class="st-shot" alt="">
        </div>
        <!-- 结果排在原文之前：考试时眼睛该先落在结果上，原文是回头看的 -->
        <div class="st-sec st-res-sec">
          <div class="st-label"><span class="st-restitle">译文</span><span class="st-status"></span></div>
          <div class="st-dst"></div>
          <div class="st-pending"></div>
        </div>
        <div class="st-sec">
          <div class="st-label">原文</div>
          <div class="st-src"></div>
        </div>
        <div class="st-sec st-write">
          <div class="st-label">写</div>
          <textarea class="st-input" placeholder="在这里写你的译文 / 想法…" spellcheck="false"></textarea>
        </div>
      </div>
      <div class="st-foot">
        <button class="st-btn primary" data-act="copy-dst">复制译文</button>
        <span class="st-more">
          <button class="st-btn" data-act="explain">看解析</button>
          <button class="st-btn" data-act="dst-to-write">译文→写</button>
          <button class="st-btn" data-act="as-question">当题做</button>
          <button class="st-btn" data-act="src-to-write">原文→写</button>
          <button class="st-btn" data-act="copy-mine">复制我写的</button>
          <button class="st-btn" data-act="retrans">重译</button>
        </span>
        <span class="st-toast"></span>
      </div>`;
    root.appendChild(panel);

    ui = {
      dir: panel.querySelector('.st-dir'),
      engine: panel.querySelector('.st-engine'),
      body: panel.querySelector('.st-body'),
      shotSec: panel.querySelector('.st-shot-sec'),
      shot: panel.querySelector('.st-shot'),
      shotInfo: panel.querySelector('.st-shotinfo'),
      src: panel.querySelector('.st-src'),
      dst: panel.querySelector('.st-dst'),
      pending: panel.querySelector('.st-pending'),
      status: panel.querySelector('.st-status'),
      resTitle: panel.querySelector('.st-restitle'),
      copyBtn: panel.querySelector('.st-btn.primary'),
      explainBtn: panel.querySelector('.st-btn[data-act="explain"]'),
      input: panel.querySelector('.st-input'),
      toast: panel.querySelector('.st-toast'),
      modes: Array.prototype.slice.call(panel.querySelectorAll('.st-mode'))
    };
    panel.querySelector('.st-head').addEventListener('click', e => {
      const b = e.target.closest('.st-mode');
      if (b) { e.stopPropagation(); pickMode(b.dataset.mode); }
    });
    syncMode();

    panel.querySelector('.st-close').addEventListener('click', () => hide(true));
    panel.querySelector('.st-head').addEventListener('mousedown', startDrag);
    panel.querySelector('.st-foot').addEventListener('click', onFootClick);
    /* 译文区偶尔会临时画一颗按钮上去（比如「取这块的字」）。
       它跟着下一次重画译文一起消失，所以事件挂在这儿就够。 */
    ui.dst.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button[data-hint]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.hint === 'ocr' && pendingRect) runOcr(pendingRect, '框选取字');
    });
    ui.input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); hide(); return; }
      /* Ctrl+Enter：把写作框里的文字按当前模式处理（粘贴进来的题目就走这条路） */
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const t = (ui.input.value || '').trim();
        if (!t) { setPending('写框是空的'); return; }
        run(t, host.getBoundingClientRect(), true, lastMode);
      }
    });
    panel.addEventListener('mousedown', e => e.stopPropagation());

    /* 挂到最外层文档：在 iframe 里也能完整显示，不被边框剪掉 */
    (TOPDOC.documentElement || document.documentElement).appendChild(host);

    /* 闭合 shadow 之后外部摸不到内部。
       自检口只在本地/扩展页面暴露（127.0.0.1 / localhost / file:），
       真实站点上一个全局名字都不留。 */
    try {
      const local = location.protocol === 'file:' || location.protocol === 'moz-extension:' ||
        location.hostname === '127.0.0.1' || location.hostname === 'localhost';
      if (local) {
        TOPWIN.__stCheck = () => ({
          vis: host ? host.style.visibility : 'gone',
          dir: ui.dir ? ui.dir.textContent : null,
          cls: ui.dst ? ui.dst.className : null,
          src: ui.src ? String(ui.src.textContent).slice(0, 50) : null,
          dst: ui.dst ? String(ui.dst.textContent).slice(0, 70) : null,
          modes: ui.modes ? ui.modes.map(b => b.textContent + (b.classList.contains('on') ? '*' : '')) : [],
          hint: (ui.dst && ui.dst.querySelector) ? (ui.dst.querySelector('button[data-hint]') ? ui.dst.querySelector('button[data-hint]').dataset.hint : null) : null,
          /* panel 可能在淡出后被拆掉——自检口不能因为自己拆了而报错 */
          btns: panel ? Array.prototype.map.call(panel.querySelectorAll('.st-foot button'), b => b.dataset.act) : []
        });
        TOPWIN.__stAct = (what) => {
          try {
            if (what === 'close') { hide(true); return 'close'; }
            if (what === 'orb') { buildOrb(); return 'orb'; }
            if (what === 'hintBtn') {
              const hb = (ui.dst && ui.dst.querySelector) ? ui.dst.querySelector('button[data-hint]') : null;
              if (!hb) return 'no-hint-btn';
              hb.click();
              return 'hintBtn:' + hb.dataset.hint;
            }
            if (what === 'canvasHint') {
              const cv = document.querySelector('canvas');
              showDrawnHint(cv ? cv.getBoundingClientRect()
                : { left: 40, top: 200, width: 260, height: 90, right: 300, bottom: 290 });
              return 'canvasHint';
            }
            if (what === 'openEmpty') { openEmpty(); return 'openEmpty'; }
            if (what === 'answer' || what === 'term' || what === 'translate') { pickMode(what); return 'mode:' + what; }
            onFootClick({ target: { closest: () => ({ dataset: { act: what } }) } });
            return 'act:' + what;
          } catch (e) { return 'err:' + e.message; }
        };
      }
    } catch (e) {}
  }

  /* 进度提示：独立一行，跟在译文下面。译文本身只增不改，边翻边读不闪。 */
  function setPending(t) { if (ui.pending) ui.pending.textContent = t || ''; }

  /* 让标题栏那两颗「翻译 / 做题」跟上当前模式 */
  function syncMode() {
    if (!ui.modes) return;
    const cur = lastMode || 'translate';
    ui.modes.forEach(b => b.classList.toggle('on', b.dataset.mode === cur));
    if (ui.resTitle) ui.resTitle.textContent = RES_TITLE[cur] || '译文';
    if (ui.copyBtn) ui.copyBtn.textContent = COPY_LABEL[cur] || '复制译文';
    /* 「看解析」只在做题模式露出来（CSS 按 data-mode 控），文本靠 lastExplain 翻面 */
    if (panel) panel.dataset.mode = cur;
    if (ui.explainBtn) ui.explainBtn.textContent = lastExplain ? '收起解析' : '看解析';
  }

  const MODE_LABEL = { translate: '翻译', answer: '做题', term: '术语' };
  /* 结果区的标题和主按钮跟着模式走：做题时写「答案 / 复制答案」，术语时写「术语 / 复制译法」。
     不改这两个字，换模式就只剩颜色在变——考场上一眼认不出来。 */
  const RES_TITLE = { translate: '译文', answer: '答案', term: '术语' };
  const COPY_LABEL = { translate: '复制译文', answer: '复制答案', term: '复制译法' };
  function modeOf(m) { return (m === 'answer' || m === 'term') ? m : 'translate'; }
  const escHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* 术语模式的三行：译法 / 备选 / 说明。模型偶尔会加粗体或换措辞，所以前缀宽松匹配。 */
  function splitTerm(raw) {
    const lines = String(raw || '').split('\n').map(x => x.trim()).filter(Boolean);
    const pick = (keys) => {
      for (const l of lines) {
        for (const k of keys) {
          const m = l.match(new RegExp('^[*#\\s]*' + k + '[\\s：:]*[*\\s]*(.+)$'));
          if (m) return m[1].replace(/\*\*/g, '').trim();
        }
      }
      return '';
    };
    return {
      yifa: pick(['译法', '译文', '英文']) || (lines[0] || '').replace(/^[*#\s]*/, '').trim(),
      beixuan: pick(['备选', '其他', '变体']),
      shuoming: pick(['说明', '阐释', '解释'])
    };
  }

  /* 做题 / 术语：不走译文那一套，各自单独摆。返回 true 表示已经画过了。 */
  function paintSpecial(resp) {
    if (resp.mode === 'answer') {
      const a = splitAnswer(resp.answer || '');
      ui.dst.className = 'st-dst is-answer';
      /* 有解析就把它接在答案后面（同一块里，字号在 .st-explain 里收回去） */
      ui.dst.innerHTML = escHtml(a.main) +
        (a.explain ? '<span class="st-explain">' + escHtml(a.explain) + '</span>' : '');
      setPending(a.unsure ? '没把握：' + a.unsure : '');
      return true;
    }
    if (resp.mode === 'term') {
      const t = splitTerm(resp.answer || '');
      ui.dst.className = 'st-dst is-term';
      /* 「译法」行里出现 → 说明这是一整段话被打成了多条，逐条摆 */
      let head;
      if (t.yifa.indexOf('→') !== -1) {
        head = t.yifa.split(/[；;]\s*/).map(s => s.trim()).filter(Boolean).map(s => {
          const i = s.indexOf('→');
          const zh = i >= 0 ? s.slice(0, i).trim() : s;
          const en = i >= 0 ? s.slice(i + 1).trim() : '';
          return '<div class="st-tterm"><span class="st-tk">' + escHtml(zh) + '</span><span class="st-tv">' + escHtml(en) + '</span></div>';
        }).join('');
      } else {
        head = '<div class="st-tterm"><span class="st-tk">译法</span><span class="st-tv">' + escHtml(t.yifa) + '</span></div>';
      }
      ui.dst.innerHTML = head +
        (t.beixuan && t.beixuan !== '无' ? '<div class="st-trow"><span class="st-tk">备选</span><span class="st-tx">' + escHtml(t.beixuan) + '</span></div>' : '') +
        (t.shuoming ? '<div class="st-trow"><span class="st-tk">说明</span><span class="st-tx">' + escHtml(t.shuoming) + '</span></div>' : '');
      setPending('');
      return true;
    }
    return false;
  }

  /* 在浮层里直接切「翻译 / 做题 / 术语」。点了就立刻用新模式把当前这段重跑一遍——
     切模式要是只换个标签、内容不动，那切了等于没切。 */
  function pickMode(mode) {
    mode = modeOf(mode);
    lastMode = mode;
    S.actionMode = mode;
    try { chrome.storage.local.set({ actionMode: mode }); } catch (e) {}
    syncMode();
    if (!lastText) { setPending('先划一段文字，我再按「' + MODE_LABEL[mode] + '」重来'); return; }
    run(lastText, host.getBoundingClientRect(), true, mode);
  }

  /* 把模型的两行输出拆开：第一行是答案，第二行是 u 开头的「没把握的题号」。
     输出格式偶尔会飘（少一行、多空行），所以拆得宽松一点，拆不准就原样显示。 */
  /* 做题的输出：答案 + 可选解析。
     「解析：」之后全归解析——有它，就不能把解析混进答案那一行里。 */
  function splitAnswer(raw) {
    const lines = String(raw || '').split('\n');
    let cut = -1;
    /* 模型写法会飘：【解析】/ 解析：/ **解析** 都算。只认行首，不认句中。 */
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*[*#\s]*[【\[（(]?\s*解析\s*[】\]）)]?\s*[：:]?/.test(lines[i])) { cut = i; break; }
    }
    const head = (cut >= 0 ? lines.slice(0, cut) : lines).map(x => x.trim()).filter(Boolean);
    const uLine = head.find(l => /^u$/i.test(l) || /^u[\s\u3000]/i.test(l));
    return {
      main: head.filter(l => l !== uLine).join('  '),
      unsure: uLine ? uLine.replace(/^u[\s\u3000]*/i, '').trim() : '',
      explain: cut >= 0 ? lines.slice(cut).join('\n').trim() : ''
    };
  }

  /* ---------------- 拖拽 ---------------- */
  function startDrag(e) {
    if (e.target.closest('.st-close')) return;
    if (e.target.closest('.st-mode')) return;      // 点「翻译/做题」不该把面板拖走
    const r = host.getBoundingClientRect();
    const off = { x: e.clientX - r.left, y: e.clientY - r.top };
    const move = ev => {
      host.style.left = clamp(ev.clientX - off.x, 4, innerWidth - r.width - 4) + 'px';
      host.style.top = clamp(ev.clientY - off.y, 4, innerHeight - r.height - 4) + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', up, true);
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    e.preventDefault();
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- 定位：优先放选区右边，右边放不下就放左边 ---------------- */
  function place(rect) {
    const vw = TOPWIN.innerWidth || innerWidth;
    const vh = TOPWIN.innerHeight || innerHeight;
    const w = host.offsetWidth || 420;
    const h = host.offsetHeight || 300;
    const gap = 14;
    let left, top;
    // 选了一长段（或整篇）时，别跟着选区跑，直接贴在右侧
    if (rect.height > vh * 0.5) {
      left = vw - w - 18;
      top = 24;
    } else {
      left = rect.right + gap;
      if (left + w > vw - 6) {
        const alt = rect.left - w - gap;
        left = alt >= 6 ? alt : clamp(vw - w - 6, 6, vw);
      }
      top = rect.top - 4;
    }
    left = clamp(left, 6, Math.max(6, vw - w - 6));
    top = clamp(top, 6, Math.max(6, vh - h - 6));
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
  }

  let shownAt = 0;
  let busy = false;
  let keepTimer = null;

  /* 有些页面（SPA / 轮播）会整块重绘，把浮层一起清掉。被清掉就重新挂回去。 */
  function keepAlive(on) {
    if (on) {
      if (keepTimer) return;
      keepTimer = setInterval(() => {
        if (!host) return;
        if (!TOPDOC.documentElement.contains(host)) {
          TOPDOC.documentElement.appendChild(host);
        }
      }, 700);
    } else if (keepTimer) {
      clearInterval(keepTimer); keepTimer = null;
    }
  }

  function show() {
    if (!host) return;
    clearTimeout(hideTimer);
    shownAt = Date.now();
    host.style.visibility = 'visible';
    host.style.opacity = '1';
    keepAlive(true);
  }

  /* force=true 才无视“刚显示别关 / 正在取字翻译”的保护 */
  function hide(force) {
    if (!host) return;
    if (!force && (busy || Date.now() - shownAt < 800)) return;
    host.style.opacity = '0';
    host.style.visibility = 'hidden';
    keepAlive(false);
    /* 淡出之后把节点也从页面里拆掉——不用的那一刻就不该有痕。
       下次要用时重建，代价只是一次 createElement。 */
    setTimeout(() => {
      if (!host || host.style.visibility === 'visible') return;
      try { if (host.parentNode) host.parentNode.removeChild(host); } catch (e) {}
      try { if (TOPWIN.__stHost === host) TOPWIN.__stHost = null; } catch (e) {}
      host = null; root = null; panel = null; ui = {};
    }, 300);
  }

  /* ---------------- 悬浮球 ---------------- */
  /* 给别人进不来的字一个入口：点球 → 开一个空浮层 → 把题目粘进「写」框 → Ctrl+Enter。
     可拖动，位置记在 storage；默认关闭（设置页里开）。 */
  function buildOrb() {
    if (orb || !S.orb) return;
    orb = document.createElement('div');
    orb.id = ORB_ID;
    orb.title = '旁译 · 点我打开（可在里面粘贴文字）';
    orb.style.cssText =
      'position:fixed;z-index:2147483645;width:26px;height:26px;border-radius:50%;box-sizing:border-box;' +
      'background:rgba(30,27,23,.82);border:1px solid rgba(214,155,88,.6);' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:.5;transition:opacity .15s;cursor:pointer;';
    const px = (S.orbPos && isFinite(S.orbPos.x)) ? S.orbPos.x : (TOPWIN.innerWidth - 46);
    const py = (S.orbPos && isFinite(S.orbPos.y)) ? S.orbPos.y : (TOPWIN.innerHeight - 130);
    orb.style.left = px + 'px';
    orb.style.top = py + 'px';
    orb.addEventListener('mouseenter', () => { orb.style.opacity = '.95'; });
    orb.addEventListener('mouseleave', () => { orb.style.opacity = '.5'; });
    orb.addEventListener('mousedown', startOrbDrag);
    orb.addEventListener('click', () => { if (!orbMoved) openEmpty(); orbMoved = false; });
    (TOPDOC.documentElement || document.documentElement).appendChild(orb);
  }

  function hideOrb() {
    if (!orb) return;
    try { if (orb.parentNode) orb.parentNode.removeChild(orb); } catch (e) {}
    orb = null;
  }

  function startOrbDrag(e) {
    if (!orb) return;
    e.preventDefault();
    const r = orb.getBoundingClientRect();
    const off = { x: e.clientX - r.left, y: e.clientY - r.top };
    let moved = false;
    const move = ev => {
      if (!moved && (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3)) moved = true;
      if (!moved) return;
      orb.style.left = clamp(ev.clientX - off.x, 2, Math.max(2, TOPWIN.innerWidth - 28)) + 'px';
      orb.style.top = clamp(ev.clientY - off.y, 2, Math.max(2, TOPWIN.innerHeight - 28)) + 'px';
    };
    const up = () => {
      TOPDOC.removeEventListener('mousemove', move, true);
      TOPDOC.removeEventListener('mouseup', up, true);
      if (moved) {
        orbMoved = true;
        try {
          chrome.storage.local.set({ orbPos: { x: parseInt(orb.style.left, 10), y: parseInt(orb.style.top, 10) } });
        } catch (err) {}
      }
    };
    TOPDOC.addEventListener('mousemove', move, true);
    TOPDOC.addEventListener('mouseup', up, true);
  }

  /* 点球来的：开一个空浮层，焦点落在写框里，等着接粘贴 */
  function openEmpty() {
    build();
    if (!host) return;
    ui.src.textContent = '';
    ui.dir.textContent = '待输入';
    ui.status.textContent = '';
    ui.engine.textContent = '';
    ui.input.value = '';
    ui.toast.textContent = '';
    ui.dst.className = 'st-dst is-pending';
    ui.dst.textContent = '把文字粘进下面的「写」框，按 Ctrl+Enter 就按当前模式处理。';
    setPending('');
    if (ui.shotSec) ui.shotSec.classList.remove('on');
    syncMode();
    host.style.left = Math.round(Math.max(8, TOPWIN.innerWidth - (host.offsetWidth || 420) - 18)) + 'px';
    host.style.top = '64px';
    show();
    setTimeout(() => { try { if (ui.input) ui.input.focus(); } catch (e) {} }, 80);
  }

  /* ---------------- 长文分段 ---------------- */
  const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uff00-\uffef]/;

  /* 两块拼在一起时中间要不要空格：中文不出空格，英文要 */
  function sep(a, b) {
    const la = (a || '').slice(-1), fb = (b || '').slice(0, 1);
    if (!la || !fb) return '';
    if (CJK_RE.test(la) || CJK_RE.test(fb)) return '';
    return ' ';
  }

  /* 一句话长到超限又没标点可断时，只能在空格处硬切 */
  function hardCut(s, limit) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      let end = Math.min(s.length, i + limit);
      if (end < s.length) {
        const sp = s.lastIndexOf(' ', end);
        if (sp > i + Math.floor(limit * 0.55)) end = sp + 1;
      }
      const p = s.slice(i, end).trim();
      if (p) out.push(p);
      i = end;
    }
    return out;
  }

  function splitSentences(t, limit) {
    const segs = t.split(/(?<=[.!?。！？；;])[ \t]*/).map(x => x.trim()).filter(Boolean);
    const out = [];
    let buf = '';
    for (const s of segs) {
      if (s.length > limit) {
        if (buf) { out.push(buf); buf = ''; }
        hardCut(s, limit).forEach(p => out.push(p));
        continue;
      }
      if (!buf) { buf = s; continue; }
      if (buf.length + 1 + s.length <= limit) buf += sep(buf, s) + s;
      else { out.push(buf); buf = s; }
    }
    if (buf) out.push(buf);
    return out.length ? out : [t.trim()];
  }

  /* 把整篇切成若干「段」。两条规矩：
   *   1) 每段不超过 limit 字符（模型一次吃这么多，译得最专注）；
   *   2) 段内的原段落边界用 \n 留着，拼回去才不是一坨。 */
  function splitChunks(text, limit) {
    limit = Math.max(120, limit || 500);
    const norm = String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!norm) return [];

    const units = [];
    for (const raw of norm.split(/\n\s*\n/)) {
      const p = raw.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
      if (!p) continue;
      if (p.length <= limit) { units.push({ t: p, glue: '\n', end: true }); continue; }
      const segs = splitSentences(p, limit);
      segs.forEach((s, i) => units.push({ t: s, glue: i === 0 ? '\n' : 'sep', end: i === segs.length - 1 }));
    }

    const chunks = [];
    let closed = false;
    for (const u of units) {
      let cur = chunks[chunks.length - 1];
      if (cur && !closed && cur.t.length + u.t.length + 1 <= limit) {
        cur.t += (u.glue === 'sep' ? sep(cur.t.slice(-1), u.t.slice(0, 1)) : '\n') + u.t;
      } else {
        cur = { t: u.t };
        chunks.push(cur);
        closed = false;
      }
      cur.paraEnd = !!u.end;                       // 这一段是不是在原文段落末尾收的
      if (u.end && cur.t.length >= limit * 0.6) closed = true;
    }
    return chunks;
  }

  /* ---------------- 主流程 ---------------- */
  const CHUNK_LIMIT = 500;      // 一段喂给模型的字数上限
  const CHUNK_PARALLEL = 3;     // 同时最多发几个请求：够快，又不至于被接口掐

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 1) return null;
    if (!/[\p{L}\p{N}]/u.test(text)) return null;
    let rect;
    try {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      rect = (r && r.width === 0 && r.height === 0)
        ? sel.getRangeAt(sel.rangeCount - 1).getBoundingClientRect()
        : r;
    } catch (e) { return null; }
    if (!rect || (!rect.width && !rect.height)) return null;
    const cap = S.maxLen || 8000;
    if (text.length > cap) return { tooLong: text.length, cap: cap, rect: rect };
    return { text, rect };
  }

  function insideHost(t) {
    if (!host || !t) return false;
    return t === host || host.contains(t) || (t.getRootNode && t.getRootNode() === root);
  }

  async function run(text, rect, force, mode, explain) {
    build();
    const my = ++seq;
    busy = true;
    lastText = text;
    const answering = mode === 'answer';
    const terming = mode === 'term';
    /* 做题要不要解析：浮层那颗按钮显式传进来的优先，否则看设置里的默认值 */
    const explaining = answering && ((typeof explain === 'boolean') ? explain : S.answerExplain === 'on');
    lastExplain = explaining;
    lastMode = answering ? 'answer' : (terming ? 'term' : 'translate');
    syncMode();

    /* 方向按整篇定，不按段定。一段里数字多了自己翻个方向，整篇就会中英混杂。 */
    const cjkN = (text.match(/[\u3400-\u9fff\u3040-\u30ff]/g) || []).length;
    const latN = (text.match(/[A-Za-z]/g) || []).length;
    const srcHint = (cjkN === 0 && latN === 0) ? '' : (cjkN >= latN ? 'zh' : 'en');
    const toEn = S.targetMode === 'en' ? true
      : S.targetMode === 'zh' ? false
      : srcHint === 'zh';

    /* 做题与术语都绝不分段：题目 / 术语必须整体进模型，切开就废。分段只为翻译服务。 */
    const chunks = (answering || terming) ? [{ t: text, paraEnd: true }] : splitChunks(text, CHUNK_LIMIT);
    const multi = chunks.length > 1;
    const out = new Array(chunks.length).fill(null);
    const fail = new Array(chunks.length).fill(null);
    /* 哪几段是被模型截断的（finish_reason=length）：没写完的译文不能当完整的端上去 */
    const trunc = new Array(chunks.length).fill(false);
    let next = 0, meta = null, anyMeta = null, okCount = 0, notText = false, firstRender = true;

    ui.src.textContent = text;
    ui.input.value = '';
    if (ui.shotSec) ui.shotSec.classList.remove('on');
    ui.dst.className = 'st-dst';
    ui.dst.textContent = '';
    ui.status.textContent = '';
    ui.dir.textContent = answering ? '答题' : (terming ? '术语' : '译');
    ui.engine.textContent = '';
    ui.toast.textContent = '';
    setPending(answering ? '答题中…' : (terming ? '查术语中…'
      : (multi ? '开始翻…（共 ' + chunks.length + ' 段）' : '翻译中…')));
    place(toViewport(rect));
    show();

    /* 只显示「已经连成一片」的那部分：第 1 段没好，第 2 段的译文就不抢先冒出来。
       读到的永远是完整的前缀，中间不会开洞。 */
    let unsure = '';
    const render = () => {
      if (answering || terming) {
        if (out[0] != null) {
          paintSpecial({ mode: answering ? 'answer' : 'term', answer: String(out[0]) });
          if (trunc[0]) setPending('这次没输出完（模型被截断了），可以重译一次');
        }
        return;
      }
      let s = '', last = -1;
      for (let i = 0; i < chunks.length; i++) {
        if (out[i] == null) break;
        if (i > 0) s += chunks[i - 1].paraEnd ? '\n\n' : (toEn ? ' ' : '');
        s += out[i];
        last = i;
      }
      const nearBottom = ui.body.scrollTop + ui.body.clientHeight >= ui.body.scrollHeight - 64;
      ui.dst.textContent = s;
      if (last >= 0) {
        ui.status.textContent = multi ? '· 已出 ' + (last + 1) + '/' + chunks.length + ' 段' : '';
        setPending(last + 1 < chunks.length
          ? '正在翻第 ' + (last + 2) + ' 段…'
          : (fail.some(Boolean)
            ? '有 ' + fail.filter(Boolean).length + ' 段没译成，可以重译'
            : (trunc.some(Boolean)
              ? '有 ' + trunc.filter(Boolean).length + ' 段没译完（模型输出被截断了），可以重译或把这段拆短些'
              : (notText ? '有一段不像正常文字，没翻' : ''))));
      }
      if (nearBottom || firstRender) ui.body.scrollTop = ui.body.scrollHeight;
      firstRender = false;
    };

    /* 同时开 CHUNK_PARALLEL 条流水线。第 0 段最先发、也按顺序显示，
       所以「看到第一句」的等待就是一段的时间，不是整篇的时间。 */
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= chunks.length || my !== seq) return;
        let r = null;
        try {
          r = await ask({
            type: 'translate', text: chunks[i].t,
            partIndex: i + 1, partCount: chunks.length, srcHint: srcHint,
            mode: answering ? 'answer' : (terming ? 'term' : 'translate'),
            explain: explaining ? 1 : 0,
            host: HOSTNAME
          });
        } catch (e) { r = null; }
        if (my !== seq) return;
        const got = (r && r.ok) ? ((answering || terming) ? r.answer : r.translated) : null;
        if (got) {
          out[i] = String(got);
          okCount++;
          if (r && r.truncated) trunc[i] = true;
          if (!meta) meta = r;
        } else if (r && r.notText) {
          /* 模型说这不像文字。不算错，也不算译成：照实把话撂下，
             不编一个像样的译文骗自己。 */
          notText = true;
          out[i] = '［' + (r.error || '这段看着不像正常文字，没有翻。') + '］';
        } else {
          fail[i] = (r && r.error) || '没有回应';
          out[i] = '［第 ' + (i + 1) + ' 段没译成：' + fail[i] + '］';
        }
        if (!anyMeta && r) anyMeta = r;
        render();
      }
    };

    await Promise.all(Array.from({ length: Math.min(CHUNK_PARALLEL, chunks.length) }, worker));
    if (my !== seq) return;
    busy = false;

    /* 方向与引擎名：能用第一个成功的响应，就它的；全没成也用它把方向显示出来 */
    /* ⚠️ 这个变量千万别叫 show / hide / build —— 会把同名的函数遮蔽掉，
       TDZ 直接炸掉整条链路（踩过：ReferenceError: Cannot access 'show' before initialization）。 */
    const metaShow = meta || anyMeta;
    if (metaShow) {
      ui.dir.textContent = metaShow.dir || (answering ? '答题' : (terming ? '术语' : '译'));
      ui.engine.textContent = (metaShow.engine || '') + (!answering && multi ? ' · ' + chunks.length + ' 段' : '');
    }
    if (!okCount && !notText && fail.some(Boolean)) {
      ui.dst.className = 'st-dst is-error';
      setPending('');
      ui.dst.textContent = (multi ? '整篇都没译成：' : '翻译失败：') + fail.filter(Boolean)[0];
      return;
    }
    if (!okCount) ui.dst.className = 'st-dst is-error';
    render();
    /* 降级了就得说一声：悄悄换引擎比报错更坑人 */
    if (metaShow && metaShow.degraded) setPending(metaShow.degraded);
  }

  function onFootClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const dst = ui.dst.textContent || '';
    const mine = ui.input.value || '';
    const flash = t => { ui.toast.textContent = t; setTimeout(() => { ui.toast.textContent = ''; }, 1400); };
    if (act === 'copy-dst') {
      if (!dst || dst === '翻译中…') return;
      copyText(dst).then(ok => flash(ok ? '译文已复制' : '复制失败'));
    } else if (act === 'dst-to-write') {
      if (!dst || dst === '翻译中…') return;
      ui.input.value = dst;
      ui.input.focus();
      flash('已放进写作框');
    } else if (act === 'src-to-write') {
      /* 取字认出来是乱码时，译文没用了，但原文还得能顺手拿走（验证码之类） */
      const s = ui.src.textContent || '';
      if (!s || s.charAt(0) === '（') { flash('原文是空的'); return; }
      ui.input.value = s;
      ui.input.focus();
      flash('已放进写作框');
    } else if (act === 'copy-mine') {
      if (!mine.trim()) { flash('写作框是空的'); return; }
      copyText(mine).then(ok => flash(ok ? '已复制你写的' : '复制失败'));
    } else if (act === 'explain') {
      /* 做题模式下多出来的那颗：同一个模式，把「要不要解析」翻个面重跑 */
      if (lastMode !== 'answer' || !lastText) { flash('先划一道题'); return; }
      run(lastText, host.getBoundingClientRect(), true, 'answer', !lastExplain);
    } else if (act === 'retrans') {
      if (lastText) run(lastText, host.getBoundingClientRect(), true, lastMode);
    } else if (act === 'as-question') {
      /* 写框里有字就用它（可以手打或粘贴题目），否则拿刚划中的那段当题干 */
      const q = (ui.input.value || '').trim() || lastText;
      if (!q || q === '翻译中…' || q === '取字中…') { flash('先划一段题目'); return; }
      run(q, host.getBoundingClientRect(), true, 'answer');
    }
  }

  /* ---------------- OCR：双击图片 / 手动框选 / DOM 抠字 ---------------- */

  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('截图解码失败'));
      im.src = src;
    });
  }

  /* 在可视区里找一块「像图」的元素。
     只认真正的图片元素（img/canvas/video/svg），带背景图的大容器要卡得很紧。
     旧版把背景图容器的面积上限放到视口的 85%，一裁就是半屏，
     连浮层自己都会被拍进去——那正是「越认越长」的源头。 */
  const IMG_TAGS = { IMG: 1, CANVAS: 1, VIDEO: 1, SVG: 1, OBJECT: 1, PICTURE: 1 };

  function findImageHost(start) {
    let n = start, hops = 0;
    const vp = innerWidth * innerHeight;
    let bgCandidate = null;
    while (n && n.nodeType === 1 && hops < 6) {
      const r = n.getBoundingClientRect();
      const area = r.width * r.height;
      const usable = r.width >= 12 && r.height >= 12;
      if (IMG_TAGS[n.tagName]) {
        /* canvas 本身就是「画出来的面」，不设面积上限——考试系统有时整屏就是一块 canvas，
           卡在 85% 会把最该取的那块整个漏掉。别的图片元素仍然卡着（背景图容器更紧）。 */
        if (usable && (n.tagName === 'CANVAS' || area <= vp * 0.85)) return n;
      } else if (!bgCandidate) {
        try {
          const bg = getComputedStyle(n).backgroundImage;
          if (bg && bg.indexOf('url(') !== -1 && usable && area <= vp * 0.3) bgCandidate = n;
        } catch (e) {}
      }
      n = n.parentElement; hops++;
    }
    return bgCandidate;
  }

  async function captureAndCrop(rect) {
    /* 浮层自己不能进镜头。它是屏幕上最清楚、最大号的一块文字，
       一旦被拍进去，OCR 就会把上面印着的上一轮结果再念一遍：
       越认越长，还认得像模像样。 */
    const prevVis = host && host.style.visibility;
    if (host && prevVis === 'visible') {
      host.style.visibility = 'hidden';
      await new Promise(r => setTimeout(r, 90));
    }
    let resp;
    try {
      resp = await ask({ type: 'capture' });
    } finally {
      if (host && prevVis === 'visible') host.style.visibility = 'visible';
    }
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || '截图失败');
    const im = await loadImage(resp.dataUrl);
    const dpr = window.devicePixelRatio || 1;
    const sx = Math.max(0, Math.round(rect.left * dpr));
    const sy = Math.max(0, Math.round(rect.top * dpr));
    const sw = Math.max(1, Math.min(im.width - sx, Math.round(rect.width * dpr)));
    const sh = Math.max(1, Math.min(im.height - sy, Math.round(rect.height * dpr)));
    if (sw < 4 || sh < 4) throw new Error('这块不在可视区里，先把它滚到屏幕里');
    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    cv.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
    return {
      dataUrl: cv.toDataURL('image/png'),
      info: '截图 ' + im.width + '×' + im.height + ' · dpr ' + dpr +
            ' · 裁 (' + sx + ',' + sy + ') ' + sw + '×' + sh +
            ' · 视口 ' + innerWidth + '×' + innerHeight
    };
  }

  /* OCR 前先把图理一理。
     网页标题常是彩色加粗字，灰度化后彼此挨得太近，直接丢给 Tesseract 会糊成一团
     （同一行字实测准度 26）。做两件事：把对比度拉满、小图放大一倍——实测能到 49，
     「网上共青团」「团建」都出来了。
     不做二值化：这种低对比度的字一被切成黑白两色，笔画会直接消失（实测反而降到 28）。 */
  async function preprocess(dataUrl) {
    try {
      const im = await loadImage(dataUrl);
      let scale = 1;
      const big = Math.max(im.width, im.height);
      if (big < 700) scale = 2;
      if (big * scale > 2400) scale = 1;
      const w = Math.max(1, Math.round(im.width * scale));
      const h = Math.max(1, Math.round(im.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(im, 0, 0, w, h);

      const id = ctx.getImageData(0, 0, w, h);
      const d = id.data;
      const n = w * h;
      const gray = new Uint8Array(n);
      const hist = new Uint32Array(256);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const g = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000 | 0;
        gray[i] = g;
        hist[g]++;
      }
      /* 找真正的黑与白：两端各捨掉 1% 的极端像素，不被几个噪点带偏 */
      const cut = Math.max(1, Math.floor(n * 0.01));
      let lo = 0, hi = 255, acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
      acc = 0;
      for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }

      let note = '';
      if (hi - lo >= 16) {
        const k = 255 / (hi - lo);
        for (let i = 0; i < n; i++) {
          let v = (gray[i] - lo) * k;
          v = v < 0 ? 0 : v > 255 ? 255 : v;
          const p = i * 4;
          d[p] = d[p + 1] = d[p + 2] = v;
          d[p + 3] = 255;
        }
        ctx.putImageData(id, 0, 0);
        note = '拉对比 ' + lo + '→' + hi + (scale !== 1 ? ' · 放大 ' + scale + 'x' : '');
      } else if (scale !== 1) {
        note = '放大 ' + scale + 'x';
      }
      return { dataUrl: cv.toDataURL('image/png'), note: note };
    } catch (e) {
      return { dataUrl: dataUrl, note: '' };
    }
  }

  async function runOcr(rect, tag) {
    build();
    const my = ++seq;
    busy = true;
    lastText = '';
    ui.src.textContent = '（正在看图…）';
    ui.dst.className = 'st-dst is-pending';
    ui.dst.textContent = '取字中…';
    ui.dir.textContent = '取字';
    ui.status.textContent = tag ? '· ' + tag : '';
    ui.engine.textContent = 'Tesseract（本地）';
    setPending('');
    ui.input.value = '';
    ui.toast.textContent = '';
    ui.toast.textContent = '';
    place(toViewport(rect));
    show();

    let shot;
    try {
      shot = await captureAndCrop(toViewport(rect));
    } catch (e) {
      if (my !== seq) return;
      busy = false;
      ui.dst.className = 'st-dst is-error';
      ui.dst.textContent = '取字失败：' + ((e && e.message) || e);
      return;
    }

    /* 把「到底取到了哪一块」摊在眼前：取错的时候看一眼就知道，
       不用再截屏来问人。 */
    if (ui.shot && ui.shotSec) {
      ui.shot.src = shot.dataUrl;
      ui.shotSec.classList.add('on');
      ui.shotInfo.textContent = shot.info;
    }
    const pre = await preprocess(shot.dataUrl);
    if (my !== seq) return;
    if (ui.shotInfo) ui.shotInfo.textContent = shot.info + (pre.note ? ' · ' + pre.note : '');

    const ocr = await ask({ type: 'ocr', image: pre.dataUrl });
    if (my !== seq) return;
    if (!ocr || !ocr.ok) {
      busy = false;
      ui.dst.className = 'st-dst is-error';
      ui.dst.textContent = '识别失败：' + ((ocr && ocr.error) || '没有回应');
      return;
    }
    const conf = (ocr.conf != null) ? Math.round(ocr.conf) : null;
    ui.engine.textContent = 'Tesseract（本地）' + (conf != null ? ' · 准度 ' + conf : '');
    if (ui.shotInfo && conf != null) ui.shotInfo.textContent = shot.info + ' · 准度 ' + conf;
    const text = (ocr.text || '').trim();
    ui.src.textContent = text || '（没认到字）';
    if (!text) {
      busy = false;
      ui.dst.className = 'st-dst is-error';
      ui.dst.textContent = '这块图里没认到文字。';
      return;
    }
    /* 认不准就直说。一个低准度的结果比没有结果更容易坑人。 */
    if (conf != null && conf < 50) {
      setPending('这次认得不准（准度 ' + conf + '），结果只能当参考');
    }

    lastText = text;
    ui.dst.className = 'st-dst is-pending';
    ui.dst.textContent = '翻译中…';
    const resp = await ask({
      type: 'translate', text: text,
      mode: modeOf(S.actionMode),
      host: HOSTNAME
    });
    if (my !== seq) return;
    busy = false;
    if (!resp || !resp.ok) {
      ui.dst.className = 'st-dst is-error';
      ui.dir.textContent = (resp && resp.dir) || '译';
      ui.dst.textContent = (resp && resp.notText)
        ? (resp.error || '这段看着不像正常文字，没有翻。')
        : '翻译失败：' + ((resp && resp.error) || '没有回应');
      return;
    }
    /* 取字也可能处在做题 / 术语模式：各自单独摆，不混在译文里 */
    if (resp.mode === 'answer' || resp.mode === 'term') {
      lastMode = resp.mode;
      syncMode();
      ui.dir.textContent = resp.dir || (resp.mode === 'answer' ? '答题' : '术语');
      ui.engine.textContent = resp.engine || '';
      paintSpecial(resp);
      return;
    }
    ui.dir.textContent = resp.dir || '译';
    ui.engine.textContent = resp.engine || '';
    ui.dst.className = 'st-dst';
    ui.dst.textContent = resp.translated || '';
    if (resp.truncated) setPending('这次没输出完（模型被截断了），可以重译一次');
  }

  /* CSS 禁选的文字：不用 OCR，直接从 DOM 抠 */
  function domTextAt(x, y) {
    let n = document.elementFromPoint(x, y), hops = 0;
    while (n && n.nodeType === 1 && hops < 4) {
      let cs = null;
      try { cs = getComputedStyle(n); } catch (e) {}
      if (cs && (cs.userSelect === 'none' || cs.webkitUserSelect === 'none')) {
        const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length >= 2 && t.length <= 600) return t;
      }
      n = n.parentElement; hops++;
    }
    return '';
  }

  /* 拖过的那一块是不是「画出来的面」。
     考试系统爱把题画在 <canvas> 上（有的连正文都是画上去的），页面上根本没有
     可选中的文本——选不中不等于没有东西。这里只做判定，取字交给 runOcr。 */
  function drawnSurfaceAt(rect) {
    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    const pts = [{ x: cx, y: cy }, { x: rect.left + 2, y: rect.top + 2 }, { x: rect.right - 2, y: rect.bottom - 2 }];
    for (const p of pts) {
      let n = null;
      try { n = document.elementFromPoint(p.x, p.y); } catch (e) {}
      let hops = 0;
      while (n && n.nodeType === 1 && hops < 5) {
        if (IMG_TAGS[n.tagName]) return n;
        n = n.parentElement; hops++;
      }
    }
    return null;
  }

  /* 拖了一整片却一个字都没选到——把这条路摆到她面前，别让她以为工具没反应。 */
  function showDrawnHint(rect) {
    build();
    if (!host) return;
    pendingRect = rect;                       // 记着这一块，「取这块的字」要用
    ui.dir.textContent = '取字';
    ui.engine.textContent = '';
    ui.status.textContent = '';
    ui.toast.textContent = '';
    ui.src.textContent = '';
    ui.input.value = '';
    if (ui.shotSec) ui.shotSec.classList.remove('on');
    ui.dst.className = 'st-dst is-hint';
    ui.dst.innerHTML =
      '这一块的字是<b>画上去的</b>，在页面上选不中。' +
      '<div class="st-hintrow"><button class="st-hintbtn" data-hint="ocr">取这块的字</button></div>';
    setPending('也可以直接双击那块图，或者点工具栏图标自己框一块。');
    place(toViewport(rect));
    show();
  }

  /* 手动框选 */
  let pickEl = null;
  let pendingRect = null;
  function startPick() {
    if (pickEl) return;
    pickEl = document.createElement('div');
    pickEl.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;' +
      'background:rgba(20,18,15,.14);backdrop-filter:saturate(.6)';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #d69b58;background:rgba(214,155,88,.14);' +
      'box-shadow:0 0 0 9999px rgba(20,18,15,.14);display:none;pointer-events:none';
    pickEl.appendChild(box);
    document.documentElement.appendChild(pickEl);

    let sx = 0, sy = 0, dragging = false;
    const mm = (e) => {
      if (!dragging) return;
      const l = Math.min(sx, e.clientX), t = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      box.style.display = 'block';
      box.style.left = l + 'px'; box.style.top = t + 'px';
      box.style.width = w + 'px'; box.style.height = h + 'px';
    };
    const cleanup = () => {
      document.removeEventListener('mousemove', mm, true);
      document.removeEventListener('mousedown', md, true);
      document.removeEventListener('mouseup', mu, true);
      document.removeEventListener('keydown', kd, true);
      if (pickEl && pickEl.parentNode) pickEl.parentNode.removeChild(pickEl);
      pickEl = null;
    };
    const kd = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); } };
    const md = (e) => { e.preventDefault(); e.stopPropagation(); sx = e.clientX; sy = e.clientY; dragging = true; mm(e); };
    const mu = (e) => {
      e.preventDefault(); e.stopPropagation();
      const l = Math.min(sx, e.clientX), t = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      cleanup();
      if (w < 12 || h < 12) return;              // 太小当误触
      runOcr({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h }, '框选取字');
    };
    document.addEventListener('mousemove', mm, true);
    document.addEventListener('mousedown', md, true);
    document.addEventListener('mouseup', mu, true);
    document.addEventListener('keydown', kd, true);
  }

  /* ---------------- 事件 ---------------- */
  let downPt = null;
  document.addEventListener('mousedown', e => {
    downPt = { x: e.clientX, y: e.clientY };
  }, true);

  document.addEventListener('mouseup', e => {
    if (!S.enabled) return;
    if (insideHost(e.target)) return;
    const up = { x: e.clientX, y: e.clientY };
    const down = downPt; downPt = null;
    setTimeout(() => {
      const info = selectionInfo();

      /* 选得比上限还长：不要默默什么都不发生，直接告诉她往哪儿调。 */
      if (info && info.tooLong) {
        build();
        ui.status.textContent = '';
        setPending('');
        ui.src.textContent = '';
        ui.dst.className = 'st-dst is-error';
        ui.dst.textContent = '这段太长了：' + info.tooLong + ' 字符，当前上限 ' + info.cap +
          '。去设置页把「最长划词」调大，或者分两次选。';
        place(info.rect); show(); return;
      }

      if (info && info.text) {
        if (!S.autoTranslate) {
          build();
          setPending('');
          ui.src.textContent = info.text;
          ui.dst.className = 'st-dst is-pending';
          ui.dst.textContent = '（已关闭自动翻译）';
          place(info.rect); show(); return;
        }
        run(info.text, info.rect, false, S.actionMode === 'answer' ? 'answer' : 'translate');
        return;
      }

      // 没选中：看是不是“想选但选不到”
      const dragged = down && (Math.abs(up.x - down.x) > 18 || Math.abs(up.y - down.y) > 18);
      if (!dragged) { hide(); return; }
      const dragRect = {
        left: Math.min(down.x, up.x), top: Math.min(down.y, up.y),
        width: Math.abs(up.x - down.x), height: Math.abs(up.y - down.y),
        right: Math.max(down.x, up.x), bottom: Math.max(down.y, up.y)
      };
      const dt = domTextAt(up.x, up.y);
      if (dt) { run(dt, dragRect); return; }
      /* 拖了一整片、一个字都没选到：先别当成什么都没发生。
         这块很可能是画出来的字（canvas / 图片），以前这里直接 hide()，
         她只会觉得「这插件没反应」——那正是最该给个说法的时候。 */
      if (S.ocrOnDblclick && drawnSurfaceAt(dragRect)) { showDrawnHint(dragRect); return; }
      hide();
    }, 12);
  }, true);

  /* 双击图片 → 自动取字 */
  /* 但图片常常被包在 <a> 里，第一次点击就会跳走。
     所以对“链接里的图”先扣住 300ms：等不到第二次点击才照原样跳过去。 */
  let pendingNav = null;
  function cancelPendingNav() {
    if (pendingNav) { clearTimeout(pendingNav); pendingNav = null; }
  }

  document.addEventListener('click', e => {
    if (!S.enabled || !S.ocrOnDblclick) return;
    if (insideHost(e.target)) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!e.target || !e.target.closest) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.charAt(0) === '#' || raw.toLowerCase().indexOf('javascript:') === 0) return;
    if (a.hasAttribute('download')) return;
    if (!findImageHost(e.target)) return;          // 只对“图”这么做
    const abs = a.href;
    const blank = (a.target || '').toLowerCase() === '_blank';
    e.preventDefault();
    e.stopPropagation();
    cancelPendingNav();
    pendingNav = setTimeout(() => {
      pendingNav = null;
      try { if (blank) window.open(abs, '_blank'); else location.href = abs; } catch (_) {}
    }, 300);
  }, true);

  document.addEventListener('dblclick', e => {
    if (!S.enabled || !S.ocrOnDblclick) return;
    if (insideHost(e.target)) return;
    /* 双击常常就是「选一个词」。真选到文字了，就别再走 OCR 那条路——
       整屏垫一块 canvas 的页面上，那会把整页拍一遍。 */
    try {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim()) return;
    } catch (err) {}
    const host = findImageHost(e.target);
    if (!host) return;
    cancelPendingNav();                            // 双击成立 → 不跳转，改成取字
    e.preventDefault();
    e.stopPropagation();
    const r = host.getBoundingClientRect();
    runOcr({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }, '双击图片');
  }, true);

  /* 工具栏图标 → 进入框选取字 */
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === 'pick' && S.enabled !== false) startPick();
  });

  document.addEventListener('mousedown', e => {
    if (insideHost(e.target)) return;
    clearTimeout(hideTimer);          // ← 不先清掉，双击时上一个定时器会在浮层刚显示后触发
    hideTimer = setTimeout(() => hide(), 180);
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && host && host.style.visibility === 'visible') hide(true);
  }, true);

  /* 窗口尺寸变了不自动关浮层（它在 fixed 定位下自己会待在原处） */

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    Object.keys(ch).forEach(k => { S[k] = ch[k].newValue; });
    if (!S.enabled) hide();
    if (S.orb) buildOrb(); else hideOrb();
    /* 主题改了就地更新，不用等浮层重建 */
    if (ch.panelTheme && panel) panel.setAttribute('data-theme', S.panelTheme === 'dark' ? 'dark' : 'light');
  });

  storeGet().then(v => {
    S = Object.assign({}, DEFAULTS, v);
    if (S.orb) buildOrb();
    /* 预热只在顶层做一次，别让每个 iframe 都去喊一遍 */
    if (S.ocrOnDblclick && !IN_FRAME) setTimeout(() => ask({ type: 'ocrWarmup' }), 2500);
  });
})();
