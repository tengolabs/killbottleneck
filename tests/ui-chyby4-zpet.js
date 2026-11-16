// UI e2e (headless Chrome, own temporary profile): "Undo" takes back ONE own step, not the whole
// map (code analysis 4, F1-02), and an idea inserted from the buffer and undone goes back to the
// buffer (F1-08).
//
// Before the fix Undo restored a full snapshot of the map taken before the last recorded step:
// one click also wiped later changes that never entered the history (a status, texts from the
// node dialog) and a colleague's tick merged in meanwhile (DB `done` → `todo`, server 200, no
// warning). An idea inserted from the buffer and undone was in neither the map nor the buffer.
//
// Two signed-in people in two browser contexts, real clicks, the real 45 s background watcher.
// The database is read through the API.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-zpet', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  await inst.register('kolega@example.com', { name: 'Kolega' });
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', chyby);
  const K = await E.clovek(browser, inst, 'kolega@example.com', null);
  const share = (token, body) => inst.api('POST', '/api/kb/share', { token, body });
  const db = (id) => E.mapaZDb(inst, S.token, id);
  const popis = (m) => ((m && m.nodes) || []).map((n) => `${n.id.startsWith('node-') ? 'nový' : n.id}=${(n.data || {}).title}/${(n.data || {}).status || 'todo'}`).join(' ; ');
  const novy = (m) => ((m && m.nodes) || []).find((n) => n.id.startsWith('node-')) || null;
  const pruhCizi = () => S.page.evaluate(() => /Mapu mezitím změnil někdo jiný/.test(document.body.innerText));

  console.log('== vlastní změny mimo historii přežijí Zpět ==');
  const A = await E.zalozMapu(inst, S.token, 'Zpět vlastní');
  await S.otevriMapu(A.id);
  expect(await S.akceUzlu('k2', 'Přidat podcíl'), 'šéf: „Přidat podcíl“ pod k2 (krok v historii)');
  await sleep(600);
  expect(await S.klikStav('k2'), 'šéf: stav k2 → Probíhá (do historie nejde)');
  expect(await S.otevriDialog('k2'), 'šéf: dialog k2');
  await S.page.click('[role="dialog"] #title', { clickCount: 3 });
  await S.page.keyboard.type('Krok dva PŘEPSÁN');
  expect(await S.klikText('Uložit', '[role="dialog"]'), 'šéf: nový název k2 uložen z dialogu (od rozhodnutí 15. 11. 2026 vlastní krok historie)');
  expect(await E.cekej(async () => { const m = await db(A.id); return (m.nodes || []).length === 4 && E.nazev(m, 'k2') === 'Krok dva PŘEPSÁN' && E.stav(m, 'k2') === 'in_progress'; }, 10000, 'uloženo'), `před Zpět je v databázi podcíl i obě úpravy (${popis(await db(A.id))})`);
  // The rename from the dialog is a step of its own now: the first Undo takes back the rename
  // only, the second one the sub-goal. The status (clicked, never in the history) stays.
  const nazevPred = E.NODES().find((n) => n.id === 'k2').data.title;
  expect(await S.klikTitulek('Vrátit zpět'), 'šéf: klik „Vrátit zpět“ (1.)');
  expect(await E.cekej(async () => E.nazev(await db(A.id), 'k2') === nazevPred, 10000, 'název zpět'), `1. Zpět vrátilo jen název k2 („${E.nazev(await db(A.id), 'k2')}“)`);
  expect(((await db(A.id)).nodes || []).length === 4, 'podcíl po 1. Zpět zůstal (4 uzly)');
  expect(await S.klikTitulek('Vrátit zpět'), 'šéf: klik „Vrátit zpět“ (2.)');
  expect(await E.cekej(async () => ((await db(A.id)).nodes || []).length === 3, 10000, 'podcíl pryč'), '2. Zpět odebralo přidaný podcíl (v databázi 3 uzly)');
  await sleep(1500);
  const aPo = await db(A.id);
  expect(E.nazev(aPo, 'k2') === nazevPred, `název k2 je původní („${E.nazev(aPo, 'k2')}“)`);
  expect(E.stav(aPo, 'k2') === 'in_progress', `stav k2 změněný PO kroku zůstal (${E.stav(aPo, 'k2')})`);
  expect((await S.stavNaPlatne('k2')).includes('Probíhá') && (await S.uzlyNaPlatne()).length === 3, 'plátno šéfa odpovídá: 3 uzly, k2 Probíhá');
  expect((await S.zpetAktivni()) === false, 'historie je prázdná — Zpět zašedlé');

  console.log('== smazaný uzel se vrátí, pozdější změna jinde zůstane ==');
  expect(await S.akceUzlu('k1', 'Smazat'), 'šéf: smazal krok k1 (koš na uzlu)');
  await sleep(500);
  expect(await S.klikStav('k2'), 'šéf: stav k2 → Hotovo');
  expect(await E.cekej(async () => { const m = await db(A.id); return !E.uzel(m, 'k1') && E.stav(m, 'k2') === 'done'; }, 10000, 'uloženo'), 'v databázi: k1 pryč, k2 Hotovo');
  expect(await S.klikTitulek('Vrátit zpět'), 'šéf: klik „Vrátit zpět“');
  expect(await E.cekej(async () => !!E.uzel(await db(A.id), 'k1'), 10000, 'k1 zpět'), 'Zpět vrátilo smazaný krok k1 i s hranou');
  const aPo2 = await db(A.id);
  expect((aPo2.edges || []).some((e) => e.source === 'root' && e.target === 'k1'), 'hrana Vrchol → k1 je zpátky');
  expect(E.stav(aPo2, 'k2') === 'done', `stav k2 změněný po smazání zůstal Hotovo (${E.stav(aPo2, 'k2')})`);

  console.log('== odškrtnutí od kolegy přežije Zpět (sdílení „pracovat“, skutečný hlídač) ==');
  const B = await E.zalozMapu(inst, S.token, 'Zpět s kolegou', { nodes: E.NODES().map((n) => (n.id === 'k1' ? { ...n, data: { ...n.data, owner: 'kolega@example.com' } } : n)) });
  expect((await share(S.token, { action: 'share', mapId: B.id, email: 'kolega@example.com', permission: 'work' })).status === 200, 'šéf nasdílel mapu kolegovi (pracovat)');
  await S.otevriMapu(B.id);
  expect(await S.akceUzlu('k2', 'Přidat podcíl'), 'šéf: „Přidat podcíl“ pod k2');
  await sleep(2500);
  await K.otevriMapu(B.id);
  expect(await K.klikStav('k1'), 'kolega: klik na stav svého kroku k1'); await sleep(700);
  expect(await K.klikStav('k1'), 'kolega: druhý klik → Hotovo');
  expect(await E.cekej(async () => E.stav(await db(B.id), 'k1') === 'done', 10000, 'k1 done v DB'), 'kolegovo „Hotovo“ je v databázi');
  expect(await E.cekej(async () => (await S.stavNaPlatne('k1')).includes('Hotovo'), 70000, 'slití na plátno šéfa'), 'šéf: po tiku hlídače je k1 na jeho plátně „Hotovo“ (tiché slití)');
  expect((await pruhCizi()) === false, 'šéf: bez pruhu (pouhá změna stavu se slévá tiše)');
  expect((await S.zpetAktivni()) === true, 'šéf: Zpět je aktivní (krok „podcíl“)');
  expect(await S.klikTitulek('Vrátit zpět'), 'šéf: klik „Vrátit zpět“');
  expect(await E.cekej(async () => ((await db(B.id)).nodes || []).length === 3, 10000, 'podcíl pryč'), 'Zpět odebralo šéfův podcíl');
  await sleep(1500);
  expect(E.stav(await db(B.id), 'k1') === 'done', `kolegovo „Hotovo“ v databázi ZŮSTALO (k1: ${E.stav(await db(B.id), 'k1')})`);
  expect((await S.stavNaPlatne('k1')).includes('Hotovo'), 'i na plátně šéfa je k1 dál „Hotovo“');

  console.log('== krok, který nejde bezpečně vrátit: hláška, nic se nepřepíše ==');
  const C = await E.zalozMapu(inst, S.token, 'Zpět odmítnuto');
  expect((await share(S.token, { action: 'share', mapId: C.id, email: 'kolega@example.com', permission: 'edit' })).status === 200, 'šéf nasdílel mapu kolegovi (upravovat)');
  await S.otevriMapu(C.id);
  expect(await S.akceUzlu('k1', 'Přidat podcíl'), 'šéf: „Přidat podcíl“ pod k1');
  expect(await E.cekej(async () => !!novy(await db(C.id)), 10000, 'podcíl v DB'), 'šéfův podcíl je uložený');
  const pid = novy(await db(C.id)).id;
  await K.otevriMapu(C.id);
  expect(await K.klikStav(pid), 'kolega: ve svém okně přepnul stav šéfova nového podcíle → Probíhá');
  expect(await E.cekej(async () => E.stav(await db(C.id), pid) === 'in_progress', 10000, 'stav podcíle v DB'), 'kolegova změna podcíle je v databázi');
  expect(await E.cekej(async () => (await S.stavNaPlatne(pid)).includes('Probíhá'), 70000, 'slití na plátno šéfa'), 'šéf: po tiku hlídače vidí podcíl „Probíhá“');
  expect(await S.klikTitulek('Vrátit zpět'), 'šéf: klik „Vrátit zpět“');
  expect(await E.cekej(async () => (await S.toasty()).some((x) => /už nejde vrátit/.test(x)), 6000, 'hláška'), `šéf dostal hlášku „Tenhle krok už nejde vrátit“ (${JSON.stringify((await S.toasty()).slice(0, 1)).slice(0, 200)})`);
  expect((await S.toasty()).some((x) => /Nový podcíl/.test(x) && /nic nezměnilo/.test(x)), 'hláška jmenuje uzel a říká, že se nic nezměnilo');
  await sleep(2500);
  const cPo = await db(C.id);
  expect((cPo.nodes || []).length === 4 && E.stav(cPo, pid) === 'in_progress', `v databázi podcíl zůstal i s kolegovým stavem (${popis(cPo)})`);
  expect((await S.uzlyNaPlatne()).length === 4, 'na plátně šéfa podcíl zůstal');
  expect((await S.zpetAktivni()) === false, 'nevratný krok z historie vypadl (Zpět zašedlé)');

  console.log('== F1-08: nápad ze zásobníku vložený do mapy a vrácený Zpět je zase v zásobníku ==');
  const uid = JSON.parse(Buffer.from(S.token.split('.')[1], 'base64').toString()).id;
  const napady = async () => ((await inst.api('GET', '/api/collections/buffer_nodes/records', { token: S.token })).json.items || []).map((x) => x.title);
  expect((await inst.api('POST', '/api/collections/buffer_nodes/records', { token: S.token, body: { title: 'Nápad k vrácení', description: 'Popis nápadu', owner: uid } })).status === 200, 'nápad založen v zásobníku');
  const D = await E.zalozMapu(inst, S.token, 'Zpět zásobník');
  await S.otevriMapu(D.id);
  if (!(await S.page.$('[data-testid="buffer-panel"]'))) await (await S.page.$('[data-testid="buffer-toggle"]')).click();
  await S.page.waitForSelector('[data-testid="buffer-item"]', { visible: true, timeout: 8000 });
  await (await S.page.$('[data-testid="buffer-item"]')).hover();
  await sleep(300);
  expect(await S.klikTitulek('Vložit do mapy'), 'klik „Vložit do mapy“ u nápadu');
  expect(await E.cekej(async () => ((await db(D.id)).nodes || []).some((n) => (n.data || {}).title === 'Nápad k vrácení') && (await napady()).length === 0, 10000, 'vloženo'), 'po vložení: nápad je uzel v mapě a zásobník je prázdný');
  expect(await S.klikTitulek('Vrátit zpět'), 'klik „Vrátit zpět“');
  expect(await E.cekej(async () => !((await db(D.id)).nodes || []).some((n) => (n.data || {}).title === 'Nápad k vrácení'), 10000, 'uzel pryč'), 'po Zpět: uzel z mapy zmizel');
  expect(await E.cekej(async () => (await napady()).includes('Nápad k vrácení'), 8000, 'nápad zpět'), `po Zpět: nápad je ZPÁTKY v zásobníku (${JSON.stringify(await napady())})`);
  expect((await napady()).length === 1, 'v zásobníku je právě jednou');
  expect(await S.page.evaluate(() => [...document.querySelectorAll('[data-testid="buffer-item"]')].some((x) => /Nápad k vrácení/.test(x.innerText || ''))), 'a je vidět v panelu zásobníku');

  expect(chyby.length === 0, `konzole šéfa bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 140) : ''})`);
}, { nazev: 'UI-CHYBY4-ZPET' });
