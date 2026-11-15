// UI e2e (headless Chrome, own temporary profile) against a FAKE ollama — three places of code
// analysis 4 that were fixed but had no check of their own (wave 7, missing tests):
//
//  A) F2-02, the second entry: a message COMPOSED BY A FORM (Kancelář → Nový dokument) that the
//     server refuses. The form closes before the message leaves, so the refused message used to be
//     gone with everything the person filled in. Now it is offered in the input of the assistant.
//  B) F2-03, the project part: notes of a project in the assistant's memory — a failed save and a
//     failed delete are SAID and the typed text stays (they used to be silent).
//  C) F4-05, the organisation: "Save" of the organisation name that the server refuses (or that
//     does not reach it) says why, the button comes back and the typed name stays.
//
// The person's path: real typing and clicks. A refusal is the real hourly cap (A) and forged
// answers of single requests (A, B, C). The model is only the mock.
// Run: KB_TEST_IMAGE=<image> node product/tests/ui-chyby4-mezery.js
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

let odpovedi = 0;
const mockHandler = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  odpovedi += 1;
  res.end(JSON.stringify({ message: { role: 'assistant', content: `ODPOVED-${odpovedi}.` }, prompt_eval_count: 100, eval_count: 20, done: true }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-chyby4-mezery', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 1,
  } });
  await inst.register('sef@example.com', { name: 'Šéf' }); // the first account = administrator
  const ST = await inst.superuser();
  const { browser } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', null, { viewport: { width: 1400, height: 900 } });
  const { page } = S;
  const dialogy = []; // E.clovek accepts every dialog; here they are only written down
  page.on('dialog', (d) => { dialogy.push({ typ: d.type(), text: d.message() }); });

  // forged answers: podvrh = [{ method, url: RegExp, status, body, abort }]
  let podvrh = [];
  const zasahy = [];
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    const p = podvrh.find((x) => x.method === rq.method() && x.url.test(rq.url()));
    if (p) zasahy.push(`${rq.method()} ${rq.url().replace(inst.base, '')}`);
    if (p && p.abort) { rq.abort('failed').catch(() => {}); return; }
    if (p) { rq.respond({ status: p.status, contentType: 'application/json', body: JSON.stringify(p.body || {}) }).catch(() => {}); return; }
    rq.continue().catch(() => {});
  });

  const sekce = async (fn) => { try { await fn(); } catch (err) { expect(false, `výjimka v sekci: ${err && err.stack ? err.stack.split('\n').slice(0, 2).join(' ') : err}`); } };
  const cekejSel = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
  const cekejText = (s, ms = 20000) => E.cekej(async () => (await textPanelu()).includes(s), ms, `text ${s}`);
  const pole = () => page.$eval('[data-testid="chat-input"]', (el) => el.value);
  const vymazPole = async () => { await page.click('[data-testid="chat-input"]'); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); };
  const chybaTxt = () => page.evaluate(() => (document.querySelector('[data-testid="chat-chyba"]') || {}).textContent || '');
  const chaty = async () => (await inst.api('GET', '/api/collections/ai_chats/records?perPage=50', { token: ST })).json.items || [];
  const zpravyUzivatele = (rec) => ((rec && rec.messages) || []).filter((m) => m.role === 'user').map((m) => m.content);
  const otevriPanel = async () => {
    await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    if (!(await cekejSel('[data-testid="chat-panel"]', 4000))) { await cekejSel('[data-testid="chat-tab"]'); await (await page.$('[data-testid="chat-tab"]')).click(); }
    const ok = await cekejSel('[data-testid="chat-input"]');
    if (await page.$('[data-testid="chat-porada-ne"]')) { await page.click('[data-testid="chat-porada-ne"]'); await sleep(400); }
    return ok;
  };
  const otevriKancelar = async () => {
    if (!(await page.$('[data-testid="chat-dokumenty"]'))) await page.click('[data-testid="chat-dokumenty-btn"]');
    await cekejSel('[data-testid="chat-dokumenty"]');
    if (await page.$('[data-testid="chat-dok-zpet"]')) { await page.click('[data-testid="chat-dok-zpet"]'); await sleep(400); }
  };
  // Kancelář → Nový → invitation → fill in → send; the form composes the message itself
  const posliFormular = async (akce) => {
    await otevriKancelar();
    if (!(await cekejSel('[data-testid="chat-dok-novy"]'))) return false;
    await page.click('[data-testid="chat-dok-novy"]');
    if (!(await cekejSel('[data-testid="chat-dok-novy-form"]', 8000))) return false;
    await page.click('[data-testid="chat-dok-druh"][data-druh="invitation"]');
    await page.type('[data-testid="chat-dok-novy-akce"]', akce);
    await page.type('[data-testid="chat-dok-novy-kde"]', 'dílna, Dlouhá 12');
    await page.click('[data-testid="chat-dok-novy-odeslat"]');
    return true;
  };
  const slozena = (akce) => (s) => /Udělej pozvánku/.test(s) && s.includes(`Akce: ${akce}.`) && s.includes('Kde: dílna, Dlouhá 12.');

  console.log('== A) F2-02: zpráva složená formulářem, kterou server odmítne ==');
  await sekce(async () => {
    expect(await otevriPanel(), 'panel asistenta otevřený');
    await page.click('[data-testid="chat-input"]'); await page.keyboard.type('Ahoj, první zpráva'); await page.keyboard.press('Enter');
    expect(await cekejText('ODPOVED-1.'), 'první odpověď v panelu (hodinový strop 1 je tím vyčerpaný)');
    const predModel = mock.pozadavky.length;
    expect(await posliFormular('Vánoční večírek'), 'formulář Nový dokument (pozvánka) vyplněn a odeslán');
    expect(await E.cekej(async () => /hodinový strop/.test(await chybaTxt()), 10000, 'hláška stropu'), `429 (skutečný hodinový strop): panel říká proč („${(await chybaTxt()).slice(0, 80)}“)`);
    await sleep(600);
    const p1 = await pole();
    expect(slozena('Vánoční večírek')(p1), `429: složená zpráva je v políčku asistenta i s tím, co člověk do formuláře vyplnil („${p1.slice(0, 140)}“)`);
    expect((await textPanelu()).includes('ODPOVED-1.'), '429: rozhovor v panelu zůstal');
    const ch = await chaty();
    expect(ch.length === 1 && zpravyUzivatele(ch[0]).length === 1 && mock.pozadavky.length === predModel, `429: na serveru odmítnutá zpráva není a model nebyl volán (rozhovorů ${ch.length}, zpráv uživatele ${zpravyUzivatele(ch[0]).length})`);

    // another refusal (forged 402) — the input is emptied first, the form is filled in again
    await vymazPole();
    podvrh = [{ method: 'POST', url: /\/api\/kb\/chat$/, status: 402, body: { error: 'Předplatné skončilo. Obnovte ho ve Správě.' } }];
    expect(await posliFormular('Letní grilování'), 'druhý formulář vyplněn a odeslán (podvržená odpověď 402)');
    expect(await E.cekej(async () => /Předplatné skončilo/.test(await chybaTxt()), 10000, 'hláška 402'), `402: panel ukázal větu serveru („${(await chybaTxt()).slice(0, 60)}“)`);
    await sleep(600);
    const p2 = await pole();
    expect(slozena('Letní grilování')(p2), `402: složená zpráva je v políčku („${p2.slice(0, 140)}“)`);

    // what the person had typed in the input before is NOT overwritten by the refused form message
    await vymazPole();
    await page.keyboard.type('Rozepsaná věta');
    expect(await posliFormular('Podzimní výlet'), 'třetí formulář odeslán, v políčku je rozepsaný text (podvržená odpověď 402)');
    await E.cekej(async () => zasahy.length >= 2, 8000, 'druhé odmítnutí');
    await sleep(800);
    expect((await pole()) === 'Rozepsaná věta', `rozepsaný text v políčku zůstal, složená zpráva ho nepřepsala („${(await pole()).slice(0, 80)}“)`);
    podvrh = [];
    await vymazPole();
  });

  console.log('== B) F2-03: poznámky k projektu v paměti asistenta — chyba uložení a smazání ==');
  await sekce(async () => {
    const M = await E.zalozMapu(inst, S.token, 'Projekt Alfa');
    const POZN = 'POZNAMKY K PROJEKTU ALFA: dodavatel je firma Drevo.';
    expect((await inst.api('POST', '/api/kb/chat/pamet', { token: S.token, body: { text: POZN, map_id: M.id } })).status === 200, 'poznámky k projektu uloženy přes API');
    const naServeru = async () => (((await inst.api('GET', '/api/kb/chat/pamet', { token: S.token })).json || {}).projekty || []).map((p) => p.text);
    await otevriKancelar();
    expect(await cekejSel('[data-testid="chat-dok-pamet"]'), 'v Kanceláři je odkaz na paměť');
    await page.click('[data-testid="chat-dok-pamet"]');
    expect(await cekejSel('[data-testid="chat-pamet-projekt"]', 8000) && (await page.$eval('[data-testid="chat-pamet-projekt-text"]', (el) => el.value)) === POZN, 'paměť ukazuje poznámky k projektu');
    const klikUlozit = () => page.evaluate(() => { const k = document.querySelector('[data-testid="chat-pamet-projekt"]'); [...k.querySelectorAll('button')].find((b) => !b.getAttribute('data-testid')).click(); });
    podvrh = [{ method: 'POST', url: /\/api\/kb\/chat\/pamet/, status: 500, body: { error: 'Chyba serveru.' } }];
    await page.click('[data-testid="chat-pamet-projekt-text"]');
    await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
    await page.keyboard.type(' DOPLNEK.');
    await klikUlozit();
    expect(await cekejSel('[data-testid="chat-pamet-projekt-chyba"]', 8000), 'nepovedené uložení poznámek k projektu je VIDĚT');
    expect((await page.$eval('[data-testid="chat-pamet-projekt-text"]', (el) => el.value)) === `${POZN} DOPLNEK.`, 'napsaný text v poli zůstal');
    expect((await naServeru()).join('|') === POZN, 'na serveru jsou dál původní poznámky');
    // a failed delete: the card stays with its text and says so
    podvrh = [];
    await klikUlozit();
    expect(await E.cekej(async () => (await naServeru()).join('|') === `${POZN} DOPLNEK.`, 8000, 'uložení poznámek'), 'druhý pokus poznámky uložil');
    expect(await E.cekej(async () => !(await page.$('[data-testid="chat-pamet-projekt-chyba"]')), 5000, 'hláška pryč'), 'hláška o chybě uložení po úspěchu zmizela');
    podvrh = [{ method: 'POST', url: /\/api\/kb\/chat\/pamet/, status: 500, body: { error: 'Chyba serveru.' } }];
    await page.click('[data-testid="chat-pamet-projekt-smaz"]');
    expect(await cekejSel('[data-testid="chat-pamet-projekt-chyba"]', 8000), 'nepovedené smazání poznámek je VIDĚT');
    expect(!!(await page.$('[data-testid="chat-pamet-projekt"]')) && (await page.$eval('[data-testid="chat-pamet-projekt-text"]', (el) => el.value)) === `${POZN} DOPLNEK.`, 'karta projektu i s textem zůstala (nic nevypadá smazané)');
    expect((await naServeru()).join('|') === `${POZN} DOPLNEK.`, 'na serveru poznámky dál jsou');
    podvrh = [];
    await page.click('[data-testid="chat-pamet-projekt-smaz"]');
    // the server keeps an EMPTY row for the project (ulozPamet does not delete) — the text is what counts here
    const smazano = await E.cekej(async () => (await naServeru()).every((x) => x === ''), 8000, 'smazání poznámek');
    expect(smazano, `kontrola: bez výpadku se text poznámek na serveru smaže (zbylo: ${JSON.stringify(await naServeru())})`);
    expect(await E.cekej(async () => !(await page.$('[data-testid="chat-pamet-projekt"]')), 5000, 'karta pryč'), 'a karta projektu z paměti zmizí');
    // not asserted, only written down: what the memory shows when it is opened again after the delete
    await page.click('[data-testid="chat-dok-zpet"]'); await sleep(400);
    await page.click('[data-testid="chat-dok-pamet"]');
    await cekejSel('[data-testid="chat-pamet-text"]', 8000); await sleep(600);
    const znovu = await page.evaluate(() => [...document.querySelectorAll('[data-testid="chat-pamet-projekt"]')].map((k) => `${k.querySelector('p').innerText}: „${k.querySelector('textarea').value}“`));
    // deleted means deleted: no empty card that cannot be removed, no empty row on the server
    const zbylo = await naServeru();
    expect(znovu.length === 0 && zbylo.length === 0, `po znovuotevření paměti smazané poznámky nejsou — žádná prázdná karta, žádný řádek (karty ${JSON.stringify(znovu)}; server ${JSON.stringify(zbylo)})`);
  });

  console.log('== C) F4-05: Uložit název organizace, když požadavek selže ==');
  await sekce(async () => {
    const orgZaznamy = async () => ((await inst.api('GET', '/api/collections/org_settings/records', { token: ST })).json.items || []).map((x) => x.name);
    await page.goto(`${inst.base}/admin/users?oddil=org`, { waitUntil: 'networkidle2' });
    expect(await cekejSel('#org-name', 20000), 'Správa → Organizace otevřena');
    // the "Uložit" button of the organisation card: the nearest one above the name field
    const tlacitko = () => page.evaluate(() => {
      let el = document.querySelector('#org-name');
      while (el && el !== document.body) {
        el = el.parentElement;
        const b = el && [...el.querySelectorAll('button')].find((x) => /^(Uložit|Uloženo)/.test((x.innerText || '').trim()));
        if (b) { b.setAttribute('data-test-org-uloz', '1'); return { text: (b.innerText || '').trim(), disabled: b.disabled }; }
      }
      return null;
    });
    const uloz = async () => { await tlacitko(); await page.click('[data-test-org-uloz="1"]'); };
    await page.click('#org-name', { clickCount: 3 });
    await page.type('#org-name', 'Truhlárna Šéf');
    podvrh = [{ method: 'POST', url: /\/api\/collections\/org_settings\/records/, status: 400, body: { status: 400, message: 'PODVRZENE-SELHANI-ORGANIZACE', data: {} } },
      { method: 'PATCH', url: /\/api\/collections\/org_settings\/records/, status: 400, body: { status: 400, message: 'PODVRZENE-SELHANI-ORGANIZACE', data: {} } }];
    dialogy.length = 0; zasahy.length = 0;
    await uloz();
    await E.cekej(() => dialogy.some((d) => d.typ === 'alert'), 8000, 'hláška o organizaci');
    const hl = (dialogy.find((d) => d.typ === 'alert') || {}).text || '';
    expect(zasahy.length === 1, `předpoklad: požadavek na uložení organizace odešel a byl odmítnut (${zasahy.join(', ') || 'žádný'})`);
    expect(/PODVRZENE-SELHANI-ORGANIZACE/.test(hl), `odmítnuté uložení organizace se řekne větou serveru („${hl}“)`);
    await sleep(500);
    let b = await tlacitko();
    expect(!!b && b.text === 'Uložit' && !b.disabled, `tlačítko je zpátky na „Uložit“ a jde stisknout znovu, netvrdí „Uloženo“ (${JSON.stringify(b)})`);
    expect((await page.$eval('#org-name', (el) => el.value)) === 'Truhlárna Šéf', 'napsaný název v poli zůstal');
    expect((await orgZaznamy()).length === 0, 'na serveru žádný záznam organizace nevznikl');
    // the request does not reach the server at all
    podvrh = [{ method: 'POST', url: /\/api\/collections\/org_settings\/records/, abort: true }, { method: 'PATCH', url: /\/api\/collections\/org_settings\/records/, abort: true }];
    dialogy.length = 0;
    await uloz();
    await E.cekej(() => dialogy.some((d) => d.typ === 'alert'), 8000, 'hláška o organizaci');
    const hl2 = (dialogy.find((d) => d.typ === 'alert') || {}).text || '';
    expect(hl2.trim().length > 5 && !/userAdmin\./.test(hl2), `požadavek, který na server nedorazil, se také řekne (${hl2 ? `„${hl2}“` : 'žádná hláška'})`);
    await sleep(500);
    b = await tlacitko();
    expect(!!b && b.text === 'Uložit' && !b.disabled && (await page.$eval('#org-name', (el) => el.value)) === 'Truhlárna Šéf', 'tlačítko je zpátky a název v poli zůstal');
    // control: without the forged failure the same click saves
    podvrh = [];
    dialogy.length = 0;
    await uloz();
    expect(await E.cekej(async () => (await orgZaznamy()).join('|') === 'Truhlárna Šéf', 8000, 'uložení organizace'), 'kontrola: bez selhání se název uloží');
    expect(!dialogy.some((d) => d.typ === 'alert'), 'a žádná chybová hláška se neukáže');
  });
}, { nazev: 'UI-CHYBY4-MEZERY' });
