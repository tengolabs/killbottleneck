// App start (owner 16 Nov 2026: "the aquarium after start was too aggressive — only the assistant"): with the default
// configuration the assistant panel opens by itself on a wide window and NO relax scene starts; F5 in the same tab
// does not repeat the start. /api/kb/config: start_open true, start_relax false; KB_START_RELAX=1 brings the aquarium
// back (that path is clicked through in ui-relax.js), KB_START_RELAX=0 turns both off.
const H = require('./_harness');
const { expect, sleep } = H;

H.beh(async () => {
  // KB_PURPOSE_ASK: null = the default of a real instance (the harness sends 0, which switches the start off for suites)
  const inst = await H.startInstance({ slug: 'ui-start-asistent', env: { KB_PURPOSE_ASK: null, KB_UVODNI_MAPA: 0, KB_AGENT_SETUP_ASK: 0 } });
  await inst.register('start@example.com', { name: 'Start' });
  const A = await inst.login('start@example.com');
  const cfg = (await inst.api('GET', '/api/kb/config', { token: A })).json;
  expect(cfg.start_open === true && cfg.start_relax === false, `default config: the panel opens, no aquarium (start_open ${cfg.start_open}, start_relax ${cfg.start_relax})`);

  const { page, chyby } = await H.browser();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument((tk) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} })); }, A);
  const cekej = async (sel, ms = 10000) => page.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  console.log('== start: the assistant panel opens by itself, no aquarium ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await cekej('[data-testid="chat-panel"]', 15000), 'after start the assistant panel is open (no click on the tab)');
  await sleep(3000);
  expect(!(await page.$('[data-testid="relax-vrstva"]')), 'no relax scene after start');
  console.log('== F5: still no aquarium ==');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(3000);
  expect(!(await page.$('[data-testid="relax-vrstva"]')), 'no relax scene after F5 either');
  expect(chyby.length === 0, `console without errors (${chyby.slice(0, 3).join(' | ')})`);

  console.log('== KB_START_RELAX=0 / =1: config ==');
  for (const [v, open, relax] of [['0', false, false], ['1', true, true]]) {
    const i2 = await H.startInstance({ slug: `ui-start-asistent-${v}`, env: { KB_PURPOSE_ASK: null, KB_UVODNI_MAPA: 0, KB_START_RELAX: v } });
    await i2.register('s@example.com', { name: 'S' });
    const T = await i2.login('s@example.com');
    const c = (await i2.api('GET', '/api/kb/config', { token: T })).json;
    expect(c.start_open === open && c.start_relax === relax, `KB_START_RELAX=${v}: start_open ${c.start_open}, start_relax ${c.start_relax}`);
    await i2.stop();
  }
}, { nazev: 'UI-START-ASISTENT' });
