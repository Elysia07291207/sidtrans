/* 旁译 · SideTrans — background（Firefox MV3 事件页）
 * 职责：语言判定 → 选方向 → 调引擎 → 回给内容脚本
 */

const DEFAULTS = {
  enabled: true,
  engine: 'mymemory',        // mymemory | openai | local
  targetMode: 'auto',        // auto（双向） | zh | en
  autoTranslate: true,
  actionMode: 'translate',   // translate（划词就译）| answer（划词当题做）| term（术语）
  answerExplain: 'off',      // 做题要不要解析：off（只给答案，默认）| on（答案 + 逐空解析）
  transStyle: 'daily',       // daily（日常）| lit（笔译赛风格）
  maxLen: 8000,
  ocrOnDblclick: true,       // 双击图片自动取字
  panelTheme: 'light',       // 浮层主题：light（暖白奶油，默认）| dark（暖黑 + 金色）
  ocrLangs: ['chi_sim', 'eng'],
  openai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    prompt: ''
  },
  local: {
    url: 'http://127.0.0.1:8787/translate'
  }
};

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, v => resolve(Object.assign({}, DEFAULTS, v || {})));
  });
}

/* ---------- 本地错误日志 ----------
   出问题的时候我这边什么都看不到，只能猜。
   只记「哪一步、什么错、页面结构摘要」，**绝不记内容**（不记题目、不记译文）。 */
function noteFail(step, detail, extra) {
  try {
    chrome.storage.local.get(['errlog'], v => {
      const arr = Array.isArray(v && v.errlog) ? v.errlog : [];
      arr.push(Object.assign({
        t: Date.now(), step: String(step || '?'), d: String(detail == null ? '' : detail).slice(0, 240)
      }, extra || {}));
      chrome.storage.local.set({ errlog: arr.slice(-60) });   /* 只留最近 60 条 */
    });
  } catch (e) {}
}

/* ---------- 结果缓存 ----------
   同一段反复翻，不必反复花钱、反复等。十分钟内同一请求直接给旧结果。 */
const CACHE_TTL = 10 * 60 * 1000;
function hkey(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '_' + s.length;
}
function cacheLook(key) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(['xcache'], v => {
        const c = (v && v.xcache) || {};
        const it = c[key];
        if (it && Date.now() - it.t < CACHE_TTL) resolve(it.v); else resolve(null);
      });
    } catch (e) { resolve(null); }
  });
}
function cachePut(key, val) {
  try {
    chrome.storage.local.get(['xcache'], v => {
      let c = (v && v.xcache) || {};
      const now = Date.now();
      /* 先清过期的，再写入；总量封顶 120 条，从最早的开始扔 */
      const keys = Object.keys(c).filter(k => now - c[k].t < CACHE_TTL);
      const next = {};
      keys.forEach(k => { next[k] = c[k]; });
      const all = Object.keys(next);
      if (all.length >= 120) {
        all.sort((a, b) => next[a].t - next[b].t).slice(0, all.length - 119).forEach(k => { delete next[k]; });
      }
      next[key] = { t: now, v: val };
      chrome.storage.local.set({ xcache: next });
    });
  } catch (e) {}
}

/* ---------- 语言判定：中日韩表意文字 vs 拉丁字母 ---------- */
function detectLang(s) {
  const cjk = (s.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  if (cjk === 0 && latin === 0) return 'unknown';
  return cjk >= latin ? 'zh' : 'en';
}

/* ---------- 方向：auto 就是「双向自动切换」 ---------- */
function pairFor(src, mode) {
  if (mode === 'zh') return { from: src === 'zh' ? 'zh-CN' : 'en', to: 'zh-CN' };
  if (mode === 'en') return { from: src === 'zh' ? 'zh-CN' : 'en', to: 'en' };
  if (src === 'zh') return { from: 'zh-CN', to: 'en' };
  return { from: 'en', to: 'zh-CN' };
}

const LANG_NAME = { en: 'English', 'zh-CN': '简体中文', zh: '简体中文' };

/* 做题模式：考试场景，只要答案。
   两行输出——第一行答案，第二行用 u 标出没把握的题号。
   标记不确定的题不是解释，是让她把注意力放到那几道上。 */
const ANSWER_SYS = [
  '你是英语考试的答题助手。用户给你的是一道英语客观题（完形填空或选词填空）的题干与选项。',
  '',
  '只输出答案，两行，不要第三个字的多余内容：不要解释、不要分析、不要复述题目。',
  '',
  '第一行 = 答案：',
  '· 选项是 A/B/C/D 这类字母时，按空号从小到大的顺序直接连成一串，如 BDACA；每 5 个字母空一格，如 BDACA CADCB。',
  '· 是从词库里选词填空（要填单词）时，按「空号 单词」依次写，如 1 range 2 subtle 3 deny。',
  '· 只答用户给出的空，不要自己添加题目里没有的空。',
  '',
  '第二行 = 没有十足把握的空号，以 u 开头，如 u 3 7；全部有把握就只写 u。',
  '',
  '拿不准也必须给出答案。绝不允许输出“不确定”“无法判断”“信息不足”这类话。'
].join('\n');

/* 做题 + 解析（可选）。默认是关的：考试时她只要那一眼答案，
   解析是她想弄懂这道题时才要——多花一份 token 与时间，所以得她点头。
   刻意写成独立一套，不在 ANSWER_SYS 上追加：那句话明写着「不要第三个字」，
   追加会让两条规则打架。 */
const ANSWER_EXPLAIN_SYS = [
  '你是英语考试的答题助手。用户给你的是一道英语客观题（完形填空或选词填空）的题干与选项。',
  '',
  '输出分三段，顺序固定，不要加其它内容：',
  '',
  '第一行 = 答案：选项是 A/B/C/D 这类字母时，按空号从小到大连成一串，如 BDACA，每 5 个字母空一格；',
  '是从词库里选词填空（要填单词）时，按「空号 单词」依次写，如 1 range 2 subtle 3 deny。',
  '第二行 = 没有十足把握的空号，以 u 开头，如 u 3 7；全部有把握就只写 u。',
  '第三行开始 = 另起一段，先写「解析：」，然后每个空占一行，写成「3. 选 C。…」。',
  '',
  '解析用中文，每个空一句，只讲判断依据（词义、固定搭配、语法或上下文线索），',
  '不要复述题目、不要展开成段、不要写「综上所述」这类废话。',
  '',
  '拿不准也必须给出答案。绝不允许输出“不确定”“无法判断”“信息不足”这类话。'
].join('\n');

/* 术语模式（省赛 / 笔译赛）：一个中文术语 → 译法 + 备选 + 说明。
   笔译赛里术语的官方译法就是硬分，所以「译法」必须独立成行、摆在最前。 */
const TERM_SYS = [
  '你是“理解当代中国”英语笔译赛的术语助手。用户会给你一个中文术语、专名或一整段话。',
  '',
  '严格只输出三行，除这三行外不要任何多余的字：',
  '译法：<见下面的两种情形>',
  '备选：<其他通行译法，用 / 分隔；确实没有就写「无」>',
  '说明：<一到两句中文：概念指什么，以及英文里怎么用（冠词、单复数、固定搭配、能否缩略）>',
  '',
  '「译法」行的两种情形：',
  '· 用户给的是单个术语 / 专名 → 只写一条英文译法。',
  '· 用户给的是**一整段话** → 先把其中需要术语化处理的表达逐个列出，',
  '  格式「原词 → 英文译法」，用「；」分隔（最多 8 条）；',
  '  这时「说明」行改为：给一句这句整体的翻译建议（语气、可拆可合的地方）。',
  '',
  '如果用户给的是英文，就把「译法」换成对应的中文说法，其余同理。',
  '拿不准官方译法时，给最接近的通行译法，不要编造不存在的表达。'
].join('\n');

/* 笔译赛风格：考的是「像不像英语该有的样子」，不是意思对不对。
   只在 style === 'lit' 时追加，日常翻译不受影响。 */
const LIT_STYLE = [
  '',
  '【笔译赛标准】',
  '· 以英语读者的阅读习惯为第一优先，不要保留中文的句式结构。',
  '· 避免逐词对应：该拆句就拆句，该合句就合句，主谓宾按英语习惯重排。',
  '· 用词偏书面正式，不用口语与缩写；但也不堆砌生僻词。',
  '· 专名、术语用通行译法；首次出现且读者可能不熟时，可用括号补原文。',
  '· 中文里常见的四字并列、排比堆砌，译成英语时应适当合并，不要逐个对应。',
  '· 仍然只输出译文，不要加任何注释或说明。'
].join('\n');

/* 模型用它回答「这不是文字」。宽松匹配：模型有时候会多写几个空格或换个大小写。 */
const NOT_TEXT_RE = /\[\[\s*NOT[\s_-]*TEXT\s*\]\]/i;
const NOT_TEXT_MSG = '这段看着不像正常的文字（可能是验证码、乱码或字符串），我没有翻。原文留在上面，自己核对一下更稳。';
function dirLabel(from, to) {
  const a = from === 'en' ? '英' : '中';
  const b = to === 'en' ? '英' : '中';
  return a + ' → ' + b;
}

/* ---------- 引擎 1：MyMemory（免费在线，无需 key） ---------- */
async function engineMyMemory(text, from, to) {
  const url = 'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) + '&langpair=' + encodeURIComponent(from + '|' + to);
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) throw new Error('MyMemory HTTP ' + r.status);
  const j = await r.json();
  const t = j && j.responseData && j.responseData.translatedText;
  if (!t) throw new Error('MyMemory 没有返回译文');
  return { text: String(t), engine: 'MyMemory' };
}

/* ---------- 引擎 2：OpenAI 兼容接口（BYOK） ---------- */
async function engineOpenAI(text, from, to, cfg, part, total, mode, style, explain) {
  if (!cfg || !cfg.baseUrl) throw new Error('没有配置 API 地址');
  if (!cfg.apiKey) throw new Error('没有填 API Key');
  const answering = mode === 'answer';
  const terming = mode === 'term';
  let sys;
  if (answering) {
    sys = explain ? ANSWER_EXPLAIN_SYS : ANSWER_SYS;
  } else if (terming) {
    sys = TERM_SYS;
  } else {
    /* 预设 / 自定义提示词是「角色与文风」，不是把整套规矩换掉。
       自带的硬要求（翻成哪个语言、只输出译文、乱码不硬翻、分段说明）永远叠在它后面——
       否则选一个预设就会把「乱码不硬翻」这类底线一起顶掉。 */
    const role = (cfg.prompt || '').trim();
    sys = (role ? role + '\n\n' : '你是专业翻译。') +
      '把用户给出的文本翻译成' + (LANG_NAME[to] || to) +
      '。只输出译文本身：不要解释、不要引号、不要原文、不要注释。';
    /* 乱码硬翻会输出一句通顺的假话——比空白更坑人：她会以为认对了。
       所以宁可让模型说「这不是文字」。 */
    sys += '\n\n如果输入根本不是可翻译的文字（验证码、乱码、随机字符、密钥串、' +
      '纯代码或数据），不要猜、不要编、不要凑一个像样的译文，只输出这一个标记：' +
      '[[NOT_TEXT]]。判断拿不准时，按正常文字翻译。';
    if (style === 'lit') sys += '\n' + LIT_STYLE;
    /* 一篇文章被切成几段分别翻时，得把「这不是完整的一篇」说清楚，
       否则模型容易自作主张补上下文，或者把残句补圆。 */
    if (part >= 1 && total > 1) {
      sys += '\n\n【分段说明】这是同一篇文章被切开后的第 ' + part + '/' + total + ' 段，' +
        '不是独立的一篇。保持术语、人名、专名和语气与全文一致；' +
        '不要补写、不要总结、不要加过渡句，只把这一段译出来；' +
        '若本段首尾不足一句（被切断的），照原文直译就行，不要把它补完整。';
    }
  }
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: text }
    ],
    temperature: (answering || terming) ? 0 : 0.2,
    stream: false
  };
  /* ⚠️ 不要在这里卡 max_tokens。
     卡过 400，本意是「答案就几个字，别多吐」——但 cn:deepseek-v4.1-flash 这类「会思考」的模型，
     思考也算在 max_tokens 里：实测 400 和 2000 都被思考吃光，finish_reason=length、content 空，
     于是回一句「API 没有返回内容」。不设上限时才拿到正文
     （thinking 2100 + 正文 "A\nu 1"，finish_reason=stop）。
     翻译那条路一直没设上限，所以它没事——这就是「翻译正常、做题失败」的根源。 */
  const r = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey
    },
    body: JSON.stringify(body)
  });
  const raw = await r.text();
  if (!r.ok) throw new Error('API HTTP ' + r.status + '：' + raw.slice(0, 140));
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error('API 返回不是 JSON：' + raw.slice(0, 140)); }
  const ch0 = j.choices && j.choices[0];
  const t0 = ch0 && ch0.message && ch0.message.content;
  if (!t0) {
    /* 正文空、思考非空 = 预算全花在思考上了。说清楚，别让她以为是自己配错了。 */
    const think = ch0 && ch0.message && ch0.message.reasoning_content;
    if (ch0 && ch0.finish_reason === 'length' && think) {
      throw new Error('模型把回复长度全用在思考上了，正文一个字没留下（换个不带思考的模型，或者把这一段拆短些）');
    }
    throw new Error('API 没有返回内容');
  }
  const raw0 = String(t0).trim();
  /* finish_reason=length 的意思是「模型还没写完就被截断了」。
     以前不看它：正文有字就当完整结果端上去——半句译文看上去跟完整译文一模一样。
     现在带回去，让浮层能说一句「这段没译完」。 */
  const truncated = !!(ch0 && ch0.finish_reason === 'length');
  if (NOT_TEXT_RE.test(raw0)) return { text: '', notText: true, engine: cfg.model || 'API' };
  const t = raw0.replace(NOT_TEXT_RE, '').trim();
  if (!t) throw new Error('API 没有返回内容');
  return { text: t, engine: cfg.model || 'API', truncated: truncated };
}

/* ---------- 引擎 3：本地服务（离线，POST {text,from,to}） ---------- */
async function engineLocal(text, from, to, cfg) {
  if (!cfg || !cfg.url) throw new Error('没有配置本地服务地址');
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, from: from, to: to })
  });
  const raw = await r.text();
  if (!r.ok) throw new Error('本地引擎 HTTP ' + r.status + '：' + raw.slice(0, 140));
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error('本地引擎返回不是 JSON'); }
  const t = j.text || j.translated || j.result || j.translation;
  if (!t) throw new Error('本地引擎没有返回译文');
  return { text: String(t), engine: j.engine || '本地模型' };
}

/* ---------- 总入口 ---------- */
async function translate(text, opt) {
  opt = opt || {};
  const s = await getSettings();
  const mode = (opt.mode === 'answer' || opt.mode === 'term') ? opt.mode : 'translate';
  /* 方向按整篇定：内容脚本会把整篇的语言判断传下来，
     免得某一段里数字多了自己翻个方向、整篇中英混杂。 */
  const src = opt.srcHint || detectLang(text);
  const p = pairFor(src, s.targetMode);

  /* 缓存：内容 + 模式 + 风格 + 引擎。命中就直接回，不花钱不等待。 */
  /* 缓存键要把「会影响结果的东西」全带上。以前漏了地址/模型/提示词——
     一键换预设（笔译风格→学术论文）之后，十分钟内旧样式的结果会照旧端上来，
     她会以为预设没生效。实测过才发现这类“看起来没反应”多半是自己把键写简了。 */
  const oc = s.openai || {};
  const ck = hkey([mode, s.transStyle || 'daily', s.engine,
    (mode === 'answer' && opt.explain) ? 'explain' : '',
    s.engine === 'openai' ? ((oc.baseUrl || '') + '|' + (oc.model || '') + '|' + (oc.prompt || '')) : '',
    p.from, p.to, text].join('\u0001'));
  const hit = await cacheLook(ck);
  if (hit) { const h = Object.assign({}, hit); h.cached = true; return h; }

  let out, degraded = '';
  const t0 = Date.now();
  try {
    if (s.engine === 'openai') out = await engineOpenAI(text, p.from, p.to, s.openai, opt.partIndex || 0, opt.partCount || 0, mode, s.transStyle, mode === 'answer' && !!opt.explain);
    else if (s.engine === 'local') out = await engineLocal(text, p.from, p.to, s.local);
    else out = await engineMyMemory(text, p.from, p.to);
  } catch (err) {
    /* 主引擎挂了（断网 / 额度用完 / 服务抖）。考场上这是致命的，不能就这么干等。
       翻译还能退到免费引擎；做题和术语没有免费替代，如实报错。 */
    noteFail('engine', (err && err.message) || err, { mode: mode, engine: s.engine, host: opt.host || '' });
    if (s.engine === 'openai' && mode === 'translate') {
      try {
        const alt = await engineMyMemory(text, p.from, p.to);
        out = { text: alt.text, engine: alt.engine };
        degraded = 'DeepSeek 不通，已自动换免费引擎';
      } catch (err2) {
        noteFail('fallback-fail', (err2 && err2.message) || err2, { mode: mode, host: opt.host || '' });
        /* 两条路都断了。只报第一条会把「网络全断」说成「余额不足」，说得比实情更具体——
           两个事实都留着，让 humanEngineError 能看出是这种情形。 */
        const e2 = new Error('两条路都不通｜API：' + ((err && err.message) || err) +
          '｜免费引擎：' + ((err2 && err2.message) || err2));
        e2.bothFailed = true;
        throw e2;
      }
    } else {
      throw err;
    }
  }
  const ms = Date.now() - t0;

  let res;
  if (mode === 'answer' || mode === 'term') {
    /* 做题/术语里也要认「这不是文字」这个标记：以前只翻译那条看它，
       这几个模式下模型要是回了标记，会直接拿去当答案（空答案）。 */
    if (out && out.notText) {
      res = {
        ok: false, mode: mode, notText: true, error: NOT_TEXT_MSG,
        dir: dirLabel(p.from, p.to), from: p.from, to: p.to, ms: ms
      };
    } else {
      res = {
        ok: true, mode: mode, answer: out.text, engine: out.engine,
        truncated: !!out.truncated,
        dir: mode === 'answer' ? '答题' : '术语', src: src, from: p.from, to: p.to,
        ms: ms, degraded: degraded
      };
    }
  } else if (out && out.notText) {
    res = { ok: false, notText: true, error: NOT_TEXT_MSG, src: src, from: p.from, to: p.to, dir: dirLabel(p.from, p.to), ms: ms };
  } else {
    res = {
      ok: true, src: src, from: p.from, to: p.to, dir: dirLabel(p.from, p.to),
      translated: out.text, engine: out.engine, ms: ms, degraded: degraded,
      truncated: !!out.truncated
    };
  }
  /* 只缓存成功的：失败要么是环境问题，要么下次还得再试 */
  if (res.ok) cachePut(ck, res);
  return res;
}

/* ============================================================
 * OCR（Tesseract.js / WASM，全程本地，不出网、不起进程）
 * ============================================================ */
let ocrWorker = null;
let ocrBooting = null;
/* 让 OCR 能自己说话：加载成没成、认得多准，都带回浮层。
   否则出了问题只能看到一串乱码，没人知道是哪一环断的。 */
const ocrState = { ok: false, error: null, langs: 'chi_sim,eng', bootedAt: 0 };

function getOcrWorker() {
  if (ocrWorker) return Promise.resolve(ocrWorker);
  if (ocrBooting) return ocrBooting;
  const U = (p) => chrome.runtime.getURL(p);
  ocrBooting = (async () => {
    const w = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      workerPath: U('worker.min.js'),
      corePath: U('tesseract-core-simd-lstm.wasm.js'),
      langPath: U('lang'),
      gzip: true,
      workerBlobURL: false           // ← 不这样写会被扩展 CSP 挡掉
    });
    ocrWorker = w;
    ocrBooting = null;
    ocrState.ok = true;
    ocrState.bootedAt = Date.now();
    ocrState.error = null;
    console.log('[旁译] OCR worker 就绪', ocrState);
    return w;
  })().catch(e => {
    ocrBooting = null;
    ocrState.ok = false;
    ocrState.error = String((e && e.message) || e);
    console.error('[旁译] OCR worker 创建失败', ocrState.error);
    throw e;
  });
  return ocrBooting;
}

/* 中文识别会在字间插空格，去掉；保留真正的换行 */
const CJK = '[\\u3400-\\u9fff\\u3040-\\u30ff\\uff00-\\uffef]';
const RE_CJK_SPACE = new RegExp('(' + CJK + ')\\s+(?=' + CJK + ')', 'g');
function tidyOcr(t) {
  return String(t || '')
    .replace(/\r/g, '')
    .replace(RE_CJK_SPACE, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function ocrImage(dataUrl) {
  const w = await getOcrWorker();
  const r = await w.recognize(dataUrl);
  const text = tidyOcr(r && r.data && r.data.text);
  const conf = r && r.data && isFinite(r.data.confidence) ? Number(r.data.confidence) : null;
  return {
    ok: true, text: text, engine: 'Tesseract(本地)',
    conf: conf, langs: ocrState.langs
  };
}

function captureTab() {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!dataUrl) { reject(new Error('截图返回空')); return; }
        resolve(dataUrl);
      });
    } catch (e) { reject(e); }
  });
}

/* ---------- 报错说人话 ----------
   她看到的不是状态码，是「接下来该干嘛」。
   原始返回体不丢（诊断日志里记着），屏幕上只留一句能照做的。
   做题 / 术语没有免费替代——这两条路本来就没退路，得说清楚。 */
function humanEngineError(err, mode) {
  const raw = String((err && err.message) || err || '');
  const noFree = (mode === 'answer' || mode === 'term')
    ? '　（做题和术语没有免费替代，得先让 API 能用。）' : '';
  if (err && err.bothFailed) {
    return 'API 和免费引擎都没通。多半是网络或代理的问题——先确认浏览器能正常打开网页。' + noFree;
  }
  const mc = /API HTTP (\d{3})/.exec(raw);
  const code = mc ? parseInt(mc[1], 10) : 0;
  const low = raw.toLowerCase();
  if (code === 402 || low.indexOf('insufficient balance') !== -1 ||
      low.indexOf('insufficient_quota') !== -1 || low.indexOf('余额') !== -1) {
    return 'API 账户余额不足（402）。去服务商那边充值；只想翻译的话，把引擎切成「免费在线」也能用。' + noFree;
  }
  if (code === 401) return 'API Key 不对或已失效（401）。去设置页换一个。' + noFree;
  if (code === 403) return '这个 Key 没权限或该模型没开（403）。去设置页看一眼。' + noFree;
  if (code === 404) return 'API 地址或模型名不对（404）。核对设置页里的接口地址与模型。' + noFree;
  if (code === 429) return '请求太密被限流了（429）。等十几秒，或者把「最长划词」调小一点。' + noFree;
  if (code >= 500) return '服务商那边出问题了（HTTP ' + code + '）。不是你的错，过一会儿再试。' + noFree;
  if (code) return 'API 返回 HTTP ' + code + '。原始信息：' + raw.replace(/^API HTTP \d+[：:]?/, '').slice(0, 120);
  if (/没有配置 API 地址|没有填 API Key/.test(raw)) return raw;
  if (/failed to fetch|networkerror|network error|load failed|连接|timed ?out/i.test(raw)) {
    return '连不上 API 地址。检查网络或代理；只想翻译的话，把引擎切成「免费在线」。' + noFree;
  }
  if (/MyMemory HTTP \d+/.test(raw)) {
    return '免费引擎那边也不通（' + /MyMemory HTTP \d+/.exec(raw)[0] + '）。等会儿再试，或者把引擎切到 API。';
  }
  return raw.slice(0, 160) + noFree;
}

/* ---------- 消息路由 ---------- */
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  if (!m || !m.type) return;

  if (m.type === 'translate') {
    /* 配着内容脚本的分段走，单次不会超过几百字符；这个上限只是兜底。
       （旧版这里是 4000，长文会被静默砍掉——这是本次修掉的坑之二。） */
    /* 上限跟设置页的「最长划词」对齐（那边最多 20000）。
       以前这里卡 12000：她调到 20000 后，13000–20000 那一段会被静默砍掉。 */
    const text = String(m.text || '').slice(0, 20000);
    if (!text.trim()) { sendResponse({ ok: false, error: '空文本' }); return true; }
    /* 记一笔“最后在哪个站点干过活”——排查时能看出扩展到底进没进过那个页面 */
    try { chrome.storage.local.set({ lastSeen: { host: m.host || '', t: Date.now() } }); } catch (e) {}
    translate(text, {
      srcHint: m.srcHint || '',
      partIndex: m.partIndex || 0,
      partCount: m.partCount || 0,
      mode: m.mode || 'translate',
      explain: m.explain || 0,
      host: m.host || ''
    })
      .then(sendResponse)
      .catch(e => {
        noteFail('translate', String((e && e.message) || e), { mode: m.mode || 'translate', host: m.host || '' });
        sendResponse({ ok: false, error: humanEngineError(e, m.mode || 'translate') });
      });
    return true;
  }

  /* 内容脚本遇到问题时，把“哪一步、什么错、页面结构摘要”交过来记一笔。
     只记结构，不记内容——考试的东西不落盘。 */
  if (m.type === 'note') {
    noteFail(m.step || 'content', m.detail || '', m.extra || {});
    sendResponse({ ok: true });
    return true;
  }

  /* 设置页要导诊断日志 */
  if (m.type === 'getLog') {
    chrome.storage.local.get(['errlog'], v => sendResponse({ ok: true, log: (v && v.errlog) || [] }));
    return true;
  }
  if (m.type === 'clearLog') {
    chrome.storage.local.set({ errlog: [] }, () => sendResponse({ ok: true }));
    return true;
  }

  if (m.type === 'capture') {
    captureTab()
      .then(dataUrl => sendResponse({ ok: true, dataUrl: dataUrl }))
      .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }

  if (m.type === 'ocr') {
    ocrImage(String(m.image || ''))
      .then(r => {
        console.log('[旁译] OCR →', JSON.stringify({ text: r.text, conf: r.conf, langs: r.langs }));
        sendResponse(r);
      })
      .catch(e => {
        console.error('[旁译] OCR 失败:', e);
        sendResponse({ ok: false, error: String((e && e.message) || e), diag: ocrState });
      });
    return true;
  }

  if (m.type === 'ocrWarmup') {
    getOcrWorker()
      .then(() => sendResponse({ ok: true, diag: ocrState }))
      .catch(e => sendResponse({ ok: false, error: String((e && e.message) || e), diag: ocrState }));
    return true;
  }

  if (m.type === 'ocrDiag') {
    sendResponse({ ok: true, diag: ocrState, engine: 'Tesseract(本地)' });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, v => {
    const patch = {};
    Object.keys(DEFAULTS).forEach(k => { if (!(k in (v || {}))) patch[k] = DEFAULTS[k]; });
    /* 旧版把「最长划词 1500」当作默认值写进了 storage。
       光改代码里的默认值覆盖不掉它，这里做一次性迁移，
       否则「改了却没生效」——最费时间的那种坑。 */
    if (v && v.maxLen === 1500) patch.maxLen = DEFAULTS.maxLen;
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
  try {
    chrome.contextMenus.create({ id: 'sidtrans-settings', title: '旁译 · 设置', contexts: ['browser_action'] });
  } catch (e) {}
});

/* 点工具栏图标 → 让当前页进入「框选取字」模式 */
if (chrome.browserAction && chrome.browserAction.onClicked) {
  chrome.browserAction.onClicked.addListener((tab) => {
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { type: 'pick' }, () => { void chrome.runtime.lastError; });
  });
}

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'sidtrans-settings') chrome.runtime.openOptionsPage();
  });
}
