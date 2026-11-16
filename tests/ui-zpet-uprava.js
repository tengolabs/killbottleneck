// UI e2e (headless Chrome, own temporary profile): "Undo" takes back an edit saved from the node
// dialog as ONE step, and Ctrl+Z is the keyboard shortcut of the Undo button (Richard's decision
// 15 Nov 2026 — before it a title overwritten by mistake had to be typed again and Ctrl+Z did
// nothing on the map).
//
// One signed-in person, real clicks and real key presses. The database is read through the API.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-zpet-uprava', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', chyby);
  const db = (id) => E.mapaZDb(inst, S.token, id);
  const popisUzlu = (m, id) => String(((E.uzel(m, id) || {}).data || {}).description || '');
  const ctrlZ = async () => { await S.page.keyboard.down('Control'); await S.page.keyboard.press('KeyZ'); await S.page.keyboard.up('Control'); };
  const klikPlatno = async () => { await S.page.mouse.click(40, 400); await sleep(200); };
  const titulekZpet = () => S.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').startsWith('Vrátit zpět') && x.offsetParent !== null); return b ? b.getAttribute('title') : ''; });

  console.log('== úprava z dialogu je jeden krok „Vrátit zpět“ ==');
  const A = await E.zalozMapu(inst, S.token, 'Zpět úprava');
  await S.otevriMapu(A.id);
  expect((await S.zpetAktivni()) === false, 'na začátku je Zpět zašedlé');
  expect(/Ctrl\+Z/.test(await titulekZpet()), `bublina tlačítka jmenuje zkratku („${await titulekZpet()}“)`);
  expect(await S.otevriDialog('k1'), 'dialog k1');
  expect(await S.klikText('Uložit', '[role="dialog"]'), 'uloženo beze změny');
  await sleep(600);
  expect((await S.zpetAktivni()) === false, 'uložení beze změny nevytvoří krok (Zpět dál zašedlé)');

  expect(await S.otevriDialog('k1'), 'dialog k1 podruhé');
  await S.page.click('[role="dialog"] #title', { clickCount: 3 });
  await S.page.keyboard.type('Krok jedna PŘEPSÁN');
  expect(await S.klikText('Uložit', '[role="dialog"]'), 'nový název k1 uložen z dialogu');
  expect(await E.cekej(async () => E.nazev(await db(A.id), 'k1') === 'Krok jedna PŘEPSÁN', 10000, 'název v DB'), 'přepsaný název je v databázi');
  expect((await S.zpetAktivni()) === true, 'Zpět je aktivní');
  expect(await S.klikStav('k2'), 'stav k2 → Probíhá (klikem, mimo historii)');
  expect(await E.cekej(async () => E.stav(await db(A.id), 'k2') === 'in_progress', 10000, 'stav v DB'), 'stav k2 je v databázi');
  expect(await S.klikTitulek('Vrátit zpět'), 'klik „Vrátit zpět“');
  expect(await E.cekej(async () => E.nazev(await db(A.id), 'k1') === 'Krok jedna', 10000, 'název zpět'), `Zpět vrátilo původní název k1 („${E.nazev(await db(A.id), 'k1')}“)`);
  expect(E.stav(await db(A.id), 'k2') === 'in_progress', 'stav k2 změněný potom zůstal');
  expect(await S.page.evaluate(() => /Krok jedna/.test((document.querySelector('.react-flow__node[data-id="k1"]') || {}).innerText || '') && !/PŘEPSÁN/.test((document.querySelector('.react-flow__node[data-id="k1"]') || {}).innerText || '')), 'i na plátně je původní název');
  expect((await S.zpetAktivni()) === false, 'historie je prázdná');

  console.log('== Ctrl+Z na plátně = tlačítko Zpět ==');
  expect(await S.akceUzlu('k2', 'Přidat podcíl'), '„Přidat podcíl“ pod k2');
  expect(await E.cekej(async () => ((await db(A.id)).nodes || []).length === 4, 10000, 'podcíl v DB'), 'podcíl je v databázi (4 uzly)');
  await klikPlatno();
  await ctrlZ();
  expect(await E.cekej(async () => ((await db(A.id)).nodes || []).length === 3, 10000, 'podcíl pryč'), 'Ctrl+Z odebralo přidaný podcíl (3 uzly)');
  expect((await S.uzlyNaPlatne()).length === 3, 'i na plátně jsou 3 uzly');

  console.log('== Ctrl+Z při psaní do pole mapu nevrací ==');
  expect(await S.akceUzlu('k2', 'Přidat podcíl'), '„Přidat podcíl“ pod k2 znovu');
  expect(await E.cekej(async () => ((await db(A.id)).nodes || []).length === 4, 10000, 'podcíl v DB'), 'podcíl je v databázi');
  await klikPlatno();
  expect(await S.otevriDialog('k1'), 'dialog k1');
  await S.page.click('[role="dialog"] #title', { clickCount: 3 });
  await S.page.keyboard.type('Rozepsáno');
  await ctrlZ();
  await sleep(1500);
  expect((await S.uzlyNaPlatne()).length === 4 && ((await db(A.id)).nodes || []).length === 4, 'Ctrl+Z v poli dialogu podcíl z mapy neodebralo');
  expect(await S.klikText('Zrušit', '[role="dialog"]') || (await S.page.keyboard.press('Escape'), true), 'dialog zavřen bez uložení');
  await sleep(500);
  expect(E.nazev(await db(A.id), 'k1') === 'Krok jedna', 'název k1 se nezměnil');
  await klikPlatno();
  await ctrlZ();
  expect(await E.cekej(async () => ((await db(A.id)).nodes || []).length === 3, 10000, 'podcíl pryč'), 'po zavření dialogu Ctrl+Z podcíl odebere');

  console.log('== popis a název v jednom uložení jdou zpět jedním krokem ==');
  expect(await S.otevriDialog('k2'), 'dialog k2');
  await S.page.click('[role="dialog"] #title', { clickCount: 3 });
  await S.page.keyboard.type('Dva jinak');
  expect(await S.klikText('Uložit', '[role="dialog"]'), 'uloženo');
  expect(await E.cekej(async () => E.nazev(await db(A.id), 'k2') === 'Dva jinak', 10000, 'název v DB'), 'nový název k2 v databázi');
  await klikPlatno();
  await ctrlZ();
  expect(await E.cekej(async () => E.nazev(await db(A.id), 'k2') === 'Krok dva', 10000, 'název zpět'), 'Ctrl+Z vrátilo název k2');
  expect(popisUzlu(await db(A.id), 'k2') === '', 'popis k2 zůstal prázdný');
  expect(E.stav(await db(A.id), 'k2') === 'in_progress', 'stav k2 zůstal Probíhá');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 140) : ''})`);
}, { nazev: 'UI-ZPET-UPRAVA' });
