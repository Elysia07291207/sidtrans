import crypto from 'node:crypto';

const ISS = process.argv[2];
const SECRET = process.argv[3];

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function makeJwt() {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({
    iss: ISS,
    jti: crypto.randomBytes(8).toString('hex'),
    iat,
    exp: iat + 55          // AMO 要求 JWT 寿命不能太长（<=60 秒）
  }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest());
  return header + '.' + payload + '.' + sig;
}

const jwt = makeJwt();
const url = 'https://addons.mozilla.org/api/v5/addons/addon/sidtrans@pangyi.local/';

for (const scheme of ['JWT', 'Bearer']) {
  try {
    const r = await fetch(url, { headers: { Authorization: scheme + ' ' + jwt, 'User-Agent': 'web-ext/7.0.0' } });
    const t = await r.text();
    console.log(`[${scheme}] ${r.status}  ${t.slice(0, 200)}`);
  } catch (e) {
    console.log(`[${scheme}] ERR ${e.message}`);
  }
}
