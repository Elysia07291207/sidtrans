import crypto from 'node:crypto';
import fs from 'node:fs';

/* ⚠️ 凭据不写在源码里。从环境变量或命令行取：
     AMO_KEY / AMO_SECRET 环境变量，或者第 4/5 个参数。
   （这个文件会进公开仓库——当初图省事把 key 写死在这里，开源前必须拿掉。） */
const ISS = process.env.AMO_KEY || process.argv[4] || '';
const SECRET = process.env.AMO_SECRET || process.argv[5] || '';
if (!ISS || !SECRET) {
  console.error('缺少 AMO 凭据。用法：\n' +
    '  set AMO_KEY=user:xxxxx:123 & set AMO_SECRET=xxxx  （或直接传第 4/5 个参数）\n' +
    '  node amo_get.mjs <输出目录> <版本号>\n' +
    '凭据在 AMO 后台生成：https://addons.mozilla.org/developers/addon/api/key/');
  process.exit(2);
}
const GUID = 'sidtrans@pangyi.local';
const OUTDIR = process.argv[2] || '.';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function makeJwt() {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ iss: ISS, jti: crypto.randomBytes(8).toString('hex'), iat, exp: iat + 55 }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest());
  return header + '.' + payload + '.' + sig;
}

const want = process.argv[3] || null;   // 指定版本；不给就取最新

const auth = () => ({ Authorization: 'JWT ' + makeJwt(), 'User-Agent': 'web-ext/7.0.0' });

let version = want;
if (!version) {
  const a = await (await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${GUID}/`, { headers: auth() })).json();
  version = a.current_version && a.current_version.version;
  console.log('current version =', version);
}

const vr = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${GUID}/versions/${version}/`, { headers: auth() });
if (!vr.ok) {
  /* 版本还没建出来：可能签名没提交成功，也可能 AMO 那边还在处理 */
  console.log('version query failed', vr.status, (await vr.text()).slice(0, 200));
  process.exitCode = 1;
} else {
  const v = await vr.json();
  console.log('version', v.version, 'file.status =', v.file.status, 'url =', v.file.url);
  if (!/\.xpi$/.test(v.file.url)) {
    /* 版本建出来了，但签名还没挂上来——过一会儿再问一次 */
    console.log('还没签好（url 不是 .xpi）');
    process.exitCode = 2;
  } else {
    const fr = await fetch(v.file.url, { headers: auth() });
    if (!fr.ok) {
      console.log('download failed', fr.status);
      process.exitCode = 1;
    } else {
      const buf = Buffer.from(await fr.arrayBuffer());
      const out = `${OUTDIR}\\sidtrans-${version}-signed.xpi`;
      fs.writeFileSync(out, buf);
      console.log('downloaded', buf.length, 'bytes ->', out);
    }
  }
}
/* 不用 process.exit：它会在 undici 还活着的时候拆环境，
   报一句和真事无关的 Assertion failed（看着像挂了，其实什么都没错）。 */
