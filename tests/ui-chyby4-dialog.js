// UI e2e (headless Chrome, own temporary profile): the node dialog keeps what is being typed
// when the node changes underneath it (code analysis 4, F1-04).
//
// Before the fix the form was reloaded whenever the node OBJECT changed: a colleague's tick on
// the same step (or the repaint of the editor, for the main goal of a project with a project
// colour) silently replaced the typed title and description with the stored ones.
//
// Two signed-in people in two browser contexts, real clicks and typing, the real 45 s watcher.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-dialog', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  await inst.register('kolega@example.com', { name: 'Kolega' });
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', chyby);
  const K = await E.clovek(browser, inst, 'kolega@example.com', null);
  const db = (id) => E.mapaZDb(inst, S.token, id);
  const pole = (sel) => S.page.$eval(`[role="dialog"] ${sel}`, (el) => el.value).catch(() => null);
  // which status button of the dialog is the active one (the only one with a ring)
  const stavVDialogu = () => S.page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /ring-2/.test(x.className) && /Založeno|Probíhá|Hotovo/.test(x.innerText || '')); return b ? b.innerText.trim() : ''; });
  const upozorneni = () => S.page.evaluate(() => { const el = document.querySelector('[data-testid="node-bg-changes"]'); return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : ''; });

  console.log('== vrchol projektu s barvou projektu: rozepsaný text přežije doběh ukládání ==');
  const uzlyA = E.NODES().map((n) => (n.id === 'root' ? { ...n, data: { ...n.data, nodeType: 'apex', apexText: 'Vrchol' } } : n));
  const A = await E.zalozMapu(inst, S.token, 'Barevný projekt', { nodes: uzlyA, color: '#e11d48' });
  await S.otevriMapu(A.id);
  expect(await S.klikStav('k1'), 'šéf: klik na stav k1 (rozběhne ukládání) a HNED dialog vrcholu');
  const vrchol = await S.page.$('.react-flow__node[data-id="root"]');
  await vrchol.click({ clickCount: 2 });
  expect(await S.page.waitForSelector('[role="dialog"] #apex-text', { timeout: 8000 }).then(() => true).catch(() => false), 'dialog vrcholu otevřen');
  await S.page.click('[role="dialog"] #apex-text', { clickCount: 3 });
  await S.page.keyboard.type('Rozepsaný nový cíl');
  expect((await pole('#apex-text')) === 'Rozepsaný nový cíl', 'text vrcholu napsán');
  await sleep(6000); // save → "saved" → idle repaints the editor
  expect((await pole('#apex-text')) === 'Rozepsaný nový cíl', `po 6 s (doběh ukládání, překreslení lišty) je rozepsaný text pořád v poli („${await pole('#apex-text')}“)`);
  expect(E.stav(await db(A.id), 'k1') === 'in_progress', 'úprava stavu k1 se mezitím uložila');
  expect(await S.klikText('Zrušit', '[role="dialog"]'), 'dialog zavřen bez uložení');

  console.log('== kolega odškrtne krok, který právě upravuji: rozepsané zůstane, stav se dotáhne tiše ==');
  const B = await E.zalozMapu(inst, S.token, 'Dialog s kolegou', { nodes: E.NODES().map((n) => (n.id === 'k1' ? { ...n, data: { ...n.data, owner: 'kolega@example.com' } } : n)) });
  expect((await inst.api('POST', '/api/kb/share', { token: S.token, body: { action: 'share', mapId: B.id, email: 'kolega@example.com', permission: 'work' } })).status === 200, 'mapa nasdílená kolegovi (pracovat)');
  await S.otevriMapu(B.id);
  await K.otevriMapu(B.id);
  expect(await S.otevriDialog('k1'), 'šéf: dialog kroku k1');
  await S.page.click('[role="dialog"] #title', { clickCount: 3 });
  await S.page.keyboard.type('Krok jedna ROZEPSANÝ');
  await S.page.click('[role="dialog"] #description');
  await S.page.keyboard.type('Dlouhý popis, který ještě není uložený.');
  expect((await stavVDialogu()) === 'Založeno', `šéf: dialog ukazuje stav Založeno (${await stavVDialogu()})`);
  expect(await K.klikStav('k1'), 'kolega: ve svém okně přepnul stav k1 → Probíhá');
  expect(await E.cekej(async () => (await S.stavNaPlatne('k1')).includes('Probíhá'), 70000, 'slití'), 'šéf: po tiku hlídače se změna slila na jeho plátno (pod otevřeným dialogem)');
  await sleep(500);
  expect((await pole('#title')) === 'Krok jedna ROZEPSANÝ', `rozepsaný název zůstal („${await pole('#title')}“)`);
  expect((await pole('#description')) === 'Dlouhý popis, který ještě není uložený.', `rozepsaný popis zůstal („${await pole('#description')}“)`);
  expect((await stavVDialogu()) === 'Probíhá', `pole, které šéf needitoval (stav), se tiše aktualizovalo (${await stavVDialogu()})`);
  expect((await upozorneni()) === '', 'žádné upozornění — nic rozepsaného se nepotkalo');

  console.log('== kolega změní pole, které právě edituji: upozornění a volba ==');
  expect(await S.klikText('Založeno', '[role="dialog"]'), 'šéf: v dialogu přepnul stav na Založeno (neuloženo)');
  expect(await K.klikStav('k1'), 'kolega: další klik → Hotovo');
  expect(await E.cekej(async () => (await S.stavNaPlatne('k1')).includes('Hotovo'), 70000, 'slití'), 'šéf: po tiku hlídače je k1 na plátně Hotovo');
  expect(await E.cekej(async () => (await upozorneni()) !== '', 5000, 'upozornění'), 'dialog ukázal upozornění, že se krok změnil jinde');
  const up = await upozorneni();
  expect(/Stav/.test(up) && /Hotovo/.test(up) && /Převzít novou hodnotu/.test(up) && /Nechat moje/.test(up), `upozornění jmenuje pole a novou hodnotu a nabízí volbu („${up.slice(0, 160)}“)`);
  expect((await stavVDialogu()) === 'Založeno' && (await pole('#title')) === 'Krok jedna ROZEPSANÝ', 'do rozhodnutí se nic nepřepsalo (stav Založeno, název rozepsaný)');
  await (await S.page.$('[data-bg-take="status"]')).click();
  await sleep(300);
  expect((await stavVDialogu()) === 'Hotovo' && (await upozorneni()) === '', '„Převzít novou hodnotu“ → stav Hotovo, upozornění zmizelo');
  // the "merged" toast sits over the dialog's Save button for a few seconds — a click there would land on the toast
  await E.cekej(async () => (await S.toasty()).length === 0, 20000, 'hlášky zmizely');
  expect(await S.klikText('Uložit', '[role="dialog"]'), 'šéf: Uložit');
  expect(await E.cekej(async () => E.nazev(await db(B.id), 'k1') === 'Krok jedna ROZEPSANÝ', 10000, 'uloženo'), 'rozepsaný název je uložený');
  const bPo = await db(B.id);
  expect(E.stav(bPo, 'k1') === 'done', `kolegovo „Hotovo“ uložení dialogu nepřepsalo (k1: ${E.stav(bPo, 'k1')})`);
  expect(((E.uzel(bPo, 'k1') || {}).data || {}).description === 'Dlouhý popis, který ještě není uložený.', 'i popis je uložený');

  expect(chyby.length === 0, `konzole šéfa bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 140) : ''})`);
}, { nazev: 'UI-CHYBY4-DIALOG' });
