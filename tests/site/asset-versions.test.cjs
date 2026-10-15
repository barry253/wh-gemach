// Cache-busting (build.sh, Oct 15, 2026): every script / stylesheet link in the built pages carries
// ?v=<first 10 hex of the file's SHA-256>, so a changed file always gets a new URL. Runs on ../../dist
// (run-all.mjs builds it first). No browser needed.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
let fails = 0;
function assert(c, msg) { if (!c) { fails++; console.log('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); }

const htmlIn = dir => fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => path.join(dir, f));
const LINK = /(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))(\?[^"]*)?"/g;
const sha10 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);

// Source pages: every script / stylesheet link has a ?v= for the build to stamp.
for (const file of [...htmlIn(path.join(ROOT, 'site')), path.join(ROOT, 'embed.html'), path.join(ROOT, 'admin.html')]) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(LINK)) {
    assert(/^\?v=[A-Za-z0-9]+$/.test(m[2] || ''), `${path.relative(ROOT, file)}: ${m[1]} has a ?v= (got "${m[2] || ''}")`);
  }
}

// Built pages: every link's ?v= is the file's own hash, and the file exists.
let links = 0;
for (const file of htmlIn(DIST)) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(LINK)) {
    links++;
    const target = path.join(DIST, m[1]);
    if (!fs.existsSync(target)) { assert(false, `${path.basename(file)}: ${m[1]} exists`); continue; }
    const want = '?v=' + sha10(target);
    assert(m[2] === want, `${path.basename(file)}: ${m[1]}${m[2] || ''} is stamped ${want}`);
  }
}
assert(links >= 10, `found the pages' script / stylesheet links (${links})`);

// The stamp follows the content: change a byte, get another stamp (and the same content, the same stamp).
const g = path.join(DIST, 'assets', 'gemach.js');
const before = sha10(g);
assert(before === sha10(g), 'same file, same stamp');
assert(crypto.createHash('sha256').update(fs.readFileSync(g, 'utf8') + ' ').digest('hex').slice(0, 10) !== before, 'changed file, new stamp');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
