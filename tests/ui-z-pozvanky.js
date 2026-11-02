// Z POZVÁNKY DO KALENDÁŘE v prohlížeči (/checkup 2. 11. 2026 — plán sliboval UI kontroly, chyběly):
// chip nese místo v tooltipu, dialog má pole Místo, do kterého jde PSÁT (pravidlo „zámek pole spolkl psaní“ —
// skutečné klávesy, uložit, znovu otevřít), blok série, „Smazat celou sérii“ = 1. klik jen dotaz, 2. smaže
// celou sérii (událost mimo sérii zůstane), pozvaná tlačítko série nemá.
const H = require('./_harness');
const { expect, sleep } = H;
const den = (p) => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' })); d.setDate(d.getDate() + p); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-z-pozvanky', env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0 } });
  await inst.register('a@e2e.cz'); await inst.register('b@e2e.cz');
  const A = await inst.login('a@e2e.cz');
  let r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items: [1, 2, 3].map((i) => ({ title: 'Seminář', day: den(i), time: '10:00', end_time: '11:00', place: 'Sál 214' })), participants: ['b@e2e.cz'] } });
  expect(r.status === 200 && r.json.events.length === 3, `dávka 3 (${r.status})`);
  const ids = r.json.events.map((e) => e.id);
  await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Mimo sérii', day: den(1), time: '15:00' } });
  const { page, chyby } = await H.browser();
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email'); await page.type('#email', 'a@e2e.cz'); await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1000);
  await page.goto(`${inst.base}/kalendar`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.gcal-wrapper', { timeout: 15000 }); await sleep(1000);
  // měsíc může přetéct do dalšího měsíce — chip najdeme podle id
  let chip = await page.$(`[data-testid^="gcal-chip-ev-${ids[0]}"]`);
  if (!chip) { await page.click('[aria-label="Další měsíc"]').catch(() => {}); await sleep(800); chip = await page.$(`[data-testid^="gcal-chip-ev-${ids[0]}"]`); }
  expect(!!chip, 'chip události ze série v kalendáři');
  const title = chip ? await page.evaluate((el) => el.getAttribute('title'), chip) : '';
  expect(/Sál 214/.test(title || ''), `tooltip chipu nese místo (${title})`);
  await chip.click(); await sleep(800);
  const misto = await page.$eval('[data-testid="udalost-misto"]', (el) => el.value).catch(() => null);
  expect(misto === 'Sál 214', `dialog: pole Místo = ${misto}`);
  const serieTxt = await page.$eval('[data-testid="udalost-serie"]', (el) => el.innerText).catch(() => null);
  expect(!!serieTxt && /3/.test(serieTxt), `dialog: blok série (${serieTxt && serieTxt.replace(/\n/g, ' ')})`);
  // psaní do pole Místo: smazat a napsat klávesami, uložit, znovu otevřít
  await page.click('[data-testid="udalost-misto"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('[data-testid="udalost-misto"]', 'Učebna B-208', { delay: 15 });
  const napsano = await page.$eval('[data-testid="udalost-misto"]', (el) => el.value);
  expect(napsano === 'Učebna B-208', `do pole Místo jde psát (${napsano})`);
  await page.click('[data-testid="udalost-ulozit"]'); await sleep(1200);
  const ulozena = ((await inst.api('GET', '/api/kb/events', { token: A })).json.events || []).find((e) => e.id === ids[0]);
  expect(ulozena && ulozena.place === 'Učebna B-208' && ulozena.series, `uloženo: místo ${ulozena && ulozena.place}, série zůstala`);
  await page.goto(`${inst.base}/kalendar?udalost=${ids[0]}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="udalost-misto"]', { timeout: 10000 }).catch(() => {});
  await sleep(600);
  const znovu = await page.$eval('[data-testid="udalost-misto"]', (el) => el.value).catch(() => null);
  expect(znovu === 'Učebna B-208', `po znovuotevření je v poli nové místo (${znovu})`);
  await page.click('[data-testid="udalost-smazat-serii"]'); await sleep(400);
  const potvrd = await page.$eval('[data-testid="udalost-smazat-serii"]', (el) => el.innerText).catch(() => null);
  const zbyva1 = ((await inst.api('GET', '/api/kb/events', { token: A })).json.events || []).length;
  expect(zbyva1 === 4, `1. klik = jen dotaz, nic nesmazáno (${potvrd}; událostí ${zbyva1})`);
  await page.click('[data-testid="udalost-smazat-serii"]'); await sleep(1500);
  const zbyva = ((await inst.api('GET', '/api/kb/events', { token: A })).json.events || []);
  expect(zbyva.length === 1 && zbyva[0].title === 'Mimo sérii', `2. klik smazal celou sérii, zbyla jen „Mimo sérii“ (${zbyva.map((e) => e.title)})`);
  const toast = await page.evaluate(() => document.body.innerText.match(/[^\n]*(smazán|Smazán)[^\n]*/)?.[0] || '');
  expect(!!toast, `toast (${toast})`);
  expect(!(await page.$(`[data-testid^="gcal-chip-ev-${ids[1]}"]`)), 'chipy série z kalendáře zmizely');
  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}) ${chyby.slice(0, 3).join(' | ')}`);
  // pozvaná B: nevidí tlačítko série
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items: [1, 2].map((i) => ({ title: 'Kurz', day: den(i), time: '08:00' })), participants: ['b@e2e.cz'] } });
  const kurz = r.json.events[0].id;
  const p2 = await (await H.browser()).page;
  await p2.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await p2.waitForSelector('#email'); await p2.type('#email', 'b@e2e.cz'); await p2.type('#password', H.PW);
  await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p2.click('button[type="submit"]')]);
  await sleep(1000);
  await p2.goto(`${inst.base}/kalendar`, { waitUntil: 'networkidle2' });
  await p2.waitForSelector('.gcal-wrapper', { timeout: 15000 }); await sleep(1000);
  let c2 = await p2.$(`[data-testid^="gcal-chip-ev-${kurz}"]`);
  if (!c2) { await p2.click('[aria-label="Další měsíc"]').catch(() => {}); await sleep(800); c2 = await p2.$(`[data-testid^="gcal-chip-ev-${kurz}"]`); }
  expect(!!c2, 'B vidí chip pozvané série');
  if (c2) { await c2.click(); await sleep(800); }
  expect(!(await p2.$('[data-testid="udalost-smazat-serii"]')), 'pozvaná B tlačítko „Smazat celou sérii“ nemá');
}, { nazev: 'UI Z POZVÁNKY' });
