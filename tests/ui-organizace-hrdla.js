// UI e2e: SEKCE „KDE TO NEJVÍC STOJÍ" NA ORGANIZACI + STAGNAČNÍ VĚTEV HRDEL (v2).
//
// buildPortfolio.sections.bottlenecks = reálná hrdla napříč týmovými/sdílenými
// projekty: uzel PO TERMÍNU nebo ZE SEKCE „nehýbe se", který drží ≥1 nehotový
// navazující krok. Čistě propadlý list (nikoho nedrží) do sekce NEPATŘÍ —
// zůstává jen v „Po termínu". Soukromé mapy se nezapočítávají (jako celá
// stránka). Tytéž uzly kreslí editor mapy jako červený odznak.
//
// Stagnace: jediný předpis nodeLastMoved (map_changes, jen skutečný pohyb).
// Razítka nejdou zpětně datovat (autodate), test proto NEfalšuje data, ale
// posune práh: KB_STUCK_DAYS=-1 → i dnešní pohyb je „starý". Přesně k tomu
// env přepínač vznikl.
//
// MUTAČNÍ DŮKAZ: na image z main sada ČERVENÁ — sekce ani /map-activity neexistují.
const H = require('./_harness');
const { expect, sleep } = H;

const den = (posun) => {
  const d = new Date();
  d.setDate(d.getDate() + posun);
  return d.toISOString().slice(0, 10);
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'org-hrdla', env: { KB_UVODNI_MAPA: 0, KB_STUCK_DAYS: -1 } });

  const regAdmin = await inst.register('admin@e2e.cz'); // první účet = admin
  const regClen = await inst.register('clen@e2e.cz');
  expect(regAdmin.status === 200 && regClen.status === 200, 'admin + člen založeni');
  const TA = await inst.login('admin@e2e.cz');
  const TC = await inst.login('clen@e2e.cz');

  console.log('== seed: týmová mapa (hrdla + propadlý list) a soukromá mapa ==');
  const tymova = (await inst.api('POST', '/api/collections/goalmaps/records', { token: TA, body: {
    title: 'TYMOVY PROJEKT',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 400, y: 0 }, data: { nodeType: 'apex', apexText: 'TYM', title: 'TYM', status: 'todo' } },
      { id: 'over', type: 'goalNode', position: { x: 100, y: 300 }, data: { title: 'PROPADLE HRDLO', status: 'in_progress', deadline: den(-2), owner: 'clen@e2e.cz' } },
      { id: 'overCh', type: 'goalNode', position: { x: 100, y: 600 }, data: { title: 'Ceka na hrdlo', status: 'todo' } },
      { id: 'stag', type: 'goalNode', position: { x: 450, y: 300 }, data: { title: 'ZASEKNUTE HRDLO', status: 'todo', owner: 'admin@e2e.cz' } },
      { id: 'stagCh', type: 'goalNode', position: { x: 450, y: 600 }, data: { title: 'Ceka na zaseknute', status: 'todo' } },
      { id: 'list', type: 'goalNode', position: { x: 800, y: 300 }, data: { title: 'PROPADLY LIST', status: 'todo', deadline: den(-5), owner: 'clen@e2e.cz' } },
    ],
    edges: [
      { id: 'e1', source: 'apex', target: 'over' }, { id: 'e2', source: 'over', target: 'overCh' },
      { id: 'e3', source: 'apex', target: 'stag' }, { id: 'e4', source: 'stag', target: 'stagCh' },
      { id: 'e5', source: 'apex', target: 'list' },
    ],
  } })).json;
  expect(!!tymova.id, 'týmová mapa založena');
  const sdil = await inst.api('POST', '/api/kb/share', { token: TA, body: { mapId: tymova.id, action: 'set_team_access', access: 'read' } });
  expect(sdil.status === 200, `týmový přístup nastaven (${sdil.status})`);

  const soukroma = (await inst.api('POST', '/api/collections/goalmaps/records', { token: TA, body: {
    title: 'SOUKROMY PROJEKT',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 200, y: 0 }, data: { nodeType: 'apex', apexText: 'S', title: 'S', status: 'todo' } },
      { id: 'so', type: 'goalNode', position: { x: 200, y: 300 }, data: { title: 'SOUKROME HRDLO', status: 'todo', deadline: den(-8), owner: 'admin@e2e.cz' } },
      { id: 'soCh', type: 'goalNode', position: { x: 200, y: 600 }, data: { title: 'Ceka soukrome', status: 'todo' } },
    ],
    edges: [{ id: 'e1', source: 'apex', target: 'so' }, { id: 'e2', source: 'so', target: 'soCh' }],
  } })).json;
  expect(!!soukroma.id, 'soukromá mapa založena');

  // „pohyb" zaseknutého uzlu = PATCH stavu (zapíše řádek do map_changes;
  // s prahem -1 je i dnešní razítko za hranicí → uzel stagnuje)
  const nodes2 = tymova.nodes.map((n) => (n.id === 'stag' ? { ...n, data: { ...n.data, status: 'in_progress' } } : n));
  const patch = await inst.api('PATCH', `/api/collections/goalmaps/records/${tymova.id}`, { token: TA, body: { nodes: nodes2 } });
  expect(patch.status === 200, `pohyb zaseknutého uzlu zapsán (${patch.status})`);

  console.log('== API: portfolio má sekci bottlenecks se 2 položkami ==');
  const pf = await inst.api('GET', '/api/kb/portfolio', { token: TA });
  const bn = (pf.json?.sections?.bottlenecks) || [];
  expect(pf.status === 200, `portfolio 200 (${pf.status})`);
  expect(pf.json?.counts?.bottlenecks === 2, `counts.bottlenecks = 2 (${pf.json?.counts?.bottlenecks})`);
  const titles = bn.map((b) => b.title);
  expect(titles.includes('PROPADLE HRDLO'), `propadlé blokující hrdlo v sekci (${titles.join(', ')})`);
  expect(titles.includes('ZASEKNUTE HRDLO'), 'zaseknuté blokující hrdlo v sekci (stagnace přes záznamník)');
  expect(!titles.includes('PROPADLY LIST'), 'čistě propadlý list v sekci NENÍ (nikoho nedrží)');
  expect(!titles.includes('SOUKROME HRDLO'), 'soukromá mapa se nezapočítává');
  const over = bn.find((b) => b.title === 'PROPADLE HRDLO');
  expect(over && over.blocked === 1 && over.daysOver === 2, `fakta sedí: blokuje 1, po termínu 2 dny (${over && over.blocked}/${over && over.daysOver})`);

  console.log('== API: /map-activity — viditelnost a stagnace ==');
  const maT = await inst.api('GET', `/api/kb/map-activity?map=${tymova.id}`, { token: TC });
  expect(maT.status === 200 && maT.json?.stagnant && ('stag' in maT.json.stagnant), `člen vidí aktivitu týmové mapy a stag stagnuje (${maT.status})`);
  const maS = await inst.api('GET', `/api/kb/map-activity?map=${soukroma.id}`, { token: TC });
  expect(maS.status === 404, `cizí soukromá mapa → 404 (${maS.status})`);

  const { page, chyby } = await H.browser();
  const login = async (email) => {
    await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.evaluate(() => { document.querySelector('#email').value = ''; document.querySelector('#password').value = ''; });
    await page.type('#email', email);
    await page.type('#password', H.PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1200);
  };
  await login('admin@e2e.cz');

  console.log('== /organizace: sekce Kde to nejvíc stojí ==');
  await page.goto(`${inst.base}/organizace`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="organizace-bottlenecks"]', { timeout: 20000 });
  const sekce = await page.$eval('[data-testid="organizace-bottlenecks"]', (el) => el.innerText);
  expect(/Kde to nejvíc stojí/.test(sekce), 'sekce má název „Kde to nejvíc stojí"');
  // pořadí sekcí = rozhodnutí Richarda 2. 9. 2026 (staging):
  // 1. Projekty podle % hotovo, 2. Kde to nejvíc stojí, 3. Po termínu
  const poradi = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('section[id^="s-"]')].map((el) => el.id);
    return ids.indexOf('s-projects') < ids.indexOf('s-bottlenecks')
      && ids.indexOf('s-bottlenecks') < ids.indexOf('s-overdue');
  });
  expect(poradi, 'pořadí sekcí: Projekty → Kde to nejvíc stojí → Po termínu');
  expect(/PROPADLE HRDLO/.test(sekce) && /ZASEKNUTE HRDLO/.test(sekce), 'obě hrdla v sekci');
  expect(!/PROPADLY LIST/.test(sekce), 'propadlý list v sekci není');
  expect(/po termínu/.test(sekce) && /leží/.test(sekce), 'sloupec Proč stojí nese fakta (po termínu / leží)');

  console.log('== Report → PDF (k poslání) ==');
  // jsPDF ukládá přes <a download> (click i dispatchEvent — verze se liší),
  // proto se chytají obě cesty; skutečný soubor na disku netestujeme
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.evaluate(() => {
    window.__pdfStazeno = [];
    const zapis = (el) => { if (el && el.tagName === 'A' && el.download) window.__pdfStazeno.push(el.download); };
    const origClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () { zapis(this); return origClick.call(this); };
    const origDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (ev) { if (ev && ev.type === 'click') zapis(this); return origDispatch.call(this, ev); };
  });
  await page.click('[data-testid="organizace-report"]');
  await page.waitForSelector('[data-testid="organizace-report-pdf"]', { timeout: 5000 });
  await page.click('[data-testid="organizace-report-pdf"]');
  await sleep(6000); // snímek stránky + sazba PDF chvíli trvá
  const pdfStazeno = await page.evaluate(() => window.__pdfStazeno || []);
  expect(pdfStazeno.some((f) => String(f).endsWith('.pdf')), `PDF report se stáhl (${JSON.stringify(pdfStazeno)})`);
  expect(pageErrors.length === 0, `PDF nevyhodilo chybu na stránce (${pageErrors.join(' | ').slice(0, 140)})`);
  // druhá varianta: „v mém vzhledu" (skin/tmavý režim zůstává)
  await page.click('[data-testid="organizace-report"]');
  await page.waitForSelector('[data-testid="organizace-report-pdf-skin"]', { timeout: 5000 });
  await page.click('[data-testid="organizace-report-pdf-skin"]');
  await sleep(6000);
  const pdfStazeno2 = await page.evaluate(() => window.__pdfStazeno || []);
  expect(pdfStazeno2.filter((f) => String(f).endsWith('.pdf')).length >= 2, `stáhly se obě PDF varianty (${JSON.stringify(pdfStazeno2)})`);
  expect(pageErrors.length === 0, `ani druhá varianta nevyhodila chybu (${pageErrors.join(' | ').slice(0, 140)})`);
  await page.keyboard.press('Escape');
  await sleep(400);

  console.log('== deep-link Řešit v mapě: vybere uzel ==');
  await page.click('[data-testid="organizace-bottleneck-item"]');
  await page.waitForSelector('.react-flow__node.selected', { timeout: 20000 }).catch(() => {});
  await sleep(1000);
  expect((await page.$$('.react-flow__node.selected')).length === 1, 'proklik vybral uzel v mapě');

  console.log('== mapa: zaseknuté hrdlo má červený odznak (stagnace ze serveru) ==');
  await page.goto(`${inst.base}/map/${tymova.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="toolbar-bottlenecks"]', { timeout: 20000 });
  await sleep(1800); // map-activity fetch
  const mapStav = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="toolbar-bottlenecks"]');
    return {
      pocitadlo: b ? (b.textContent || '').replace(/\D+/g, '') : '',
      realBadge: ((document.body.innerText || '').match(/Úzké hrdlo/g) || []).length,
    };
  });
  // V MAPĚ je červené KAŽDÉ po termínu (i list, který nikoho nedrží) — hoří
  // přímo u práce. Sekce na Organizaci je PODMNOŽINA: jen hrdla držící další
  // kroky (listy má sekce Po termínu). Proto tady 3, v sekci výš 2.
  expect(mapStav.pocitadlo === '3', `počítadlo = 3 reálná (propadlé+zaseknuté+propadlý list) (${mapStav.pocitadlo})`);
  expect(mapStav.realBadge === 3, `3 červené odznaky (${mapStav.realBadge})`);

  console.log('== člen v Můj den: štítek „jsem úzké hrdlo" na svém propadlém cíli ==');
  await login('clen@e2e.cz');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="myday-hrdlo"]', { timeout: 20000 }).catch(() => {});
  const hrdloStitky = await page.$$eval('[data-testid="myday-hrdlo"]', (els) =>
    els.map((el) => ({ text: el.textContent, radek: el.closest('button')?.textContent || '' })));
  expect(hrdloStitky.length === 1, `právě 1 štítek úzkého hrdla (${hrdloStitky.length})`);
  expect(/PROPADLE HRDLO/.test(hrdloStitky[0]?.radek || ''), 'štítek sedí na propadlém blokujícím cíli');
  expect(/drží 1 krok/.test(hrdloStitky[0]?.text || ''), `štítek nese fakt „drží 1 krok" (${hrdloStitky[0]?.text})`);
  const listRadek = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((el) => /PROPADLY LIST/.test(el.textContent || ''));
    return b ? b.textContent : '';
  });
  expect(listRadek !== '' && !/úzké hrdlo/.test(listRadek), 'propadlý list (nikoho nedrží) štítek NEMÁ');

  console.log('== člen: Organizace dál bez oprávnění ==');
  await page.goto(`${inst.base}/organizace`, { waitUntil: 'networkidle2' });
  await sleep(800);
  expect(!!(await page.$('[data-testid="organizace-noperm"]')), 'člen (role user) dostane „bez oprávnění"');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-ORGANIZACE-HRDLA' });
