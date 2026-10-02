// UI e2e: dotazník účelu (Richard 25. 8. 2026). První admin po registraci vidí
// dialog „K čemu budete killBottleneck používat?", zvolí „Jen pro sebe" →
// jeho nedotčená úvodní mapa se nahradí variantou pro sebe (12 položek, bez
// zvaní a rolí). Druhý účet (pozvaný člen) dialog NEvidí — účel dědí.
// Volba jde změnit ve Správě organizace (select), přeskočení = firma/tým.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20564';
const NAME = 'flowmap-e2e-ui-ucel';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json: json || {} };
};
const login = async (email, pw = PW) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: pw } })).json.token;
const polozky = (m) => (m.nodes || []).filter((n) => n.type === 'goalNode' && (n.data || {}).plannedOn);

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20564:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'zakladatel@e2e.cz');
    await page.type('#password', PW);
    await page.type('#confirm', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);

    console.log('== první admin vidí dotazník ==');
    await page.waitForSelector('[data-testid="purpose-dialog"]', { timeout: 10000 });
    const nadpis = await page.$eval('[data-testid="purpose-dialog"] h2', (e) => e.textContent).catch(() => '');
    expect(/K čemu budete killBottleneck používat/.test(nadpis), `nadpis dialogu („${nadpis}")`);
    const karty = await page.$$eval('[data-testid^="purpose-"][data-testid$="team"], [data-testid="purpose-family"], [data-testid="purpose-solo"]', (els) => els.map((e) => e.textContent));
    expect(karty.length === 3 && /Firma nebo tým/.test(karty[0]) && /Rodina a přátelé/.test(karty[1]) && /Jen pro sebe/.test(karty[2]), `tři karty (${karty.map((k) => k.slice(0, 16)).join(' | ')})`);
    // POPISKY VOLEB: klíče `${ucel}Hint` skládá PurposeDialog dynamicky, takže je
    // úklid „nepoužitých" i18n klíčů (27. 8. 2026) smazal a dialog od v0.46.1-beta
    // ukazoval syrové teamHint / familyHint / soloHint. Hlídá se zdroj (každý účel
    // z PURPOSES má popisek v cs i en) i to, co uživatel opravdu vidí.
    {
      const fs = require('fs'), path = require('path');
      const src = path.join(__dirname, '..', 'frontend', 'src');
      const ucely = (fs.readFileSync(path.join(src, 'lib', 'purpose.js'), 'utf8').match(/PURPOSES\s*=\s*\[([^\]]*)\]/) || [])[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
      expect(ucely.length === 3, `PURPOSES přečteny ze zdroje (${ucely.join(', ')})`);
      for (const jazyk of ['cs', 'en']) {
        const slovnik = JSON.parse(fs.readFileSync(path.join(src, 'i18n', jazyk, 'ucel.json'), 'utf8'));
        const chybi = ucely.filter((u) => !String(slovnik[`${u}Hint`] || '').trim());
        expect(chybi.length === 0, `${jazyk}/ucel.json má popisek pro každý účel (${chybi.length ? 'chybí ' + chybi.map((u) => u + 'Hint').join(', ') : ucely.map((u) => u + 'Hint').join(', ')})`);
      }
      const textDialogu = await page.$eval('[data-testid="purpose-dialog"]', (e) => e.textContent);
      expect(!/Hint/.test(textDialogu), `dialog neukazuje syrové klíče („Hint" v textu: ${(textDialogu.match(/\w*Hint/g) || []).join(', ') || 'není'})`);
      expect(/Kolegové, role/.test(karty[0] || '') && /Společné plány/.test(karty[1] || '') && /Vlastní cíle/.test(karty[2] || ''), 'každá karta má pod názvem svůj popisek');
    }
    const tok = await login('zakladatel@e2e.cz');
    const pred = (await api('GET', '/api/collections/goalmaps/records', { token: tok })).json.items || [];
    const predUvodni = pred.find((m) => /Zaveden/i.test(m.title)) || {};
    expect(pred.length === 2 && polozky(predUvodni).length === 18, `před odpovědí: 2 projekty, plná úvodní mapa (${polozky(predUvodni).length} položek)`);

    console.log('== Escape = jen zavřít, nic neuložit, příště znovu ==');
    await page.keyboard.press('Escape'); await sleep(500);
    expect(!(await page.$('[data-testid="purpose-dialog"]')), 'Escape dialog zavřel');
    expect((await api('GET', '/api/kb/config', { token: tok })).json.purpose === '', 'a účel se NEuložil (zabloudilý klik nesmí rozhodnout natrvalo)');
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="purpose-dialog"]', { timeout: 10000 });
    expect(true, 'po obnovení stránky se dialog zeptá znovu');

    console.log('== volba „Jen pro sebe" ==');
    await page.click('[data-testid="purpose-solo"]');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('[data-testid="purpose-continue"]')]);
    await sleep(1500);
    expect(!(await page.$('[data-testid="purpose-dialog"]')), 'dialog zmizel');
    const po = (await api('GET', '/api/collections/goalmaps/records', { token: tok })).json.items || [];
    const poUvodni = po.find((m) => /pro sebe/i.test(m.title)) || {};
    expect(po.length === 2 && polozky(poUvodni).length === 12 && po.some((m) => /Udělat si radost/.test(m.title)), `projekty nahrazeny variantou pro sebe (${po.map((m) => m.title).join(' | ')})`);
    expect((await api('GET', '/api/kb/config', { token: tok })).json.purpose === 'solo', 'config: purpose=solo');
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(800);
    expect(!(await page.$('[data-testid="purpose-dialog"]')), 'po obnovení stránky se dialog už neptá');

    console.log('== Správa organizace: účel jde změnit ==');
    await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="org-purpose"]', { timeout: 8000 });
    expect(await page.$eval('[data-testid="org-purpose"]', (e) => e.value) === 'solo', 'select ukazuje solo');
    await page.select('[data-testid="org-purpose"]', 'family'); await sleep(800);
    expect((await api('GET', '/api/kb/config', { token: tok })).json.purpose === 'family', 'změna na rodinu se uložila');

    console.log('== pozvaný člen dialog nevidí ==');
    const inv = await api('POST', '/api/kb/invite', { token: tok, body: { email: 'clen@e2e.cz', role: 'user' } });
    const tempPw = inv.json.temp_password;
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.type('#email', 'clen@e2e.cz'); await page.type('#password', tempPw);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.keyboard.press('Enter')]);
    await sleep(1500);
    expect(!(await page.$('[data-testid="purpose-dialog"]')), 'člen dotazník nedostane (účel dědí)');
    const tokC = await login('clen@e2e.cz', tempPw);
    const mapaC = ((await api('GET', '/api/collections/goalmaps/records', { token: tokC })).json.items || []).find((m) => /Vítejte/i.test(m.title)) || {};
    expect(polozky(mapaC).length === 11 && polozky(mapaC).every((n) => !n.data.deadline), `člen má rodinnou rutinu bez termínů (${polozky(mapaC).length})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.message);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ui-dotaznik-ucelu: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
