// Back in the Windows app (product/desktop): the mouse's back button arrives as the window's app-command
// `browser-backward` → webContents.navigationHistory.goBack() — the BROWSER's back, which (unlike history.back() from a
// page) jumps over history entries the page added without a fresh user activation. Richard 17 Nov 2026: in Brain
// training → sudoku back threw him out of the app. The first fix re-added its history guard from the popstate handler
// after the game closed; Chrome marked the page entry as skippable and the SECOND back left the page instead of
// closing the zone. Only a real Electron shows that (headless Chrome's mouse button takes the page's own path).
//
// Run (outside the full regression like e2e.js; needs the kb-desktop-electron image and `npm install` in
// product/desktop — a node_modules symlink to another checkout works, its real path is mounted too):
//   KB_TEST_IMAGE=kb-zpet node product/tests/desktop-e2e/zpet.js
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

const volnyPort = () => new Promise((hotovo) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => hotovo(port)); });
});

const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  JSON.parse(body);
  res.end(JSON.stringify({ message: { role: 'assistant', content: 'ok' }, prompt_eval_count: 10, eval_count: 2, done: true }));
};

async function spustAplikaci(vystup) {
  const cdpPort = await volnyPort();
  const displej = 100 + Math.floor(Math.random() * 400);
  const jmeno = `kb-desktop-zpet-${process.pid}`;
  const log = path.join(vystup, 'udalosti.jsonl');
  fs.writeFileSync(log, '');
  execSync(`docker rm -f ${jmeno} 2>/dev/null; true`, { stdio: 'ignore' });
  // a node_modules symlink (worktree) must resolve inside the container too
  const nm = fs.realpathSync(path.join(DESKTOP, 'node_modules'));
  const nmMount = nm === path.join(DESKTOP, 'node_modules') ? [] : ['-v', `${nm}:${nm}:ro`];
  const proc = spawn('docker', [
    'run', '--rm', '-i', '--name', jmeno, '--network', 'host', '--shm-size', '512m',
    '--user', `${process.getuid()}:${process.getgid()}`,
    '-e', 'KB_DESKTOP_E2E=1', '-e', 'KB_DESKTOP_E2E_LOG=/vystup/udalosti.jsonl',
    '-e', 'KB_DESKTOP_USERDATA=/vystup/profil', '-e', 'KB_DESKTOP_HLIDAC_MS=60000', '-e', 'LANGUAGE=cs', '-e', 'LANG=C.UTF-8',
    '-v', `${DESKTOP}:/app:ro`, ...nmMount, '-v', `${vystup}:/vystup`, OBRAZ_ELECTRON,
    'sh', '-c', `Xvfb :${displej} -screen 0 1400x900x24 -nolisten tcp >/dev/null 2>&1 & export DISPLAY=:${displej}; sleep 1; `
      + `exec dbus-run-session -- /app/node_modules/electron/dist/electron --no-sandbox --remote-debugging-port=${cdpPort} /app`,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let vystupProcesu = '';
  proc.stdout.on('data', (d) => { vystupProcesu += d; });
  proc.stderr.on('data', (d) => { vystupProcesu += d; });
  let skoncil = false;
  proc.on('exit', () => { skoncil = true; });
  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch { return false; }
  }, { timeout: 40000, popis: 'ladicí port Electronu' }).catch((e) => { throw new Error(`${e.message}\n${vystupProcesu.slice(-2000)}`); });
  const puppeteer = require('puppeteer-core');
  const prohlizec = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}`, defaultViewport: null });
  const stranka = await waitFor(async () => (await prohlizec.pages()).find((p) => p.url() && !p.url().startsWith('devtools')), { timeout: 15000, popis: 'okno aplikace' });
  const prikaz = (radek) => proc.stdin.write(`${radek}\n`);
  const konec = async () => {
    try { prohlizec.disconnect(); } catch { /* už odpojeno */ }
    if (!skoncil) { try { execSync(`docker rm -f ${jmeno}`, { stdio: 'ignore' }); } catch { /* už neběží */ } }
  };
  return { stranka, prikaz, konec };
}

const origin = (url) => { try { return new URL(url).origin; } catch { return ''; } };

H.beh(async () => {
  execSync(`docker build -q -t ${OBRAZ_ELECTRON} ${path.join(__dirname)}`, { stdio: ['ignore', 'ignore', 'inherit'] });
  const vystup = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-desktop-zpet-'));
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'desktop-zpet', addHostGateway: true, env: { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0 } });
  await inst.register('anna@e2e.cz');

  const app = await spustAplikaci(vystup);
  try {
    const { stranka: s, prikaz } = app;
    const cekej = (sel, ms = 10000) => s.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
    const zmizi = (sel, ms = 8000) => s.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true).catch(() => false);
    const cesta = () => s.evaluate(() => window.location.pathname).catch(() => '?');
    const hra = () => s.$eval('[data-testid="brain-vrstva"]', (e) => e.dataset.hra).catch(() => '');
    // the mouse's back button in the Windows app (no click on the page: app-command)
    const zpet = async () => { prikaz('zpet'); await sleep(1200); };

    // organization picker → manual address → sign-in
    await s.waitForSelector('#formFirma:not([hidden]), #formAdresa:not([hidden])', { visible: true, timeout: 30000 });
    if (await s.$eval('#formAdresa', (f) => f.hidden)) await s.click('#naRucne');
    await s.waitForSelector('#adresa', { visible: true });
    await s.type('#adresa', inst.base);
    await s.click('#tlAdresa');
    await waitFor(() => origin(s.url()) === inst.base, { timeout: 20000, popis: 'server v okně' });
    await s.waitForSelector('#email', { visible: true, timeout: 20000 });
    await s.type('#email', 'anna@e2e.cz');
    await s.type('#password', H.PW);
    await s.click('button[type="submit"]');
    await waitFor(async () => (await cesta()) === '/' && !(await s.$('#password')), { timeout: 20000, popis: 'přihlášení' });
    expect(true, 'signed in inside the Windows app');

    // a page before the app's home page, so "leaving the page" is visible
    const nav = (k) => waitFor(() => s.evaluate((x) => { const a = document.querySelector(`[data-nav="${x}"]`); if (a) a.click(); return !!a; }, k), { timeout: 15000, popis: `lišta ${k}` });
    await nav('tasks');
    await waitFor(async () => (await cesta()) === '/tasks', { timeout: 10000, popis: '/tasks' });
    await nav('projects');
    await waitFor(async () => (await cesta()) === '/', { timeout: 10000, popis: '/' });
    await sleep(800);

    if (!(await s.$('[data-testid="chat-input"]'))) { await cekej('[data-testid="chat-tab"]'); await s.click('[data-testid="chat-tab"]'); }
    expect(await cekej('[data-testid="chat-input"]'), 'assistant panel open');
    if (await s.$('[data-testid="chat-porada-ne"]')) await s.click('[data-testid="chat-porada-ne"]');

    console.log('== Brain training → sudoku → back, back (app-command, no click in between) ==');
    await s.click('[data-testid="chat-brain-toggle"]');
    expect(await cekej('[data-testid="brain-vrstva"][data-hra="hub"]'), 'the zone is open on the list of games');
    const sel = '[data-testid="brain-hrat-sudoku"]';
    await s.waitForSelector(sel);
    await s.$eval(sel, (e) => e.scrollIntoView({ block: 'center' }));
    await sleep(300);
    await s.click(sel);
    expect(await cekej('[data-testid="brain-vrstva"][data-hra="sudoku"][data-nacteno="1"]', 15000), 'sudoku loaded');
    {
      const box = await (await s.$('[data-testid="brain-iframe"]')).boundingBox();
      await s.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // the person plays (focus in the game)
    }
    await sleep(6000); // past the click's transient activation, like a person thinking over a sudoku
    await zpet();
    expect((await hra()) === 'hub', `back from the game = the list of games (${await hra()})`);
    expect((await cesta()) === '/', `still on the home page (${await cesta()})`);
    await zpet();
    expect(await zmizi('[data-testid="brain-vrstva"]'), 'back again = the zone closed');
    expect((await cesta()) === '/', `the SECOND back did not leave the page (${await cesta()})`);
    await zpet();
    expect((await cesta()) === '/tasks', `with nothing open back is an ordinary one (${await cesta()})`);
    await nav('projects'); // home again for the next case
    await waitFor(async () => (await cesta()) === '/', { timeout: 8000, popis: 'zpět na /' });

    console.log('== relax locked with a PIN: back does nothing, twice ==');
    if (!(await s.$('[data-testid="chat-input"]'))) { await s.click('[data-testid="chat-tab"]'); await cekej('[data-testid="chat-input"]'); }
    await s.click('[data-testid="chat-relax-toggle"]');
    expect(await cekej('[data-testid="relax-vrstva"]'), 'relax open');
    if (!(await cekej('[data-testid="relax-zamknout"]', 8000))) await s.screenshot({ path: path.join(vystup, 'relax.png') });
    await s.click('[data-testid="relax-zamknout"]');
    await cekej('[data-testid="relax-pin-nastavit"]');
    await s.type('[data-testid="relax-pin"]', '1234');
    await sleep(300);
    await s.type('[data-testid="relax-pin"]', '1234');
    expect(await cekej('[data-testid="relax-vrstva"][data-zamek="1"]'), 'locked');
    await sleep(6000);
    await zpet();
    await zpet();
    await zpet();
    const zamek = await s.$eval('[data-testid="relax-vrstva"]', (e) => e.dataset.zamek).catch(() => '');
    expect(zamek === '1' && (await cesta()) === '/', `three backs: still locked on the same page (${zamek}, ${await cesta()})`);
    await s.click('[data-testid="relax-odemknout"]');
    await cekej('[data-testid="relax-pin-odemknout"]');
    await s.type('[data-testid="relax-pin"]', '1234');
    expect(await cekej('[data-testid="relax-vrstva"][data-zamek="0"]'), 'unlocked');
    await sleep(6000);
    await zpet();
    expect(await zmizi('[data-testid="relax-vrstva"]') && (await cesta()) === '/', `unlocked relax closes on back, the page stays (${await cesta()})`);
  } finally {
    await app.konec();
  }
}, { nazev: 'DESKTOP-ZPET' });
