// Ukotvená horní lišta (Richard 27. 10. 2026: „ať je v celé aplikaci ukotvení horní lišty s panáčkem a zvonečkem,
// ať pořád máš notifikace a víš, kde jsi — i v asistentovi, i v nastavení“) — klikací sada (Puppeteer, bez modelu):
// lišta drží při rolování, je přes celé okno i s otevřeným asistentem a panel začíná pod ní; zásobník a stopky
// začínají pod lištou; Správa organizace má lištu; dialogy z menu panáčka se otevírají POD lištou a lišta zůstává
// klikací (zvonek otevře nabídku a dialog nezmizí), klik do závoje zavře; telefon (390 px): panel pod dvouřádkovou lištou.
// Editor mapy × panel hlídá ui-ai-chat.js, akvárium ui-relax.js, Dokumenty ui-dokumenty.js.
const H = require('./_harness');
const { expect, sleep } = H;

H.beh(async () => {
  // KB_TRIAL_UNTIL: celá sada jede S proužkem „Zkušební verze“ — ten je součástí ukotveného obalu a na telefonu
  // dřív zasunuté ouško asistenta (pevných 96 px) leželo přes panáčka (nález panelu 27. 10. 2026)
  const inst = await H.startInstance({ slug: 'ui-lista', env: { KB_UVODNI_MAPA: 0, KB_TRIAL_UNTIL: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const box = async (sel) => { const el = await page.$(sel); return el ? el.boundingBox() : null; };
  const lista = () => page.evaluate(() => {
    const h = document.querySelector('[data-app-header]'); if (!h) return null;
    const o = h.closest('[data-app-header-obal]') || h;
    const r = h.getBoundingClientRect(); const ro = o.getBoundingClientRect();
    const nahore = (b) => { if (!b) return false; const x = b.getBoundingClientRect(); if (!x.width) return false; const el = document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2); return !!el && b.contains(el); };
    const zvonek = [...h.querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-bell'));
    const panacek = h.querySelector('button[data-user-menu]');
    return {
      top: Math.round(r.top), obalTop: Math.round(ro.top), proužek: Math.round(r.top - ro.top), spodek: Math.round(r.bottom), left: Math.round(ro.left), right: Math.round(ro.right), okno: window.innerWidth,
      sticky: getComputedStyle(o).position, zvonek: nahore(zvonek), panacek: nahore(panacek), maZvonek: !!zvonek, maPanacka: !!panacek,
      zakryto: [...h.querySelectorAll('button')].filter((b) => b.offsetParent && !b.disabled && !nahore(b)).length,
    };
  });

  console.log('== titulka: lišta drží při rolování a vede přes celé okno ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-app-header]'), 'lišta na titulce');
  let l = await lista();
  expect(l.sticky === 'sticky' && l.obalTop === 0 && l.proužek >= 20 && l.left === 0 && l.right === l.okno, `obal lišty (i s proužkem ${l.proužek} px) je sticky přes celé okno (${l.sticky}, od ${l.obalTop}, ${l.left}–${l.right} / ${l.okno})`);
  await page.evaluate(() => { const d = document.createElement('div'); d.style.height = '3000px'; d.setAttribute('data-testid', 'vycpavka'); document.querySelector('[data-testid="obsah"]').appendChild(d); window.scrollTo(0, 600); });
  await sleep(300);
  l = await lista();
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY >= 500 && l.obalTop === 0 && l.zvonek && l.panacek, `po odrolování o ${scrollY} px lišta i proužek zůstaly nahoře (obal od ${l.obalTop}), zvonek i panáček klikací`);
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('[data-testid="vycpavka"]')?.remove(); });

  console.log('== otevřený asistent: lišta přes celé okno, panel pod ní, nic z lišty nezakryté ==');
  await page.click('[data-testid="chat-toggle"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'panel asistenta otevřený');
  await sleep(600); // přechod odsunu
  l = await lista();
  let bp = await box('[data-testid="chat-panel"]');
  const odsazeni = await page.evaluate(() => { const el = [...document.querySelectorAll('div[style]')].find((d) => d.style.paddingRight); return el ? parseFloat(el.style.paddingRight) : 0; });
  expect(l.left === 0 && l.right === l.okno && Math.abs(odsazeni - bp.width) <= 1, `lišta dál vede přes celé okno (${l.left}–${l.right}), obsah odsazen o panel (${odsazeni} px)`);
  expect(Math.abs(bp.y - l.spodek) <= 1 && bp.y + bp.height >= 899, `panel začíná pod lištou (lišta do ${l.spodek}, panel od ${Math.round(bp.y)}) a sahá dolů`);
  expect(l.zakryto === 0 && l.zvonek && l.panacek, `žádné tlačítko lišty není pod panelem (zakryto ${l.zakryto}), zvonek i panáček klikací`);
  await page.click('[data-testid="chat-zavrit"]');
  await cekej('[data-testid="chat-tab"]');

  console.log('== levé panely (zásobník, stopky) začínají pod lištou, obsah se odsouvá ==');
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-app-header]') && await cekej('button[title="Zásobník nápadů"]'), 'úkoly: lišta + ouško zásobníku');
  await page.click('button[title="Zásobník nápadů"]');
  expect(await cekej('[data-testid="buffer-panel"]'), 'zásobník otevřený');
  await sleep(500);
  l = await lista();
  const bb = await box('[data-testid="buffer-panel"]');
  const krizekZasobniku = await page.evaluate(() => { const b = document.querySelector('[data-testid="buffer-panel"] button'); const x = b.getBoundingClientRect(); const el = document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2); return !!el && b.contains(el); });
  const odsunObsahu = await page.evaluate(() => (document.querySelector('[data-testid="obsah"]')?.className || '').match(/sm:pl-\d+/)?.[0] || '');
  expect(Math.abs(bb.y - l.spodek) <= 1 && krizekZasobniku, `zásobník začíná pod lištou (lišta do ${l.spodek}, panel od ${Math.round(bb.y)}), jeho hlavička je klikací`);
  expect(l.left === 0 && odsunObsahu === 'sm:pl-72', `lišta přes celé okno i nad zásobníkem, odsazený je jen obsah (${odsunObsahu})`);
  await page.click('[data-testid="buffer-panel"] button');
  await sleep(300);
  const stopky = await page.$('button[title*="Měření času — záznamy"]');
  expect(!!stopky, 'ouško stopek na hraně');
  await stopky.click();
  expect(await cekej('[data-testid="timelog-panel"]'), 'panel stopek otevřený');
  await sleep(500);
  const bs = await box('[data-testid="timelog-panel"]');
  l = await lista();
  expect(Math.abs(bs.y - l.spodek) <= 1, `panel stopek začíná pod lištou (${Math.round(bs.y)} / lišta do ${l.spodek})`);
  await page.click('[data-testid="timelog-panel"] button'); await sleep(300);

  console.log('== Správa organizace má lištu; kotva #ai pod ní ==');
  await page.goto(`${inst.base}/admin/users`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-app-header]'), 'Správa organizace: lišta je tu');
  l = await lista();
  expect(l.maZvonek && l.maPanacka && l.zvonek && l.panacek && !!(await page.$('[data-app-header] svg.lucide-arrow-left')), 'v liště zvonek, panáček i šipka zpět');
  expect(!(await page.$('h1 ~ button svg.lucide-arrow-left')) && (await page.$$eval('svg.lucide-arrow-left', (a) => a.length)) === 1, 'původní samostatná šipka zpět pod lištou zmizela (jen jedna šipka — v liště)');
  await page.goto(`${inst.base}/admin/users#ai`, { waitUntil: 'networkidle2' });
  if (await cekej('#ai', 8000)) {
    await sleep(800);
    const ai = await box('#ai'); l = await lista();
    expect(ai.y >= l.spodek - 1, `kotva #ai není schovaná pod lištou (box od ${Math.round(ai.y)}, lišta do ${l.spodek})`);
  } else console.log('  (bez sekce #ai — hostovaná sestava, kotva se netestuje)');

  console.log('== dialog z menu panáčka pod lištou: lišta klikací, zvonek dialog nezavře, závoj ano ==');
  await page.click('button[data-user-menu]');
  expect(await cekej('[role="menu"]'), 'nabídka panáčka');
  let polozka = await page.evaluateHandle(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Můj účet/.test(m.textContent)));
  await polozka.asElement().click();
  expect(await cekej('[role="dialog"][data-pod-listou="1"]'), 'dialog Můj účet se otevřel v režimu pod lištou');
  await sleep(400);
  l = await lista();
  const bd = await box('[role="dialog"][data-pod-listou="1"]');
  const zavoj = await page.evaluate(() => { const z = document.querySelector('[data-dialog-zavoj]'); return z ? Math.round(z.getBoundingClientRect().top) : -1; });
  expect(zavoj === l.spodek && bd.y >= l.spodek, `závoj začíná pod lištou (${zavoj} / ${l.spodek}), okno dialogu pod ní (od ${Math.round(bd.y)})`);
  expect(l.zvonek && l.panacek && l.zakryto === 0, 'lišta nad dialogem je klikací (zvonek, panáček, nic zakryté)');
  const podZavojem = await page.evaluate(() => { const el = document.elementFromPoint(30, 880); return el ? (el.hasAttribute('data-dialog-zavoj') ? 'zavoj' : el.tagName) : 'nic'; });
  expect(podZavojem === 'zavoj', `obsah stránky pod závojem NENÍ klikací (v bodě 30,880 je ${podZavojem})`);
  const rolovani = await page.evaluate(() => getComputedStyle(document.body).overflow);
  expect(rolovani === 'hidden', `otevřený dialog zamyká rolování stránky (body overflow ${rolovani})`);
  // druhý dialog z nabídky zavře první (nemodální dialogy, lišta klikací → dřív by se otevřely dva přes sebe)
  await page.click('button[data-user-menu]');
  await cekej('[role="menu"]');
  await page.click('[data-skin-menu-item]');
  await sleep(400);
  const pocetDialogu = await page.$$eval('[role="dialog"][data-pod-listou="1"]', (d) => d.length);
  expect(pocetDialogu === 1, `z nabídky nad otevřeným dialogem se otevře jen jeden dialog naráz (${pocetDialogu})`);
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.click('button[data-user-menu]');
  await cekej('[role="menu"]');
  polozka = await page.evaluateHandle(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Můj účet|My account/.test(m.textContent)));
  await polozka.asElement().click();
  expect(await cekej('[role="dialog"][data-pod-listou="1"]'), 'Můj účet znovu otevřený');
  await sleep(400);
  l = await lista();
  const zvonekEl = await page.evaluateHandle(() => [...document.querySelectorAll('[data-app-header] button')].find((b) => b.querySelector('svg.lucide-bell')));
  await zvonekEl.asElement().click();
  await sleep(400);
  const nabidkaZvonku = await page.evaluate(() => [...document.querySelectorAll('[role="menu"]')].some((m) => /Notifikace|Notifications|Oznámení/.test(m.textContent)));
  expect(nabidkaZvonku && !!(await page.$('[role="dialog"][data-pod-listou="1"]')), 'klik na zvonek otevřel oznámení a dialog ZŮSTAL otevřený');
  await page.keyboard.press('Escape');
  await sleep(300);
  expect(!!(await page.$('[role="dialog"][data-pod-listou="1"]')), 'Escape zavřel jen nabídku zvonku, dialog zůstal');
  await page.mouse.click(30, 880); // do závoje vlevo dole (mimo okno dialogu)
  await sleep(500);
  expect(!(await page.$('[role="dialog"][data-pod-listou="1"]')), 'klik do závoje dialog zavřel');
  // Vzhled: dialog s vlastním (průhledným) závojem — taky pod lištou
  await page.click('button[data-user-menu]');
  await cekej('[role="menu"]');
  await page.click('[data-skin-menu-item]');
  expect(await cekej('[role="dialog"][data-pod-listou="1"]'), 'Vzhled: dialog pod lištou');
  l = await lista();
  expect(l.zvonek && l.panacek, 'Vzhled: lišta nad ním klikací');
  await sleep(400); // nabídka panáčka dojíždí zavírací animaci — dokud je vrstvou nad dialogem, Escape by spolkla ona
  await page.keyboard.press('Escape');
  await sleep(300);
  expect(!(await page.$('[role="dialog"]')), `Escape dialog zavřel (${await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => (d.getAttribute('data-pod-listou') || '-') + ':' + d.textContent.slice(0, 50)).join(' | ') + ' fokus=' + (document.activeElement && document.activeElement.tagName))})`);

  console.log('== editor mapy: pruh nad lištou posouvá i panel (archivovaný projekt + pruh za běhu) ==');
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Archivovaná zakázka', archived: true, nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } },
    ], edges: [] } })).json;
  await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: A, body: { archived: true } }); // create archivaci vynuluje
  await page.evaluate(() => localStorage.setItem('kb-chat-open', '1')); // panel otevřený už při načtení editoru
  await page.goto(`${inst.base}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-app-header]'), 'editor: lišta');
  // editor otevírá asistenta tlačítkem v liště (toolbar-asistent); ouško na okraji v editoru není
  expect(await cekej('[data-testid="chat-panel"]'), 'editor: panel otevřený');
  await sleep(600);
  const pruh = () => page.evaluate(() => { const h = document.querySelector('[data-app-header]'); let v = 0; for (let s = h.previousElementSibling; s; s = s.previousElementSibling) v += s.getBoundingClientRect().height; return Math.round(v); });
  l = await lista();
  bp = await box('[data-testid="chat-panel"]');
  const vPruhu = await pruh();
  expect(vPruhu >= 30 && l.top === vPruhu && Math.abs(bp.y - l.spodek) <= 1, `pruh „archivovaný projekt“ (${vPruhu} px) nad lištou: lišta od ${l.top}, panel od spodku lišty ${l.spodek} (panel od ${Math.round(bp.y)})`);
  expect(l.zvonek && l.panacek && l.zakryto === 0, 'editor s pruhem: zvonek i panáček klikací, nic zakryté');
  // pruh přidaný ZA BĚHU (stejný tvar jako „mapa se změnila jinde“): lišta se jen posune, velikost nezmění → sklad to musí vidět
  await page.evaluate(() => { const h = document.querySelector('[data-app-header]'); const d = document.createElement('div'); d.style.height = '36px'; d.setAttribute('data-testid', 'pruh-za-behu'); h.parentElement.insertBefore(d, h); });
  await sleep(400);
  l = await lista();
  bp = await box('[data-testid="chat-panel"]');
  expect(l.top === vPruhu + 36 && Math.abs(bp.y - l.spodek) <= 1 && l.zakryto === 0, `pruh přidaný za běhu: lišta od ${l.top} (${vPruhu}+36), panel od spodku ${l.spodek} (od ${Math.round(bp.y)}), zakryto ${l.zakryto}`);
  await page.evaluate(() => document.querySelector('[data-testid="pruh-za-behu"]').remove());
  await sleep(400);
  l = await lista();
  bp = await box('[data-testid="chat-panel"]');
  expect(l.top === vPruhu && Math.abs(bp.y - l.spodek) <= 1, `pruh odebraný za běhu: panel zpět na spodek lišty ${l.spodek} (od ${Math.round(bp.y)})`);

  console.log('== telefon (390 px): panel asistenta pod dvouřádkovou lištou ==');
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-app-header]'), 'telefon: lišta');
  if (!(await page.$('[data-testid="chat-panel"]'))) await page.click('[data-testid="chat-toggle"]');
  expect(await cekej('[data-testid="chat-panel"]'), 'telefon: panel otevřený');
  await sleep(500);
  l = await lista();
  bp = await box('[data-testid="chat-panel"]');
  expect(l.spodek > 56 && Math.abs(bp.y - l.spodek) <= 1 && bp.width >= 389 && bp.y + bp.height >= 843, `telefon: panel od spodku dvouřádkové lišty (${l.spodek}) přes celou šířku do spodku (od ${Math.round(bp.y)}, šířka ${Math.round(bp.width)})`);
  expect(l.zvonek && l.panacek, 'telefon: zvonek i panáček nad panelem klikací');
  await page.click('[data-testid="chat-dokumenty-btn"]');
  expect(await cekej('[data-testid="chat-dokumenty"]'), 'telefon: Dokumenty otevřené');
  await sleep(400);
  const bdok = await box('[data-testid="chat-dokumenty"]');
  l = await lista();
  expect(Math.abs(bdok.y - l.spodek) <= 1 && l.zvonek && l.panacek, `telefon: Dokumenty začínají pod lištou (${Math.round(bdok.y)} / ${l.spodek}), lišta klikací`);
  // zasunuté ouško asistenta se bez připojené AI nekreslí a na telefonu je místo něj spodní lišta → jeho polohu pod lištou hlídá ui-ai-chat

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 2).join(' | ').slice(0, 160)})`);
}, { nazev: 'UI-LISTA-UKOTVENA' });
