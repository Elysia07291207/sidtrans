/* 旁译 · SideTrans — 设置页 */

const DEFAULTS = {
  enabled: true,
  engine: 'mymemory',
  actionMode: 'translate',
  answerExplain: 'off',
  transStyle: 'daily',
  orb: false,
  targetMode: 'auto',
  autoTranslate: true,
  maxLen: 8000,
  panelTheme: 'light',
  openai: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', prompt: '' },
  local: { url: 'http://127.0.0.1:8787/translate' }
};

const $ = id => document.getElementById(id);

const ENGINE_HINT = {
  mymemory: 'MyMemory 免费接口，不用注册、不用 key，开箱即用。适合应急；量大时会有速率限制，长句质量一般。',
  openai: '任何 OpenAI 兼容接口（DeepSeek / Kimi / 硅基流动 / 本地 Ollama…）。质量最好，需要自己填 key。',
  local: '指向本机的翻译服务。全程离线，文本不出本机 —— 比赛、断网、隐私场景用这个。'
};

let S = JSON.parse(JSON.stringify(DEFAULTS));

/* 常用预设：名字要一眼看懂，内容照样能改。
   选「默认」= 清空这一格，让扩展用它自带的那套。
   注意：这些文本是「角色与文风」，自带的硬要求（翻成哪个语言、只输出译文、
   乱码不硬翻）会叠在它们后面，所以预设不会把底线挤掉。 */
const PROMPT_PRESETS = [
  {
    id: 'none', name: '默认',
    hint: '扩展自带的那套：中英互译、不挑文风。日常用这个就够。',
    text: ''
  },
  {
    id: 'lit', name: '笔译风格',
    hint: '像笔译员那样翻：句子按外语习惯重排、不逐词对应、用词偏书面。笔译赛、正式稿件用这个。',
    text: '【角色】你是一位拥有10年经验的专业笔译员，精通英汉互译，擅长非文学类文本翻译。\n\n' +
      '【要求】按目的语的阅读习惯重排句子，不逐词对应；用词偏书面正式，不口语化、不用缩写；\n' +
      '中文里常见的四字并列、排比堆砌，译成外语时适当合并，不要逐个对应；\n' +
      '专名与术语用通行译法，首次出现且读者可能不熟时用括号补出原文。'
  },
  {
    id: 'academic', name: '学术论文',
    hint: '给论文摘要、引言、方法部分用：术语全文统一、语气克制、长句重组，不增不减。',
    text: '【角色】你是一位学术论文的翻译，熟悉中英文学术写作规范。\n\n' +
      '【要求】术语全文统一，同一个词不要换着译；保持客观克制的语气，避免口语化与修辞；\n' +
      '中文的流水长句按外语习惯拆分或重组，多用被动与名词化结构；\n' +
      '不增不减：原文没有的信息不要补，原文有的限定（如“可能”“初步”）不要删；\n' +
      '公式符号、变量名、单位、图表编号原样保留，不要翻。'
  },
  {
    id: 'tech', name: '技术文档',
    hint: '给代码注释、手册、报错信息用：命令与标识符原样不动，术语按行内叫法。',
    text: '【角色】你是一位技术文档与工程说明的翻译。\n\n' +
      '【要求】命令、代码、标识符、文件路径、URL、版本号原样保留，一个字都不要动；\n' +
      '术语用业内通行叫法，拿不准就保留英文原词并在括号里给中文；\n' +
      '操作步骤按原文顺序，语气直白简洁，不加客套话；\n' +
      '报错信息保留英文原文，后面用括号补中文解释。'
  },
  {
    id: 'casual', name: '日常口语',
    hint: '聊天、社交媒体、台词用这个：说人话，不书面腔，语气留住。',
    text: '【角色】你是一位把话说得自然的人，不做书面腔。\n\n' +
      '【要求】用日常口语，短句为主，不作诗、不堆形容词；\n' +
      '该省的主语就省，该有的语气要留住（惊讶、抱怨、犹豫这些）；\n' +
      '俚语、玩笑、语气换成目的语里的同感说法，不要逐字直译。'
  }
];

/* 支持用链接一键导入配置：
 *   options.html#cfg=<base64url(JSON)>
 * 例如把 {engine:'openai',openai:{baseUrl,apiKey,model}} 编码后贴进 hash，
 * 打开就会自动写进 storage，不用手点。 */
function cfgFromHash() {
  const h = location.hash || '';
  const m = h.match(/cfg=([A-Za-z0-9_\-]+)/);
  if (!m) return null;
  try {
    let b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch (e) { return null; }
}

function load() {
  chrome.storage.local.get(null, v => {
    S = Object.assign({}, DEFAULTS, v || {});
    S.openai = Object.assign({}, DEFAULTS.openai, (v && v.openai) || {});
    S.local = Object.assign({}, DEFAULTS.local, (v && v.local) || {});
    if (S.maxLen === 1500) S.maxLen = DEFAULTS.maxLen;   // 旧默认值，不是她的意图
    const cfg = cfgFromHash();
    if (cfg) {
      /* ⚠️ 顺序很重要：先把嵌套对象合完，再整体合。
         反着写（先 Object.assign(S, cfg)）会把 S.openai 整个换成 cfg.openai，
         后面那句「合并」就没东西可合并了——没写进 cfg 的字段（比如领域提示词）会静默丢掉。
         踩过：用 #cfg 链接导入 baseUrl/key/model，把她的领域提示词冲没了。 */
      if (cfg.openai) cfg.openai = Object.assign({}, S.openai, cfg.openai);
      if (cfg.local) cfg.local = Object.assign({}, S.local, cfg.local);
      Object.assign(S, cfg);
      paint();
      chrome.storage.local.set({
        enabled: S.enabled, autoTranslate: S.autoTranslate, maxLen: S.maxLen,
        targetMode: S.targetMode, engine: S.engine, openai: S.openai, local: S.local
      }, () => {
        history.replaceState(null, '', location.pathname);
        flash('已从链接导入配置');
      });
      return;
    }
    paint();
  });
}

function paint() {
  $('enabled').checked = !!S.enabled;
  $('autoTranslate').checked = !!S.autoTranslate;
  $('orb').checked = !!S.orb;
  $('maxLen').value = S.maxLen;
  $('oa-base').value = S.openai.baseUrl;
  $('oa-key').value = S.openai.apiKey;
  $('oa-model').value = S.openai.model;
  $('oa-prompt').value = S.openai.prompt;
  $('lc-url').value = S.local.url;
  paintPreset();

  [['targetMode', S.targetMode], ['engine', S.engine], ['actionMode', S.actionMode], ['transStyle', S.transStyle], ['panelTheme', S.panelTheme], ['answerExplain', S.answerExplain]].forEach(([id, val]) => {
    [...$(id).querySelectorAll('button')].forEach(b => b.classList.toggle('on', b.dataset.v === val));
  });
  applyTheme();
  $('engineHint').textContent = ENGINE_HINT[S.engine] || '';
  $('box-openai').classList.toggle('hide', S.engine !== 'openai');
  $('box-local').classList.toggle('hide', S.engine !== 'local');
}

function collect() {
  return {
    enabled: $('enabled').checked,
    autoTranslate: $('autoTranslate').checked,
    orb: $('orb').checked,
    panelTheme: S.panelTheme,
    maxLen: Math.max(200, Math.min(20000, parseInt($('maxLen').value, 10) || 8000)),
    actionMode: S.actionMode,
    transStyle: S.transStyle,
    answerExplain: S.answerExplain,
    targetMode: S.targetMode,
    engine: S.engine,
    openai: {
      baseUrl: $('oa-base').value.trim(),
      apiKey: $('oa-key').value.trim(),
      model: $('oa-model').value.trim(),
      prompt: $('oa-prompt').value
    },
    local: { url: $('lc-url').value.trim() }
  };
}

/* 设置页自己也跟着主题走：跟浮层用同一个值，不另开一个开关 */
function applyTheme() {
  document.body.dataset.theme = S.panelTheme === 'dark' ? 'dark' : 'light';
}

function flash(text, isErr) {
  const m = $('msg');
  m.textContent = text;
  m.className = 'msg' + (isErr ? ' err' : '');
  setTimeout(() => { m.textContent = ''; }, 2400);
}

[['targetMode'], ['engine'], ['actionMode'], ['transStyle'], ['panelTheme'], ['answerExplain']].forEach(([id]) => {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    S[id] = b.dataset.v;
    paint();
  });
});

/* 预设高亮：只看字面是否与某一套完全相同。改过就不再高亮（如实反映）。 */
function paintPreset() {
  const cur = ($('oa-prompt').value || '').trim();
  const hit = PROMPT_PRESETS.find(p => p.text.trim() === cur);
  [...$('promptPreset').querySelectorAll('button')].forEach(b => {
    b.classList.toggle('on', !!hit && b.dataset.p === hit.id);
  });
  $('presetHint').textContent = hit
    ? hit.hint
    : (cur ? '这是你自己写的（或者改过的），保持原样不再当预设。' : '当前的提示词是空的：只用扩展自带的那套。');
}

$('promptPreset').addEventListener('click', e => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  const p = PROMPT_PRESETS.find(x => x.id === b.dataset.p);
  if (!p) return;
  $('oa-prompt').value = p.text;
  S.openai = Object.assign({}, S.openai, { prompt: p.text });
  paintPreset();
  flash('已套用「' + p.name + '」，记得点保存');
});
$('oa-prompt').addEventListener('input', paintPreset);

$('save').addEventListener('click', () => {
  const next = collect();
  chrome.storage.local.set(next, () => {
    S = Object.assign({}, S, next);
    flash('已保存');
  });
});

$('test').addEventListener('click', () => {
  const next = collect();
  const out = $('probeOut');
  $('probe').classList.remove('hide');
  out.textContent = '翻译中…';
  chrome.storage.local.set(next, () => {
    chrome.runtime.sendMessage({ type: 'translate', text: 'The quick brown fox jumps over the lazy dog.' }, r => {
      void chrome.runtime.lastError;
      if (!r || !r.ok) { out.textContent = '失败：' + ((r && r.error) || '没有回应'); return; }
      out.textContent = '[' + r.dir + ' · ' + r.engine + ']\n' + r.translated;
    });
  });
});

/* 拿一串验证码去试：验证「不是文字就不硬翻」这条规则到底生没生效。
   这一步要她自己点——我不能替她验，就不该把「应该没问题」当验证。 */
$('testJunk').addEventListener('click', () => {
  const next = collect();
  const out = $('probeOut');
  $('probe').classList.remove('hide');
  out.textContent = '拿一串验证码去试…';
  chrome.storage.local.set(next, () => {
    chrome.runtime.sendMessage({ type: 'translate', text: 'WEHESIeIeEald#E ow=-z=S5F' }, r => {
      void chrome.runtime.lastError;
      if (!r) { out.textContent = '没有回应'; return; }
      if (r.notText) { out.textContent = '新规则生效：它没有硬翻，回的是\n“' + r.error + '”'; return; }
      if (!r.ok) { out.textContent = '失败：' + r.error; return; }
      out.textContent = '它还是翻了：\n“' + r.translated + '”\n（说明这条规则没拦住，告诉我）';
    });
  });
});

/* 导出诊断日志：只记结构和错误，不记内容 */
$('logExport').addEventListener('click', () => {
  const box = $('logBox'), out = $('logOut');
  box.classList.remove('hide');
  out.textContent = '读取中…';
  chrome.runtime.sendMessage({ type: 'getLog' }, r => {
    void chrome.runtime.lastError;
    const log = (r && r.log) || [];
    if (!log.length) { out.textContent = '（还没有记录）'; return; }
    const txt = JSON.stringify(log, null, 2);
    out.textContent = txt.slice(0, 6000);
    try {
      const blob = new Blob([txt], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sidtrans-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      flash('已导出 ' + log.length + ' 条');
    } catch (e) { flash('导出失败，直接复制下面的文本', true); }
  });
});

$('logClear').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearLog' }, () => {
    void chrome.runtime.lastError;
    $('logBox').classList.add('hide');
    flash('日志已清空');
  });
});

load();
