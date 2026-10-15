// E2E aplikace pro Windows (product/desktop): skutečný Electron (vývojová stavba) v dockeru
// s virtuální obrazovkou Xvfb proti zkušební instanci killBottlenecku.
//
// Spuštění (mimo plnou regresi — leží v podsložce, run-all ji nehledá; Electron potřebuje
// vlastní obraz a `npm install` v product/desktop):
//   KB_TEST_IMAGE=kb-desktop node product/tests/desktop-e2e/e2e.js
// Scénář „starší server“ (web bez desktopové části) bere KB_DESKTOP_STARY_IMAGE,
// výchozí product-flowmap:latest. Prázdná hodnota ho přeskočí.
//
// Rám se ovládá přes stdin (jen vývojová stavba s KB_DESKTOP_E2E=1: skryj, ukaz, popredi,
// klikni <id>, obnov, probuzeni, ukonci) a své kroky zapisuje do JSONL logu (toast, odznak,
// ven, stahovani, mistni…) — upozornění Windows ani ikonu u hodin Puppeteer nevidí.
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const H = require('../_harness');

const { expect, sleep, waitFor } = H;
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DESKTOP = path.join(ROOT, 'product', 'desktop');
const OBRAZ_ELECTRON = 'kb-desktop-electron';
const STARY_IMAGE = process.env.KB_DESKTOP_STARY_IMAGE ?? 'product-flowmap:latest';

const volnyPort = () => new Promise((hotovo) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => hotovo(port)); });
});

function sestavObraz() {
  execSync(`docker build -q -t ${OBRAZ_ELECTRON} ${path.join(__dirname)}`, { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Spuštěný rám: proces, čtení událostí z JSONL a připojení Puppeteeru přes CDP.
async function spustAplikaci(vystup) {
  const cdpPort = await volnyPort();
  const displej = 100 + Math.floor(Math.random() * 400);
  const jmeno = `kb-desktop-e2e-${process.pid}`;
  fs.mkdirSync(path.join(vystup, 'stazene'), { recursive: true });
  const log = path.join(vystup, 'udalosti.jsonl');
  fs.writeFileSync(log, '');
  execSync(`docker rm -f ${jmeno} 2>/dev/null; true`, { stdio: 'ignore' });
  const proc = spawn('docker', [
    'run', '--rm', '-i', '--name', jmeno, '--network', 'host', '--shm-size', '512m',
    '--user', `${process.getuid()}:${process.getgid()}`,
    '-e', 'KB_DESKTOP_E2E=1', '-e', 'KB_DESKTOP_E2E_LOG=/vystup/udalosti.jsonl',
    '-e', 'KB_DESKTOP_USERDATA=/vystup/profil', '-e', 'KB_DESKTOP_E2E_STAZENE=/vystup/stazene',
    '-e', 'KB_DESKTOP_HLIDAC_MS=2000', '-e', 'LANGUAGE=cs', '-e', 'LANG=C.UTF-8',
    '-v', `${DESKTOP}:/app:ro`, '-v', `${vystup}:/vystup`, OBRAZ_ELECTRON,
    'sh', '-c', `Xvfb :${displej} -screen 0 1400x900x24 -nolisten tcp >/dev/null 2>&1 & export DISPLAY=:${displej}; sleep 1; `
      + `exec dbus-run-session -- /app/node_modules/electron/dist/electron --no-sandbox --remote-debugging-port=${cdpPort} /app`,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let vystupProcesu = '';
  proc.stdout.on('data', (d) => { vystupProcesu += d; });
  proc.stderr.on('data', (d) => { vystupProcesu += d; });
  let skoncil = false;
  proc.on('exit', () => { skoncil = true; });

  const udalosti = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r));
  const cekejNa = (udalost, pred = () => true, { timeout = 15000, od = 0 } = {}) => waitFor(
    () => udalosti().slice(od).find((u) => u.udalost === udalost && pred(u)),
    { timeout, popis: `událost ${udalost}` },
  );
  const prikaz = (radek) => proc.stdin.write(`${radek}\n`);

  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch { return false; }
  }, { timeout: 40000, popis: 'ladicí port Electronu' }).catch((e) => { throw new Error(`${e.message}\n${vystupProcesu.slice(-2000)}`); });
  const puppeteer = require('puppeteer-core');
  const prohlizec = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}`, defaultViewport: null });
  const stranka = await waitFor(async () => (await prohlizec.pages()).find((p) => p.url() && !p.url().startsWith('devtools')), { timeout: 15000, popis: 'okno aplikace' });
  const konec = async () => {
    try { prohlizec.disconnect(); } catch { /* už odpojeno */ }
    if (!skoncil) { try { execSync(`docker rm -f ${jmeno}`, { stdio: 'ignore' }); } catch { /* už neběží */ } }
  };
  return { proc, stranka, udalosti, cekejNa, prikaz, konec, skoncil: () => skoncil, vystup: () => vystupProcesu };
}

const origin = (url) => { try { return new URL(url).origin; } catch { return ''; } };

// Výběr organizace → ruční adresa → přihlašovací stránka serveru.
async function pripojRucne(app, base) {
  const { stranka } = app;
  // výběr si pamatuje poslední režim (název firmy / ruční adresa)
  await stranka.waitForSelector('#formFirma:not([hidden]), #formAdresa:not([hidden])', { visible: true });
  if (await stranka.$eval('#formAdresa', (f) => f.hidden)) await stranka.click('#naRucne');
  await stranka.waitForSelector('#adresa', { visible: true });
  await stranka.$eval('#adresa', (el) => { el.value = ''; });
  await stranka.type('#adresa', base);
  await stranka.click('#tlAdresa');
  await waitFor(() => origin(stranka.url()) === base, { timeout: 20000, popis: `načtení ${base}` });
  await stranka.waitForSelector('#email', { visible: true, timeout: 20000 });
}

async function prihlas(app, email) {
  const { stranka } = app;
  await stranka.type('#email', email);
  await stranka.type('#password', H.PW);
  await Promise.all([
    waitFor(() => !/\/login/.test(new URL(stranka.url()).pathname), { timeout: 20000, popis: 'odchod z přihlášení' }),
    stranka.click('button[type="submit"]'),
  ]);
}

const pocetUdalosti = (app) => app.udalosti().length;

H.beh(async () => {
  sestavObraz();
  const vystup = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-desktop-e2e-'));
  console.log(`výstup: ${vystup}`);

  const inst = await H.startInstance({ slug: 'desktop' });
  const su = await inst.superuser();
  expect((await inst.register('anna@e2e.cz')).status === 200, 'registrace Anny');
  await inst.register('petr@e2e.cz');
  const prihlaseniAnny = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'anna@e2e.cz', password: H.PW } })).json;
  const anna = prihlaseniAnny.record;
  const petr = await inst.login('petr@e2e.cz');
  // Notifikace vznikají SKUTEČNOU cestou serveru (ne zápisem přes API — tam smí příjemce
  // měnit jen `read`): Petr dá Anně uzel a komentuje ho; komentáře v okně 10 min server
  // slučuje do jednoho řádku s rostoucím `count` (helpers.js) — přesně to musí rám poznat.
  const uzly = (owner) => [
    { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Okno', title: 'Okno', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 0, y: 380 }, data: { title: 'Hlídač', status: 'todo', ...(owner ? { owner } : {}) } },
  ];
  const komentar = (mapId, text) => inst.api('POST', '/api/collections/comments/records', { token: petr, body: { goalmap: mapId, node_id: 'n1', text } });
  const notifikaceAnny = async (filtr) => (await inst.api('GET',
    `/api/collections/notifications/records?perPage=50&sort=-created&filter=${encodeURIComponent(filtr)}`, { token: prihlaseniAnny.token })).json.items || [];

  const app = await spustAplikaci(vystup);
  try {
    const { stranka, cekejNa, prikaz } = app;
    await cekejNa('pripraven');
    await waitFor(() => stranka.url().startsWith('kb-app://app/vyber.html'), { popis: 'výběr organizace' });
    await stranka.waitForSelector('#firma', { visible: true });

    // --- místní stránka: privilegované API jen tady, API pro server ne
    const typy = await stranka.evaluate(() => `${typeof window.kbApp}/${typeof window.kbDesktop}`);
    expect(typy === 'object/undefined', `výběr organizace má kbApp a nemá kbDesktop (${typy})`);

    // --- název firmy: náhled adresy jako na webu
    await stranka.type('#firma', 'Moje Firma s.r.o.');
    await waitFor(async () => (await stranka.$eval('#nahled', (e) => e.textContent)) === 'moje-firma.killbottleneck.com', { popis: 'náhled adresy' });
    expect(true, 'náhled adresy z názvu firmy: moje-firma.killbottleneck.com');

    // --- ruční adresa → server → přihlášení
    await pripojRucne(app, inst.base);
    expect(true, 'ruční adresa zkušební instance → přihlašovací stránka serveru v okně');
    const api = await stranka.evaluate(() => ({
      api: window.kbDesktop && window.kbDesktop.api,
      verze: window.kbDesktop && window.kbDesktop.version,
      klice: window.kbDesktop ? Object.keys(window.kbDesktop).sort().join(',') : '',
      kbApp: typeof window.kbApp,
    }));
    const verzeRamu = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')).version;
    expect(api.api === 1 && api.verze === verzeRamu, `stránka serveru má kbDesktop api 1, verze ${api.verze}`);
    expect(api.klice === 'api,changeOrganization,flushDone,supportsFlush,takeOpenRequest,version', `kbDesktop má jen smluvené funkce (${api.klice})`);
    expect(api.kbApp === 'undefined', 'stránka serveru nemá privilegované kbApp');
    const textPrihlaseni = await stranka.evaluate(() => document.body.innerText);
    expect(textPrihlaseni.includes(new URL(inst.base).host) && /Změnit organizaci|Change organization/.test(textPrihlaseni),
      'přihlášení ukazuje adresu organizace a „Změnit organizaci“');

    await prihlas(app, 'anna@e2e.cz');
    expect(true, 'přihlášení e-mailem a heslem v okně aplikace');
    await cekejNa('flushPodporovan');
    expect(true, 'nový web ohlásil rámu podporu uložení rozdělané práce');
    const sw = await stranka.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length));
    expect(sw === 0, `webový service worker se v aplikaci neregistruje (${sw})`);
    await cekejNa('hlidac', (u) => u.stav === 'ok', { timeout: 15000 });
    expect(true, 'hlídač notifikací se ptá serveru jako přihlášená Anna');

    // --- upozornění při skrytém okně: Petr dá Anně uzel
    prikaz('skryj');
    let od = pocetUdalosti(app);
    const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', {
      token: petr, body: { title: 'Okno', nodes: uzly(), edges: [{ id: 'e1', source: 'apex', target: 'n1' }] },
    })).json;
    await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, {
      token: petr, body: { nodes: uzly('anna@e2e.cz'), edges: [{ id: 'e1', source: 'apex', target: 'n1' }] },
    });
    const prirazeni = await waitFor(async () => (await notifikaceAnny('type="node_assigned"'))[0], { popis: 'notifikace o přiřazení' }).catch(() => null);
    expect(!!prirazeni, 'server Anně vytvořil notifikaci o přiřazení uzlu');
    const toast = prirazeni ? await cekejNa('toast', (u) => u.id === prirazeni.id, { od, timeout: 15000 }).catch(() => null) : null;
    expect(!!toast, 'nová notifikace → upozornění Windows');
    expect(!!toast && toast.titulek === `killBottleneck · ${new URL(inst.base).host}`, 'titulek upozornění nese adresu serveru');
    expect(!!toast && toast.text === prirazeni.text, 'upozornění nese text notifikace');
    const odznak = await cekejNa('odznak', (u) => u.pocet >= 1, { od, timeout: 15000 }).catch(() => null);
    expect(!!odznak, 'počet nepřečtených u ikony');

    // --- komentář a druhý komentář: server je sloučí do jednoho řádku (count 2) → ohlásit znovu
    od = pocetUdalosti(app);
    await komentar(mapa.id, 'První poznámka');
    const radek = await waitFor(async () => (await notifikaceAnny('type="node_comment"'))[0], { popis: 'notifikace o komentáři' }).catch(() => null);
    expect(!!radek && !!(await cekejNa('toast', (u) => u.id === radek.id, { od }).catch(() => null)), 'komentář → upozornění');
    const idN = radek && radek.id;
    od = pocetUdalosti(app);
    await komentar(mapa.id, 'Druhá poznámka');
    const slity = await waitFor(async () => (await notifikaceAnny('type="node_comment"')).find((x) => x.id === idN && Number(x.count) >= 2), { popis: 'sloučený řádek' }).catch(() => null);
    expect(!!slity, `server druhý komentář sloučil do téhož řádku (count ${slity && slity.count})`);
    expect(!!(await cekejNa('toast', (u) => u.id === idN, { od }).catch(() => null)), 'sloučená notifikace (vyšší count) → upozornění znovu');

    // --- v popředí se upozornění neukazují (odznak ano)
    prikaz('popredi ano');
    od = pocetUdalosti(app);
    await komentar(mapa.id, 'Třetí poznámka');
    expect(!!(await cekejNa('toastPotlacen', () => true, { od }).catch(() => null)), 'okno v popředí → upozornění potlačeno');
    prikaz('popredi -');

    // --- klik na upozornění → nový web otevře cíl a označí přečtené (bez záložní cesty rámu)
    od = pocetUdalosti(app);
    prikaz(`klikni ${idN}`);
    const cil = `/map/${mapa.id}`;
    await waitFor(() => new URL(stranka.url()).pathname === cil, { timeout: 10000, popis: 'přechod na cíl notifikace' }).catch(() => {});
    expect(new URL(stranka.url()).pathname === cil && new URL(stranka.url()).searchParams.get('node') === 'n1',
      `klik → mapa s uzlem, o kterém notifikace je (${new URL(stranka.url()).pathname}${new URL(stranka.url()).search})`);
    await sleep(2000);
    expect(!app.udalosti().slice(od).some((u) => u.udalost === 'otevreniZaloha'), 'nový web si klik převzal (záložní cesta rámu se nepoužila)');
    const precteno = await inst.api('GET', `/api/collections/notifications/records/${idN}`, { token: su });
    expect(precteno.json && precteno.json.read === true, 'kliknutá notifikace je přečtená');

    // --- nová verze serveru: neohlásit, ale skryté okno tiše obnovit
    prikaz('skryj');
    od = pocetUdalosti(app);
    await inst.api('POST', '/api/collections/notifications/records', { token: su, body: { user: anna.id, type: 'new_version', text: 'E2E: nová verze', read: false } });
    expect(!!(await cekejNa('obnoveniSkryte', (u) => u.duvod === 'novaVerze', { od }).catch(() => null)), 'nová verze serveru → skryté okno se obnoví');
    expect(!app.udalosti().slice(od).some((u) => u.udalost === 'toast' && /nová verze/.test(u.text || '')), 'nová verze se jako upozornění neukazuje');
    prikaz('ukaz');
    await stranka.waitForFunction(() => !!window.kbDesktop, { timeout: 15000 });

    // --- odkazy ven: do prohlížeče, okno zůstává; nebezpečná schémata nikam
    const predtim = stranka.url();
    od = pocetUdalosti(app);
    await stranka.evaluate(() => { window.open('https://example.com/e2e-okno'); });
    expect(!!(await cekejNa('ven', (u) => u.url === 'https://example.com/e2e-okno', { od }).catch(() => null)), 'window.open cizí stránky → výchozí prohlížeč');
    await sleep(2100); // brzda odkazů ven: rozestup 2 s
    await stranka.evaluate(() => { window.location.href = 'https://example.com/e2e-navigace'; });
    expect(!!(await cekejNa('ven', (u) => u.url === 'https://example.com/e2e-navigace', { od }).catch(() => null)), 'navigace na cizí web → výchozí prohlížeč');
    await sleep(500);
    expect(stranka.url() === predtim, 'okno zůstalo na serveru organizace');
    await stranka.evaluate(() => { window.open('ms-msdt:/id PCWDiagnostic'); });
    await sleep(500);
    expect(!app.udalosti().slice(od).some((u) => u.udalost === 'ven' && /^ms-msdt/.test(u.url)), 'ms-msdt: se do systému nepustí');

    // --- oprávnění: web-notifikace a poloha ne
    const notif = await stranka.evaluate(() => Notification.requestPermission());
    expect(notif === 'denied', `webová upozornění zamítnuta (dělá je rám) — ${notif}`);
    const poloha = await stranka.evaluate(() => new Promise((hotovo) => navigator.geolocation.getCurrentPosition(() => hotovo('ok'), (e) => hotovo(e.code), { timeout: 5000 })));
    expect(poloha === 1, `poloha zamítnuta (${poloha})`);

    // --- stahování exportu (blob + a.download)
    od = pocetUdalosti(app);
    await stranka.evaluate(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['{"e2e":true}'], { type: 'application/json' }));
      a.download = 'export-e2e.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    const stazeni = await cekejNa('stahovani', (u) => u.soubor === 'export-e2e.json', { od }).catch(() => null);
    expect(!!stazeni, 'stažení exportu projde rámem');
    await waitFor(() => fs.existsSync(path.join(vystup, 'stazene', 'export-e2e.json')), { timeout: 10000, popis: 'soubor exportu' }).catch(() => {});
    expect(fs.existsSync(path.join(vystup, 'stazene', 'export-e2e.json')), 'soubor exportu je na disku');

    // --- dávka stažení: bez dialogu jen běžné dokumenty; spustitelné jen přes „Uložit jako“
    await sleep(3500); // ať první soubor dávky nenavazuje na export výš
    od = pocetUdalosti(app);
    const stahni = (jmena) => stranka.evaluate((seznam) => {
      for (const jmeno of seznam) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['e2e'], { type: 'application/octet-stream' }));
        a.download = jmeno;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    }, jmena);
    await stahni(['davka-1.pdf', 'davka-2.exe', 'davka-3.pdf']);
    const rozhodnuti = async (soubor, odKdy) => ((await cekejNa('stahovani', (u) => u.soubor === soubor, { od: odKdy }).catch(() => null)) || {}).rozhodnuti;
    expect(await rozhodnuti('davka-1.pdf', od) === 'dialog', 'první soubor → dialog Uložit jako');
    expect(await rozhodnuti('davka-2.exe', od) === 'dialog', '.exe v dávce → jen přes dialog, nikdy potichu do Stažených');
    expect(await rozhodnuti('davka-3.pdf', od) === 'stazene', 'další PDF dávky → rovnou do Stažených');

    // --- skryté okno nestahuje nic (stránka na pozadí po autostartu)
    prikaz('skryj');
    await sleep(500);
    od = pocetUdalosti(app);
    await stahni(['skryte.pdf']);
    expect(await rozhodnuti('skryte.pdf', od) === 'zrusit', 'stažení ze skrytého okna zamítnuto');
    await sleep(1000);
    expect(!fs.existsSync(path.join(vystup, 'stazene', 'skryte.pdf')), 'soubor ze skrytého okna na disku není');
    prikaz('ukaz');
    await sleep(500);

    // --- mikrofon jen když uživatel okno vidí
    const mikrofon = () => stranka.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true })
      .then((proud) => { proud.getTracks().forEach((t) => t.stop()); return 'ok'; }, (e) => e.name));
    const opravneniMikrofonu = async (odKdy) => ((await cekejNa('opravneni', (u) => u.opravneni === 'media', { od: odKdy, timeout: 5000 }).catch(() => null)) || {}).ok;
    prikaz('popredi ne');
    od = pocetUdalosti(app);
    const vPozadi = await mikrofon();
    expect(await opravneniMikrofonu(od) === false && vPozadi !== 'ok', `okno mimo popředí → mikrofon zamítnut (${vPozadi})`);
    prikaz('popredi ano');
    od = pocetUdalosti(app);
    const vPopredi = await mikrofon();
    expect(await opravneniMikrofonu(od) === true && vPopredi === 'ok', `okno v popředí → hlasovka smí mikrofon (${vPopredi})`);
    prikaz('popredi -');

    // --- výpadek serveru: místní stránka místo chyby, po návratu přihlášen dál
    od = pocetUdalosti(app);
    execSync(`docker pause ${inst.name}`, { stdio: 'ignore' });
    prikaz('obnov');
    const offline = await cekejNa('mistni', (u) => u.stranka === 'offline' && !!u.duvod, { od, timeout: 20000 }).catch(() => null);
    expect(!!offline, `server neodpovídá → místní stránka „Server neodpovídá“ (${offline && offline.duvod})`);
    execSync(`docker unpause ${inst.name}`, { stdio: 'ignore' });
    await sleep(1000);
    prikaz('probuzeni');
    await waitFor(() => origin(stranka.url()) === inst.base, { timeout: 20000, popis: 'návrat na server' }).catch(() => {});
    await sleep(3000);
    expect(origin(stranka.url()) === inst.base && !/\/login/.test(new URL(stranka.url()).pathname),
      `po návratu serveru zpět v aplikaci a stále přihlášen (${new URL(stranka.url()).pathname})`);

    // --- výpadek → „Změnit organizaci“: rozepsaný výběr nepřepíše opakování offline stránky (30 s)
    od = pocetUdalosti(app);
    execSync(`docker pause ${inst.name}`, { stdio: 'ignore' });
    prikaz('obnov');
    await cekejNa('mistni', (u) => u.stranka === 'offline' && !!u.duvod, { od, timeout: 20000 }).catch(() => null);
    // jako klik na tlačítko: stránka se hned nahradí výběrem, na výsledek se nečeká
    await stranka.evaluate(() => { setTimeout(() => window.kbApp.zmenit(), 0); });
    await waitFor(() => stranka.url().startsWith('kb-app://app/vyber.html'), { timeout: 15000, popis: 'výběr organizace' });
    execSync(`docker unpause ${inst.name}`, { stdio: 'ignore' });
    await stranka.waitForSelector('#formFirma:not([hidden]), #formAdresa:not([hidden])', { visible: true });
    if (await stranka.$eval('#formFirma', (f) => f.hidden)) await stranka.click('#naFirmu').catch(() => {});
    await stranka.waitForSelector('#firma', { visible: true }).catch(() => {});
    await stranka.type('#firma', 'Rozepsaná firma');
    await sleep(33_000);
    const porad = stranka.url().startsWith('kb-app://app/vyber.html')
      && (await stranka.$eval('#firma', (e) => e.value).catch(() => '')) === 'Rozepsaná firma';
    expect(porad, 'po 30 s je výběr organizace pořád otevřený i s rozepsaným názvem');
    await stranka.click('#seznam li .polozka');
    await waitFor(() => origin(stranka.url()) === inst.base, { timeout: 20000, popis: 'zpět na server' }).catch(() => {});

    // --- změna organizace z webu: výběr organizace s uloženou organizací
    await stranka.evaluate(() => window.kbDesktop.changeOrganization());
    await waitFor(() => stranka.url().startsWith('kb-app://app/vyber.html'), { timeout: 15000, popis: 'výběr organizace' });
    await stranka.waitForSelector('#seznam li', { visible: true });
    expect((await stranka.$$('#seznam li')).length === 1, 'uložená organizace je v seznamu');
    await stranka.click('#seznam li .polozka');
    await waitFor(() => origin(stranka.url()) === inst.base, { timeout: 20000, popis: 'zpět na server' }).catch(() => {});
    expect(origin(stranka.url()) === inst.base, 'klik na uloženou organizaci → zpět na server');

    // --- starší server (web bez desktopové části): okno i upozornění fungují, klik jde na seznam
    if (STARY_IMAGE) {
      const stary = await H.startInstance({ slug: 'desktop-stary', image: STARY_IMAGE });
      const suS = await stary.superuser();
      await stary.register('bara@e2e.cz');
      const bara = (await stary.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'bara@e2e.cz', password: H.PW } })).json.record;
      await stranka.evaluate(() => window.kbDesktop.changeOrganization());
      await waitFor(() => stranka.url().startsWith('kb-app://app/vyber.html'), { timeout: 15000, popis: 'výběr organizace' });
      await pripojRucne(app, stary.base);
      const text = await stranka.evaluate(() => document.body.innerText);
      expect(!/Změnit organizaci|Change organization/.test(text), 'starší web nemá řádek organizace (o aplikaci neví)');
      // starší web service worker registruje — v aplikaci ho musí zarazit rám (jinak by při
      // výpadku servíroval starou stránku místo hlášky „Server neodpovídá“)
      await sleep(4000);
      const swStary = await stranka.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length));
      expect(swStary === 0, `starší server: service worker zablokoval rám (${swStary})`);
      const predPrihlasenim = pocetUdalosti(app);
      await prihlas(app, 'bara@e2e.cz');
      // první dotaz za Báru = výchozí stav; notifikace vložená až PO něm je nová
      await cekejNa('hlidac', (u) => u.stav === 'ok', { od: predPrihlasenim, timeout: 15000 }).catch(() => {});
      prikaz('skryj');
      od = pocetUdalosti(app);
      const n2 = await stary.api('POST', '/api/collections/notifications/records', { token: suS, body: { user: bara.id, type: 'node_assigned', text: 'E2E: starší server', read: false } });
      expect(!!(await cekejNa('toast', (u) => u.text === 'E2E: starší server', { od, timeout: 15000 }).catch(() => null)), 'starší server: upozornění Windows chodí (hlídá je rám)');
      od = pocetUdalosti(app);
      prikaz(`klikni ${n2.json && n2.json.id}`);
      expect(!!(await cekejNa('otevreniZaloha', () => true, { od, timeout: 8000 }).catch(() => null)), 'starší web si klik nepřevezme → rám otevře seznam upozornění');
      await waitFor(() => new URL(stranka.url()).pathname === '/notifications', { timeout: 8000, popis: 'seznam upozornění' }).catch(() => {});
      expect(new URL(stranka.url()).pathname === '/notifications', 'záložní cesta: /notifications');

      // klik na starší upozornění první organizace → okno se vrátí do NÍ (ne id cizí firmy sem)
      od = pocetUdalosti(app);
      prikaz(`klikniZ ${inst.base} ${idN}`);
      const zpet = await cekejNa('nacitam', (u) => u.origin === inst.base, { od, timeout: 15000 }).catch(() => null);
      expect(!!zpet && !app.udalosti().slice(od).some((u) => u.udalost === 'otevriNotifikaci'),
        'klik na upozornění jiné organizace → přepnutí do ní, id se cizímu serveru neposílá');
      await waitFor(() => origin(stranka.url()) === inst.base, { timeout: 20000, popis: 'zpět na první organizaci' }).catch(() => {});
    }

    // --- uložené nastavení a ukončení
    const nast = JSON.parse(fs.readFileSync(path.join(vystup, 'profil', 'nastaveni.json'), 'utf8'));
    expect(nast.organizace.some((o) => o.origin === inst.base), 'nastavení si pamatuje organizaci');
    prikaz('ukonci');
    await waitFor(() => app.skoncil(), { timeout: 15000, popis: 'ukončení aplikace' }).catch(() => {});
    expect(app.skoncil(), 'aplikace se z menu „Ukončit“ opravdu ukončí');
  } finally {
    await app.konec();
  }
}, { nazev: 'DESKTOP-E2E' });
