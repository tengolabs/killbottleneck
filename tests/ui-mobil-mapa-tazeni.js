// Mapa na telefonu: uzly jdou posouvat PRSTEM a PROPOJOVAT i ve vodorovném
// (mobilním) zobrazení, zámek je výchozí odemčený a posun se ULOŽÍ (do svislých,
// kanonických pozic s prohozenými osami). Richard 4. 10. 2026 zrušil rozhodnutí
// z 23. 7. („na mobilu zamčeno, vodorovně jen náhled“). Ruční zámek dál funguje.
const H = require('./_harness');
const { expect, sleep } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-mobil-mapa', env: { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const uzel = (id, title, x, y) => ({ id, type: 'goalNode', position: { x, y }, data: { title, status: 'todo', description: '', color: '', nodeType: 'normal', goalType: '', apexText: '' } });
  // svislé (kanonické) pozice: apex nahoře, A pod ním, B stranou bez rodiče
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Telefon', nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Telefon', title: 'Telefon', status: 'todo' } },
      uzel('a', 'Krok A', 0, 300), uzel('b', 'Krok B', 400, 300),
    ], edges: [{ id: 'e1', source: 'apex', target: 'a' }] } })).json;
  expect(!!mapa.id, 'mapa založena přes API');

  const { page, chyby } = await H.browser({ mobil: true });
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); localStorage.setItem('kb-lang', 'cs'); }, A);
  await page.goto(`${inst.base}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
  const cekej = async (sel, ms = 15000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  expect(await cekej('.react-flow__node[data-id="b"]'), 'plátno s uzly na telefonu');
  await sleep(1500);
  const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } : null; }, sel);
  const zoom = () => page.evaluate(() => { const m = /scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform || ''); return m ? Number(m[1]) : 1; });
  const ulozeno = async () => { await sleep(1400); await page.waitForFunction(() => !(document.body.innerText || '').includes('Ukládání'), { timeout: 15000 }).catch(() => {}); await sleep(300); return (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: A })).json; };
  const tah = async (od, kam, kroku = 10) => {
    await page.touchscreen.touchStart(od.x, od.y);
    for (let i = 1; i <= kroku; i++) { await page.touchscreen.touchMove(od.x + (kam.x - od.x) * i / kroku, od.y + (kam.y - od.y) * i / kroku); await sleep(30); }
    await page.touchscreen.touchEnd();
  };

  console.log('== výchozí stav: odemčeno, vodorovně ==');
  expect((await page.evaluate(() => document.querySelector('[data-locked]')?.getAttribute('data-locked'))) === '0', 'zámek na telefonu je výchozí ODEMČENÝ');
  const apex0 = await rect('.react-flow__node[data-id="apex"]'), a0 = await rect('.react-flow__node[data-id="a"]');
  expect(apex0 && a0 && a0.x > apex0.x + apex0.w / 2, `vodorovné zobrazení: dítě A je vpravo od vrcholu (apex x=${apex0?.x | 0}, A x=${a0?.x | 0})`);
  expect(await page.evaluate(() => document.querySelector('.react-flow__node[data-id="a"]')?.classList.contains('draggable')), 'uzel je na telefonu tažitelný (třída draggable)');

  console.log('== propojení prstem: A → B ==');
  const hA = await rect('.react-flow__node[data-id="a"] .react-flow__handle.source');
  const hB = await rect('.react-flow__node[data-id="b"] .react-flow__handle.target');
  expect(hA && hB, 'konektory obou uzlů jsou na plátně');
  await tah({ x: hA.cx, y: hA.cy }, { x: hB.cx, y: hB.cy });
  await sleep(400);
  expect((await page.$$('.react-flow__edge')).length === 2, `na plátně jsou 2 hrany (${(await page.$$('.react-flow__edge')).length})`);
  let rec = await ulozeno();
  expect((rec.edges || []).some((e) => e.source === 'a' && e.target === 'b'), `hrana A→B je uložená (${JSON.stringify((rec.edges || []).map((e) => e.source + '>' + e.target))})`);
  let pa = (rec.nodes || []).find((n) => n.id === 'a')?.position;
  expect(pa && pa.x === 0 && pa.y === 300, `samotné propojení pozice nemění (A = ${pa?.x}, ${pa?.y})`);

  console.log('== posun prstem se projeví i uloží (osy prohozené) ==');
  // tah DOLEVA a dolů — pryč od pravého okraje displeje, kde by plátno samo
  // ujíždělo (autopan) a uzel by v souřadnicích mapy ujel dál než prst
  const flowPos = (id) => page.evaluate((id) => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(document.querySelector(`.react-flow__node[data-id="${id}"]`)?.style.transform || ''); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; }, id);
  const f0 = await flowPos('a');
  const DX = -70, DY = 60;
  await tah({ x: a0.cx, y: a0.cy }, { x: a0.cx + DX, y: a0.cy + DY });
  await sleep(300);
  const a1 = await rect('.react-flow__node[data-id="a"]'), f1 = await flowPos('a');
  const dxF = f1.x - f0.x, dyF = f1.y - f0.y;
  // první kroky dotyku spolkne práh tažení, proto volnější tolerance; přesnost hlídá kontrola v souřadnicích mapy níž
  expect(Math.abs(a1.x - a0.x - DX) < 35 && Math.abs(a1.y - a0.y - DY) < 35, `uzel A se na obrazovce posunul o ≈(${DX}, ${DY}) (skutečně ${(a1.x - a0.x) | 0}, ${(a1.y - a0.y) | 0})`);
  expect(dxF < -40 && dyF > 40, `v souřadnicích mapy: doleva a dolů (${dxF | 0}, ${dyF | 0})`);
  rec = await ulozeno();
  pa = (rec.nodes || []).find((n) => n.id === 'a')?.position;
  const ocekX = 0 + dyF, ocekY = 300 + dxF;
  expect(pa && Math.abs(pa.x - ocekX) < 2 && Math.abs(pa.y - ocekY) < 2, `uloženo svisle s PROHOZENÝMI osami: A ≈ (${ocekX.toFixed(0)}, ${ocekY.toFixed(0)}), je (${pa?.x?.toFixed(0)}, ${pa?.y?.toFixed(0)})`);
  const pb = (rec.nodes || []).find((n) => n.id === 'b')?.position;
  expect(pb && pb.x === 400 && pb.y === 300, 'netažený uzel B zůstal, kde byl');

  console.log('== ruční zámek dál drží ==');
  await page.tap('[data-locked]');
  await sleep(300);
  expect((await page.evaluate(() => document.querySelector('[data-locked]')?.getAttribute('data-locked'))) === '1', 'klepnutí zámek zamklo');
  // zamčený uzel pod prstem posouvá CELÉ plátno (panOnDrag), proto se měří pozice v mapě, ne na obrazovce
  const b0 = await rect('.react-flow__node[data-id="b"]'), fb0 = await flowPos('b');
  await tah({ x: b0.cx, y: b0.cy }, { x: b0.cx - 60, y: b0.cy - 40 });
  await sleep(300);
  const fb1 = await flowPos('b');
  expect(fb0 && fb1 && fb0.x === fb1.x && fb0.y === fb1.y, `zamčený uzel se prstem v mapě neposune (${fb0?.x | 0},${fb0?.y | 0} → ${fb1?.x | 0},${fb1?.y | 0})`);
  rec = await ulozeno();
  const pb2 = (rec.nodes || []).find((n) => n.id === 'b')?.position;
  expect(pb2 && pb2.x === 400 && pb2.y === 300, 'zamčený uzel ani v uložené mapě nezměnil pozici');

  console.log('== otevření na počítači: pořadí/pozice z telefonu sedí svisle ==');
  const { page: pc } = await H.browser();
  await pc.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); localStorage.setItem('kb-lang', 'cs'); }, A);
  await pc.goto(`${inst.base}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
  await pc.waitForSelector('.react-flow__node[data-id="a"]', { timeout: 15000 });
  await sleep(1200);
  const pcApex = await pc.evaluate(() => document.querySelector('.react-flow__node[data-id="apex"]').getBoundingClientRect().y);
  const pcA = await pc.evaluate(() => document.querySelector('.react-flow__node[data-id="a"]').getBoundingClientRect().y);
  expect(pcA > pcApex, 'na počítači je A svisle POD vrcholem (kanonické pozice, ne vodorovné)');
  expect((await pc.$$('.react-flow__edge')).length === 2, 'na počítači jsou obě hrany');

  const cizi = chyby.filter((c) => !/favicon|ResizeObserver/.test(c));
  expect(cizi.length === 0, `konzole telefonu bez chyb (${cizi.slice(0, 2).join(' | ').slice(0, 160)})`);
}, { nazev: 'UI-MOBIL-MAPA-TAZENI' });
