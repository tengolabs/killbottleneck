// Assistant on the left or right + conversations list inside the panel (10 Nov 2026) — Puppeteer suite against a FAKE ollama.
// Richard: "I want to be able to move the assistant to the left too … the other windows (documents, aquarium) then move
// to the right", and the history / new-conversation buttons "look weird". Approved: button + header drag; list in the panel.
// Measures: default right; ⇄ button → panel at x=0, page padded LEFT by its width, headers take it back, Office (documents)
// starts at the chat's right edge, relax "beside" and the image viewer to the right of the chat, left rails on Home
// (inbox / timer / bug report) shifted, toasts back to the right edge; resize handle on the right edge widens to the right;
// choice survives F5; dragging the header to the right third moves it back (drop target shown), a short drag/middle third
// does not; phone = full width, no ⇄. Conversations: ☰ shows the list instead of messages, ✎ new, groups, search without
// diacritics, open, delete with confirmation (cancel keeps it), Esc back.
const H = require('./_harness');
const { expect, sleep } = H;

const fronta = [];
const text = (s) => ({ content: s });
const mockHandler = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  const o = fronta.shift() || text('(fronta prázdná)');
  const posli = () => res.end(JSON.stringify({ message: { role: 'assistant', content: o.content || '' }, prompt_eval_count: 100, eval_count: 20, done: true }));
  if (o.delay) setTimeout(posli, o.delay); else posli(); // delay = the turn is still running when the panel gets closed
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-asistent-strana', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_START_RELAX: 0,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } }], edges: [] } })).json;
  expect(!!map.id, 'mapa založena');

  const { page } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); try { sessionStorage.setItem('kb-start-relax', '1'); } catch {} }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const zmizi = async (sel, ms = 5000) => page.waitForSelector(sel, { hidden: true, timeout: ms }).then(() => true).catch(() => false);
  const box = async (sel) => { const el = await page.$(sel); return el ? el.boundingBox() : null; };
  const W = 1400;
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.keyboard.press('Enter'); };
  const cekejText = async (s, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '')).includes(s)) return true; await sleep(250); } return false; };
  // closed tab: its text and every button / link / heading it overlaps (Richard 11 Nov: it lay over the left rail)
  const infoOuska = () => page.evaluate(() => {
    const tab = document.querySelector('[data-testid="chat-tab"]');
    const r = tab.getBoundingClientRect();
    const prekryv = [...document.querySelectorAll('button, a, h1, h2, h3')].filter((el) => el !== tab && !tab.contains(el)).filter((el) => {
      const q = el.getBoundingClientRect();
      return q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
    }).map((el) => el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.tagName + ':' + (el.textContent || '').trim().slice(0, 20));
    return { text: tab.innerText.trim(), prekryv, top: Math.round(r.top), w: Math.round(r.width) };
  });
  const odsazeni = () => page.evaluate(() => { const el = [...document.querySelectorAll('div[style]')].find((d) => d.style.paddingLeft || d.style.paddingRight); return el ? { l: parseFloat(el.style.paddingLeft) || 0, r: parseFloat(el.style.paddingRight) || 0 } : null; });

  console.log('== výchozí: vpravo ==');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.setItem('kb-chat-open', '1'); });
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"][data-side="right"]'), 'panel otevřený vpravo (výchozí)');
  let bChat = await box('[data-testid="chat-panel"]');
  expect(Math.abs(bChat.x + bChat.width - W) <= 1, `přiléhá k pravému okraji (${Math.round(bChat.x)}+${Math.round(bChat.width)})`);
  let o = await odsazeni();
  expect(!!o && Math.abs(o.r - bChat.width) <= 1 && !o.l, `stránka odsazená zprava o šířku chatu (${JSON.stringify(o)})`);

  console.log('== ⇄ přesune panel doleva; ostatní okna se zrcadlí ==');
  await page.click('[data-testid="chat-strana"]');
  expect(await cekej('[data-testid="chat-panel"][data-side="left"]'), 'tlačítko ⇄ přesune panel doleva');
  bChat = await box('[data-testid="chat-panel"]');
  expect(Math.abs(bChat.x) <= 1, `panel u levého okraje (x=${Math.round(bChat.x)})`);
  o = await odsazeni();
  expect(!!o && Math.abs(o.l - bChat.width) <= 1 && !o.r, `stránka odsazená ZLEVA o šířku chatu (${JSON.stringify(o)})`);
  const bLista = await box('[data-app-header]');
  expect(Math.abs(bLista.x) <= 1 && Math.abs(bLista.width - W) <= 1, `horní lišta editoru dál přes celé okno (${Math.round(bLista.x)}, ${Math.round(bLista.width)})`);
  expect(Math.abs(bChat.y - (bLista.y + bLista.height)) <= 1, 'panel začíná pod horní lištou i vlevo');
  const zakryto = await page.evaluate(() => [...document.querySelectorAll('[data-app-header] button')].filter((b) => { const r = b.getBoundingClientRect(); if (!r.width) return false; const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !b.contains(el); }).length);
  expect(zakryto === 0, `žádné tlačítko horní lišty není zakryté (${zakryto})`);
  // Office (documents) to the RIGHT of the chat
  await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dokumenty"][data-side="left"]'), 'Kancelář otevřená');
  const bDok = await box('[data-testid="chat-dokumenty"]');
  expect(Math.abs(bDok.x - (bChat.x + bChat.width)) <= 2, `Kancelář začíná u pravé hrany chatu (dok x=${Math.round(bDok.x)}, chat do ${Math.round(bChat.x + bChat.width)})`);
  const dokHrana = await page.$eval('[data-testid="chat-dok-hrana"]', (e) => { const r = e.getBoundingClientRect(); const p = e.closest('[data-testid="chat-dokumenty"]').getBoundingClientRect(); return { w: Math.round(r.width), vpravo: Math.abs(r.right - p.right) <= 1, zare: getComputedStyle(e, '::after').backgroundImage.startsWith('linear-gradient') }; }).catch(() => null);
  expect(!!dokHrana && dokHrana.w === 2 && dokHrana.vpravo && dokHrana.zare, `Kancelář má stejnou výraznou hranu, vlevo zrcadlově na pravém okraji (${JSON.stringify(dokHrana)})`);
  // Office resize handle on its right edge: dragging right widens, left edge stays at the chat
  const hDok = await box('[data-testid="chat-dok-resize"]');
  expect(Math.abs(hDok.x + hDok.width - (bDok.x + bDok.width)) <= 1, 'úchyt šířky Kanceláře je na její pravé hraně');
  await page.mouse.move(hDok.x + 2, hDok.y + 300); await page.mouse.down(); await page.mouse.move(hDok.x + 122, hDok.y + 300, { steps: 6 }); await page.mouse.up();
  const bDok2 = await box('[data-testid="chat-dokumenty"]');
  expect(bDok2.width - bDok.width >= 80 && Math.abs(bDok2.x - bDok.x) <= 2, `tažení doprava rozšíří Kancelář (${Math.round(bDok.width)} → ${Math.round(bDok2.width)}) a zůstane u chatu`);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--kb-toast-right')) === '', 'toasty vpravo dole bez odsazení (vpravo je nic nekryje)');
  await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await zmizi('[data-testid="chat-dokumenty"]'), 'Kancelář zavřená');
  // chat resize handle on its right edge
  const hChat = await box('[data-testid="chat-resize"]');
  expect(Math.abs(hChat.x + hChat.width - (bChat.x + bChat.width)) <= 1, 'úchyt šířky chatu je na jeho pravé hraně');
  await page.mouse.move(hChat.x + 2, hChat.y + 300); await page.mouse.down(); await page.mouse.move(hChat.x + 102, hChat.y + 300, { steps: 6 }); await page.mouse.up();
  const bChat2 = await box('[data-testid="chat-panel"]');
  expect(bChat2.width - bChat.width >= 80 && Math.abs(bChat2.x) <= 1, `tažení doprava rozšíří chat (${Math.round(bChat.width)} → ${Math.round(bChat2.width)})`);
  bChat = bChat2;
  // relax beside → scene to the right of the chat
  await page.click('[data-testid="chat-relax-toggle"]');
  expect(await cekej('[data-testid="relax-vrstva"][data-rozlozeni="vedle"]', 15000), 'akvárium vedle chatu');
  await sleep(400);
  const bRelax = await box('[data-testid="relax-vrstva"]');
  bChat = await box('[data-testid="chat-panel"]');
  expect(Math.abs(bRelax.x - (bChat.x + bChat.width)) <= 2 && Math.abs(bRelax.x + bRelax.width - W) <= 2, `akvárium vpravo od chatu až k okraji (${Math.round(bRelax.x)}–${Math.round(bRelax.x + bRelax.width)}, chat ${Math.round(bChat.x)}+${Math.round(bChat.width)})`);
  await page.click('[data-testid="chat-relax-toggle"]');
  expect(await zmizi('[data-testid="relax-vrstva"]'), 'akvárium vypnuté');

  console.log('== volba přežije F5; ouško zavřeného panelu je vlevo ==');
  await page.reload({ waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"][data-side="left"]'), 'po F5 je panel pořád vlevo');
  // ⇥ at the outer screen edge, the closed tab on the same spot → one place to keep opening / closing (Richard 11 Nov)
  const stred = async (sel) => { const b = await box(sel); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const vBox = (b, p) => !!b && !!p && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  const zavritL = await stred('[data-testid="chat-zavrit"]');
  const prvniL = await page.$eval('[data-testid="chat-hlavicka"] button[data-testid]', (b) => b.dataset.testid);
  expect(prvniL === 'chat-zavrit' && zavritL.x < 48, `vlevo: ⇥ je první, u levého kraje obrazovky (${prvniL}, x=${Math.round(zavritL.x)})`);
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-tab"][data-side="left"]'), 'zavřený panel: ouško vlevo');
  expect(vBox(await box('[data-testid="chat-tab"]'), zavritL), `vlevo: ouško leží na místě ⇥ — klikat pořád na jedno místo (${JSON.stringify(zavritL)})`);
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-zavrit"]'), 'týmž místem znovu otevřeno');
  await page.click('[data-testid="chat-zavrit"]');
  await cekej('[data-testid="chat-tab"][data-side="left"]');
  const bTab = await box('[data-testid="chat-tab"]');
  expect(Math.abs(bTab.x) <= 1, `ouško u levého okraje (x=${Math.round(bTab.x)})`);
  await sleep(300);
  const tabMapa = await infoOuska();
  expect(!tabMapa.prekryv.length && tabMapa.text === '', `mapa: ouško bez textu nepřekrývá levou lištu ani zoom (${JSON.stringify(tabMapa.prekryv)}, top ${tabMapa.top})`);
  o = await odsazeni();
  expect(!o || (!o.l && !o.r), 'zavřený panel stránku neodsouvá');
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-panel"][data-side="left"]'), 'ouško panel otevře zase vlevo');

  console.log('== Home: zásobník, stopky a hlášení chyby začínají vedle levého chatu ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"][data-side="left"]'), 'na titulce panel vlevo');
  bChat = await box('[data-testid="chat-panel"]');
  expect(await cekej('[data-testid="buffer-toggle"]'), 'ouško zásobníku je vidět');
  const bBuf = await box('[data-testid="buffer-toggle"]');
  expect(Math.abs(bBuf.x - (bChat.x + bChat.width)) <= 2, `ouško zásobníku u pravé hrany chatu, ne pod ním (${Math.round(bBuf.x)} vs ${Math.round(bChat.x + bChat.width)})`);
  await page.click('[data-testid="buffer-toggle"]');
  expect(await cekej('[data-testid="buffer-panel"]'), 'zásobník otevřený');
  await sleep(400); // padding / left have a 150 ms transition
  const bBufP = await box('[data-testid="buffer-panel"]');
  expect(Math.abs(bBufP.x - (bChat.x + bChat.width)) <= 2, `zásobník začíná u pravé hrany chatu (${Math.round(bBufP.x)})`);
  const obsah = await box('[data-testid="obsah"]');
  // the content is padded by the chat (outer wrapper) + the inbox (sm:pl-72) → the first card starts right of both
  const prvniVObsahu = await page.evaluate(() => { const el = document.querySelector('[data-testid="obsah"]'); return el ? parseFloat(getComputedStyle(el).paddingLeft) : 0; });
  expect(obsah.x >= bChat.x + bChat.width - 2 && prvniVObsahu >= 280, `obsah titulky začíná za chatem a odsazuje se o zásobník (obsah x=${Math.round(obsah.x)}, pl=${prvniVObsahu})`);
  await page.click('[data-testid="buffer-panel"] button');
  await zmizi('[data-testid="buffer-panel"]');
  // the report button exists only when reporting is enabled — the check must not skip silently (checkup 11 Nov 2026)
  const reportOn = await page.evaluate(async (b) => !!(await (await fetch(`${b}/api/kb/config`)).json()).report_enabled, inst.base);
  const rail = await page.$('[data-rail-report]');
  expect(!!rail === reportOn, `tlačítko hlášení chyby je, právě když je hlášení zapnuté (zapnuto=${reportOn})`);
  if (rail) {
    const bRail = await rail.boundingBox();
    expect(Math.abs(bRail.x - (bChat.x + bChat.width)) <= 2, `tlačítko hlášení chyby u pravé hrany chatu (${Math.round(bRail.x)})`);
  }

  console.log('== zavřené ouško vlevo: jen ikona, nic nezakrývá; točí se při práci, tečka po hotové odpovědi (Richard 11. 11.) ==');
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-tab"][data-side="left"]'), 'Home: zavřený panel = ouško vlevo');
  await sleep(300);
  const tabInfo = await infoOuska();
  expect(tabInfo.text === '' && tabInfo.w <= 60, `ouško bez textu, jen ikona (${JSON.stringify(tabInfo.text)}, ${tabInfo.w} px)`);
  expect(!tabInfo.prekryv.length, `ouško nepřekrývá lištu ani nadpis (${JSON.stringify(tabInfo.prekryv)}, top ${tabInfo.top})`);
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-input"]'), 'ouško otevře panel');
  fronta.push({ content: 'Prezentace je hotová.', delay: 2500 });
  await napis('Udělej krátkou prezentaci');
  await sleep(300);
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-tab-pracuje"]', 2000), 'zavřeno během práce: na oušku se točí kolečko');
  expect(!(await page.$('[data-testid="chat-tab-novinka"]')), 'během práce ještě bez tečky');
  const tNov = await cekej('[data-testid="chat-tab-novinka"]', 15000);
  expect(tNov, `hotová odpověď při zavřeném panelu → tečka na oušku (tečka=${await page.$eval('[data-testid="chat-tab"]', (b) => b.dataset.tecka + '/' + b.dataset.pracuje).catch(() => '?')})`);
  expect(!(await page.$('[data-testid="chat-tab-pracuje"]')), 'po dokončení se už netočí');
  await page.click('[data-testid="chat-tab"]');
  expect(await cekejText('Prezentace je hotová.'), 'otevřený panel ukazuje dokončenou odpověď');
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-tab"]') && !(await page.$('[data-testid="chat-tab-novinka"]')), 'přečteno: po dalším zavření tečka není');
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-panel"][data-side="left"]'), 'panel zase otevřený vlevo');

  console.log('== přetažení hlavičky: krátký tah / střed nic, pravá třetina = doprava ==');
  const bHl = await box('[data-testid="chat-hlavicka"]');
  // a spot in the header with no button: just right of the title area
  const volneMisto = await page.evaluate(() => {
    const h = document.querySelector('[data-testid="chat-hlavicka"]').getBoundingClientRect();
    for (let x = h.left + 60; x < h.right - 10; x += 4) { const el = document.elementFromPoint(x, h.top + h.height / 2); if (el && !el.closest('button')) return { x, y: h.top + h.height / 2 }; }
    return null;
  });
  expect(!!volneMisto, `v hlavičce je volné místo k chycení (${JSON.stringify(volneMisto)})`);
  await page.mouse.move(volneMisto.x, volneMisto.y); await page.mouse.down(); await page.mouse.move(volneMisto.x + 4, volneMisto.y, { steps: 2 }); await page.mouse.up();
  await sleep(200);
  expect(!!(await page.$('[data-testid="chat-panel"][data-side="left"]')), 'tah pod 8 px stranu nezmění');
  await page.mouse.move(volneMisto.x, volneMisto.y); await page.mouse.down(); await page.mouse.move(W / 2, volneMisto.y + 200, { steps: 8 });
  expect(!(await page.$('[data-testid="chat-strana-cil"]')), 'nad prostřední třetinou se cíl neukazuje');
  await page.mouse.up(); await sleep(200);
  expect(!!(await page.$('[data-testid="chat-panel"][data-side="left"]')), 'puštění uprostřed stranu nezmění');
  await page.mouse.move(volneMisto.x, volneMisto.y); await page.mouse.down(); await page.mouse.move(W - 100, volneMisto.y + 200, { steps: 10 });
  expect(await cekej('[data-testid="chat-strana-cil"][data-cil="right"]', 2000), 'při tahu k pravému okraji se ukáže cíl vpravo');
  await page.mouse.up();
  expect(await cekej('[data-testid="chat-panel"][data-side="right"]'), 'puštění v pravé třetině přesune panel doprava');
  expect(await zmizi('[data-testid="chat-strana-cil"]'), 'cíl po puštění zmizí');
  expect(await page.evaluate(() => !document.body.classList.contains('kb-tah')), 'po tahu se úklid povedl (body bez kb-tah)');
  await sleep(400); // the rails' left has a transition
  bChat = await box('[data-testid="chat-panel"]');
  expect(Math.abs(bChat.x + bChat.width - W) <= 1, 'panel zase u pravého okraje');
  const bBuf2 = await box('[data-testid="buffer-toggle"]');
  expect(Math.abs(bBuf2.x) <= 1, `vpravo je ouško zásobníku zpátky u levého okraje (${Math.round(bBuf2.x)})`);
  expect(Math.abs(bHl.width - bChat.width) <= 2, 'hlavička přes celou šířku panelu');

  console.log('== robot = první v levé liště, vždy vlevo; vpravo jen u asistenta vpravo; stejná výška (Richard 11. 11., schválená volba) ==');
  const bLevy = await box('[data-testid="chat-tab-levy"]');
  expect(!!bLevy && Math.abs(bLevy.x) <= 1, `asistent vpravo (otevřený): robot zůstává vlevo nahoře (${bLevy && Math.round(bLevy.x)})`);
  const lista = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width && r.left <= 1 && getComputedStyle(b).position === 'fixed'; }).map((b) => ({ id: b.getAttribute('data-testid') || (b.hasAttribute('data-rail-report') ? 'report' : b.title), top: Math.round(b.getBoundingClientRect().top), bottom: Math.round(b.getBoundingClientRect().bottom) })).sort((x, y) => x.top - y.top));
  expect(lista[0] && lista[0].id === 'chat-tab-levy' && lista.slice(1).every((b, i) => b.top >= lista[i].bottom), `robot je první a lišta pod ním se nepřekrývá (${JSON.stringify(lista)})`);
  const zavritP = await stred('[data-testid="chat-zavrit"]');
  expect(zavritP.x > W - 48, `vpravo: ⇥ u pravého kraje (x=${Math.round(zavritP.x)})`);
  await page.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-tab"][data-side="right"]'), 'zavřený vpravo: ouško vpravo');
  expect(vBox(await box('[data-testid="chat-tab"]'), zavritP), `vpravo: ouško leží na místě ⇥ (${JSON.stringify(zavritP)})`);
  const bPravy = await box('[data-testid="chat-tab"]');
  const bLevy2 = await box('[data-testid="chat-tab-levy"]');
  expect(!!bLevy2 && Math.abs(bPravy.y - bLevy2.y) <= 1 && Math.abs(bPravy.y - tabInfo.top) <= 1, `robot vpravo i vlevo ve stejné výšce jako robot asistenta vlevo (${Math.round(bPravy.y)} / ${Math.round(bLevy2.y)} / ${tabInfo.top})`);
  expect(await page.$eval('[data-testid="chat-tab-levy"]', (b) => b.innerText.trim() === ''), 'levý robot bez textu');
  await page.click('[data-testid="buffer-toggle"]');
  expect(await cekej('[data-testid="buffer-panel"]'), 'zásobník otevřený');
  await sleep(400);
  const bBufP2 = await box('[data-testid="buffer-panel"]');
  const bLevy3 = await box('[data-testid="chat-tab-levy"]');
  expect(Math.abs(bLevy3.x - (bBufP2.x + bBufP2.width)) <= 2, `otevřený zásobník: robot se posune doprava za něj, nezakrývá nadpis (${Math.round(bLevy3.x)} vs ${Math.round(bBufP2.x + bBufP2.width)})`);
  await page.click('[data-testid="buffer-panel"] button');
  await zmizi('[data-testid="buffer-panel"]');
  await page.click('[data-testid="chat-tab-levy"]');
  expect(await cekej('[data-testid="chat-panel"][data-side="right"]'), 'levý robot otevře asistenta tam, kde je (vpravo)');

  console.log('== Rozhovory v panelu: ☰ seznam, ✎ nový, hledání, otevření, smazání s potvrzením, Esc ==');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]'), 'panel otevřený');
  expect(!(await page.$('[data-testid="chat-robot-zavrit"]')) && !!(await page.$('[data-testid="chat-novy"]')), 'hlavička: robot ani „+ Nový“ u názvu nejsou, ✎ Nový rozhovor ano');
  const poradi = await page.$$eval('[data-testid="chat-hlavicka"] button[data-testid]', (els) => els.map((e) => e.dataset.testid).filter((x) => /^chat-(historie|novy|dokumenty-btn|relax-toggle|strana|zavrit)$/.test(x)));
  expect(JSON.stringify(poradi) === JSON.stringify(['chat-historie', 'chat-novy', 'chat-dokumenty-btn', 'chat-relax-toggle', 'chat-strana', 'chat-zavrit']), `hlavička: ☰ · ✎ · dokumenty · 🐟 | ⇄ · ⇥ (Richard 11. 11.: dokumenty doprostřed, akvárko doprava) (${poradi.join(',')})`);
  const hrana = await page.$eval('[data-testid="chat-hrana"]', (e) => { const r = e.getBoundingClientRect(); const p = e.closest('[data-testid="chat-panel"]').getBoundingClientRect(); const g = getComputedStyle(e, '::after'); return { w: Math.round(r.width), naHrane: Math.abs(r.left - p.left) <= 1, bg: getComputedStyle(e).backgroundColor, zare: g.backgroundImage.startsWith('linear-gradient'), zareW: parseFloat(g.width) }; }).catch(() => null);
  expect(!!hrana && hrana.w === 2 && hrana.naHrane && hrana.zare && hrana.zareW >= 12 && !/rgba\(0, 0, 0, 0\)/.test(hrana.bg), `výrazná hrana sloupce: 2px barevná linka na vnitřní hraně + záře (${JSON.stringify(hrana)})`);
  for (const [zprava, odpoved] of [['Ranní plán dílny', 'ODP-PRVNI'], ['Objednávka spárovek', 'ODP-DRUHA']]) {
    await page.click('[data-testid="chat-novy"]');
    fronta.push(text(odpoved));
    await napis(zprava);
    expect(await cekejText(odpoved, 15000), `rozhovor „${zprava}“ má odpověď`);
  }
  await page.click('[data-testid="chat-historie"]');
  expect(await cekej('[data-testid="chat-panel"][data-pohled="rozhovory"] [data-testid="chat-rozhovory"]'), '☰ ukáže seznam rozhovorů v panelu');
  expect(!(await page.$('[data-testid="chat-input"]')) && !(await page.$('[data-testid="chat-zpravy"]')), 'seznam nahradí zprávy i políčko');
  const nazev = await page.$eval('[data-testid="chat-nazev"]', (e) => e.innerText);
  expect(/Rozhovory/.test(nazev), `v hlavičce je „Rozhovory“ (${nazev})`);
  const polozky = await page.$$eval('[data-testid="chat-rozhovory-polozka"]', (els) => els.map((e) => ({ t: e.innerText, a: e.dataset.aktivni })));
  expect(polozky.length >= 2, `v seznamu jsou oba rozhovory (${polozky.length})`);
  expect(polozky.some((p) => /Objednávka spárovek|spárovek/i.test(p.t) && p.a === '1'), `otevřený rozhovor je zvýrazněný (${JSON.stringify(polozky)})`);
  const skupiny = await page.$$eval('[data-testid="chat-rozhovory-skupina"]', (els) => els.map((e) => e.dataset.skupina + ':' + e.innerText.split('\n')[0]));
  expect(skupiny.length === 1 && /^today:DNES$/i.test(skupiny[0]), `dnešní rozhovory pod nadpisem Dnes (${JSON.stringify(skupiny)})`);
  // search without diacritics
  await page.click('[data-testid="chat-rozhovory-hledat"]');
  await page.keyboard.type('sparovek');
  await sleep(200);
  let viditelne = await page.$$eval('[data-testid="chat-rozhovory-polozka"]', (els) => els.map((e) => e.innerText));
  expect(viditelne.length === 1 && /spárovek/i.test(viditelne[0]), `hledání bez diakritiky najde jen „spárovek“ (${JSON.stringify(viditelne)})`);
  await page.keyboard.type('xyz');
  expect(await cekej('[data-testid="chat-rozhovory-nenalezeno"]', 2000), 'nic nenalezeno → hláška');
  for (let i = 0; i < 11; i++) await page.keyboard.press('Backspace');
  await sleep(200);
  // open the other conversation
  const kliknuto = await page.evaluate(() => { const el = [...document.querySelectorAll('[data-testid="chat-rozhovory-polozka"]')].find((e) => /Ranní plán/i.test(e.innerText)); if (el) el.click(); return !!el; });
  expect(kliknuto && await cekej('[data-testid="chat-panel"][data-pohled="chat"]') && await cekejText('ODP-PRVNI'), 'klik na položku otevře ten rozhovor');
  // delete: bin → confirmation; ✕ keeps it, ✓ deletes
  await page.click('[data-testid="chat-historie"]');
  await cekej('[data-testid="chat-rozhovory"]');
  const pred = (await page.$$('[data-testid="chat-rozhovory-polozka"]')).length;
  await page.click('[data-testid="chat-rozhovory-smazat"]');
  expect(await cekej('[data-testid="chat-rozhovory-potvrdit"]'), 'koš se nejdřív zeptá „Smazat rozhovor?“');
  await page.click('[data-testid="chat-rozhovory-smazat-ne"]');
  expect(await zmizi('[data-testid="chat-rozhovory-potvrdit"]') && (await page.$$('[data-testid="chat-rozhovory-polozka"]')).length === pred, '✕ nechá rozhovor být');
  await page.click('[data-testid="chat-rozhovory-smazat"]');
  await page.keyboard.press('Escape');
  expect(await zmizi('[data-testid="chat-rozhovory-potvrdit"]') && !!(await page.$('[data-testid="chat-rozhovory"]')), 'Esc nejdřív zruší potvrzení, seznam zůstane');
  await page.click('[data-testid="chat-rozhovory-smazat"]');
  await page.click('[data-testid="chat-rozhovory-smazat-ano"]');
  const t0 = Date.now(); let po = pred;
  while (Date.now() - t0 < 5000) { po = (await page.$$('[data-testid="chat-rozhovory-polozka"]')).length; if (po === pred - 1) break; await sleep(200); }
  expect(po === pred - 1, `✓ rozhovor smaže (${pred} → ${po})`);
  // ✎ big button in the list = new conversation
  await page.click('[data-testid="chat-rozhovory-novy"]');
  expect(await cekej('[data-testid="chat-panel"][data-pohled="chat"] [data-testid="chat-input"]') && await cekej('[data-testid="chat-chipy"]'), '„Nový rozhovor“ v seznamu otevře prázdný rozhovor');
  // Esc typed into a field OUTSIDE the panel belongs to that field — the list stays (checkup 11 Nov 2026)
  await page.click('[data-testid="chat-historie"]');
  await cekej('[data-testid="chat-rozhovory"]');
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'kb-test-venku'; i.style.cssText = 'position:fixed;top:200px;left:700px;z-index:99'; document.body.appendChild(i); i.focus(); });
  await page.keyboard.press('Escape');
  await sleep(300);
  expect(!!(await page.$('[data-testid="chat-rozhovory"]')), 'Esc v políčku mimo panel seznam rozhovorů nezavře');
  await page.evaluate(() => document.getElementById('kb-test-venku').remove());
  // Esc back
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Escape');
  expect(await zmizi('[data-testid="chat-rozhovory"]') && await cekej('[data-testid="chat-input"]'), 'Esc ze seznamu zpět do rozhovoru');
  // ☰ again toggles back
  await page.click('[data-testid="chat-historie"]');
  await cekej('[data-testid="chat-rozhovory"]');
  await page.click('[data-testid="chat-historie"]');
  expect(await zmizi('[data-testid="chat-rozhovory"]'), 'druhý klik na ☰ vrátí rozhovor');

  console.log('== telefon: přes celou šířku, bez ⇄, uložená strana „vlevo“ se neuplatní ==');
  const mob = await H.browser({ mobil: true });
  await mob.page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); localStorage.setItem('kb-chat-side', 'left'); localStorage.setItem('kb-chat-open', '1'); }, A);
  await mob.page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await mob.page.waitForSelector('[data-testid="chat-panel"]', { timeout: 10000 }).then(() => true).catch(() => false), 'telefon: panel otevřený');
  const bM = await (await mob.page.$('[data-testid="chat-panel"]')).boundingBox();
  expect(Math.abs(bM.x) <= 1 && Math.abs(bM.width - 390) <= 1, `telefon: panel přes celou šířku (${Math.round(bM.x)}, ${Math.round(bM.width)})`);
  expect(!(await mob.page.$('[data-testid="chat-strana"]')), 'telefon: tlačítko ⇄ není');
  expect((await mob.page.$eval('[data-testid="chat-panel"]', (e) => e.dataset.side)) === 'right', 'telefon: strana se neuplatní');
  await mob.page.click('[data-testid="chat-historie"]');
  expect(await mob.page.waitForSelector('[data-testid="chat-rozhovory"]', { timeout: 5000 }).then(() => true).catch(() => false), 'telefon: seznam rozhovorů jde otevřít');
  const hlavickaVejde = await mob.page.evaluate(() => { const h = document.querySelector('[data-testid="chat-hlavicka"]'); return h.scrollWidth <= h.clientWidth + 1; });
  expect(hlavickaVejde, 'telefon: hlavička se vejde (nic nepřetéká)');
  // minimised bar: a reply sent from the bar is shown IN the bar → no "news" dot (checkup 11 Nov 2026)
  await mob.page.click('[data-testid="chat-historie"]');
  // the morning-briefing offer would take over the bar text and the dot → decline it for today first
  await mob.page.click('[data-testid="chat-novy"]');
  if (await mob.page.waitForSelector('[data-testid="chat-porada-ne"]', { timeout: 3000 }).then(() => true).catch(() => false)) await mob.page.click('[data-testid="chat-porada-ne"]');
  await mob.page.click('[data-testid="chat-zavrit"]');
  expect(await mob.page.waitForSelector('[data-testid="chat-bar-input"]', { timeout: 5000 }).then(() => true).catch(() => false), 'telefon: ⌄ zmenší asistenta do lišty');
  fronta.push(text('ODP-LISTA'));
  await mob.page.click('[data-testid="chat-bar-input"]');
  await mob.page.keyboard.type('Z lišty');
  await mob.page.click('[data-testid="chat-bar-send"]');
  const t1 = Date.now(); let vListe = '';
  while (Date.now() - t1 < 15000) { vListe = await mob.page.$eval('[data-testid="chat-bar-text"]', (e) => e.innerText).catch(() => ''); if (vListe.includes('ODP-LISTA')) break; await sleep(250); }
  await sleep(500);
  expect(vListe.includes('ODP-LISTA') && !(await mob.page.$('[data-testid="chat-bar-novinka"]')), `telefon: odpověď je vidět v liště, tečka „novinka“ nesvítí (${JSON.stringify(vListe.slice(0, 40))})`);
  await mob.browser.close().catch(() => {});
});
