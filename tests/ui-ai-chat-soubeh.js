// UI e2e (headless Chrome) against a FAKE ollama: the assistant panel when the conversation
// is still answering another request (code analysis 4, S1-02).
//
// The same conversation is open in the panel and "in a second tab" (a plain API request that
// is slow). What the person SEES in the panel when they send a message / confirm a card
// meanwhile: the server's sentence ("Rozhovor právě odpovídá…" / English for an English
// account), the typed text back in the field, the card still waiting — nothing lost; after
// the other request finishes, the same message goes through and the card can be confirmed.
const H = require('./_harness');
const { expect, sleep } = H;

const nastroj = (name, args) => ({ function: { name, arguments: args } });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  const b = JSON.parse(body);
  const msgs = b.messages || [];
  const iu = msgs.map((m) => m.role).lastIndexOf('user');
  const user = iu >= 0 ? String(msgs[iu].content || '') : '';
  const nastroju = msgs.slice(iu + 1).filter((m) => m.role === 'tool').length;
  const message = { role: 'assistant', content: '' };
  let zdrzeni = 0;
  if (/POMALU/.test(user)) { zdrzeni = 6000; message.content = 'ODPOVED-POMALA.'; }
  else if (/PROJEKT/.test(user)) {
    if (!nastroju) message.tool_calls = [nastroj('create_project', { title: 'Projekt z karty', goal: 'Cíl projektu z karty', outline: [{ title: 'První krok' }] })];
    else message.content = 'DOPOVED-PO-KARTE.';
  } else message.content = /nesmí ztratit/.test(user) ? 'ODPOVED-NEZTRACENO.' : 'ODPOVED-AHOJ.';
  const odpoved = () => res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
  if (zdrzeni) setTimeout(odpoved, zdrzeni); else odpoved();
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-chat-soubeh', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  await inst.register('en@example.com', { name: 'Ann', language: 'en' });
  const ST = await inst.superuser();
  const { browser, chyby } = await H.browser();

  const scenar = async (email, L) => {
    const tok = await inst.login(email);
    const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
    const page = await ctx.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    page.on('console', (m) => { if (m.type() === 'error' && !H.cizihoPuvodu(m)) chyby.push(m.text()); });
    await page.evaluateOnNewDocument((tk) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
      try { localStorage.setItem('kb-relax-rano:' + JSON.parse(atob(tk.split('.')[1])).id, new Date().toLocaleDateString('en-CA')); } catch { /* test */ }
    }, tok);
    const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
    const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
    const cekejText = async (s, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textPanelu()).includes(s)) return true; await sleep(300); } return false; };
    const napis = async (t) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(t); await page.keyboard.press('Enter'); };
    const pole = () => page.$eval('[data-testid="chat-input"]', (el) => el.value);
    const chybaTxt = () => page.evaluate(() => (document.querySelector('[data-testid="chat-chyba"]') || {}).textContent || '');
    const veta = L === 'en' ? 'This conversation is still answering' : 'Rozhovor právě odpovídá';

    await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    if (!(await cekej('[data-testid="chat-panel"]', 4000))) { await cekej('[data-testid="chat-tab"]'); await (await page.$('[data-testid="chat-tab"]')).click(); }
    expect(await cekej('[data-testid="chat-input"]'), `${L}: panel asistenta otevřený`);
    if (await page.$('[data-testid="chat-porada-ne"]')) { await page.click('[data-testid="chat-porada-ne"]'); await sleep(400); }
    await napis('Ahoj');
    expect(await cekejText('ODPOVED-AHOJ.'), `${L}: první odpověď v panelu`);
    const chatId = await page.evaluate(() => localStorage.getItem('kb-chat-id') || '');
    expect(!!chatId, `${L}: panel drží id rozhovoru`);

    console.log(`== ${L}: zpráva z panelu, zatímco rozhovor odpovídá jinde ==`);
    const jinde = inst.api('POST', '/api/kb/chat', { token: tok, body: { chat_id: chatId, message: 'POMALU z druhé záložky' } });
    await sleep(800);
    await napis('Tohle se nesmí ztratit');
    expect(await H.waitFor(async () => (await chybaTxt()).includes(veta), { timeout: 8000, popis: 'hláška v panelu' }).then(() => true).catch(() => false), `${L}: panel ukázal větu serveru („${(await chybaTxt()).slice(0, 80)}")`);
    expect((await pole()) === 'Tohle se nesmí ztratit', `${L}: napsaný text je zpátky v políčku („${await pole()}")`);
    const r1 = await jinde;
    expect(r1.status === 200, `${L}: požadavek z druhé záložky doběhl (${r1.status})`);
    await page.click('[data-testid="chat-input"]');
    await page.keyboard.press('Enter');
    expect(await cekejText('ODPOVED-NEZTRACENO.'), `${L}: po doběhnutí jde tatáž zpráva odeslat a asistent odpoví`);
    expect((await textPanelu()).includes('ODPOVED-POMALA.'), `${L}: tah z druhé záložky v rozhovoru je také — nic se nepřepsalo`);
    expect((await chybaTxt()) === '', `${L}: hláška zmizela`);
    const rec = (await inst.api('GET', `/api/collections/ai_chats/records/${chatId}`, { token: ST })).json;
    const u = (rec.messages || []).filter((m) => m.role === 'user').map((m) => m.content);
    expect(u.filter((x) => x === 'Tohle se nesmí ztratit').length === 1 && u.includes('POMALU z druhé záložky'), `${L}: v uloženém rozhovoru jsou obě zprávy, každá jednou (${u.length})`);

    console.log(`== ${L}: potvrzení karty, zatímco rozhovor odpovídá jinde ==`);
    await napis('PROJEKT založ');
    expect(await cekej('[data-testid="chat-akce-ano"]', 15000), `${L}: karta akce čeká na potvrzení`);
    // a slow MESSAGE holds the conversation (a slow confirmation would consume the card itself); the click comes
    // while that message waits for the model and the panel still shows the card
    const pomala = inst.api('POST', '/api/kb/chat', { token: tok, body: { chat_id: chatId, message: 'POMALU podruhé' } });
    await sleep(800);
    await page.click('[data-testid="chat-akce-ano"]');
    expect(await H.waitFor(async () => (await chybaTxt()).includes(veta), { timeout: 8000, popis: 'hláška v panelu' }).then(() => true).catch(() => false), `${L}: klik na kartu během cizího tahu → věta serveru, ne tichý úspěch („${(await chybaTxt()).slice(0, 80)}")`);
    await pomala;
    const projektu = ((await inst.api('GET', `/api/collections/goalmaps/records?filter=${encodeURIComponent(`title="Projekt z karty" && owner_email="${email}"`)}`, { token: ST })).json.items || []).length;
    expect(projektu === 0, `${L}: odmítnuté potvrzení nic neprovedlo (projektů ${projektu})`);
    await ctx.close();
  };

  await scenar('admin@example.com', 'cs');
  await scenar('en@example.com', 'en');
  expect(chyby.filter((c) => !/409|Conflict/.test(c)).length === 0, `konzole bez nečekaných chyb (${chyby.slice(0, 2).join(' | ').slice(0, 200)})`);
}, { nazev: 'UI-AI-CHAT-SOUBEH' });
