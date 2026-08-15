// UI e2e: grafické skiny (výběr, persistence, dark souhra, import, instanční default, lite).
//
// Ověřuje celou cestu skinu: dialog Vzhled → computed CSS proměnné se REÁLNĚ
// změní (ne jen stav Reactu), volba přežije reload bez záblesku (cache před
// renderem) i na serveru (users.skin_id), tmavý režim bere dark sekci skinu,
// plátno mapy jede z --canvas-* tokenů, nevalidní import se odmítne S HLÁŠKOU
// (poučení z QA v0.9: texty notifikací nikdo nehlídal), instanční default
// obarví login a neprebije vlastní volbu, v lite funguje nativní select.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20519';
const NAME = 'flowmap-e2e-ui-skins';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// hodnoty ze src/lib/skins.js — kdyby se vestavěné skiny změnily, test to chytí
const SEPIA_LIGHT_BG = '40 30% 96%';
const SEPIA_DARK_BG = '30 12% 11%';
const TERMINAL_LIGHT_BG = '160 10% 9%';
const CONTRAST_LIGHT_BG = '0 0% 100%';
const CUSTOM_BG = '300 40% 90%';

const cssVar = (page, name) => page.evaluate(
  (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

// Přepínač světlý/tmavý PŘÍMO v dialogu skinů (Richard 12. 8. 2026: „když
// přepínám skiny, bylo by super měnit i tmavý a světlý — nemusím lézt do mapy").
// Skin platí pro oba režimy, takže bez přepínače byla vidět jen půlka výsledku.
const overPrepinacRezimu = async (page, ok) => {
  ok(await page.$('[data-theme-pick]') !== null, 'dialog skinů má přepínač světlý/tmavý');
  const pred = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.evaluate((r) => document.querySelector(`[data-theme-pick="${r}"]`)?.click(), pred ? 'light' : 'dark');
  await new Promise((r) => setTimeout(r, 800));
  const po = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  ok(pred !== po, `přepnutí režimu z dialogu funguje (${pred ? 'tmavý' : 'světlý'} → ${po ? 'tmavý' : 'světlý'})`);
  ok(await page.$('[role="dialog"]') !== null, 'a dialog přitom zůstane otevřený');
  await page.evaluate((r) => document.querySelector(`[data-theme-pick="${r}"]`)?.click(), pred ? 'dark' : 'light');
  await new Promise((r) => setTimeout(r, 800));
};

const openSkinDialog = async (page) => {
  await page.click('header button[aria-label="Uživatelské menu"]');
  await page.waitForSelector('[data-skin-menu-item]', { timeout: 5000 });
  await page.click('[data-skin-menu-item]');
  await page.waitForSelector('[data-skin-card]', { timeout: 5000 });
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20519:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    // 401/403 jsou očekávané JEN v anonymní fázi (po localStorage.clear) — plošný
    // filtr by maskoval rozbitá autorizovaná volání (vzor „testy, co nic nedokazují")
    let anonPhase = false;
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (anonPhase && /40[13]/.test(m.text())) return;
      // písma z Googlu nejsou vada aplikace (viz komentář v ostatních sadách);
      // adresa je v m.location().url, ne v textu hlášky
      const u = (m.location() && m.location().url) || '';
      if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) return;
      errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewport(DESKTOP);

    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(1500);

    // mapa s hranou — kvůli kontrole, že plátno jede z --canvas-* tokenů
    const mapId = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const m = await (await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          title: 'SKIN-MAPA',
          nodes: [
            { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'SKIN-MAPA', title: 'SKIN-MAPA', status: 'todo' } },
            { id: 'n1', type: 'goalNode', position: { x: 0, y: 220 }, data: { title: 'Krok', status: 'todo' } },
          ],
          edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
        }),
      })).json();
      return m.id;
    });

    console.log('== výběr vestavěného skinu v dialogu Vzhled ==');
    const bgBefore = await cssVar(page, '--background');
    await openSkinDialog(page);
    await overPrepinacRezimu(page, expect);
    expect((await page.$$('[data-skin-card]')).length >= 4, 'dialog nabízí aspoň 4 vestavěné skiny');
    await page.click('[data-skin-card="sepia"]');
    await sleep(800);
    expect(await page.$('#kb-skin') !== null, 'vznikl <style id="kb-skin">');
    const bgAfter = await cssVar(page, '--background');
    expect(bgAfter === SEPIA_LIGHT_BG && bgAfter !== bgBefore,
      `--background se změnilo na Papír (${bgAfter})`);

    console.log('== persistence: reload bez záblesku + uloženo k účtu ==');
    // domcontentloaded (bez čekání na síť): skin musí platit UŽ z localStorage
    // cache před prvním renderem — jinak by každé otevření bliklo výchozími barvami
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const bgEarly = await cssVar(page, '--background');
    expect(bgEarly === SEPIA_LIGHT_BG, `skin platí hned při domcontentloaded (${bgEarly})`);
    await sleep(1500);
    const onServer = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await (await fetch(`/api/collections/users/records/${auth.record?.id || auth.model?.id}`,
        { headers: { Authorization: auth.token } })).json();
      return { skin_id: r.skin_id, skin_custom: r.skin_custom };
    });
    expect(onServer.skin_id === 'sepia', `server má users.skin_id = sepia (${onServer.skin_id})`);
    // malůvka i na desktopu (titulka) — Papír kreslí linky sešitu
    expect(!!(await page.$('[data-skin-pattern="lines"]')), 'titulka (desktop) kreslí malůvku skinu');

    console.log('== souhra s tmavým režimem (dark sekce skinu) ==');
    await page.click('header button[title="Přepnout na tmavý režim"]');
    await sleep(500);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    const bgDark = await cssVar(page, '--background');
    expect(isDark && bgDark === SEPIA_DARK_BG, `tmavý režim bere dark sekci skinu (${bgDark})`);
    await page.click('header button[title="Přepnout na světlý režim"]');
    await sleep(500);
    expect(await cssVar(page, '--background') === SEPIA_LIGHT_BG, 'přepnutí zpět vrátí světlou sekci');

    console.log('== plátno mapy jede z --canvas-* tokenů ==');
    await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__edge-path', { timeout: 15000 });
    const canvas = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const resolve = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
      const edge = document.querySelector('.react-flow__edge-path');
      const dot = document.querySelector('.react-flow__background circle');
      const out = {
        edge: edge ? getComputedStyle(edge).stroke : null,
        edgeWant: resolve('hsl(var(--canvas-edge))'),
        dot: dot ? getComputedStyle(dot).fill : null,
        dotWant: resolve('hsl(var(--canvas-dots))'),
      };
      probe.remove();
      return out;
    });
    expect(canvas.edge === canvas.edgeWant, `hrana má barvu --canvas-edge (${canvas.edge})`);
    expect(canvas.dot === canvas.dotWant, `tečky pozadí mají barvu --canvas-dots (${canvas.dot})`);
    // malůvka POD plátnem mapy: existuje a uzel se kreslí NAD ní
    expect(!!(await page.$('[data-skin-pattern="lines"]')), 'editor mapy má malůvku skinu pod plátnem');
    // skin jde změnit i Z MAPY — tlačítko palety v ovládání plátna
    await page.click('[data-skin-controls]');
    await page.waitForSelector('[data-skin-card]', { timeout: 5000 });
    await page.click('[data-skin-card="ocean"]');
    await sleep(800);
    expect(await cssVar(page, '--background') === '210 45% 97%', 'výběr skinu přímo z editoru funguje (Oceán)');
    await page.keyboard.press('Escape');
    await sleep(400);
    // zpět na sepii, ať navazující kontroly sedí
    await page.click('[data-skin-controls]');
    await page.waitForSelector('[data-skin-card]', { timeout: 5000 });
    await page.click('[data-skin-card="sepia"]');
    await sleep(800);
    await page.keyboard.press('Escape');
    await sleep(400);
    // minimapa jde minimalizovat (překrývala malůvku skinu)
    expect(!!(await page.$('.react-flow__minimap')), 'minimapa je vidět');
    await page.click('[data-minimap-toggle]');
    await sleep(400);
    expect(!(await page.$('.react-flow__minimap')), 'klik ji schová');
    await page.click('[data-minimap-toggle]');
    await sleep(400);
    expect(!!(await page.$('.react-flow__minimap')), 'druhý klik ji vrátí');
    const nodeAbove = await page.evaluate(() => {
      const node = document.querySelector('.react-flow__node');
      if (!node) return false;
      const r = node.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(el && el.closest('.react-flow__node'));
    });
    expect(nodeAbove, 'uzel mapy leží NAD malůvkou (klik jde do uzlu)');

    console.log('== export mapy je WYSIWYG — stejné barvy včetně pozadí skinu ==');
    // Terminál je tmavý i ve světlém režimu — export s ním MUSÍ vyjít tmavý
    // (Richard 31. 7.: „ať je to ve stejné barvě s pozadím, jako když se na to
    // dívám na telefonu"). Kdyby se snímalo přes bílou, měření níž to chytí.
    const patchSkin = (id) => page.evaluate(async (skinId) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      await fetch(`/api/collections/users/records/${auth.record?.id || auth.model?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: auth.token },
        body: JSON.stringify({ skin_id: skinId }),
      });
    }, id);
    await patchSkin('terminal');
    await page.setViewport({ width: 1920, height: 950 }); // pod 1850 px se Export schovává do ⋮
    await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__edge-path', { timeout: 15000 });
    await sleep(1000);
    expect(await cssVar(page, '--background') === '160 10% 15%', 'aktivní je Terminál (tmavý i v light)');
    // ovládací panel plátna musí jet z tokenů i ve SVĚTLÉM režimu — s tmavým
    // skinem býval neviditelně bílý (Richardův screenshot, Půlnoc/Terminál)
    const controlsOk = await page.evaluate(() => {
      const btn = document.querySelector('.react-flow__controls button');
      if (!btn) return { ok: false, why: 'panel nenalezen' };
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      probe.style.color = 'hsl(var(--card))';
      const want = getComputedStyle(probe).color;
      probe.remove();
      const got = getComputedStyle(btn).backgroundColor;
      return { ok: got === want, why: `${got} vs ${want}` };
    });
    expect(controlsOk.ok, `ovládání plátna má barvu karty skinu i v light (${controlsOk.why})`);
    // stažení PNG přesměrovat do window.__pngs (ať se dá snímek přeměřit)
    await page.evaluate(() => {
      window.__pngs = [];
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && (this.href || '').startsWith('data:image')) { window.__pngs.push(this.href); return undefined; }
        return orig.apply(this);
      };
    });
    // Radix menu chce skutečné pointer eventy — syntetický el.click() ho neotevře
    let exportBtn = null;
    for (const h of await page.$$('button')) {
      if ((await h.evaluate((el) => (el.innerText || '').trim())) === 'Export') { exportBtn = h; break; }
    }
    expect(!!exportBtn, 'toolbar má tlačítko Export (viewport ≥1850 px)');
    await exportBtn.click();
    await page.waitForSelector('[role="menuitem"]', { timeout: 5000 });
    let clickedPng = false;
    for (const h of await page.$$('[role="menuitem"]')) {
      if ((await h.evaluate((el) => (el.innerText || ''))).includes('Exportovat jako PNG')) {
        await h.click();
        clickedPng = true;
        break;
      }
    }
    expect(clickedPng, 'menu Export → Exportovat jako PNG');
    let got = 0;
    for (let i = 0; i < 30; i++) { got = await page.evaluate(() => window.__pngs.length); if (got) break; await sleep(500); }
    expect(got === 1, `export vyrobil PNG (${got})`);
    const snimek = await page.evaluate(async () => {
      const img = new Image();
      img.src = window.__pngs[0];
      await new Promise((r) => { img.onload = r; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const stepX = Math.max(20, Math.floor(img.width / 40));
      const stepY = Math.max(20, Math.floor(img.height / 40));
      let darkPx = 0, total = 0;
      for (let x = 10; x < img.width; x += stepX) {
        for (let y = 10; y < img.height; y += stepY) {
          const d = ctx.getImageData(x, y, 1, 1).data;
          total++;
          if (d[0] + d[1] + d[2] < 300) darkPx++;
        }
      }
      const roh = ctx.getImageData(3, img.height - 4, 1, 1).data; // pozadí mimo uzly
      return { ratio: darkPx / total, corner: roh[0] + roh[1] + roh[2], w: img.width, h: img.height };
    });
    expect(snimek.ratio > 0.6,
      `snímek je tmavý jako aplikace se skinem (${Math.round(snimek.ratio * 100)} % tmavých px, ${snimek.w}×${snimek.h})`);
    expect(snimek.corner < 250, `pozadí snímku má barvu skinu, ne bílou (r+g+b=${snimek.corner})`);
    expect(await cssVar(page, '--background') === '160 10% 15%'
      && await page.evaluate(() => !document.getElementById('kb-skin').disabled),
    'skin v aplikaci zůstal beze změny');
    await patchSkin('sepia');   // navazující sekce počítají se sépiovým skinem
    await page.setViewport(DESKTOP);

    console.log('== import: nevalidní se odmítne S HLÁŠKOU, validní se aplikuje ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1000);
    await openSkinDialog(page);
    // rozkliknout import (tlačítko se pak mění na „Ze souboru…")
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').includes('Importovat skin'));
      if (b) b.click();
    });
    await page.waitForSelector('[data-skin-import]', { timeout: 5000 });
    const typeImport = (val) => page.evaluate((v) => {
      const el = document.querySelector('[data-skin-import]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, val);
    const evil = JSON.stringify({
      format: 'kb-skin', version: 1, name: 'Zlo',
      light: { background: '1 2% 3%', 'font-body': ['x;url(https://evil.example)', 'sans-serif'] },
    });
    await typeImport(evil);
    await page.click('[data-skin-import-apply]');
    await sleep(800);
    const afterEvil = await cssVar(page, '--background');
    expect(afterEvil === SEPIA_LIGHT_BG, `nevalidní skin (url ve fontu) se NEaplikoval (${afterEvil})`);
    const toastTxt = await page.evaluate(() => document.body.innerText);
    expect(toastTxt.includes('Skin se nepodařilo importovat'), 'uživatel dostal srozumitelnou chybovou hlášku');
    // validní vlastní skin s propašovaným neznámým tokenem — token musí zmizet
    const custom = JSON.stringify({
      format: 'kb-skin', version: 1, name: 'E2E Vlastní',
      light: { background: CUSTOM_BG, primary: '300 70% 40%', 'status-hack': '1 2% 3%' },
    });
    await typeImport(custom);
    await page.click('[data-skin-import-apply]');
    await sleep(1200);
    expect(await cssVar(page, '--background') === CUSTOM_BG, 'validní vlastní skin se aplikoval');
    const onServer2 = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await (await fetch(`/api/collections/users/records/${auth.record?.id || auth.model?.id}`,
        { headers: { Authorization: auth.token } })).json();
      return { skin_id: r.skin_id, skin_custom: r.skin_custom };
    });
    expect(onServer2.skin_id === 'custom' && onServer2.skin_custom?.name === 'E2E Vlastní',
      'server má skin_id=custom a vlastní skin uložený');
    expect(onServer2.skin_custom && onServer2.skin_custom.light
      && onServer2.skin_custom.light['status-hack'] === undefined,
    'propašovaný neznámý token na serveru NEPŘEŽIL (sanitizace hookem)');

    console.log('== instanční default: obarví login, neprebije vlastní volbu ==');
    const inst = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await fetch('/api/kb/instance-skin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth.token },
        body: JSON.stringify({ skin: {
          format: 'kb-skin', version: 1, name: 'Terminál',
          light: { background: '160 10% 9%', primary: '140 70% 45%' },
        } }),
      });
      return r.status;
    });
    expect(inst === 200, `POST /api/kb/instance-skin prošel (${inst})`);
    // odhlásit = smazat local storage (vč. cache skinu) → anonymní login stránka
    anonPhase = true;
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const bgLogin = await cssVar(page, '--background');
    expect(bgLogin === TERMINAL_LIGHT_BG, `login obrazovka má instanční skin (${bgLogin})`);
    // přihlášení zpět: vlastní volba účtu musí instanční default přebít
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz');
    await page.type('#password', 'testheslo123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(2500);
    anonPhase = false;
    const bgBack = await cssVar(page, '--background');
    expect(bgBack === CUSTOM_BG, `po přihlášení platí vlastní skin účtu, ne instanční (${bgBack})`);

    console.log('== lite: nativní select bez Radixu ==');
    await page.setViewport(PHONE);
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const sel = await page.$('select[data-skin-select]');
    expect(!!sel, 'v lite je nativní select skinů');
    const options = await page.evaluate(() =>
      [...document.querySelectorAll('select[data-skin-select] option')].map((o) => o.value));
    expect(options.includes('custom'), `účet s vlastním skinem má v lite volbu Vlastní (${options.join(',')})`);
    // malůvka pozadí: každý vestavěný ji má; custom bez patternu nekreslí nic
    await page.select('select[data-skin-select]', 'ocean');
    await sleep(1200);
    expect(!!(await page.$('[data-skin-pattern="wave"]')), 'skin Oceán kreslí v lite vlnku');
    await page.select('select[data-skin-select]', 'custom');
    await sleep(1200);
    expect(!(await page.$('[data-skin-pattern]')), 'vlastní skin bez patternu malůvku nekreslí');
    await page.select('select[data-skin-select]', 'contrast');
    await sleep(1200);
    expect(await cssVar(page, '--background') === CONTRAST_LIGHT_BG,
      'výběr v lite přepnul skin (Vysoký kontrast)');
    expect(!!(await page.$('[data-skin-pattern="stripes"]')), 'Vysoký kontrast kreslí pruhy');
    // tmavý/světlý jde přepnout i z mobilu (dřív šlo jen z hlavičky plné verze).
    // ⚠️ Odrolovat: přepínač sedí na konci stránky a od 6. 8. 2026 je pod
    // okrajem obrazovky, protože úvodní mapa přidala úkoly a stránka narostla.
    // Bez odrolování klik dopadne na spodní pevnou lištu (ověřeno měřením:
    // elementFromPoint vrací navigaci, ne tlačítko).
    await page.evaluate(() => document.querySelector('[data-theme-toggle-lite]')
      .scrollIntoView({ block: 'center' }));
    await sleep(500);
    const darkBefore = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await page.click('[data-theme-toggle-lite]');
    await sleep(400);
    const darkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(darkBefore !== darkAfter, `lite přepínač režimu funguje (${darkBefore} → ${darkAfter})`);
    await page.click('[data-theme-toggle-lite]');
    await sleep(400);
    await page.goto(`${BASE}/lite`, { waitUntil: 'domcontentloaded' });
    expect(await cssVar(page, '--background') === CONTRAST_LIGHT_BG, 'volba z lite přežije reload');

    const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
    expect(relevant.length === 0, `konzole bez chyb (${relevant.length}${relevant.length ? ': ' + relevant[0].slice(0, 140) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
