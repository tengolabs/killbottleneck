// UI e2e: every font content travels over the network ONCE (whole-app analysis 5, measurement m-1).
// Inter and Plus Jakarta Sans are variable fonts — all weights of a subset are the same file. They used to lie
// in public/fonts under 18 names with 4 different contents, so the first visit downloaded the same bytes up to
// four times (sign-in page: 7 requests / 430 kB for 3 contents / 162 kB). Guarded on three levels:
//   source  — the files in public/fonts all differ and fonts.css names nothing else (no Docker needed for it),
//   server  — what the instance serves has those fingerprints, with a Cache-Control,
//   browser — on a first visit no font content is requested twice.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('./_harness');
const { expect, sleep } = H;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const FONTS = path.join(__dirname, '../frontend/public/fonts');

H.beh(async () => {
  console.log('== source: one file per content ==');
  const files = fs.readdirSync(FONTS).filter((f) => f.endsWith('.woff2'));
  const prints = files.map((f) => sha(fs.readFileSync(path.join(FONTS, f))));
  expect(files.length > 0 && new Set(prints).size === files.length, `${files.length} font files, ${new Set(prints).size} different contents`);
  const css = fs.readFileSync(path.join(__dirname, '../frontend/src/fonts.css'), 'utf8');
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
  const named = [...new Set(urls)];
  expect(named.every((u) => files.includes(path.basename(u))) && named.length === files.length, `fonts.css names exactly those files (${named.length} URLs in ${urls.length} rules)`);
  // rendering unchanged: still one rule per family × weight × subset
  const rules = [...css.matchAll(/@font-face\s*\{[^}]*font-family:\s*'([^']+)'[^}]*font-weight:\s*(\d+)[^}]*url\(([^)]+)\)[^}]*\}/g)].map((m) => `${m[1]} ${m[2]} ${/latin-ext/.test(m[3]) ? 'latin-ext' : 'latin'}`);
  const want = [];
  for (const w of [300, 400, 500, 600, 700]) for (const s of ['latin-ext', 'latin']) want.push(`Inter ${w} ${s}`);
  for (const w of [500, 600, 700, 800]) for (const s of ['latin-ext', 'latin']) want.push(`Plus Jakarta Sans ${w} ${s}`);
  expect(JSON.stringify(rules.slice().sort()) === JSON.stringify(want.slice().sort()), `the same 18 faces as before (family × weight × subset): ${rules.length}`);

  console.log('== server: fingerprints and caching ==');
  const inst = await H.startInstance({ slug: 'fonts-once', env: { KB_UVODNI_MAPA: 0 } });
  let servedOk = true; let cacheOk = true; let seen = '';
  for (const u of named) {
    const res = await fetch(inst.base + u);
    const body = Buffer.from(await res.arrayBuffer());
    if (res.status !== 200 || sha(body) !== sha(fs.readFileSync(path.join(FONTS, path.basename(u))))) servedOk = false;
    seen = res.headers.get('cache-control') || '';
    if (!/max-age=\d{6,}/.test(seen)) cacheOk = false;
  }
  expect(servedOk, 'the instance serves every font named by the stylesheet, byte for byte');
  expect(cacheOk, `fonts carry a long Cache-Control (${seen})`);
  const gone = await fetch(`${inst.base}/fonts/inter-400-latin.woff2`);
  expect(!/max-age/.test(gone.headers.get('cache-control') || ''), `a font that does not exist gets no long caching (${gone.status}, "${gone.headers.get('cache-control') || ''}")`);
  const index = await (await fetch(inst.base + '/')).text();
  const asset = (index.match(/\/assets\/[^"']+\.js/) || [])[0];
  const ares = asset ? await fetch(inst.base + asset) : null;
  expect(!!ares && /immutable/.test(ares.headers.get('cache-control') || ''), `hashed assets are immutable (${asset}: ${ares && ares.headers.get('cache-control')})`);
  const root = await fetch(inst.base + '/');
  expect(/no-store/.test(root.headers.get('cache-control') || ''), 'index.html stays no-store');

  console.log('== browser: first visit ==');
  const visit = async (label, go) => {
    const { browser, page } = await H.browser({ viewport: { width: 1440, height: 900 } });
    const got = [];
    page.on('response', async (res) => {
      if (!/\.woff2(\?|$)/.test(res.url())) return;
      try { const b = await res.buffer(); got.push({ url: new URL(res.url()).pathname, bytes: b.length, print: sha(b), cache: res.fromCache() }); } catch { /* aborted */ }
    });
    await go(page);
    await sleep(2500);
    await browser.close();
    const net = got.filter((g) => !g.cache);
    const contents = new Set(net.map((g) => g.print)).size;
    const kb = Math.round(net.reduce((a, g) => a + g.bytes, 0) / 1024);
    console.log(`  ${label}: ${net.length} font requests, ${kb} kB, ${contents} different contents`);
    expect(net.length > 0 && net.length === contents, `${label}: no font content downloaded twice (${net.length} requests for ${contents} contents, ${kb} kB)`);
    return { requests: net.length, kb, contents };
  };
  await visit('sign-in page', (page) => page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' }));
  await inst.register('pisma@e2e.cz');
  await visit('Home after sign-in', async (page) => {
    await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await page.type('#email', 'pisma@e2e.cz');
    await page.type('#password', H.PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  });
}, { nazev: 'UI-FONTS-ONCE' });
