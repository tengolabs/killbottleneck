// Správa organizace v ODDÍLECH (schválená maketa, 29. 10. 2026):
// rozcestník 6 oddílů a vidět je vždy jen jeden, odkazy ?oddil= / ?fakturace=1 / #ai míří do
// správného oddílu, tabulka lidí má 7 sloupců a vejde se bez posouvání do strany, obnova hesla
// a odebrání jsou v menu ⋯, jedna informační karta o správcích místo dvou vět, na telefonu karty
// místo tabulky a stránka bez vodorovného posunu; v cloudu tečka „chybí fakturační údaje",
// karty tarifů sbalené jen u placené instance a pole vlastního modelu až po zapnutí.
const H = require('./_harness');
const { expect, sleep } = H;

const ODDILY = ['lide', 'org', 'struktura', 'kalendare', 'platby', 'ai'];

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-oddily', env: { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 } });
  await inst.register('admin@example.com', { full_name: 'Petr Novák' });
  await inst.register('jana@example.com', { full_name: 'Jana Dvořáková' });
  await inst.register('tomas@example.com', { full_name: 'Tomáš Malý' });
  const A = await inst.login('admin@example.com');

  const { page, chyby, novaStranka } = await H.browser({ viewport: { width: 1280, height: 900 } });
  const prihlas = (p, tk) => p.evaluateOnNewDocument((t) => { try { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })); localStorage.setItem('kb-relax-rano:' + JSON.parse(atob(t.split('.')[1])).id, new Date().toLocaleDateString('en-CA')); } catch { /* about:blank nové karty localStorage nemá */ } }, tk);
  await prihlas(page, A);
  const viditelne = (p) => p.$$eval('[data-oddil]', (s) => s.filter((x) => !x.hidden && x.offsetParent !== null).map((x) => x.dataset.oddil));
  const vybrany = (p) => p.$eval('[role="tab"][aria-selected="true"]', (b) => b.dataset.testid);

  console.log('== rozcestník: 6 oddílů, vidět jen jeden ==');
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('tbody tr[data-clovek]', { timeout: 15000 });
  const zalozky = await page.$$eval('[role="tab"][data-testid^="oddil-"]', (b) => b.map((x) => x.dataset.testid.replace('oddil-', '')));
  expect(zalozky.join(',') === ODDILY.join(','), `rozcestník má oddíly v pořadí makety (${zalozky.join(', ')})`);
  expect((await viditelne(page)).join(',') === 'lide', `po otevření je vidět jen oddíl Lidé (${(await viditelne(page)).join(', ')})`);
  const pocet = await page.$eval('[data-testid="oddil-lide"]', (b) => b.innerText);
  expect(/3/.test(pocet), `u Lidí je počet lidí (${pocet.replace(/\s+/g, ' ')})`);
  expect(/3 lidé/.test(await page.$eval('[data-testid="admin-identita"]', (e) => e.innerText)), 'hlavička: „3 lidé"');
  for (const id of ODDILY) {
    await page.click(`[data-testid="oddil-${id}"]`);
    await sleep(300);
    const v = await viditelne(page);
    expect(v.length === 1 && v[0] === id && (await vybrany(page)) === `oddil-${id}`, `klik na ${id} ukáže jen ${id} (${v.join(', ')})`);
  }
  expect(page.url().endsWith('?oddil=ai'), `oddíl je v adrese (${page.url().replace(inst.base, '')})`);
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(500);
  expect((await viditelne(page)).join(',') === 'ai', 'reload zůstane v oddílu AI');
  // šipky mezi oddíly (vzor ARIA tabs): na počítači svisle, aktivní záložka je jediná v pořadí Tabu
  await page.focus('[data-testid="oddil-ai"]');
  await page.keyboard.press('Home'); await sleep(200);
  await page.keyboard.press('ArrowDown'); await sleep(300);
  const fokus = await page.evaluate(() => document.activeElement && document.activeElement.dataset.testid);
  expect((await viditelne(page)).join(',') === 'org' && fokus === 'oddil-org', `Home + šipka dolů → Organizace i s fokusem (${fokus})`);
  const tabIdx = await page.$$eval('[role="tab"]', (b) => b.filter((x) => x.tabIndex === 0).map((x) => x.dataset.testid));
  const panel = await page.$eval('[data-testid="oddil-org"]', (b) => { const p = document.getElementById(b.getAttribute('aria-controls')); return p && p.dataset.oddil; });
  expect(tabIdx.join(',') === 'oddil-org' && panel === 'org' && await page.$eval('[role="tablist"]', (t) => t.getAttribute('aria-orientation')) === 'vertical',
    'jen aktivní záložka je v Tabu, aria-controls míří na její oddíl, rozcestník je svislý');
  // odkaz z téže stránky BEZ nového načtení (tlačítko ve zkušebním pruhu = navigate('/admin/users?oddil=platby')):
  // oddíl se musí přepnout podle adresy, ne jen adresa (vada z /checkup 29. 10.)
  await page.click('[data-testid="oddil-lide"]'); await sleep(300);
  await page.evaluate(() => { history.pushState({}, '', '/admin/users?oddil=platby'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await sleep(500);
  expect((await viditelne(page)).join(',') === 'platby', 'navigace na ?oddil=platby přímo z Lidí přepne oddíl (zkušební pruh)');
  await page.goto(`${inst.base}/admin/users?oddil=neexistuje`, { waitUntil: 'networkidle2' });
  await sleep(400);
  expect((await viditelne(page)).join(',') === 'lide', 'neznámý ?oddil= → Lidé');

  console.log('== odkazy míří do správného oddílu ==');
  await page.goto(`${inst.base}/admin/users?fakturace=1`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="invoicing-section"]', { visible: true, timeout: 10000 }).catch(() => {});
  expect((await viditelne(page)).join(',') === 'platby', '?fakturace=1 (karta asistenta) otevře oddíl s fakturami');
  expect(page.url().endsWith('?oddil=platby'), `… a v adrese zůstane ?oddil=platby, ať ho drží F5 (${page.url().replace(inst.base, '')})`);
  expect(await page.$eval('[data-testid="invoicing-toggle"]', (b) => b.getAttribute('aria-expanded')).catch(() => null) === 'true', '… a Vystavování faktur je rozbalené');
  expect(/Faktury/.test(await page.$eval('[data-testid="oddil-platby"]', (b) => b.innerText)) && !/Předplatné/.test(await page.$eval('[data-testid="oddil-platby"]', (b) => b.innerText)),
    'vlastní server: oddíl se jmenuje jen „Faktury" (nic nepředplácí)');
  await page.goto(`${inst.base}/admin/users#ai`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#ai', { visible: true, timeout: 10000 }).catch(() => {});
  expect((await viditelne(page)).join(',') === 'ai', '#ai (asistent „Připojit AI") otevře oddíl AI');
  await page.goto(`${inst.base}/admin/users?pozvat=novy@example.com`, { waitUntil: 'networkidle2' });
  await sleep(600);
  expect((await viditelne(page)).join(',') === 'lide' && await page.$eval('#invite-email', (i) => i.value).catch(() => '') === 'novy@example.com',
    '?pozvat= (zvoneček) otevře Lidé a předvyplněnou pozvánku');
  await page.keyboard.press('Escape'); await sleep(300);

  console.log('== tabulka lidí: 7 sloupců, vejde se ==');
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('tbody tr[data-clovek]', { timeout: 15000 });
  const sloupcu = await page.$$eval('[data-oddil="lide"] thead th', (t) => t.length); // skryté oddíly mají vlastní tabulky
  expect(sloupcu === 7, `tabulka má 7 sloupců (${sloupcu}; dřív 9)`);
  const sirka = await page.$eval('table', (t) => ({ sw: t.parentElement.scrollWidth, cw: t.parentElement.clientWidth }));
  expect(sirka.sw <= sirka.cw + 1, `na 1280 px se tabulka vejde bez posouvání (${sirka.sw} ≤ ${sirka.cw})`);
  const pod = await page.$eval('tr[data-clovek="jana@example.com"] td', (td) => td.innerText);
  expect(/jana@example\.com · 0 map · od /.test(pod), `pod jménem e-mail · mapy · od data (${pod.replace(/\n/g, ' | ')})`);
  const banner = await page.$$eval('[data-testid="spravci-banner"]', (b) => b.map((x) => x.innerText));
  expect(banner.length === 1 && /Správce AI a správce struktury/.test(banner[0]), `jedna informační karta o obou správcích (${banner.length})`);
  expect(!(await page.$('[data-oddil="lide"] svg.lucide-trash-2')) && !(await page.$('[data-oddil="lide"] svg.lucide-key-round')), 'v řádku nejsou holé ikony koše a klíče');
  expect(/pozvánka čeká/.test(await page.$eval('tr[data-clovek="jana@example.com"]', (r) => r.innerText)), 'kdo se ještě nepřihlásil: krátce „pozvánka čeká"');
  await page.click('[data-testid="akce-jana@example.com"]'); await sleep(400);
  expect(!!(await page.$('[data-testid="reset-jana@example.com"]')) && !!(await page.$('[data-testid="smazat-jana@example.com"]')), 'menu ⋯ u člena: Obnovit heslo i Odebrat');
  await page.keyboard.press('Escape'); await sleep(300);
  expect(!(await page.$('[data-testid="akce-admin@example.com"]')), 'u sebe menu ⋯ není (sebe neodebírá ani neresetuje)');
  // přepínač zůstává na jedno kliknutí přímo v řádku; zapnutím zmizí půlka informační karty
  await page.click('tr[data-clovek="jana@example.com"] button[role="switch"]'); await sleep(800);
  const banner2 = await page.$$eval('[data-testid="spravci-banner"]', (b) => b.map((x) => x.innerText));
  expect(banner2.length === 1 && /strukturu/.test(banner2[0]) && !/Správce AI/.test(banner2[0]), `po jmenování správce AI zbude jen věta o struktuře (${banner2[0] || ''})`);
  // odebrání přes menu ⋯ opravdu odebere (potvrzení confirm přijmout)
  page.once('dialog', (d) => d.accept());
  await page.click('[data-testid="akce-tomas@example.com"]'); await sleep(400);
  await page.click('[data-testid="smazat-tomas@example.com"]'); await sleep(1200);
  const tomas = (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="tomas@example.com"'), { token: A })).json;
  expect(tomas && tomas.totalItems === 0 && !(await page.$('tr[data-clovek="tomas@example.com"]')), 'Smazat účet v menu ⋯ účet opravdu smaže');

  // užší okno (tablet, půlka monitoru): tabulka by se nevešla → karty, zase bez posunu do strany
  await page.setViewport({ width: 1024, height: 800 }); await sleep(500);
  expect(!(await page.$('[data-oddil="lide"] table')) && (await page.$$('div[data-clovek]')).length === 2, '1024 px: karty místo tabulky');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, '1024 px: bez vodorovného posunu');
  await page.setViewport({ width: 1280, height: 900 }); await sleep(500);

  console.log('== organizace: název se uloží ==');
  await page.click('[data-testid="oddil-org"]'); await sleep(300);
  await page.click('#org-name', { clickCount: 3 });
  await page.keyboard.type('Truhlářství Novák');
  const ulozit = await page.evaluateHandle(() => [...document.querySelectorAll('[data-oddil="org"] button')].find((b) => /^Uložit$/.test(b.innerText.trim())));
  await ulozit.asElement().click(); await sleep(1200);
  expect(/Truhlářství Novák/.test(await page.$eval('[data-testid="admin-identita"]', (e) => e.innerText)), 'název organizace je hned v hlavičce stránky');

  console.log('== telefon: karty místo tabulky, žádný posun do strany ==');
  const tel = await novaStranka();
  await prihlas(tel, A);
  await tel.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await tel.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await tel.waitForSelector('[data-clovek]', { timeout: 15000 });
  expect(!(await tel.$('table')) && (await tel.$$('div[data-clovek]')).length === 2, 'na telefonu karta na člověka, žádná tabulka');
  // ⚠️ ne window.innerWidth: emulovaný telefon (isMobile) okno s přetékajícím obsahem roztáhne, rozdíl je pak vždy 0
  const posun = await tel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(posun <= 0, `stránka bez vodorovného posunu (přesah ${posun} px)`);
  const pozvat = await tel.$eval('h1', (h) => { const b = h.closest('div').parentElement.querySelector('button'); const r = b.getBoundingClientRect(); return { h: r.height, w: r.right }; });
  expect(pozvat.h < 44 && pozvat.w <= 390, `„Pozvat" se na telefonu nezalomí a nepřetéká (${Math.round(pozvat.h)} px)`);
  const pruh = await tel.$eval('[role="tablist"]', (t) => getComputedStyle(t).flexDirection);
  expect(pruh === 'row', `rozcestník je na telefonu vodorovný pruh (${pruh})`);
  await tel.tap('[data-testid="oddil-platby"]').catch(() => tel.click('[data-testid="oddil-platby"]')); await sleep(400);
  expect((await viditelne(tel)).join(',') === 'platby', 'klepnutí v pruhu přepne oddíl');
  expect(await tel.$eval('[role="tablist"]', (t) => t.getAttribute('aria-orientation')) === 'horizontal', 'na telefonu je rozcestník i pro čtečku vodorovný');
  // přímý odkaz na oddíl na konci pruhu (asistent „Připojit AI“ → ?oddil=ai): vybraná záložka musí být v pruhu vidět
  await tel.goto(`${inst.base}/admin/users?oddil=ai`, { waitUntil: 'networkidle2' });
  await tel.waitForSelector('[data-testid="oddil-ai"]', { timeout: 15000 }); await sleep(400);
  const vPruhu = await tel.$eval('[data-testid="oddil-ai"]', (b) => { const r = b.getBoundingClientRect(); const p = b.parentElement.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), pl: Math.round(p.left), pr: Math.round(p.right) }; });
  expect(vPruhu.l >= vPruhu.pl && vPruhu.r <= vPruhu.pr, `přímý odkaz ?oddil=ai: záložka AI je v pruhu vidět (${JSON.stringify(vPruhu)})`);

  console.log('== správce struktury: jen Lidé a Struktura, ani přes adresu ==');
  await inst.register('eva@example.com', { full_name: 'Eva Svobodová' });
  const eva = (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="eva@example.com"'), { token: A })).json.items[0];
  await inst.api('PATCH', `/api/collections/users/records/${eva.id}`, { token: A, body: { is_org_manager: true } });
  const pE = await novaStranka();
  await prihlas(pE, await inst.login('eva@example.com'));
  await pE.goto(`${inst.base}/admin/users?oddil=platby`, { waitUntil: 'networkidle2' });
  await pE.waitForSelector('[data-oddil]', { timeout: 15000 }).catch(() => {});
  const evaZal = await pE.$$eval('[role="tab"]', (b) => b.map((x) => x.dataset.testid.replace('oddil-', '')));
  expect(evaZal.join(',') === 'lide,struktura' && (await viditelne(pE)).join(',') === 'lide' && !(await pE.$('[data-oddil="platby"]')),
    `?oddil=platby u správce struktury → Lidé; platby vůbec nevykreslené (${evaZal.join(', ')})`);

  console.log('== cloud: tečka u chybějících údajů, tarify, vlastní model ==');
  const instH = await H.startInstance({ slug: 'ui-oddily-h', env: { KB_HOSTED: 1, KB_SETUP_CODE: 'e2e-kod', KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, KB_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef' } });
  await instH.register('sef@example.com', { name: 'Šéf', setup_code: 'e2e-kod' });
  const HA = await instH.login('sef@example.com');
  const pH = await novaStranka();
  await prihlas(pH, HA);
  await pH.goto(`${instH.base}/admin/users`, { waitUntil: 'networkidle2' });
  await pH.waitForSelector('[data-testid="platby-chybi"]', { timeout: 10000 }).catch(() => {});
  expect(!!(await pH.$('[data-testid="platby-chybi"]')), 'chybí fakturační údaje → tečka u „Předplatné a faktury"');
  expect(/Předplatné a faktury/.test(await pH.$eval('[data-testid="oddil-platby"]', (b) => b.innerText)), 'v cloudu se oddíl jmenuje „Předplatné a faktury"');
  await pH.click('[data-testid="oddil-platby"]'); await sleep(500);
  expect(!(await pH.$('[data-testid="plan-cloud-lite"]')) && !!(await pH.$('[data-testid="tarify-toggle"]')), 'placená instance: karty tarifů sbalené');
  await pH.click('[data-testid="tarify-toggle"]'); await sleep(300);
  expect(!!(await pH.$('[data-testid="plan-cloud-lite"]')), '„Porovnat a změnit tarif" je rozbalí');
  await pH.click('[data-testid="oddil-ai"]'); await sleep(500);
  expect(!!(await pH.$('[data-testid="vlastni-model"]')) && !(await pH.$('[data-testid="vlastni-model-url"]')), 'vlastní model vypnutý: pole adresy/modelu/klíče nejsou vidět');
  await pH.click('[data-testid="vlastni-model-zapnout"]'); await sleep(300);
  expect(!!(await pH.$('[data-testid="vlastni-model-url"]')) && !!(await pH.$('[data-testid="vlastni-model-klic"]')), 'po zapnutí se pole ukážou');
  // telefon v cloudu: rozcestník s tečkou „chybí údaje" nesmí roztáhnout stránku (sr-only text tečky unikal z pruhu)
  const telH = await novaStranka();
  await prihlas(telH, HA);
  await telH.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await telH.goto(`${instH.base}/admin/users`, { waitUntil: 'networkidle2' });
  await telH.waitForSelector('[data-testid="platby-chybi"]', { timeout: 10000 }).catch(() => {});
  const posunH = await telH.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(!!(await telH.$('[data-testid="platby-chybi"]')) && posunH <= 0, `cloud na telefonu: s tečkou v pruhu bez vodorovného posunu (přesah ${posunH} px)`);
  await instH.api('POST', '/api/kb/billing', { token: HA, body: { company: 'Truhlářství Novák', street: 'Dlouhá 1', city: 'Brno', zip: '60200' } });
  await pH.goto(`${instH.base}/admin/users`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  expect(!(await pH.$('[data-testid="platby-chybi"]')), 'po vyplnění údajů tečka zmizí');

  const zavazne = chyby.filter((e) => !/favicon|manifest|status of 4\d\d/i.test(e));
  expect(zavazne.length === 0, `konzole bez chyb (${zavazne.length}${zavazne.length ? ': ' + zavazne[0].slice(0, 140) : ''})`);
}, { nazev: 'UI-SPRAVA-ODDILY' });
