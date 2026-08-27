// Sdílený harness testů killBottlenecku (vlna E analýzy kódu, 27. 8. 2026).
//
// Do té doby si každá ze 127 sad opisovala totéž: docker run s portem natvrdo
// (26 kolizí portů, 106 sad publikovaných na 0.0.0.0), čekání na /api/health
// (103 sad při vypršení tiše pokračovalo), api()/expect()/login() v 82 kopiích
// a PĚT formátů závěrečného souhrnu, z nichž klik-test.sh umí číst jen jeden.
//
// Zásady (aby harness NEZMĚNIL to, co sady měří):
//  • api() nic nekontroluje ani neopakuje — statusy si hlídá sada, retry by maskoval závody
//  • KB_TEST_IMAGE je POVINNÝ: tichý fallback 'product-flowmap' dřív zakrýval, že
//    sada testuje starý image z předchozího buildu (run-all.sh i klik-test.sh ho exportují)
//  • port přiděluje docker (-p 127.0.0.1::8090), jméno kontejneru nese otisk image
//    → dvě regrese naráz si už nemažou kontejnery (past z 12. 8. 2026)
//  • finish() tiskne VŽDY `NÁZEV PASS n / FAIL n` (klik-test.sh:84 to grepuje) a při
//    0 kontrolách selže (zelená na prázdné stránce — past č. 5 z 13. 8. 2026)
//  • HARNESS_MUTACE=api|health|expect podvrhne harness sám → důkaz, že sada měří
//    produkt, ne harness (viz komentář u mutace níže)
//
// Použití (kostra):
//   const H = require('./_harness'); const { expect } = H;
//   H.beh(async () => {
//     const inst = await H.startInstance({ slug: 'rls', env: { KB_UVODNI_MAPA: 0 } });
//     const A = await inst.login('a@example.com'); …
//   }, { nazev: 'API-RLS' });
const { execSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const net = require('net');

const MUTACE = String(process.env.HARNESS_MUTACE || '');
const PW = 'testheslo123';
const SU = { email: 'su@e2e.local', pw: 'supersu12345' };

let pass = 0, fail = 0;
const instance = [];      // spuštěné kontejnery — finish() je uklidí všechny
const uklid = [];         // mocky, prohlížeče — funkce k zavolání při finish()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- kontroly ----------
const expect = (c, m) => {
  if (MUTACE === 'expect') c = true; // mutace: expect nic nekontroluje → sada MUSÍ zůstat zelená
  if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); }
  return !!c;
};
const ok = expect;
const pocty = () => ({ pass, fail });
// await + catch → ❌ (nahrazuje ruční `catch { fail++ }` bloky)
const zkusit = async (fn, m) => { try { await fn(); return true; } catch (e) { fail++; console.log(`  ❌ ${m}: ${String(e && e.message || e).slice(0, 160)}`); return false; } };

// ---------- čekání ----------
const waitFor = async (fn, { timeout = 10000, krok = 250, popis = 'podmínka' } = {}) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`${popis} nenastala do ${timeout} ms`);
    await sleep(krok);
  }
};

// ---------- instance ----------
const otiskImage = (img) => crypto.createHash('sha1').update(String(img)).digest('hex').slice(0, 6);

async function waitHealthy(inst, { timeout = 60000 } = {}) {
  if (MUTACE === 'health') return; // mutace: nečekat → sada MUSÍ zčervenat
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(`${inst.base}/api/health`)).ok) return; } catch { /* startuje */ }
    if (Date.now() - t0 > timeout) {
      let logy = ''; try { logy = inst.logs(5); } catch { /* bez logů */ }
      throw new Error(`${inst.name} nenaběhl do ${timeout / 1000} s\n${logy}`);
    }
    await sleep(1000);
  }
}

function startInstance({ slug, env = {}, addHostGateway = false, addHosts = {}, volume = false, image, extraArgs = '' }) {
  if (!slug) throw new Error('startInstance: chybí slug');
  const img = image || process.env.KB_TEST_IMAGE;
  if (!img) throw new Error('KB_TEST_IMAGE není nastavený — spusť přes tests/run-all.sh, tests/klik-test.sh, nebo `KB_TEST_IMAGE=<image> node …` (tichý fallback na starý image záměrně není)');
  const name = `kb-e2e-${slug}-${otiskImage(img)}`;
  // KB_PURPOSE_ASK=0 je výchozí (dotazník účelu by blokoval klikací sady);
  // sada, která ho testuje, dá env: { KB_PURPOSE_ASK: null }
  const envAll = Object.assign({ KB_PURPOSE_ASK: 0 }, env);
  const envArgs = Object.entries(envAll).filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `-e ${k}=${String(v).replace(/'/g, "'\\''")}`).join(' ');
  const hosts = [addHostGateway ? '--add-host=host.docker.internal:host-gateway' : '']
    .concat(Object.entries(addHosts).map(([h, ip]) => `--add-host=${h}:${ip}`)).filter(Boolean).join(' ');
  const vol = volume ? `-v ${volume === true ? name + '-data' : volume}:/app/pb_data` : '';
  execSync(`docker rm -f ${name} 2>/dev/null; true`, { stdio: 'ignore' });
  execSync(`docker run -d --name ${name} ${envArgs} ${hosts} ${vol} ${extraArgs} -p 127.0.0.1::8090 ${img}`, { stdio: 'ignore' });
  const inst = { name, port: 0, base: '', image: img };
  const ctiPort = () => {
    inst.port = Number(execSync(`docker port ${name} 8090`).toString().trim().split('\n')[0].split(':').pop());
    inst.base = `http://127.0.0.1:${inst.port}`;
  };
  ctiPort();
  Object.assign(inst, { volume: volume ? (volume === true ? name + '-data' : volume) : '',
    api: async (method, path, { token, bearer, body, form, headers } = {}) => {
      if (MUTACE === 'api' && String(method).toUpperCase() === 'GET') return { status: 200, json: {}, headers: new Headers() };
      const hdr = Object.assign(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json' },
        token ? { Authorization: token } : {}, bearer ? { Authorization: `Bearer ${bearer}` } : {}, headers || {});
      const res = await fetch(inst.base + path, { method, headers: hdr,
        ...(body !== undefined ? { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}) });
      let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
      return { status: res.status, json, headers: res.headers };
    },
    exec: (cmd) => execSync(`docker exec ${name} ${cmd}`).toString(),
    logs: (n = 40) => execSync(`docker logs --tail ${n} ${name} 2>&1`).toString(),
    superuser: async ({ email = SU.email, pw = SU.pw } = {}) => {
      execSync(`docker exec ${name} /app/pocketbase superuser upsert ${email} ${pw}`, { stdio: 'ignore' });
      const r = await inst.api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: email, password: pw } });
      if (r.status !== 200) throw new Error(`superuser login ${email} selhal: ${r.status}`);
      return r.json.token;
    },
    register: (email, { pw = PW, ...extra } = {}) => inst.api('POST', '/api/collections/users/records', { body: { email, password: pw, passwordConfirm: pw, ...extra } }),
    login: async (email, pw = PW) => {
      const r = await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: pw } });
      if (r.status !== 200) throw new Error(`login ${email} selhal: ${r.status}`);
      return r.json.token;
    },
    // ⚠️ -p 127.0.0.1::8090 = port přiděluje docker PŘI KAŽDÉM startu kontejneru:
    // po stop/start (i restart) je jiný → base se musí přečíst znovu. Sady, které
    // si base uložily do proměnné, ji po resume() přepíšou (vrací nový base).
    pause: () => { execSync(`docker stop ${name}`, { stdio: 'ignore' }); },
    resume: async () => { execSync(`docker start ${name}`, { stdio: 'ignore' }); ctiPort(); await waitHealthy(inst); return inst.base; },
    restart: async () => { execSync(`docker restart ${name}`, { stdio: 'ignore' }); ctiPort(); await waitHealthy(inst); return inst.base; },
    stop: () => { execSync(`docker rm -f ${name} 2>/dev/null; true`, { stdio: 'ignore' }); if (inst.volume) execSync(`docker volume rm -f ${inst.volume} 2>/dev/null; true`, { stdio: 'ignore' }); },
  });
  instance.push(inst);
  return waitHealthy(inst).then(() => inst);
}

// adaptéry pro převod sad s jinou signaturou api() (7 sad path-first, 5 sad base-first)
const apiPathFirst = (inst) => (path, { method = 'GET', ...o } = {}) => inst.api(method, path, o);
const apiBaseFirst = () => (base, method, path, o = {}) => {
  const inst = instance.find((i) => i.base === base);
  if (!inst) throw new Error(`apiBaseFirst: neznámá instance ${base}`);
  return inst.api(method, path, o);
};

// ---------- mocky ----------
// SMTP jímka: sbírá doručené zprávy (surové tělo vč. hlaviček); port přidělí OS
function smtpSink() {
  const maily = [];
  const server = net.createServer((sock) => {
    let buf = '', vData = false, zprava = '';
    sock.write('220 jimka ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const radek = buf.slice(0, i); buf = buf.slice(i + 2);
        if (vData) {
          if (radek === '.') { maily.push(zprava); zprava = ''; vData = false; sock.write('250 OK\r\n'); }
          else zprava += radek + '\n';
          continue;
        }
        const cmd = radek.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-jimka\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('HELO')) sock.write('250 jimka\r\n');
        else if (cmd.startsWith('DATA')) { vData = true; sock.write('354 go\r\n'); }
        else if (cmd.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => { /* klient odpojen, nevadí */ });
  });
  const hotovo = new Promise((r) => server.listen(0, '0.0.0.0', r));
  const sink = {
    maily, port: null,
    // nastaví instanci SMTP na jímku (přes host.docker.internal → instance potřebuje addHostGateway)
    zapoj: async (inst, superToken, { appURL } = {}) => inst.api('PATCH', '/api/settings', { token: superToken, body: {
      meta: { appName: 'killBottleneck', appURL: appURL || inst.base, senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
      smtp: { enabled: true, host: 'host.docker.internal', port: sink.port, tls: false },
    } }),
    cekejNaMail: (pred, ms = 5000) => waitFor(() => maily.find(pred), { timeout: ms, popis: 'e-mail v jímce' }),
    close: () => new Promise((r) => server.close(() => r())),
  };
  uklid.push(sink.close);
  return hotovo.then(() => { sink.port = server.address().port; return sink; });
}

// HTTP mock (webhook agenta, brána AI…): handler(req, res, telo) — tělo už načtené
function httpMock(handler) {
  const pozadavky = [];
  const server = http.createServer((req, res) => {
    let telo = '';
    req.on('data', (c) => { telo += c; });
    req.on('end', () => { pozadavky.push({ method: req.method, url: req.url, headers: req.headers, body: telo }); handler(req, res, telo); });
  });
  const hotovo = new Promise((r) => server.listen(0, '0.0.0.0', r));
  const mock = { pozadavky, port: null, base: null, close: () => new Promise((r) => server.close(() => r())) };
  uklid.push(mock.close);
  return hotovo.then(() => { mock.port = server.address().port; mock.base = `http://host.docker.internal:${mock.port}`; return mock; });
}

// ---------- prohlížeč ----------
// ⚠️ whitelist konzole je ÚZKÝ (jen Google Fonts) — „všechny cizí originy" by
// zaslepilo chyby brány api.killbottleneck.com (ui-smoke.js, 20. 8. 2026)
const cizihoPuvodu = (m) => /fonts\.g(oogleapis|static)\.com/.test(m.text() || '') || (m.location && /fonts\.g(oogleapis|static)\.com/.test(m.location().url || ''));
async function browser({ viewport = { width: 1400, height: 900 }, mobil = false, konzole = true } = {}) {
  const puppeteer = require('puppeteer-core');
  const b = await puppeteer.launch({ executablePath: process.env.KB_CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  uklid.push(() => b.close().catch(() => {}));
  const chyby = [];
  const novaStranka = async () => {
    const page = await b.newPage();
    await page.setViewport(mobil ? Object.assign({ width: 390, height: 844, isMobile: true, hasTouch: true }, viewport.width === 1400 ? {} : viewport) : viewport);
    if (konzole) {
      page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) chyby.push(m.text()); });
      page.on('pageerror', (e) => chyby.push(String(e)));
    }
    return page;
  };
  const page = await novaStranka();
  return { browser: b, page, chyby, novaStranka };
}

// ---------- závěr ----------
let dokonceno = false;
async function finish({ nazev = 'SADA' } = {}) {
  if (dokonceno) return; dokonceno = true;
  for (const f of uklid.splice(0)) { try { await f(); } catch { /* úklid je best-effort */ } }
  for (const i of instance.splice(0)) { try { i.stop(); } catch { /* už neběží */ } }
  if (pass + fail === 0) { console.log('  ❌ sada neodbavila žádnou kontrolu (zelená na prázdné stránce)'); fail++; process.exitCode = 2; }
  console.log(`\n${fail ? '🔴' : '🟢'} ${nazev} PASS ${pass} / FAIL ${fail}`);
  process.exitCode = process.exitCode === 2 ? 2 : (fail ? 1 : 0);
}
// obal sady: výjimka = ❌, úklid vždy (i po SIGINT/SIGTERM), pak finish()
function beh(fn, { nazev } = {}) {
  const konec = () => finish({ nazev }).then(() => process.exit(process.exitCode || 0));
  process.on('SIGINT', konec); process.on('SIGTERM', konec);
  return (async () => {
    try { await fn(); }
    catch (e) { fail++; console.log('  ❌ výjimka:', String(e && e.message || e).slice(0, 200)); }
    finally { await konec(); }
  })();
}

module.exports = { PW, SU, sleep, expect, ok, pocty, zkusit, waitFor, waitHealthy, startInstance, apiPathFirst, apiBaseFirst, smtpSink, httpMock, browser, cizihoPuvodu, finish, beh, MUTACE };
