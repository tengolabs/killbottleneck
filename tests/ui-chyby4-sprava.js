// UI e2e (headless Chrome) for wave 1 of code analysis 4 — what the person SEES:
//
//  A) Share dialog, instance without a mail server: sharing with an address that has no
//     account shows the one-time invitation link to hand over; the row says "no account
//     yet"; signing up THROUGH the link (a second, clean browser profile) opens the project.
//     Signing up with the same address without the link does not — the owner then sees
//     "has an account, invitation not confirmed" and confirms the share with one click.
//  B) User administration: the number of projects in a person's row equals the number in
//     the delete dialog (F4-06); the dialog says BEFOREHAND what goes and what stays and
//     never names a project; it says how many projects pass to a co-admin, how many to the
//     administrator and how many private ones go (decision 11 Nov 2026); OK = the server
//     hands the shared projects over inside the delete and the account is deleted.
//  D) The two ways out of the delete dialog that must delete nothing (T1-08): the list of the
//     person's projects fails to load (an alert, no question, no blind delete) and "Cancel".
//  E) A refused "AI manager" / "org structure manager" switch shows the server's reason (F4-05).
//  C) A failed delete is reported and leaves NOTHING half-done (F4-05: the handover is part
//     of the delete), and so is a refused role change: the last administrator cannot
//     demote themselves (S4-03).
const H = require('./_harness');
const { expect, sleep } = H;

const telo = (title) => ({
  title,
  nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: title, title, status: 'todo' } },
    { id: 'k1', type: 'goalNode', position: { x: 0, y: 240 }, data: { title: 'Krok', status: 'todo' } },
  ],
  edges: [{ id: 'e1', source: 'root', target: 'k1' }],
});

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4', env: { KB_UVODNI_MAPA: 0 } });
  const ST = await inst.superuser();
  const ucet = async (email, extra) => {
    const r = await inst.register(email, extra || {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    const token = await inst.login(email);
    // entering the app writes users.last_login; an account that has never signed in cannot become a co-admin owner
    await inst.api('POST', '/api/collections/loginlogs/records', { token, body: {} });
    return { id: r.json.id, email, token };
  };
  const mapa = async (kdo, title) => (await inst.api('POST', '/api/collections/goalmaps/records', { token: kdo.token, body: Object.assign(telo(title), { owner: kdo.id, owner_email: kdo.email }) })).json;
  const admin = await ucet('admin@ui4.cz');
  const clen = await ucet('clen@ui4.cz');
  const druhy = await ucet('druhy@ui4.cz');
  const M = await mapa(admin, 'Adminuv projekt');
  await mapa(clen, 'TAJNY-SOUKROMY-PROJEKT');
  const T = await mapa(clen, 'Tymovy projekt clena');
  await inst.api('POST', '/api/kb/share', { token: clen.token, body: { action: 'set_team_access', mapId: T.id, access: 'read' } });
  // a public board with no other sharing is handed over too (decision 11 Nov 2026)
  const VV = await mapa(clen, 'VEREJNA-VYVESKA-CLENA');
  await inst.api('PATCH', `/api/collections/goalmaps/records/${VV.id}`, { token: clen.token, body: { is_public: true } });
  const SK = await mapa(clen, 'TAJNY-SDILENY-S-DRUHYM');
  await inst.api('POST', '/api/kb/share', { token: clen.token, body: { action: 'share', mapId: SK.id, email: 'druhy@ui4.cz', permission: 'edit' } });
  const T2 = await mapa(druhy, 'Tymovy projekt druheho');
  await mapa(druhy, 'TAJNY-PROJEKT-DRUHEHO');
  await inst.api('POST', '/api/kb/share', { token: druhy.token, body: { action: 'set_team_access', mapId: T2.id, access: 'read' } });

  const { browser, page, chyby } = await H.browser({ viewport: { width: 1900, height: 950 } });
  const dialogy = [];
  let odpoved = () => true; // what to answer to the next native dialog
  page.on('dialog', async (d) => { dialogy.push({ typ: d.type(), text: d.message() }); if (d.type() === 'confirm' && !odpoved(d.message())) await d.dismiss(); else await d.accept(); });
  const prihlas = async (p, email) => {
    await p.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('#email');
    await p.type('#email', email);
    await p.type('#password', H.PW);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('button[type="submit"]')]);
    await sleep(1500);
  };
  await prihlas(page, admin.email);

  console.log('== A) dialog sdílení: adresa bez účtu, instance bez pošty ==');
  await page.goto(`${inst.base}/map/${M.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.react-flow__node', { timeout: 45000 });
  await sleep(2000);
  const otevritSdileni = async () => {
    const kliklo = await page.evaluate(() => {
      const b = [...document.querySelectorAll('header button')].find((x) => (x.textContent || '').trim() === 'Sdílet');
      if (!b) return false; b.click(); return true;
    });
    if (!kliklo) throw new Error('tlačítko Sdílet nenalezeno');
    await page.waitForSelector('[role="dialog"] input[type="email"]', { timeout: 10000 });
    await sleep(600);
  };
  const zavritDialog = async () => { await page.keyboard.press('Escape'); await sleep(500); };
  const pozvat = async (email) => {
    await page.type('[role="dialog"] input[type="email"]', email);
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').trim() === 'Pozvat').click());
  };
  await otevritSdileni();
  await pozvat('novy@ui4.cz');
  await page.waitForSelector('[data-testid="share-invite-link-url"]', { timeout: 10000 }).catch(() => {});
  const odkaz = await page.evaluate(() => (document.querySelector('[data-testid="share-invite-link-url"]') || {}).textContent || '');
  expect(new RegExp('^' + inst.base.replace(/[.]/g, '\\.') + '/register\\?email=novy%40ui4\\.cz&invite=[A-Za-z0-9]{40}$').test(odkaz), `dialog ukáže odkaz s jednorázovým tokenem k předání (${odkaz.slice(0, 70)}…)`);
  let txt = await page.evaluate(() => document.querySelector('[data-testid="share-invite-notice"]').innerText);
  expect(/Předejte mu odkaz níže/.test(txt) && /dostane jen ten, kdo se přes něj zaregistruje nebo přihlásí/.test(txt), 'oznámení říká, co s odkazem a že registrace bez něj nestačí');
  expect(await page.evaluate(() => !!document.querySelector('[data-testid="share-no-account"]') && !!document.querySelector('[data-testid="share-reinvite"]')), 'řádek: „zatím bez účtu" a tlačítko poslat pozvánku znovu');
  // the reader of the project record must not see the pending address
  const zaznam = (await inst.api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: admin.token })).json;
  expect(!JSON.stringify(zaznam).includes('novy@ui4.cz'), 'čekající adresa není v záznamu projektu');
  await zavritDialog();

  console.log('== A) registrace PŘES odkaz (čistý profil prohlížeče) ==');
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const host = await ctx.newPage();
  await host.setViewport({ width: 1400, height: 900 });
  await host.goto(odkaz, { waitUntil: 'networkidle2' });
  await host.waitForSelector('#email');
  expect((await host.$eval('#email', (i) => i.value)) === 'novy@ui4.cz', 'registrace má adresu z pozvánky předvyplněnou');
  await sleep(300);
  expect(!host.url().includes('invite=') && host.url().includes('email=novy%40ui4.cz'), `token z adresního řádku zmizel (nezůstane v historii prohlížeče), e-mail zůstal (${host.url().replace(inst.base, '')})`);
  await host.type('#password', H.PW);
  await host.type('#confirm', H.PW);
  await Promise.all([host.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), host.click('button[type="submit"]')]);
  await sleep(2500);
  const radky = async (mapId) => ((await inst.api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${mapId}"`)}`, { token: ST })).json.items || []).map((x) => x.email + ':' + x.permission).sort();
  expect((await radky(M.id)).includes('novy@ui4.cz:read'), `po registraci přes odkaz sdílení vzniklo (${(await radky(M.id)).join(', ')})`);
  await host.goto(`${inst.base}/map/${M.id}`, { waitUntil: 'networkidle2' });
  const vidi = await host.waitForSelector('.react-flow__node', { timeout: 30000 }).then(() => true).catch(() => false);
  expect(vidi, 'pozvaný projekt v aplikaci otevře');
  await ctx.close();

  console.log('== A) registrace BEZ odkazu → vlastník potvrdí jedním klikem ==');
  await page.goto(`${inst.base}/map/${M.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.react-flow__node', { timeout: 45000 });
  await sleep(1500);
  await otevritSdileni();
  await pozvat('bezodkazu@ui4.cz');
  await page.waitForSelector('[data-testid="share-invite-link-url"]', { timeout: 10000 }).catch(() => {});
  await zavritDialog();
  const bez = await ucet('bezodkazu@ui4.cz'); // signs up on their own, without the link
  expect((await inst.api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: bez.token })).status === 404, 'registrace bez odkazu projekt neotevře');
  await otevritSdileni();
  await page.waitForSelector('[data-testid="share-pending-account"]', { timeout: 10000 }).catch(() => {});
  txt = await page.evaluate(() => (document.querySelector('[data-testid="share-pending-account"]') || {}).textContent || '');
  expect(/účet má, pozvánku nepotvrdil/.test(txt), `vlastník vidí, že účet existuje, ale pozvánku nepotvrdil („${txt}")`);
  await (await page.$('[data-testid="share-confirm-account"]')).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="share-pending-account"]'), { timeout: 10000 }).catch(() => {});
  expect((await radky(M.id)).includes('bezodkazu@ui4.cz:read') && (await inst.api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: bez.token })).status === 200,
    'po kliknutí „Sdílet" u řádku účet projekt vidí');
  expect(await page.evaluate(() => !document.querySelector('[data-testid="share-pending-account"]') && !document.querySelector('[data-testid="share-confirm-account"]')), 'řádek už není čekající');
  await zavritDialog();

  console.log('== B) Správa uživatelů: počet projektů v řádku = v dialogu ==');
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="oddil-lide"]', { timeout: 20000 });
  await page.click('[data-testid="oddil-lide"]'); await sleep(1200);
  const radekTxt = (email) => page.evaluate((em) => {
    const b = document.querySelector(`[data-testid="akce-${em}"]`);
    const r = b && (b.closest('tr') || b.closest('[data-testid^="karta-"]') || b.parentElement.parentElement.parentElement);
    return r ? r.innerText.replace(/\s+/g, ' ') : '';
  }, email);
  txt = await radekTxt(clen.email);
  expect(/4 mapy/.test(txt), `řádek člena: 4 mapy — i ty, které admin nevidí („${txt.slice(0, 90)}")`);
  const smazat = async (email) => {
    await (await page.$(`[data-testid="akce-${email}"]`)).click();
    await page.waitForSelector(`[data-testid="smazat-${email}"]`, { timeout: 5000 });
    await (await page.$(`[data-testid="smazat-${email}"]`)).click();
  };

  console.log('== C) smazání SELŽE → správce se to dozví a nic není napůl ==');
  await page.setRequestInterception(true);
  const zachyt = (req) => {
    if (req.method() === 'DELETE' && req.url().includes(`/api/collections/users/records/${druhy.id}`)) {
      req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ status: 400, message: 'PODVRZENE-SELHANI', data: {} }) });
    } else req.continue();
  };
  page.on('request', zachyt);
  dialogy.length = 0;
  await smazat(druhy.email);
  await H.waitFor(() => dialogy.some((d) => d.typ === 'alert'), { timeout: 10000, popis: 'hláška o selhání' }).catch(() => {});
  const alert1 = (dialogy.find((d) => d.typ === 'alert') || {}).text || '';
  expect(/Účet se smazat nepodařilo/.test(alert1) && /PODVRZENE-SELHANI/.test(alert1), `hláška říká, že se účet nesmazal, i důvod („${alert1.slice(0, 110)}")`);
  expect(!!(dialogy.find((d) => d.typ === 'confirm') || {}).text && /na vás \(projekt nemá jiného spolusprávce\): 1/.test(dialogy.find((d) => d.typ === 'confirm').text), 'dialog předtím sliboval předání 1 projektu');
  page.off('request', zachyt);
  await page.setRequestInterception(false);
  const d2 = (await inst.api('GET', `/api/collections/goalmaps/records/${T2.id}`, { token: druhy.token }));
  expect(d2.status === 200 && d2.json.owner === druhy.id, 'nesmazaný účet o nic nepřišel — projekt je dál jeho (předání je součást mazání)');
  await sleep(800);
  txt = await radekTxt(druhy.email);
  expect(/2 mapy/.test(txt), `řádek po neúspěchu: dál 2 mapy („${txt.slice(0, 80)}")`);

  // F4-05, the part nothing measured (T1-06): a refused switch of "AI manager" / "org structure manager"
  // used to end in console.error only — the switch stayed as it was and the administrator learned nothing.
  console.log('== E) přepínače Správce AI / Správce struktury: odmítnutí serveru je vidět ==');
  await page.setRequestInterception(true);
  const zachytPriznak = (req) => {
    if (req.method() === 'PATCH' && req.url().includes(`/api/collections/users/records/${druhy.id}`)) {
      req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ status: 400, message: 'PODVRZENE-SELHANI-PRIZNAKU', data: {} }) });
    } else req.continue();
  };
  page.on('request', zachytPriznak);
  const prepinace = () => page.evaluate((em) => {
    const b = document.querySelector(`[data-testid="akce-${em}"]`);
    const r = b && b.closest('tr');
    return r ? [...r.querySelectorAll('button[role="switch"]')].map((x) => `${x.getAttribute('aria-label')}=${x.getAttribute('aria-checked')}`) : [];
  }, druhy.email);
  const predPrepnutim = await prepinace();
  expect(predPrepnutim.length === 2 && predPrepnutim.every((x) => /=false$/.test(x)), `řádek druhého člena má dva vypnuté přepínače (${predPrepnutim.join(', ')})`);
  for (let i = 0; i < predPrepnutim.length; i++) {
    dialogy.length = 0;
    await page.evaluate((em, k) => document.querySelector(`[data-testid="akce-${em}"]`).closest('tr').querySelectorAll('button[role="switch"]')[k].click(), druhy.email, i);
    await H.waitFor(() => dialogy.some((d) => d.typ === 'alert'), { timeout: 8000, popis: 'hláška o odmítnutém přepnutí' }).catch(() => {});
    const hlaska = (dialogy.find((d) => d.typ === 'alert') || {}).text || '';
    expect(/PODVRZENE-SELHANI-PRIZNAKU/.test(hlaska), `odmítnuté přepnutí „${predPrepnutim[i].split('=')[0]}“ → správce vidí důvod serveru („${hlaska.slice(0, 60)}")`);
  }
  await sleep(500);
  page.off('request', zachytPriznak);
  await page.setRequestInterception(false);
  expect((await prepinace()).join() === predPrepnutim.join(), `přepínače po odmítnutí ukazují dál pravdu — vypnuto (${(await prepinace()).join(', ')})`);
  const druhyPo = (await inst.api('GET', `/api/collections/users/records/${druhy.id}`, { token: ST })).json || {};
  expect(druhyPo.is_ai_manager !== true && druhyPo.is_org_manager !== true, 'na serveru se příznaky nezměnily');

  // T1-08 (code analysis 4): the delete dialog has three ways out and only "OK" was clicked through.
  // The other two must delete NOTHING — measured by the DELETE requests the browser really sends.
  console.log('== D) dialog mazání: nenačtený výčet projektů a „Zrušit“ nesmažou nic ==');
  const odeslanaSmazani = [];
  const sledujSmazani = (req) => { if (req.method() === 'DELETE' && /\/api\/collections\/users\/records\//.test(req.url())) odeslanaSmazani.push(req.url()); };
  page.on('request', sledujSmazani);
  await page.setRequestInterception(true);
  const zachytVycet = (req) => {
    if (req.method() === 'GET' && req.url().includes(`/api/kb/users/${clen.id}/maps`)) {
      req.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'PODVRZENE-SELHANI-VYCTU' }) }); // 500: also allowed in the console filter at the end
    } else req.continue();
  };
  page.on('request', zachytVycet);
  dialogy.length = 0;
  await smazat(clen.email);
  await H.waitFor(() => dialogy.some((d) => d.typ === 'alert'), { timeout: 10000, popis: 'hláška o nenačteném výčtu projektů' }).catch(() => {});
  await sleep(1000);
  page.off('request', zachytVycet);
  await page.setRequestInterception(false);
  expect(/Nepodařilo se zjistit, které projekty uživatel vlastní — účet zůstává/.test((dialogy.find((d) => d.typ === 'alert') || {}).text || ''),
    `výčet projektů se nenačetl → správce se to dozví („${((dialogy.find((d) => d.typ === 'alert') || {}).text || '').slice(0, 80)}")`);
  expect(!dialogy.some((d) => d.typ === 'confirm') && odeslanaSmazani.length === 0, `…a aplikace se na smazání ani nezeptá a nic nemaže naslepo (dotazů ${dialogy.filter((d) => d.typ === 'confirm').length}, požadavků DELETE ${odeslanaSmazani.length})`);
  expect((await inst.api('GET', `/api/collections/users/records/${clen.id}`, { token: ST })).status === 200, 'účet po nenačteném výčtu existuje');

  dialogy.length = 0;
  odpoved = () => false; // „Zrušit“
  await smazat(clen.email);
  await H.waitFor(() => dialogy.some((d) => d.typ === 'confirm'), { timeout: 10000, popis: 'dotaz na smazání' }).catch(() => {});
  await sleep(1500);
  odpoved = () => true;
  page.off('request', sledujSmazani);
  expect(dialogy.filter((d) => d.typ === 'confirm').length === 1 && !dialogy.some((d) => d.typ === 'alert'), `„Zrušit“: jeden dotaz, žádná chybová hláška (${dialogy.map((d) => d.typ).join(', ')})`);
  expect(odeslanaSmazani.length === 0 && (await inst.api('GET', `/api/collections/users/records/${clen.id}`, { token: ST })).status === 200, `„Zrušit“: prohlížeč neposlal žádné smazání a účet existuje (požadavků DELETE ${odeslanaSmazani.length})`);
  const poZruseni = (await inst.api('GET', `/api/collections/goalmaps/records?perPage=50&filter=${encodeURIComponent(`owner="${clen.id}"`)}`, { token: ST })).json.items || [];
  expect(poZruseni.length === 4 && poZruseni.some((m) => m.title === 'TAJNY-SOUKROMY-PROJEKT'), `„Zrušit“: všechny 4 projekty člena jsou dál jeho, nic se nepředalo ani nesmazalo (${poZruseni.length})`);
  txt = await radekTxt(clen.email);
  expect(/4 mapy/.test(txt), `„Zrušit“: řádek člena v seznamu zůstal („${txt.slice(0, 60)}")`);

  console.log('== B) dialog mazání říká předem, co zmizí a co zůstane ==');
  dialogy.length = 0;
  await smazat(clen.email);
  await H.waitFor(async () => (await inst.api('GET', `/api/collections/users/records/${clen.id}`, { token: ST })).status === 404, { timeout: 15000, popis: 'smazání účtu' }).catch(() => {});
  const dotaz = (dialogy.find((d) => d.typ === 'confirm') || {}).text || '';
  expect(/Smazat účet clen@ui4\.cz\?/.test(dotaz), 'dialog jmenuje účet');
  expect(/soukromé projekty \(nikdo jiný je nevidí\): 1/.test(dotaz) && /soukromé stránky: 0/.test(dotaz), 'vypíše, co ZANIKNE (počty soukromých projektů a stránek)');
  expect(/ZŮSTANE/.test(dotaz) && /přílohy \(0\), záznamy času \(0\), komentáře a faktury/.test(dotaz) && /bývalý člen/.test(dotaz), 'vypíše, co ZŮSTANE, a že u autora bude „bývalý člen"');
  expect(/PŘEJDE na nového vlastníka/.test(dotaz) && /na spolusprávce projektu: 1/.test(dotaz) && /na vás \(projekt nemá jiného spolusprávce\): 2/.test(dotaz), 'vypíše, co PŘEJDE: 1 projekt na spolusprávce, 2 na mě (týmový a veřejná vývěska)');
  expect(dotaz.indexOf('PŘEJDE') < dotaz.indexOf('ZANIKNE') && /OK = smazat účet/.test(dotaz), 'pořadí: přejde → zanikne → zůstane, jedno potvrzení');
  expect(!/TAJNY-SOUKROMY-PROJEKT|TAJNY-SDILENY-S-DRUHYM|druhy@ui4\.cz/.test(dotaz), 'projekty, které admin nevidí, ani jejich spolusprávce nejmenuje');
  expect(dialogy.filter((d) => d.typ === 'confirm').length === 1, `jediný dotaz (${dialogy.filter((d) => d.typ === 'confirm').length})`);
  expect((await inst.api('GET', `/api/collections/users/records/${clen.id}`, { token: ST })).status === 404, 'účet je smazaný');
  const tm = (await inst.api('GET', `/api/collections/goalmaps/records/${T.id}`, { token: admin.token }));
  expect(tm.status === 200 && tm.json.owner === admin.id, 'týmový projekt převzal admin');
  const vv = (await inst.api('GET', `/api/collections/goalmaps/records/${VV.id}`, { token: ST })).json || {};
  expect(vv.owner === admin.id && vv.is_public === true, 'veřejnou vývěsku převzal admin a zůstala veřejná');
  const sk = (await inst.api('GET', `/api/collections/goalmaps/records/${SK.id}`, { token: ST })).json || {};
  expect(sk.owner === druhy.id && (await inst.api('GET', `/api/collections/goalmaps/records/${SK.id}`, { token: admin.token })).status === 404, 'projekt sdílený s druhým členem převzal on jako spolusprávce; admin ho dál nevidí');
  expect(((await inst.api('GET', `/api/collections/goalmaps/records?filter=${encodeURIComponent('title="TAJNY-SOUKROMY-PROJEKT"')}`, { token: ST })).json.items || []).length === 0, 'soukromý projekt zanikl s účtem');
  expect(await page.evaluate((em) => !document.querySelector(`[data-testid="akce-${em}"]`), clen.email), 'řádek ze seznamu zmizel');
  expect(!dialogy.some((d) => d.typ === 'alert'), `úspěšné smazání bez chybové hlášky (${dialogy.filter((d) => d.typ === 'alert').map((d) => d.text.slice(0, 60)).join(' | ')})`);

  console.log('== C) poslední administrátor se v UI nedegraduje ==');
  dialogy.length = 0;
  await page.evaluate((em) => {
    const b = document.querySelector(`[data-testid="deputy-${em}"]`) || document.querySelector('[data-testid="admin-identita"]');
    const r = [...document.querySelectorAll('tr')].find((x) => x.innerText.includes(em));
    const btn = r && [...r.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Administrátor');
    if (btn) btn.setAttribute('data-kbtest', 'role-admin'); else if (b) b.setAttribute('data-kbtest-missing', '1');
  }, admin.email);
  const roleBtn = await page.$('[data-kbtest="role-admin"]');
  expect(!!roleBtn, 'rozbalovač role na vlastním řádku nalezen');
  if (roleBtn) {
    await roleBtn.click();
    await page.waitForSelector('[role="menuitem"]', { timeout: 5000 });
    const polozky = await page.$$('[role="menuitem"]');
    for (const p of polozky) { if (/^Člen/.test((await p.evaluate((x) => x.innerText)).trim())) { await p.click(); break; } }
    await H.waitFor(() => dialogy.some((d) => d.typ === 'alert'), { timeout: 8000, popis: 'hláška o posledním administrátorovi' }).catch(() => {});
  }
  const alert2 = (dialogy.find((d) => d.typ === 'alert') || {}).text || '';
  expect(/Poslední administrátor nemůže o roli přijít/.test(alert2), `UI ukáže srozumitelnou hlášku („${alert2.slice(0, 90)}")`);
  expect((await inst.api('GET', `/api/collections/users/records/${admin.id}`, { token: ST })).json.role === 'admin', 'role na serveru zůstala');
  expect(await page.evaluate(() => !!document.querySelector('[data-kbtest="role-admin"]') && document.querySelector('[data-kbtest="role-admin"]').textContent.trim() === 'Administrátor'), 'a v řádku je dál Administrátor');

  const vazne = chyby.filter((c) => !/PODVRZENE-SELHANI|status of (400|500)|ClientResponseError/.test(c));
  expect(vazne.length === 0, `konzole bez nečekaných chyb (${vazne.slice(0, 2).join(' | ').slice(0, 200)})`);
}, { nazev: 'UI-CHYBY4-SPRAVA' });
