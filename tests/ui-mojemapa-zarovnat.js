// Ověření: Zarovnat funguje i v „Moje mapa" (Richard 11. 8. v noci)
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const NAME = 'kb-e2e-mojemapa', PORT = 20596, BASE = `http://127.0.0.1:${PORT}`, PW = 'testheslo123';
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e TZ=Europe/Prague -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /**/ } await sleep(1000); }
    await fetch(`${BASE}/api/collections/users/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'r@test.cz', password: PW, passwordConfirm: PW }) });
    const auth = await (await fetch(`${BASE}/api/collections/users/auth-with-password`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'r@test.cz', password: PW }) })).json();
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 950 });
    await page.evaluateOnNewDocument((t, r) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
      localStorage.setItem('kb-lang', 'cs');
    }, auth.token, auth.record);
    await page.goto(`${BASE}/my-map`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 5, { timeout: 45000 }).catch(() => {});
    await sleep(2000);
    const tlacitko = () => page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith('Zarovnat'));
      return b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : null;
    });
    // POZOR: po vycentrování se mapa vždy roztáhne na okno, takže šířka
    // v pixelech je pořád stejná. Měří se proto POMĚR STRAN, ten je na
    // přiblížení nezávislý — sevřený styl mapu zkrátí a prohloubí.
    const pomer = () => page.evaluate(() => {
      const r = [...document.querySelectorAll('.react-flow__node')].map((e) => e.getBoundingClientRect());
      if (!r.length) return 0;
      const w = Math.max(...r.map((x) => x.right)) - Math.min(...r.map((x) => x.left));
      const h = Math.max(...r.map((x) => x.bottom)) - Math.min(...r.map((x) => x.top));
      return h ? Math.round((w / h) * 100) / 100 : 0;
    });
    ok((await tlacitko()) !== null, `Moje mapa má tlačítko Zarovnat (${await tlacitko()})`);
    ok((await page.evaluate(() => !!document.querySelector('button[data-align-lock]'))), 'a taky zámeček');
    const pred = await pomer();
    const zarovnej = async () => { await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith('Zarovnat'))?.click()); await sleep(1500); };
    await zarovnej();  // classic
    const poKlasice = await pomer();
    await zarovnej();  // compact
    const poKompaktu = await pomer();
    ok(poKompaktu > 0 && poKompaktu !== poKlasice, `kompakt s mapou pohnul (poměr ${poKlasice} → ${poKompaktu})`);
    ok(poKompaktu < poKlasice, `a zúžil ji vůči výšce (poměr ${poKlasice} → ${poKompaktu})`);
    // ⚠️ Sada dřív mačkala jen dvakrát, takže třetí styl („kolem středu")
    // v Moje mapě NIKDY nezkusila — a právě ten se tam překrýval už od
    // 4 položek (panel /checkup 12. 8.). Překryv se měří na skutečně
    // vykreslených kartách, ne na spočítaných pozicích.
    const prekryvNaPlatne = () => page.evaluate(() => {
      const r = [...document.querySelectorAll('.react-flow__node')].map((e) => e.getBoundingClientRect());
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
        const a = r[i], b = r[j];
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) {
          return `${Math.round(a.left)},${Math.round(a.top)} × ${Math.round(b.left)},${Math.round(b.top)}`;
        }
      }
      return null;
    });
    ok(!(await prekryvNaPlatne()), `kompakt: karty se na plátně nepřekrývají${await prekryvNaPlatne() ? ' (' + await prekryvNaPlatne() + ')' : ''}`);
    await zarovnej();  // třetí styl: kolem středu
    ok(!(await prekryvNaPlatne()), `kolem středu: karty se na plátně nepřekrývají${await prekryvNaPlatne() ? ' (' + await prekryvNaPlatne() + ')' : ''}`);
    console.log(`  (poměr na začátku ${pred})`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) { console.error('CHYBA:', e); process.exitCode = 1; }
  finally { if (browser) await browser.close().catch(() => {}); execSync(`docker rm -f ${NAME} 2>/dev/null; true`); }
})();
