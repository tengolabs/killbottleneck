// "Former member" (decision 15 Nov 2026): the steps of a deleted member.
//
// Before: a step assigned to a deleted account kept showing the initials of the address, as
// if somebody were still working on it, and the delete offered nothing to do with the steps.
//
// What is clicked (the administrator in user administration, then the project and Tasks):
//   A) the delete dialog is a dialog of the app: it says how many open steps the member has
//      in the projects that stay and offers to reassign them; with a person chosen it says
//      how many will pass; "Smazat účet" deletes and the steps really pass;
//   B) a member deleted WITHOUT reassignment: their steps show the red badge "bývalý člen"
//      instead of initials — in the project (map), in Tasks (table and board) and in the
//      assignee picker of the step; the address stays readable in the bubble;
//   C) a living member still shows initials (the badge is not painted for everybody).
const H = require('./_harness');
const { expect, sleep } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-byvaly-clen', env: { KB_UVODNI_MAPA: 0 } });
  const ST = await inst.superuser();
  const ucet = async (email) => {
    const r = await inst.register(email, {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    const token = await inst.login(email);
    await inst.api('POST', '/api/collections/loginlogs/records', { token, body: {} });
    return { id: r.json.id, email, token };
  };
  const krok = (id, x, title, owner, status) => ({ id, type: 'goalNode', position: { x, y: 300 }, data: { title, status: status || 'todo', nodeType: 'normal', owner: owner || '' } });
  const mapa = async (kdo, title, kroky) => {
    const r = await inst.api('POST', '/api/collections/goalmaps/records', { token: kdo.token, body: {
      title, owner: kdo.id, owner_email: kdo.email,
      nodes: [{ id: 'R', type: 'apexNode', position: { x: 400, y: 0 }, data: { nodeType: 'apex', apexText: title, title: '', status: 'todo' } }].concat(kroky),
      edges: kroky.map((k) => ({ id: 'e-' + k.id, source: 'R', target: k.id })),
    } });
    if (r.status !== 200) throw new Error(`mapa ${title}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const sdilej = async (kdo, mapId, email, permission) => {
    const r = await inst.api('POST', '/api/kb/share', { token: kdo.token, body: { action: 'share', mapId, email, permission } });
    if (r.status !== 200) throw new Error(`sdílení ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  };
  const resitel = async (mapId, nodeId) => ((((await inst.api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: ST })).json.nodes || []).find((n) => n.id === nodeId) || {}).data || {}).owner;

  const admin = await ucet('admin@byv.cz');
  const prvni = await ucet('prvni.odchazi@byv.cz');   // deleted WITH reassignment
  const druhy = await ucet('druhy.odchazi@byv.cz');   // deleted WITHOUT reassignment
  const novy = await ucet('novy.resitel@byv.cz');
  const P1 = await mapa(admin, 'PROJEKT-PRERAZENI', [krok('k1', 0, 'KROK-PRVNIHO', prvni.email), krok('k2', 260, 'KROK-PRVNIHO-HOTOVY', prvni.email, 'done')]);
  await sdilej(admin, P1.id, prvni.email, 'edit');
  await sdilej(admin, P1.id, novy.email, 'edit');
  // a project the new assignee does not see: this step cannot pass
  const P1b = await mapa(admin, 'PROJEKT-BEZ-NOVEHO', [krok('k1', 0, 'KROK-KAM-NOVY-NEVIDI', prvni.email)]);
  await sdilej(admin, P1b.id, prvni.email, 'edit');
  const P2 = await mapa(admin, 'PROJEKT-BYVALEHO', [krok('k1', 0, 'KROK-BYVALEHO', druhy.email), krok('k2', 260, 'KROK-ZIVEHO', novy.email)]);
  await sdilej(admin, P2.id, druhy.email, 'edit');
  await sdilej(admin, P2.id, novy.email, 'edit');

  const { page, chyby } = await H.browser({ viewport: { width: 1700, height: 950 } });
  const nativni = [];
  page.on('dialog', async (d) => { nativni.push(d.message()); await d.accept(); });
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', admin.email);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1500);

  const otevriMazani = async (email) => {
    await page.waitForSelector(`[data-testid="akce-${email}"]`, { timeout: 15000 });
    await (await page.$(`[data-testid="akce-${email}"]`)).click();
    await page.waitForSelector(`[data-testid="smazat-${email}"]`, { timeout: 5000 });
    await (await page.$(`[data-testid="smazat-${email}"]`)).click();
    await page.waitForSelector('[data-testid="smazat-dialog"]', { timeout: 10000 });
    await sleep(300);
  };
  const txt = (sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');

  console.log('== A) dialog mazání nabídne přeřazení otevřených kroků ==');
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  await otevriMazani(prvni.email);
  let t = await txt('[data-testid="smazat-dialog"]');
  expect(/Smazat účet prvni\.odchazi@byv\.cz\?/.test(t) && /PŘEJDE/.test(t) && /ZANIKNE/.test(t) && /ZŮSTANE/.test(t), 'dialog aplikace jmenuje účet a říká, co přejde, zanikne a zůstane');
  expect(nativni.length === 0, `žádné systémové okno prohlížeče (${nativni.length})`);
  t = await txt('[data-testid="smazat-kroky-pocet"]');
  expect(/kroků v projektech, které zůstanou: 2 \(projektů: 2\)/.test(t), `říká počet otevřených kroků — hotový krok nepočítá („${t}")`);
  t = await txt('[data-testid="smazat-kroky-vysledek"]');
  expect(/zůstanou označené „bývalý člen“/.test(t), `bez výběru: kroky zůstanou označené („${t.slice(0, 80)}")`);
  const moznosti = await page.$$eval('[data-testid="smazat-preradit"] option', (o) => o.map((x) => x.value));
  expect(moznosti[0] === '' && moznosti.includes(novy.email) && moznosti.includes(admin.email) && !moznosti.includes(prvni.email), `výběr nabízí ostatní členy, mazaného ne (${moznosti.join(', ')})`);
  await page.select('[data-testid="smazat-preradit"]', novy.email);
  await page.waitForFunction(() => /Přeřadí se kroků/.test((document.querySelector('[data-testid="smazat-kroky-vysledek"]') || {}).innerText || ''), { timeout: 10000 }).catch(() => {});
  t = await txt('[data-testid="smazat-kroky-vysledek"]');
  expect(/Přeřadí se kroků: 1\./.test(t) && /Zbylých 1 je v projektech, kam tento člověk nevidí/.test(t), `s vybraným člověkem: 1 přejde, 1 zůstane („${t}")`);
  await page.screenshot({ path: `${process.env.KB_SNIMKY || '/tmp'}/byvaly-clen-dialog.png` }).catch(() => {});
  await page.click('[data-testid="smazat-potvrdit"]');
  await H.waitFor(async () => (await inst.api('GET', `/api/collections/users/records/${prvni.id}`, { token: ST })).status === 404, { timeout: 15000, popis: 'smazání prvního' }).catch(() => {});
  expect((await inst.api('GET', `/api/collections/users/records/${prvni.id}`, { token: ST })).status === 404, 'účet je smazaný');
  expect(await resitel(P1.id, 'k1') === novy.email, `otevřený krok přešel na vybraného člena (${await resitel(P1.id, 'k1')})`);
  expect(await resitel(P1.id, 'k2') === prvni.email, 'hotový krok zůstal původnímu řešiteli');
  expect(await resitel(P1b.id, 'k1') === prvni.email, 'krok v projektu, kam nový nevidí, zůstal');
  await page.waitForFunction(() => !document.querySelector('[data-testid="smazat-dialog"]'), { timeout: 8000 }).catch(() => {});
  expect(!(await page.$('[data-testid="smazat-dialog"]')) && !(await page.$(`[data-testid="akce-${prvni.email}"]`)), 'dialog se zavřel a člen zmizel ze seznamu');

  console.log('== B) smazání bez přeřazení → „bývalý člen“ místo iniciál ==');
  await otevriMazani(druhy.email);
  await page.click('[data-testid="smazat-potvrdit"]');
  await H.waitFor(async () => (await inst.api('GET', `/api/collections/users/records/${druhy.id}`, { token: ST })).status === 404, { timeout: 15000, popis: 'smazání druhého' }).catch(() => {});
  expect(await resitel(P2.id, 'k1') === druhy.email, 'bez přeřazení krok zůstal na adrese smazaného');

  await page.goto(`${inst.base}/map/${P2.id}`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('KROK-BYVALEHO'), { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('[data-testid="byvaly-clen"]', { timeout: 10000 }).catch(() => {});
  const vMape = await page.evaluate(() => {
    const karta = (nazev) => { const h = [...document.querySelectorAll('h3')].find((x) => (x.innerText || '').includes(nazev)); return h ? h.closest('.react-flow__node') : null; };
    const b = karta('KROK-BYVALEHO'); const z = karta('KROK-ZIVEHO');
    const stitek = b && b.querySelector('[data-testid="byvaly-clen"]');
    return { stitek: stitek ? stitek.innerText.trim() : '', bublina: stitek ? stitek.getAttribute('title') : '', byvalyText: b ? b.innerText : '', zivyStitek: !!(z && z.querySelector('[data-testid="byvaly-clen"]')), zivyText: z ? z.innerText : '' };
  });
  expect(vMape.stitek === 'bývalý člen', `mapa: krok smazaného člena nese štítek „bývalý člen“ („${vMape.stitek}")`);
  expect(/druhy\.odchazi@byv\.cz/.test(vMape.bublina || '') && /účet už neexistuje/.test(vMape.bublina || ''), `bublina říká adresu a že účet neexistuje („${vMape.bublina}")`);
  expect(!/\bDO\b/.test(vMape.byvalyText), 'iniciály smazaného (DO) na kartě nejsou');
  expect(!vMape.zivyStitek && /\bNR\b/.test(vMape.zivyText), `C) živý člen má dál iniciály a žádný štítek („${vMape.zivyText.replace(/\s+/g, ' ').slice(0, 60)}")`);
  await page.screenshot({ path: `${process.env.KB_SNIMKY || '/tmp'}/byvaly-clen-mapa.png` }).catch(() => {});

  // the assignee picker of the step names the value as a former member
  const otevreno = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((x) => (x.innerText || '').includes('KROK-BYVALEHO'));
    if (!h) return false;
    h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return true;
  });
  // the full dialog keeps the assignee under the "assignment" category
  await page.waitForSelector('[data-cat="assignment"], button[id$="owner"]', { timeout: 10000 }).catch(() => {});
  if (!(await page.$('button[id$="owner"]')) && (await page.$('[data-cat="assignment"]'))) await page.click('[data-cat="assignment"]');
  await page.waitForSelector('button[id$="owner"]', { timeout: 10000 }).catch(() => {});
  t = await txt('button[id$="owner"]');
  expect(otevreno && /bývalý člen \(druhy\.odchazi@byv\.cz\)/.test(t), `výběr řešitele v kroku: „bývalý člen (adresa)“ („${t}")`);
  await page.keyboard.press('Escape'); await sleep(500);

  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('KROK-BYVALEHO'), { timeout: 20000 }).catch(() => {});
  const vUkolech = await page.evaluate(() => {
    const radek = [...document.querySelectorAll('tr, [data-testid^="karta-"], li, article, div')].filter((x) => (x.innerText || '').includes('KROK-BYVALEHO') && x.querySelector('[data-testid="byvaly-clen"]'))
      .sort((a, b) => a.innerText.length - b.innerText.length)[0];
    const s = radek && radek.querySelector('[data-testid="byvaly-clen"]');
    return { je: !!s, bublina: s ? s.getAttribute('title') : '', vsech: document.querySelectorAll('[data-testid="byvaly-clen"]').length };
  });
  expect(vUkolech.je && /druhy\.odchazi@byv\.cz/.test(vUkolech.bublina || ''), `Úkoly: u kroku smazaného člena je šedý štítek s adresou v bublině (štítků na stránce ${vUkolech.vsech})`);
  await page.screenshot({ path: `${process.env.KB_SNIMKY || '/tmp'}/byvaly-clen-ukoly.png` }).catch(() => {});

  const vazne = chyby.filter((c) => !/status of 40[0-9]|ClientResponseError/.test(c));
  expect(vazne.length === 0, `konzole bez nečekaných chyb (${vazne.slice(0, 2).join(' | ').slice(0, 200)})`);
}, { nazev: 'UI-BYVALY-CLEN' });
