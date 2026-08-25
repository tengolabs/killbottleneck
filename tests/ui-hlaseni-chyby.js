// Nahlásit chybu / nápad OČIMA UŽIVATELE.
//
// Serverovou stranu hlídá hlaseni-chyby.js. Tady jde o to, co člověk vidí:
// položka pod panáčkem se ukáže JEN tam, kam je komu psát, a v dialogu musí
// být PŘED odesláním vidět, co všechno spolu se zprávou odejde (u produktu,
// který prodává soukromí dat, nesmí aplikace sbírat kontext potichu).
//
// ⚠️ Nic neodchází ven: KB_REPORT_TO míří na example.com a SMTP se schválně
// NEnastavuje — odeslání tedy skončí chybou, což je tady v pořádku. Sada
// ověřuje UI cestu, ne doručení (to dělá hlaseni-chyby.js proti vlastní jímce).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-hlaseni';
const PORT = 20537;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

const spust = (env) => {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ${env} ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
};
const pockej = async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* startuje */ } await sleep(1000); }
  return false;
};

// otevře menu pod panáčkem a vrátí texty položek
const polozkyMenu = async (page) => {
  // ⚠️ Čekat na panáčka, ne jen kliknout naslepo: bez čekání vrátí sada prázdné
  // menu a kontrola „položka tam není" projde z prázdna (naraženo při psaní).
  await page.waitForSelector('button[data-user-menu]', { timeout: 20000 }).catch(() => {});
  if (!(await page.$('button[data-user-menu]'))) return null;
  await page.click('button[data-user-menu]');
  await sleep(800);
  return page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((x) => (x.textContent || '').trim()));
};

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

    console.log('== self-host bez nastavené adresy: položka NENÍ ==');
    spust('');
    ok(await pockej(), 'instance bez KB_REPORT_TO naběhla');
    await api('POST', '/api/collections/users/records', { body: { email: 'a@example.com', password: PW, passwordConfirm: PW } });
    let auth = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@example.com', password: PW } });
    let page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, auth.json.token, auth.json.record);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const bez = await polozkyMenu(page);
    ok(bez && bez.length > 0, `menu pod panáčkem se otevřelo (${bez ? bez.length : 'panáček nenalezen'} položek)`);
    if (!bez || !bez.length) throw new Error('menu se neotevřelo — kontrola „položka tam není" by prošla z prázdna');
    ok(!bez.some((x) => /Nahlásit|Report a bug/i.test(x)), 'položka „Nahlásit chybu" se NENABÍZÍ');
    ok(!(await page.evaluate(() => !!document.querySelector('[data-menu-report]'))), 'a není ani v DOM');
    await page.close();

    console.log('== naše instance: položka JE a dialog funguje ==');
    spust('-e KB_REPORT_TO=podpora@example.com -e KB_VERSION=v0.38-test');
    ok(await pockej(), 'instance s KB_REPORT_TO naběhla');
    // bez SMTP by config hlásil report_enabled=false → nastavíme poštu (na neexistující
    // jímku: dialog se má otevřít, doručení tu neřešíme)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@example.com superheslo123`, { stdio: 'ignore' });
    const st = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@example.com', password: 'superheslo123' } })).json.token;
    await api('PATCH', '/api/settings', { token: st, body: {
      meta: { appName: 'killBottleneck', appURL: BASE, senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
      smtp: { enabled: true, host: '127.0.0.1', port: 25, tls: false },
    } });
    await api('POST', '/api/collections/users/records', { body: { email: 'b@example.com', password: PW, passwordConfirm: PW } });
    auth = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'b@example.com', password: PW } });

    page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    // ⚠️ Tahle sada kontejner UPROSTŘED běhu vymění (dvě instance, dvě nastavení),
    // takže docker přehodí síť pod nohama otevřeným spojením. ERR_NETWORK_CHANGED
    // je důsledek TÉHLE sady, ne vada aplikace — bez filtru padá zhruba každý
    // druhý běh. Filtruje se JEN tenhle kód, ne „chyby sítě" obecně.
    const nasChurn = (m) => /ERR_NETWORK_CHANGED/.test(m.text());
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m) && !nasChurn(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, auth.json.token, auth.json.record);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2500);

    const s = (await polozkyMenu(page)) || [];
    ok(s.some((x) => /Nahlásit|Report a bug/i.test(x)), `položka „Nahlásit chybu" se nabízí (${s.filter((x) => /Nahlásit|Report/i.test(x)).join('|') || '—'})`);

    await page.evaluate(() => document.querySelector('[data-menu-report]')?.click());
    await sleep(1200);
    const dialog = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return null;
      return {
        text: d.innerText,
        druhy: [...d.querySelectorAll('[data-report-druh]')].map((x) => x.getAttribute('data-report-druh')),
        maPole: !!d.querySelector('#report-text'),
        maOdpoved: !!d.querySelector('[data-report-odpoved]'),
        odpovedVypnuta: d.querySelector('[data-report-odpoved]') ? !d.querySelector('[data-report-odpoved]').checked : false,
        odeslatVypnuto: !!d.querySelector('[data-report-odeslat]')?.disabled,
      };
    });
    ok(dialog !== null, 'dialog se otevřel');
    if (!dialog) throw new Error('dialog se neotevřel — další kontroly by měřily prázdno');
    ok(dialog.druhy.includes('chyba') && dialog.druhy.includes('napad'), 'jde vybrat chybu i nápad');
    ok(dialog.maPole, 'je tam pole na text');
    ok(dialog.odeslatVypnuto, 'Odeslat je zašedlé, dokud není co poslat');

    console.log('== před odesláním je vidět, co odejde ==');
    // ⚠️ Adresa ani instance se od 19. 8. 2026 NEODESÍLAJÍ (Richard: „nepotřebujeme
    // vědět, jaký uživatel a jaká firma"). Dialog to musí říct nahlas a nabídnout
    // zaškrtnutí pro ty, kdo o odpověď stojí.
    ok(/v0\.38-test/.test(dialog.text), 'v dialogu je vidět verze aplikace');
    ok(!/127\.0\.0\.1:|localhost:/.test(dialog.text), 'adresa instance se NEUVÁDÍ');
    ok(/adresa ani název firmy NE/i.test(dialog.text), 'a je řečeno, že adresa neodejde');
    ok(dialog.maOdpoved, 'je tam zaškrtnutí „Chci odpověď"');
    ok(dialog.odpovedVypnuta, 'a je ve výchozím stavu VYPNUTÉ');

    await page.type('#report-text', 'Tlačítko Uložit v mapě nereaguje.');
    await sleep(400);
    const poNapsani = await page.evaluate(() => !document.querySelector('[data-report-odeslat]')?.disabled);
    ok(poNapsani, 'po napsání textu jde Odeslat zmáčknout');

    console.log('== snímek obrazovky: výběrem souboru i Ctrl+V ==');
    // podnět z bety 21. 8. 2026 — „blbě se to popisuje, obrázek řekne víc"
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const pngSoubor = `/tmp/kb-ui-hlaseni-${process.pid}.png`;
    require('fs').writeFileSync(pngSoubor, Buffer.from(pngB64, 'base64'));
    ok(await page.evaluate(() => !!document.querySelector('[data-report-priloha]')),
      'dialog nabízí tlačítko „Přiložit snímek obrazovky"');
    const vstup = await page.$('[data-report-priloha-input]');
    await vstup.uploadFile(pngSoubor);
    await sleep(1500);
    const poVyberu = await page.evaluate(() => ({
      nahled: !!document.querySelector('[data-report-priloha-nahled] img'),
      vBoxu: /přiložený snímek|attached screenshot/i.test(document.querySelector('[role="dialog"]')?.innerText || ''),
    }));
    ok(poVyberu.nahled, 'po výběru souboru je vidět náhled snímku');
    ok(poVyberu.vBoxu, 'a box „co odejde" snímek přiznává');
    // odebrání: náhled zmizí a tlačítko se vrátí (jediné tlačítko v náhledu)
    await page.click('[data-report-priloha-nahled] button');
    await sleep(600);
    ok(await page.evaluate(() => !document.querySelector('[data-report-priloha-nahled]') && !!document.querySelector('[data-report-priloha]')),
      'Odebrat snímek zruší náhled a vrátí tlačítko');
    // Ctrl+V: vložení obrázku ze schránky do textového pole (přesně cesta,
    // kterou navrhl uživatel z bety — soubor je nouzovka, schránka hlavní)
    const vlozeno = await page.evaluate((b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'schranka.png', { type: 'image/png' }));
      const ta = document.querySelector('#report-text');
      if (!ta) return false;
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    }, pngB64);
    ok(vlozeno, 'událost vložení ze schránky odeslána');
    await sleep(1500);
    ok(await page.evaluate(() => !!document.querySelector('[data-report-priloha-nahled] img')),
      'Ctrl+V obrázku ukáže náhled snímku');
    require('fs').unlinkSync(pngSoubor);

    console.log('== ikona v levé liště: přehled, úkoly i mapa ==');
    // ⚠️ Tahle sada vznikla z ostudy: tlačítko v mapě mělo `top-76`, což
    // Tailwind NEGENERUJE (škála 64 → 72 → 80). Třída se tiše zahodila,
    // tlačítko zůstalo bez pozice a v mapě nebylo vidět — nahlásil to Richard,
    // ne test. Proto se tu neměří přítomnost v DOM, ale SKUTEČNÁ poloha.
    const mapa = await api('POST', '/api/collections/goalmaps/records', { token: auth.json.token, body: {
      title: 'Mapa pro lištu', edges: [],
      nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', nodeType: 'apex' } }],
    } });
    for (const [kde, cesta] of [['přehled', '/'], ['úkoly', '/tasks'], ['mapa', `/map/${mapa.json.id}`]]) {
      await page.goto(BASE + cesta, { waitUntil: 'networkidle2' });
      await sleep(2500);
      const m = await page.evaluate(() => {
        const b = document.querySelector('[data-rail-report]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const nahore = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
                 vidno: r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight,
                 klikatelne: !!nahore && (nahore === b || b.contains(nahore)) };
      });
      ok(m && m.vidno, `${kde}: ikona hlášení je na obrazovce (${m ? `top ${m.top}px` : 'není v DOM'})`);
      ok(m && m.klikatelne, `${kde}: a nic ji nepřekrývá`);
    }
    // a doopravdy otevře dialog
    await page.click('[data-rail-report]');
    await sleep(1200);
    ok(await page.evaluate(() => !!document.querySelector('[role="dialog"] #report-text')),
      'kliknutí na ikonu v liště otevře formulář');

    ok(errs.length === 0, `konzole bez chyb (${errs.length ? errs[0].slice(0, 120) : 'čistá'})`);
  } catch (e) {
    fail++;
    console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} ${pass} OK, ${fail} chyb`);
  process.exit(fail === 0 ? 0 : 1);
})();
