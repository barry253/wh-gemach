const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.argv[2], PORT = +process.argv[3] || 8787;
// parse _headers (subset): path patterns with * splat, "! Name" detach
const rules = [];
{ let cur = null;
  for (const line of fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), set: {}, del: [] }; rules.push(cur); continue; }
    const t = line.trim();
    if (t.startsWith('!')) cur.del.push(t.slice(1).trim().toLowerCase());
    else { const i = t.indexOf(':'); cur.set[t.slice(0, i).trim().toLowerCase()] = t.slice(i + 1).trim(); }
  } }
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname);
  const hdrs = {}; for (const r of rules) if (r.re.test(p)) { Object.assign(hdrs, r.set); r.del.forEach(d => delete hdrs[d]); }
  let file, status = 200;
  if (p === '/g' || p === '/g/') { res.writeHead(302, { location: '/' }); return res.end(); }
  if (/^\/g\/[^/]+\/?$/.test(p)) file = 'gemach.html';
  else if (/^\/r\/[^/]+\/?$/.test(p)) file = 'manage.html'; // mirrors _redirects
  else if (p === '/') file = 'index.html';
  else if (fs.existsSync(path.join(ROOT, p)) && fs.statSync(path.join(ROOT, p)).isFile()) file = p.slice(1);
  else if (fs.existsSync(path.join(ROOT, p + '.html'))) file = p.slice(1) + '.html';
  else { file = '404.html'; status = 404; }
  const ext = path.extname(file);
  res.writeHead(status, { ...hdrs, 'content-type': types[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(path.join(ROOT, file)));
}).listen(PORT, () => console.log('listening', PORT));
