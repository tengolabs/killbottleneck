// UI e2e: dialog „Připoj svého AI agenta" po prvním přihlášení (vzor onboardingu Runpod,
// Richard 10. 10. 2026). Každý uživatel ho vidí JEDNOU v plné aplikaci (ne v lite),
// první admin až PO dotazníku účelu; řádek ke zkopírování nese adresu instance +
// /agent-setup.md; kopírování jde i na http (záložní cesta); Přeskočit/Hotovo zapíše
// users.agent_setup_seen → po reloadu nic; v menu u jména zůstává; pozvaný člen ho
// vidí hned. Mutačně: instance s KB_PURPOSE_ASK=0 (všechny ostatní sady) dialog nemá.
const H = require('./_harness');
const { expect, sleep } = H;

const stubKopirovani = async (page) => {
  // 127.0.0.1 je secure context → navigator.clipboard; podvrhneme jako na LAN http
  // a zachytíme, co by execCommand skutečně kopíroval (vzor ui-api-klice.js)
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false });
    window.__copy = [];
    const orig = document.execCommand.bind(document);
    document.execCommand = (cmd) => {
      if (cmd === 'copy') { const ae = document.activeElement; window.__copy.push(ae && ae.value ? ae.value : (window.getSelection() || '').toString()); return true; }
      return orig(cmd);
    };
  });
};
const prihlasTokenem = async (page, inst, email) => {
  const r = await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: H.PW } });
  await page.evaluateOnNewDocument((tok, rec) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tok, record: rec })), r.json.token, r.json.record);
};
const dialog = (page) => page.$('[data-testid="agent-setup-dialog"]');
// inst.login vrací jen token — tady potřebujeme i id záznamu
const auth = async (inst, email) => (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: H.PW } })).json;

H.beh(async () => {
  // KB_START_RELAX=0: dotazník účelu tu musí běžet (KB_PURPOSE_ASK zapnuté), a s ním i start s akváriem (v0.88) —
  // po reloadu by akvárium překrylo menu u jména (regrese v0.89: menu-connect-agent nenalezen)
  const inst = await H.startInstance({ slug: 'pripoj-agenta', env: { KB_PURPOSE_ASK: null, KB_START_RELAX: 0 } });
  const B = inst.base;
  const { page, chyby, novaStranka } = await H.browser();
  await stubKopirovani(page);

  console.log('== první admin: registrace → dotazník účelu → teprve pak agent ==');
  await page.goto(`${B}/register`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', 'zakladatel@e2e.cz');
  await page.type('#password', H.PW);
  await page.type('#confirm', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForSelector('[data-testid="purpose-dialog"]', { timeout: 15000 });
  expect(!(await dialog(page)), 'dokud je otevřený dotazník účelu, dialog agenta NENÍ (nikdy dva přes sebe)');
  await page.click('[data-testid="purpose-continue"]');
  await page.waitForSelector('[data-testid="agent-setup-dialog"]', { timeout: 15000 });
  expect(!!(await dialog(page)), 'po uložení účelu naskočil dialog „Připoj svého AI agenta"');
  const text = await page.evaluate(() => document.querySelector('[data-testid="agent-setup-dialog"]').innerText);
  expect(/Připoj svého AI agenta/.test(text), 'titulek česky');
  expect(!/\b(title|description|copyLabel|agent\.)\b/.test(text), 'žádné syrové i18n klíče');
  const radek = await page.$eval('[data-testid="agent-setup-line"]', (el) => el.textContent);
  // Richard 13. 10.: řádek v jazyce uživatele — anglický řádek v české appce = agent odpovídá anglicky
  expect(radek === `Nastav mi killBottleneck: stáhni si a postupuj podle tohoto návodu ${B}/agent-setup.md`, `řádek pro agenta 1:1, ČESKY (${radek})`);
  const guide = await fetch(`${B}/agent-setup.md`);
  const guideText = await guide.text();
  expect(guide.status === 200 && guideText.includes(`${B}/mcp`), 'adresa z řádku opravdu vrací návod s touto instancí');
  expect(/language of their request/.test(guideText), 'návod (EN) agentovi říká: mluv s uživatelem jazykem jeho zadání');

  console.log('== kopírování (ne-secure context jako LAN http) ==');
  await page.click('[data-testid="agent-setup-copy"]');
  await sleep(500);
  const zkopirovano = await page.evaluate(() => window.__copy);
  expect(zkopirovano.length === 1 && zkopirovano[0] === radek, 'execCommand kopíroval přesně ten řádek');
  expect(await page.$('[data-testid="agent-setup-done"]') !== null, 'po zkopírování tlačítko Hotovo');
  await page.click('[data-testid="agent-setup-done"]');
  await sleep(600);
  expect(!(await dialog(page)), 'Hotovo dialog zavřelo');
  const admin = await auth(inst, 'zakladatel@e2e.cz');
  const me = await inst.api('GET', `/api/collections/users/records/${admin.record.id}`, { token: admin.token });
  expect(me.json.agent_setup_seen === true, 'users.agent_setup_seen = true (uloženo na účtu, ne v prohlížeči)');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  expect(!(await dialog(page)), 'po reloadu se dialog neukáže');

  console.log('== trvale v menu u jména ==');
  await page.click('[data-user-menu]');
  await page.waitForSelector('[data-testid="menu-connect-agent"]', { timeout: 5000 });
  await page.click('[data-testid="menu-connect-agent"]');
  await page.waitForSelector('[data-testid="agent-setup-dialog"]', { timeout: 10000 });
  expect(!(await page.$('[data-testid="agent-setup-skip"]')), 'z menu bez „Zatím přeskočit" (není co přeskakovat)');
  await page.keyboard.press('Escape');
  await sleep(400);
  expect(!(await dialog(page)), 'Escape zavře dialog z menu');

  console.log('== pozvaný člen (ne admin): dialog hned, Přeskočit ho uloží ==');
  await inst.register('clen@e2e.cz');
  const p2 = await novaStranka();
  await prihlasTokenem(p2, inst, 'clen@e2e.cz');
  await p2.goto(`${B}/`, { waitUntil: 'networkidle2' });
  await p2.waitForSelector('[data-testid="agent-setup-dialog"]', { timeout: 15000 });
  expect(!(await p2.$('[data-testid="purpose-dialog"]')), 'člen dotazník účelu nevidí, dialog agenta ano');
  await p2.click('[data-testid="agent-setup-skip"]');
  await sleep(600);
  expect(!(await dialog(p2)), 'Zatím přeskočit zavřelo');
  await p2.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  expect(!(await dialog(p2)), 'po přeskočení už se neukáže');
  const clen = await auth(inst, 'clen@e2e.cz');
  const me2 = await inst.api('GET', `/api/collections/users/records/${clen.record.id}`, { token: clen.token });
  expect(me2.json.agent_setup_seen === true, 'přeskočení zapsalo příznak na účet');

  console.log('== Escape = taky přeskočení (dialog zůstává v menu) ==');
  await inst.register('esc@e2e.cz');
  const p3 = await novaStranka();
  await prihlasTokenem(p3, inst, 'esc@e2e.cz');
  await p3.goto(`${B}/`, { waitUntil: 'networkidle2' });
  await p3.waitForSelector('[data-testid="agent-setup-dialog"]', { timeout: 15000 });
  await p3.keyboard.press('Escape');
  await sleep(600);
  const esc = await auth(inst, 'esc@e2e.cz');
  const me3 = await inst.api('GET', `/api/collections/users/records/${esc.record.id}`, { token: esc.token });
  expect(!(await dialog(p3)) && me3.json.agent_setup_seen === true, 'Escape zavřel a zapsal příznak');

  console.log('== lite (telefon) dialog nemá ==');
  await inst.register('lite@e2e.cz');
  const p4 = await novaStranka();
  await prihlasTokenem(p4, inst, 'lite@e2e.cz');
  await p4.goto(`${B}/lite`, { waitUntil: 'networkidle2' });
  await sleep(2500);
  expect(!(await dialog(p4)), 'v /lite se dialog neukáže');
  expect(/\/lite/.test(p4.url()), 'stránka zůstala v lite');
  await p4.goto(`${B}/tasks`, { waitUntil: 'networkidle2' });
  await p4.waitForSelector('[data-testid="agent-setup-dialog"]', { timeout: 15000 });
  expect(!!(await dialog(p4)), 'tentýž uživatel v plné aplikaci dialog dostane');

  console.log('== mutace: instance s KB_PURPOSE_ASK=0 (jako všechny ostatní sady) ==');
  const tich = await H.startInstance({ slug: 'pripoj-agenta-tich' });
  await tich.register('kdokoli@e2e.cz');
  const p5 = await novaStranka();
  await prihlasTokenem(p5, tich, 'kdokoli@e2e.cz');
  await p5.goto(`${tich.base}/`, { waitUntil: 'networkidle2' });
  await sleep(2500);
  expect(!(await dialog(p5)), 'agent_setup_ask=false → žádný dialog (ostatní sady nic neblokuje)');

  const vazne = chyby.filter((c) => !/favicon|404/.test(c));
  expect(vazne.length === 0, `bez chyb v konzoli (${vazne.length}): ${vazne.slice(0, 2).join(' | ').slice(0, 200)}`);
}, { nazev: 'UI-PRIPOJ-AGENTA' });
