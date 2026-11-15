// UI e2e (headless Chrome, own temporary profile): the editor's state belongs to ONE map (code
// analysis 4, F1-01 + F1-06). Going from a map straight to another map — user menu →
// Organisation structure, a notification from the bell, the browser's Back button — used to keep
// the editor mounted: the undo history, the "changed by someone else" banner and an open node
// dialog of the first map stayed alive over the second one, and one click on Undo replaced the
// second map with the content of the first.
//
// Two signed-in people in two browser contexts; every step is a real click. The background
// watcher is the real 45 s one. The database is read through the API.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-prechod', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });       // first account = admin
  await inst.register('kolega@example.com', { name: 'Kolega' });
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', chyby);
  const K = await E.clovek(browser, inst, 'kolega@example.com', null);
  const share = (token, body) => inst.api('POST', '/api/kb/share', { token, body });
  const db = (id) => E.mapaZDb(inst, S.token, id);
  const ids = (m) => ((m && m.nodes) || []).map((n) => n.id).join(',');
  const pruhCizi = () => S.page.evaluate(() => /Mapu mezitím změnil někdo jiný/.test(document.body.innerText));
  const idZAdresy = () => S.page.evaluate(() => (location.pathname.match(/\/map\/([^/?]+)/) || [])[1] || '');

  console.log('== cesta 1: mapa → Uživatelské menu → Organizační struktura ==');
  const A = await E.zalozMapu(inst, S.token, 'Projekt A');
  await S.otevriMapu(A.id);
  expect(await S.akceUzlu('k1', 'Přidat podcíl'), 'A: klik „Přidat podcíl“ u kroku k1');
  expect(await E.cekej(async () => (await S.zpetAktivni()) === true, 5000, 'Zpět aktivní'), 'A: krok je v historii — „Vrátit zpět“ je aktivní');
  await sleep(300); // the autosave timer (1.2 s) is still pending → the leave must flush it INTO MAP A
  await (await S.page.$('[data-user-menu]')).click();
  await S.page.waitForSelector('[data-testid="menu-org-structure"]', { visible: true, timeout: 8000 });
  await (await S.page.$('[data-testid="menu-org-structure"]')).click();
  expect(await E.cekej(async () => { const id = await idZAdresy(); return !!id && id !== A.id; }, 15000, 'adresa org mapy'), 'adresa přešla z projektu A rovnou na organizační strukturu');
  const orgId = await idZAdresy();
  await S.page.waitForSelector('.react-flow__node', { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  const orgPred = await db(orgId);
  expect((orgPred.nodes || []).length > 0 && !ids(orgPred).includes('k1'), `organizační struktura má svůj obsah (${ids(orgPred).slice(0, 60)})`);
  const zpetVOrg = await S.zpetAktivni();
  expect(zpetVOrg === false, `v organizační struktuře je „Vrátit zpět“ zašedlé — historie projektu A nepřežila (aktivní: ${zpetVOrg})`);
  if (zpetVOrg) { await S.klikTitulek('Vrátit zpět'); await sleep(3000); } // before the fix: this click overwrites the structure
  const orgPo = await db(orgId);
  expect(ids(orgPo) === ids(orgPred), `organizační struktura v databázi je netknutá (${ids(orgPo).slice(0, 60)})`);
  const aPo = await db(A.id);
  expect((aPo.nodes || []).length === 4 && (aPo.edges || []).length === 3, `podcíl přidaný těsně před odchodem je uložený V PROJEKTU A (uzlů ${(aPo.nodes || []).length}, hran ${(aPo.edges || []).length})`);

  console.log('== cesta 2: pruh „mapu změnil někdo jiný“ + zvonek → mapa kolegy ==');
  const D = await E.zalozMapu(inst, S.token, 'Projekt D');
  expect((await share(S.token, { action: 'share', mapId: D.id, email: 'kolega@example.com', permission: 'edit' })).status === 200, 'D: šéf nasdílel projekt kolegovi k úpravám');
  const KM = await E.zalozMapu(inst, K.token, 'Mapa kolegy');
  expect((await share(K.token, { action: 'share', mapId: KM.id, email: 'sef@example.com', permission: 'edit' })).status === 200, 'kolega nasdílel svou mapu šéfovi (→ notifikace ve zvonku)');
  await S.otevriMapu(D.id);
  expect(await S.akceUzlu('k2', 'Přidat podcíl'), 'D: šéf přidal podcíl (krok v historii)');
  await sleep(2500);
  await K.otevriMapu(D.id, 'k2');
  expect(await K.akceUzlu('k1', 'Přidat podcíl'), 'D: kolega ve svém okně přidal podcíl pod k1');
  expect(await E.cekej(async () => ((await db(D.id)).nodes || []).length === 5, 10000, 'kolegův podcíl v DB'), 'D: kolegova změna je v databázi');
  expect(await E.cekej(pruhCizi, 70000, 'pruh cizí změny'), 'D: šéfovi po tiku hlídače svítí pruh „Mapu mezitím změnil někdo jiný“');
  expect(await S.klikTitulek('Notifikace'), 'D: šéf otevřel zvonek');
  await S.page.waitForSelector('[data-testid^="bell-item-"]', { visible: true, timeout: 8000 }).catch(() => {});
  const polozka = await S.page.evaluateHandle(() => [...document.querySelectorAll('[data-testid^="bell-item-"]')].find((x) => /Mapa kolegy/.test(x.innerText || '')) || null);
  expect(!!polozka.asElement(), 'zvonek nabízí notifikaci o mapě kolegy');
  if (polozka.asElement()) await polozka.asElement().click();
  expect(await E.cekej(async () => (await idZAdresy()) === KM.id, 15000, 'adresa mapy kolegy'), 'klik na notifikaci vede rovnou do mapy kolegy');
  await S.page.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  expect((await pruhCizi()) === false, 'v mapě kolegy (nikdo ji nezměnil) pruh cizí změny NESVÍTÍ');
  const zpetVKM = await S.zpetAktivni();
  expect(zpetVKM === false, `v mapě kolegy je „Vrátit zpět“ zašedlé (aktivní: ${zpetVKM})`);
  if (zpetVKM) { await S.klikTitulek('Vrátit zpět'); await sleep(3000); }
  expect(ids(await db(KM.id)) === 'root,k1,k2', `mapa kolegy v databázi je netknutá (${ids(await db(KM.id))})`);

  console.log('== cesta 3: tlačítko Zpět prohlížeče z mapy do mapy ==');
  expect(await S.klikStav('k1'), 'mapa kolegy: klik na stav k1 a HNED Zpět prohlížeče');
  await sleep(200);
  await S.page.goBack();
  expect(await E.cekej(async () => (await idZAdresy()) === D.id, 15000, 'adresa D'), 'Zpět prohlížeče vede z mapy kolegy zpátky do projektu D');
  await S.page.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  expect((await S.uzlyNaPlatne()).length === 5, `projekt D se načetl znovu, i s podcílem kolegy (uzlů na plátně: ${(await S.uzlyNaPlatne()).length})`);
  expect((await pruhCizi()) === false, 'D po návratu: čerstvě načtená mapa pruh cizí změny nemá');
  expect((await S.zpetAktivni()) === false, 'D po návratu: „Vrátit zpět“ je zašedlé');
  expect(E.stav(await db(KM.id), 'k1') === 'in_progress', `změna stavu těsně před Zpět prohlížeče je uložená v MAPĚ KOLEGY (k1: ${E.stav(await db(KM.id), 'k1')})`);
  expect(((await db(D.id)).nodes || []).length === 5 && E.stav(await db(D.id), 'k1') === 'todo', 'projekt D v databázi tou změnou zasažen není');

  console.log('== otevřený dialog uzlu nepřežije přechod do jiné mapy ==');
  expect(await S.otevriDialog('k2'), 'D: dialog kroku k2 otevřen');
  await S.page.goForward();
  expect(await E.cekej(async () => (await idZAdresy()) === KM.id, 15000, 'adresa mapy kolegy'), 'Vpřed prohlížeče vede do mapy kolegy');
  await S.page.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  expect(await S.page.evaluate(() => !document.querySelector('[role="dialog"] #title')), 'v mapě kolegy není otevřený dialog uzlu z projektu D');

  expect(chyby.length === 0, `konzole šéfa bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 120) : ''})`);
}, { nazev: 'UI-CHYBY4-PRECHOD' });
