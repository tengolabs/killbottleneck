// Ikony v hlavičce uzlu MUSÍ být vidět v každém skinu a obou režimech.
//
// Nález Richarda 12. 8. 2026: ve skinu „půlnoc" + světlý režim ikony zmizely.
// Příčina: hlavička uzlu měla barvu natvrdo (bg-slate-50/60), takže
// nerespektovala skin — a skiny „půlnoc/terminál/rubín" jsou tmavé i ve
// světlém režimu. Světlé ikony na světlé hlavičce = neviditelné (2,26:1).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const NAME = 'kb-e2e-ikony-kontrast', PORT = 20599, BASE = `http://127.0.0.1:${PORT}`, PW = 'testheslo123';
const SKINY = ['indigo', 'contrast', 'terminal', 'sepia', 'ocean', 'les', 'pulnoc', 'svestka', 'broskev', 'grafit', 'rubin'];
const MIN = 3;   // WCAG 1.4.11 pro ovládací prvky
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let b;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    await fetch(`${BASE}/api/collections/users/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'r@test.cz', password: PW, passwordConfirm: PW }) });
    const auth = await (await fetch(`${BASE}/api/collections/users/auth-with-password`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'r@test.cz', password: PW }) })).json();
    b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const mapy = await (await fetch(`${BASE}/api/collections/goalmaps/records?perPage=1`, { headers: { Authorization: auth.token } })).json();
    let nejhorsi = { p: 99, kde: '' };
    for (const skin of SKINY) {
      for (const rezim of ['dark', 'light']) {
        await fetch(`${BASE}/api/collections/users/records/${auth.record.id}`, { method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: auth.token }, body: JSON.stringify({ skin_id: skin }) });
        const page = await b.newPage();
        await page.setViewport({ width: 1600, height: 950 });
        await page.evaluateOnNewDocument((t, r, th) => {
          localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
          localStorage.setItem('kb-lang', 'cs'); localStorage.setItem('kb-theme', th);
        }, auth.token, auth.record, rezim);
        await page.goto(`${BASE}/map/${mapy.items[0].id}`, { waitUntil: 'networkidle2' });
        await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 5, { timeout: 30000 }).catch(() => {});
        await sleep(900);
        const v = await page.evaluate(() => {
          const lum = (c) => { const m = (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
          const n = [...document.querySelectorAll('.react-flow__node')][1];
          const ik = n && [...n.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').includes('měření'));
          if (!ik) return null;
          // ⚠️ Pozadí se MUSÍ číst z HLAVIČKY, ne z karty. První verze měřila
          // kartu s odůvodněním „hlavička je stejně průhledná" — jenže to platí
          // jen pro OPRAVENÝ kód. S vrácenou vadou je hlavička neprůhledně
          // světlá, sada hlásila 5,58:1 a PASS, zatímco skutečnost byla 1,00:1
          // (ikony úplně neviditelné). Test tak potvrzoval sám sebe.
          const hlavicka = ik.parentElement.parentElement;
          // hlavička je poloprůhledná → složit ji nad barvu karty, jinak by
          // alfa spadla pod stůl a měřila by se barva, kterou nikdo nevidí
          const rozloz = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); return { r: m[0] || 0, g: m[1] || 0, b: m[2] || 0, a: m.length > 3 ? m[3] : 1 }; };
          const karta = rozloz(getComputedStyle(n.querySelector('div')).backgroundColor);
          const hl = rozloz(getComputedStyle(hlavicka).backgroundColor);
          const slozeno = { r: hl.r * hl.a + karta.r * (1 - hl.a), g: hl.g * hl.a + karta.g * (1 - hl.a), b: hl.b * hl.a + karta.b * (1 - hl.a) };
          const ikona = rozloz(getComputedStyle(ik).color);
          const l1 = lum(`rgb(${ikona.r},${ikona.g},${ikona.b})`);
          const l2 = lum(`rgb(${slozeno.r},${slozeno.g},${slozeno.b})`);
          return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
        });
        await page.close();
        if (v === null) { ok(false, `${skin}/${rezim}: ikona se vůbec nevykreslila`); continue; }
        if (v < nejhorsi.p) nejhorsi = { p: v, kde: `${skin}/${rezim}` };
        ok(v >= MIN, `${skin} / ${rezim}: kontrast ikon ${v}:1${v < MIN ? ` (pod normou ${MIN}:1)` : ''}`);
      }
    }
    console.log(`\n  nejhorší kombinace: ${nejhorsi.kde} → ${nejhorsi.p}:1`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) { console.error('CHYBA SADY:', e); process.exitCode = 1; }
  finally { if (b) await b.close().catch(() => {}); execSync(`docker rm -f ${NAME} 2>/dev/null; true`); }
})();
