/* 后台三件（缓存 / 降级 / 日志）· 离线自检
 * 用桩 chrome + 桩 fetch 把 background.js 跑起来，量它到底做了什么。
 * 用法： node test_bg_cache.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'background.js'), 'utf8');

let store = {};
let fetchCount = 0;
let lastSys = '';           // 最近一次请求的 system 提示词（验「换模式/换开关」到底换了没有）
let mode = 'ok';            // ok | fail（主引擎挂）| failboth（都挂）
let route = null;           // 消息路由的 handler

const chromeStub = {
  storage: {
    local: {
      get: (k, cb) => cb(store),
      set: (o, cb) => { Object.assign(store, o); if (cb) cb(); }
    },
    onChanged: { addListener() {} }
  },
  runtime: { onMessage: { addListener(fn) { route = fn; } }, onInstalled: { addListener() {} }, getURL: p => p, lastError: null },
  tabs: { sendMessage() {}, captureVisibleTab() {} },
  contextMenus: { create() {}, onClicked: { addListener() {} } },
  browserAction: { onClicked: { addListener() {} } }
};

const fakeFetch = async (url, init) => {
  fetchCount++;
  try { lastSys = JSON.parse(init.body).messages[0].content; } catch (e) {}
  if (String(url).indexOf('mymemory') !== -1) {
    return { ok: true, json: async () => ({ responseData: { translatedText: '免费引擎给的译文' } }) };
  }
  if (mode === 'fail' || mode === 'failboth') throw new Error('模拟网络不通');
  if (mode === 'paywall') {
    /* 照抄 DeepSeek 那边真实回的形状：ok=false + 402 + 一段 JSON 体 */
    return {
      ok: false, status: 402,
      text: async () => JSON.stringify({ error: { message: 'Insufficient Balance', type: 'unknown_error' } })
    };
  }
  if (mode === 'trunc') {
    /* 模型写到一半被截断：正文有字，但 finish_reason=length */
    return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '一半的译文' } }] }) };
  }
  return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '译文#' + fetchCount } }] }) };
};

const api = new Function('chrome', 'fetch', src + '\nreturn { translate: translate, humanEngineError: humanEngineError };')(chromeStub, fakeFetch);

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  × ' + name + (extra ? '  → ' + extra : '')); } }

const KEY = { engine: 'openai', openai: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat' } };

/* ---------- 1. 结果缓存 ---------- */
console.log('\n[1] 结果缓存（同一段不重复花钱）');
store = Object.assign({}, KEY);
mode = 'ok';
fetchCount = 0;
const r1 = await api.translate('Hello cache test.', { mode: 'translate', host: 'a.com' });
const afterFirst = fetchCount;
const r2 = await api.translate('Hello cache test.', { mode: 'translate', host: 'a.com' });
ok('第一次真的请求了', afterFirst === 1, 'fetch=' + afterFirst);
ok('第二次没再请求（命中缓存）', fetchCount === 1, 'fetch=' + fetchCount);
ok('第二次标了 cached', r2 && r2.cached === true);
ok('两次译文一致', r1.translated === r2.translated, JSON.stringify([r1.translated, r2.translated]));

fetchCount = 0;
await api.translate('Hello cache test.', { mode: 'term', host: 'a.com' });
ok('换模式 → 不命中缓存，重新请求', fetchCount === 1, 'fetch=' + fetchCount);

/* ---------- 2. 引擎挂了自动降级 ---------- */
console.log('\n[2] 主引擎挂了 → 自动换免费引擎');
store = Object.assign({}, KEY);
mode = 'fail';
fetchCount = 0;
const r3 = await api.translate('A brand new sentence for fallback test.', { mode: 'translate', host: 'b.com' });
ok('没抛错（降级成功）', !!(r3 && r3.ok === true));
ok('带了降级说明', !!(r3 && r3.degraded), JSON.stringify(r3 && r3.degraded));
ok('引擎名是免费引擎', /MyMemory/.test(String(r3 && r3.engine)), String(r3 && r3.engine));
ok('译文来自备用引擎', String(r3 && r3.translated).indexOf('免费引擎') !== -1, String(r3 && r3.translated));

/* ---------- 3. 做题 / 术语不降级 ---------- */
console.log('\n[3] 做题与术语不硬凑（免费引擎做不了这些）');
mode = 'fail';
let threw = false;
try { await api.translate('Choose the best answer.', { mode: 'answer', host: 'c.com' }); } catch (e) { threw = true; }
ok('做题模式下如实报错', threw);

/* ---------- 3b. 消息路由：lastSeen ---------- */
console.log('\n[3b] 消息路由（真实入口）');
const routed = await new Promise(res => {
  route({ type: 'translate', text: 'A routed sentence.', mode: 'translate', host: 'd.com' }, {}, res);
});
ok('路由能正常返回结果', !!(routed && routed.ok), JSON.stringify(routed && routed.error));
ok('lastSeen 记下了“最后在哪个站点干活”', !!(store.lastSeen && store.lastSeen.host === 'd.com'), JSON.stringify(store.lastSeen));

/* ---------- 4. 日志：记错，不记内容 ---------- */
console.log('\n[4] 本地错误日志');
const log = store.errlog || [];
ok('记下了失败', log.length > 0, JSON.stringify(log.slice(-1)));
ok('日志里没有原文（不记内容）', JSON.stringify(log).indexOf('brand new sentence') === -1);
ok('日志里有站点名（结构信息）', JSON.stringify(log).indexOf('b.com') !== -1);
ok('日志条目封顶（不无限长）', log.length <= 60, 'len=' + log.length);

/* ---------- 5. 报错说人话 ---------- */
console.log('\n[5] 报错说人话（屏幕上要留「接下来干嘛」）');
mode = 'paywall';
store = Object.assign({}, KEY);
const e402 = await api.translate('Balance probe sentence.', { mode: 'term', host: 'e.com' }).then(() => null).catch(e => e);
ok('余额不足时如实报错（不编译文）', !!e402, String(e402 && e402.message).slice(0, 40));
const msg402 = api.humanEngineError(e402, 'term');
ok('402 → 点出是余额问题', /余额不足/.test(msg402), msg402);
ok('402 → 给出「切免费在线」这条路', /免费在线/.test(msg402), msg402);
ok('术语模式 → 明说没有免费替代', /没有免费替代/.test(msg402), msg402);
ok('原始返回体不再当正文端上来', !/Insufficient Balance/.test(msg402), msg402);

const msg401 = api.humanEngineError(new Error('API HTTP 401：{"error":"auth"}'), 'translate');
ok('401 → 指向 Key', /Key/.test(msg401), msg401);
ok('翻译模式不啰嗦「没有免费替代」', !/没有免费替代/.test(msg401), msg401);
ok('404 → 指向地址/模型', /地址|模型/.test(api.humanEngineError(new Error('API HTTP 404：not found'), 'translate')));
ok('5xx → 明说不是你的错', /不是你的错/.test(api.humanEngineError(new Error('API HTTP 503：busy'), 'translate')));
const both = new Error('两条路都不通｜API：x｜免费引擎：y');
both.bothFailed = true;
ok('两条都断 → 指向网络/代理，不把话说得比实情具体', /网络|代理/.test(api.humanEngineError(both, 'translate')));
ok('免费引擎挂了也有话说', /免费引擎/.test(api.humanEngineError(new Error('MyMemory HTTP 429'), 'translate')));

/* ---------- 6. 缓存键 / 截断标记 ---------- */
console.log('\n[6] 缓存键要带全（提示词 / 模型）/ 截断要看 finish_reason');
store = Object.assign({}, KEY, { openai: Object.assign({}, KEY.openai, { prompt: '提示词A' }) });
mode = 'ok';
fetchCount = 0;
await api.translate('Cache key probe sentence.', { mode: 'translate', host: 'f.com' });
const c1 = fetchCount;
await api.translate('Cache key probe sentence.', { mode: 'translate', host: 'f.com' });
ok('同一套设定：第二次命中缓存', fetchCount === c1, 'fetch=' + fetchCount);
store.openai.prompt = '提示词B';
await api.translate('Cache key probe sentence.', { mode: 'translate', host: 'f.com' });
ok('换了提示词（换预设）→ 不命中缓存', fetchCount === c1 + 1, 'fetch=' + fetchCount);
store.openai.model = 'another-model';
await api.translate('Cache key probe sentence.', { mode: 'translate', host: 'f.com' });
ok('换了模型 → 也不命中缓存', fetchCount === c1 + 2, 'fetch=' + fetchCount);

mode = 'trunc';
const rT = await api.translate('A sentence that gets cut off mid-way.', { mode: 'translate', host: 'g.com' });
ok('截断的译文照旧返回（不当成失败）', !!(rT && rT.ok));
ok('但带上 truncated 标记', rT && rT.truncated === true, JSON.stringify(rT && rT.truncated));
mode = 'ok';
const rN = await api.translate('A normal sentence for the truncation check.', { mode: 'translate', host: 'g.com' });
ok('正常写完的不带截断标记', rN && rN.truncated === false, JSON.stringify(rN && rN.truncated));

/* ---------- 7. 做题要不要解析 ---------- */
console.log('\n[7] 做题要不要解析（换的是提示词 + 缓存键）');
store = Object.assign({}, KEY);
mode = 'ok';
fetchCount = 0;
await api.translate('Explain switch probe one.', { mode: 'answer', explain: 0, host: 'h.com' });
ok('不带解析：用「只输出答案」那套提示词', /只输出答案/.test(lastSys) && !/解析：/.test(lastSys), lastSys.slice(0, 46));
const cA = fetchCount;
await api.translate('Explain switch probe one.', { mode: 'answer', explain: 1, host: 'h.com' });
ok('同一道题打开解析 → 不命中缓存，重新请求', fetchCount === cA + 1, 'fetch=' + fetchCount);
ok('带解析：提示词里出现了「解析：」的格式要求', /解析：/.test(lastSys), lastSys.slice(0, 46));
const cB = fetchCount;
await api.translate('Explain switch probe one.', { mode: 'answer', explain: 1, host: 'h.com' });
ok('同一套设定再问一次 → 命中缓存', fetchCount === cB, 'fetch=' + fetchCount);

mode = 'ok';
console.log('\n' + (fail ? '× ' + fail + ' 项没过' : '✓ 全部通过') + '（' + pass + ' passed' + (fail ? ', ' + fail + ' failed' : '') + '）');
process.exit(fail ? 1 : 0);
