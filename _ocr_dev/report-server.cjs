const http = require('http');
const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, 'report.log');
const wwwDir = path.join(__dirname, 'e2e');
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.xpi': 'application/x-xpinstall' };

/* 端口可改：这台机器上 8765 被别的软件占着（百度输入法），
   固定端口会让测试直接起不来，而且报错是 EACCES，容易被误读成权限问题。 */
const PORT = Number(process.env.PORT || process.argv[2] || 8765);

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');

  if (u.pathname === '/report') {
    const m = u.searchParams.get('m') || '';
    fs.appendFileSync(logFile, new Date().toISOString() + '  ' + m + '\n', 'utf8');
    console.log('REPORT: ' + m);
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('ok');
    return;
  }

  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const f = path.join(wwwDir, rel);
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(b);
  });
}).listen(PORT, '127.0.0.1', () => console.log('e2e + report server on ' + PORT));
