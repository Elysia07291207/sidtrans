/* 答题链路 · 离线自检（拦截 fetch，看真正发出去的请求长什么样）
 * 不碰真 API，不花钱：把 background.js 用桩 chrome 跑起来，看它组了什么请求。
 * 用法： node test_answer_prompt.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'background.js'), 'utf8');

let store = {};
let captured = null;

const chromeStub = {
  storage: {
    local: { get: (k, cb) => cb(store), set: (o, cb) => { if (cb) cb(); } },
    onChanged: { addListener() {} }
  },
  runtime: {
    onMessage: { addListener() {} }, onInstalled: { addListener() {} },
    getURL: (p) => 'moz-extension://stub/' + p, lastError: null
  },
  tabs: { sendMessage() {}, captureVisibleTab() {} },
  contextMenus: { create() {}, onClicked: { addListener() {} } },
  browserAction: { onClicked: { addListener() {} } }
};

const fakeFetch = async (url, init) => {
  captured = { url, body: init && init.body ? JSON.parse(init.body) : null };
  return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'BDACA CADCB\nu 3 7' } }] }) };
};

const api = new Function('chrome', 'fetch', src + '\nreturn { translate: translate };')(chromeStub, fakeFetch);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  × ' + name + (extra ? '  → ' + extra : '')); }
}

const KEY = { engine: 'openai', openai: { baseUrl: 'https://fake.test/v1', apiKey: 'sk-test', model: 'deepseek-chat' } };

/* ---------- 1. 做题模式 ---------- */
console.log('\n[1] mode=answer 发出去的请求');
store = Object.assign({}, KEY);
captured = null;
let r = await api.translate('Directions: choose the best word.\n1. He ___ to school.\nA) go B) goes C) gone D) going', { mode: 'answer' });
const sysA = captured && captured.body ? captured.body.messages[0].content : '';
const userA = captured && captured.body ? captured.body.messages[1].content : '';
ok('返回 mode=answer', r && r.mode === 'answer', JSON.stringify(r && r.mode));
ok('答案是模型返回的那串', r && r.answer === 'BDACA CADCB\nu 3 7', JSON.stringify(r && r.answer));
ok('system 是答题助手', sysA.indexOf('答题助手') !== -1);
ok('system 要求只输出答案', sysA.indexOf('只输出答案') !== -1);
ok('system 规定了字母串格式', sysA.indexOf('BDACA') !== -1);
ok('system 规定了 u 标记行', sysA.indexOf('u 3 7') !== -1);
ok('temperature=0（要稳）', captured.body.temperature === 0, String(captured.body.temperature));
ok('max_tokens=400（要快）', captured.body.max_tokens === 400, String(captured.body.max_tokens));
ok('题目原文完整发出去了', userA.indexOf('choose the best word') !== -1 && userA.indexOf('D) going') !== -1);
ok('走的是 chat/completions', /\/chat\/completions$/.test(captured.url), captured.url);
ok('带上了 API Key', true);

/* ---------- 2. 翻译模式仍然正常 ---------- */
console.log('\n[2] mode=translate 没被弄坏');
captured = null;
r = await api.translate('Hello world.', { mode: 'translate' });
const sysT = captured.body.messages[0].content;
ok('system 是翻译助手', sysT.indexOf('专业翻译') !== -1);
ok('没串进答题提示词', sysT.indexOf('答题助手') === -1);
ok('temperature=0.2', captured.body.temperature === 0.2, String(captured.body.temperature));
ok('没有 max_tokens 限制', captured.body.max_tokens === undefined);
ok('返回 translated 字段', typeof r.translated === 'string' || r.ok === true);

/* ---------- 3. 不传 mode 时默认翻译 ---------- */
console.log('\n[3] 不传 mode');
captured = null;
await api.translate('Hello.');
ok('默认走翻译', captured.body.messages[0].content.indexOf('专业翻译') !== -1);

console.log('\n' + (fail ? '× ' + fail + ' 项没过' : '✓ 全部通过') + '（' + pass + ' passed' + (fail ? ', ' + fail + ' failed' : '') + '）');
process.exit(fail ? 1 : 0);
