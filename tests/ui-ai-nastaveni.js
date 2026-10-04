// Nastavení přes asistenta — klikací sada (Puppeteer) proti PODVRŽENÉ ollamě (fronta odpovědí jako
// v ui-ai-chat.js). Měří, co API sada nevidí: karta `nastaveni` se v prohlížeči PROJEVÍ (jazyk UI, tmavý
// motiv, čitelnost otevřené mapy bez reloadu, zámek zarovnání) a Vrátit ji vrátí; přepnutí do lite přes
// kartu skončí na /lite; výchozí skin instance uloží prohlížeč (kind client) a server dostane výsledek;
// dočasné heslo pozvánky je na kartě s Kopírovat a po reloadu zmizí; konzole bez chyb.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-ai-nastaveni.js
const H = require('./_harness');
const { expect, sleep } = H;

const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  const b = JSON.parse(body);
  volani.push(b);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
};

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ui-nastaveni', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
  } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');
  const me = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: H.PW } })).json.record;
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň Dvořákovi', title: 'Kuchyň Dvořákovi', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 700 }, data: { title: 'Poslat poptávku', status: 'todo', owner: 'admin@example.com' } },
    ], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } })).json;
  expect(!!map.id, 'mapa založena');
  await sleep(3000); // kontejner těsně před Chromem = ERR_NETWORK_CHANGED (past z 1. 10. 2026)

  const { page, chyby } = await H.browser();
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const textPanelu = () => page.evaluate(() => document.querySelector('[data-testid="chat-panel"]')?.innerText || '');
  const cekejText = async (s, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await textPanelu()).includes(s)) return true; await sleep(300); } return false; };
  const napis = async (s) => { await page.click('[data-testid="chat-input"]'); await page.keyboard.type(s); await page.keyboard.press('Enter'); };
  const uzivatel = async () => (await inst.api('GET', `/api/collections/users/records/${me.id}`, { token: A })).json;
  const ls = (k) => page.evaluate((kk) => { try { return localStorage.getItem(kk); } catch { return null; } }, k);

  console.log('== otevřít mapu + panel; čitelnost se v otevřené mapě přepne bez reloadu ==');
  await page.goto(`${inst.base}/map/${map.id}`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-nazev-uzlu]'), 'uzly mapy vykreslené');
  await page.bringToFront();
  expect(await cekej('[data-testid="chat-tab"]'), 'ouško asistenta v editoru');
  await (await page.$('[data-testid="chat-tab"]')).click();
  expect(await cekej('[data-testid="chat-panel"]'), 'panel otevřen');
  const tridaNazvu = () => page.$$eval('[data-nazev-uzlu]', (els) => els.map((e) => (e.className.match(/text-(sm|lg|base|xl)/) || [''])[0]).join(','));
  const pred = await tridaNazvu();
  expect(/text-lg/.test(pred), `výchozí čitelnost „větší“ (${pred})`);
  fronta.push(nastroj('set_preference', { co: 'readability', hodnota: 'normal' }), text('CITELNOST-MOCK.'));
  await napis('Nastav čitelnost mapy na normální');
  expect(await cekej('[data-testid="chat-nastaveni"][data-co="readability"]'), 'karta nastavení čitelnosti');
  await sleep(400);
  const po = await tridaNazvu();
  expect(/text-sm/.test(po) && !/text-lg/.test(po) && (await ls('kb-citelnost')) === 'normal', `otevřená mapa se překreslila na normální písmo bez reloadu (${po}, localStorage ${await ls('kb-citelnost')})`);
  expect((await textPanelu()).includes('Čitelnost mapy: normální'), 'text karty: Čitelnost mapy: normální');
  await page.click('[data-testid="chat-nastaveni-vratit"]');
  await sleep(400);
  expect(/text-lg/.test(await tridaNazvu()) && (await ls('kb-citelnost')) === 'large', `Vrátit → zpět větší písmo (${await ls('kb-citelnost')})`);
  // server nic neukládá (klientská předvolba): kontext zařízení šel serveru v požadavku
  const posledni = volani[volani.length - 1];
  expect(!JSON.stringify(posledni.messages).includes('"klient"'), 'klientské předvolby nejdou modelu (jen serveru v kontextu)');

  console.log('== tmavý motiv: karta → html.dark; Vrátit → světlý ==');
  fronta.push(nastroj('set_preference', { co: 'theme', hodnota: 'dark' }), text('TMAVY-MOCK.'));
  await napis('Přepni mi tmavý motiv');
  expect(await cekej('[data-testid="chat-nastaveni"][data-co="theme"]'), 'karta motivu');
  await sleep(300);
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark')) && (await ls('kb-theme')) === 'dark', 'tmavý motiv aplikován v prohlížeči');
  const kartyMotivu = await page.$$('[data-testid="chat-nastaveni"][data-co="theme"] [data-testid="chat-nastaveni-vratit"]');
  await kartyMotivu[kartyMotivu.length - 1].click();
  await sleep(300);
  expect(!(await page.evaluate(() => document.documentElement.classList.contains('dark'))) && (await ls('kb-theme')) === 'light', 'Vrátit → světlý motiv');

  console.log('== zámek zarovnání: na účtu i v prohlížeči ==');
  fronta.push(nastroj('set_preference', { co: 'align_lock', hodnota: 'compact' }), text('ZAMEK-MOCK.'));
  await napis('Zamkni zarovnání na kompakt');
  expect(await cekej('[data-testid="chat-nastaveni"][data-co="align_lock"]'), 'karta zámku');
  await sleep(500);
  expect((await uzivatel()).align_lock === 'compact' && (await ls('kb-zarovnat-zamek')) === 'compact', `zámek na účtu i v localStorage (${await ls('kb-zarovnat-zamek')})`);
  const kartyZamku = await page.$$('[data-testid="chat-nastaveni"][data-co="align_lock"] [data-testid="chat-nastaveni-vratit"]');
  await kartyZamku[kartyZamku.length - 1].click();
  await sleep(700);
  expect((await uzivatel()).align_lock === '' && !(await ls('kb-zarovnat-zamek')), 'Vrátit → zámek pryč na účtu i v prohlížeči');

  console.log('== jazyk: UI se přepne do angličtiny; Vrátit zpět ==');
  fronta.push(nastroj('set_preference', { co: 'language', hodnota: 'en' }), text('SWITCHED-MOCK.'));
  await napis('Přepni mě na angličtinu');
  expect(await cekej('[data-testid="chat-nastaveni"][data-co="language"]'), 'karta jazyka');
  expect(await cekejText('Language: English', 8000), 'karta přeložená anglicky (UI přepnuto)');
  expect(await page.evaluate(() => document.documentElement.lang) === 'en' && (await ls('kb-lang')) === 'en' && (await uzivatel()).language === 'en', 'html lang, localStorage i účet = en');
  expect(await page.evaluate(() => document.querySelector('[data-testid="chat-input"]').getAttribute('placeholder')) === 'What can I help with…', 'políčko chatu anglicky');
  const kartyJazyka = await page.$$('[data-testid="chat-nastaveni"][data-co="language"] [data-testid="chat-nastaveni-vratit"]');
  await kartyJazyka[kartyJazyka.length - 1].click();
  // karta dál ukazuje hodnotu, kterou nastavila (angličtina) — teď už česky, protože UI je zpět v češtině
  expect(await cekejText('Jazyk: angličtina', 8000), 'Vrátit → UI zpět česky (karta přeložená česky)');
  await sleep(500);
  expect((await uzivatel()).language === 'cs' && (await ls('kb-lang')) === 'cs', 'účet i prohlížeč zpět cs');

  console.log('== výchozí skin instance: prohlížeč uloží JSON skinu, server dostane výsledek ==');
  fronta.push(nastroj('set_instance_skin', { builtin_id: 'sepia' }));
  await napis('Nastav výchozí vzhled instance na sépii');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta k potvrzení');
  expect((await textPanelu()).includes('Nastavit výchozí vzhled instance: sepia'), 'text karty');
  fronta.push(text('SKIN-INSTANCE-MOCK.'));
  const anoTl = await page.$$('[data-testid="chat-akce-ano"]');
  await anoTl[anoTl.length - 1].click();
  expect(await cekejText('SKIN-INSTANCE-MOCK'), 'model dopověděl po výsledku z prohlížeče');
  const skinInst = (await inst.api('GET', '/api/kb/instance-skin', { token: A })).json;
  expect(skinInst.builtin_id === 'sepia' && !!skinInst.skin && typeof skinInst.skin === 'object', `instance_settings nese id i JSON skinu sépie (${skinInst.builtin_id}/${skinInst.skin ? Object.keys(skinInst.skin).length + ' klíčů' : 'bez JSON'})`);
  expect(volani[volani.length - 1].messages.some((m) => m.role === 'tool' && /Default skin of the instance set to sepia/.test(m.content)), 'výsledek prohlížeče šel modelu');
  expect(await cekej('[data-testid="chat-akce"][data-stav="hotovo"]'), 'karta hotovo');

  console.log('== pozvánka bez SMTP: dočasné heslo na kartě s Kopírovat, po reloadu pryč ==');
  fronta.push(nastroj('invite_member', { email: 'novak@firma.cz' }));
  await napis('Pozvi do týmu novak@firma.cz');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta pozvánky');
  fronta.push(text('POZVANO-MOCK.'));
  const anoTl2 = await page.$$('[data-testid="chat-akce-ano"]');
  await anoTl2[anoTl2.length - 1].click();
  expect(await cekej('[data-testid="chat-akce-heslo"]'), 'dočasné heslo na kartě');
  const heslo = await page.$eval('[data-testid="chat-akce-heslo-text"]', (e) => e.innerText.trim());
  expect(/^[A-Za-z0-9]{12}$/.test(heslo) && (await textPanelu()).includes('Dočasné heslo pro novak@firma.cz'), `heslo s popiskem (${heslo})`);
  expect((await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'novak@firma.cz', password: heslo } })).status === 200, 'heslo z karty funguje');
  await page.reload({ waitUntil: 'networkidle2' });
  await cekej('[data-testid="chat-panel"]');
  expect((await page.$('[data-testid="chat-akce-heslo"]')) === null && !(await textPanelu()).includes(heslo), 'po reloadu heslo v rozhovoru není (server ho neuložil)');

  console.log('== lite přes kartu: potvrzení → /lite ==');
  fronta.push(nastroj('set_preference', { co: 'mode', hodnota: 'lite' }));
  await napis('Přepni mě do zjednodušeného zobrazení');
  expect(await cekej('[data-testid="chat-akce"][data-stav="ceka"]'), 'karta lite k potvrzení');
  expect((await textPanelu()).includes('asistent tam není k dispozici'), 'karta varuje, že v lite asistent není');
  fronta.push(text('LITE-MOCK.'));
  const anoTl3 = await page.$$('[data-testid="chat-akce-ano"]');
  await anoTl3[anoTl3.length - 1].click();
  const t0 = Date.now();
  while (Date.now() - t0 < 10000 && !/\/lite/.test(page.url())) await sleep(200);
  expect(/\/lite/.test(page.url()) && (await ls('kb-mode')) === 'lite', `po potvrzení aplikace přešla na /lite (${page.url()}, kb-mode ${await ls('kb-mode')})`);
  const t1 = Date.now(); let liteText = '';
  while (Date.now() - t1 < 10000 && !/Přepnout na plnou verzi/.test(liteText)) { liteText = await page.evaluate(() => document.body.innerText); await sleep(300); }
  expect(/Přepnout na plnou verzi/.test(liteText) && (await page.$('[data-testid="chat-panel"]')) === null, 'lite se vykreslilo (s cestou zpět) a panel asistenta tam není');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
}, { nazev: 'UI-AI-NASTAVENI' });
