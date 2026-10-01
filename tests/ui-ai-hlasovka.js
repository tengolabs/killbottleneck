// Hlasovky v asistentovi — klik v prohlížeči s FALEŠNÝM mikrofonem (1. 10. 2026, fáze B).
// Chrome: --use-fake-ui-for-media-stream (povolení bez dotazu) · --use-fake-device-for-media-stream ·
// --use-file-for-fake-audio-capture=<wav> (mikrofon „mluví“ souborem). 127.0.0.1 je zabezpečený původ,
// takže getUserMedia jde i přes http. Podvržený přepis (OpenAI tvar) a chat model.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ui-ai-hlasovka.js
const H = require('./_harness');
const { expect, sleep } = H;
const fs = require('fs');
const os = require('os');
const path = require('path');

// 4 s tónu 440 Hz, 16 kHz mono 16bit PCM
function wav(sekund = 4) {
  const rate = 16000, n = rate * sekund, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

let rezim = 'ok';
const prepisy = [];
const whisperHandler = (req, res, telo) => {
  res.setHeader('Content-Type', 'application/json');
  if (!req.url.startsWith('/v1/audio/transcriptions')) { res.statusCode = 404; res.end('{}'); return; }
  const soubor = (telo.match(/name="file"; filename="([^"]+)"/) || [])[1] || '';
  prepisy.push(soubor);
  if (rezim === 'down') { res.statusCode = 503; res.end('{"error":{"message":"nejede"}}'); return; }
  res.end(JSON.stringify({ text: 'zítra objednat dřevo a zavolat klientovi' }));
};
const volaniChatu = [];
let chatSpadne = 0; // kolikrát má model vrátit 500 (selhání až po přepisu)
const chatHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end('{"models":[{"name":"m-a"}]}'); return; }
  volaniChatu.push(JSON.parse(body || '{}'));
  if (chatSpadne > 0) { chatSpadne -= 1; res.statusCode = 500; res.end('{"error":"model spadl"}'); return; }
  res.end(JSON.stringify({ message: { role: 'assistant', content: 'Mám to, roztřídím.' }, prompt_eval_count: 10, eval_count: 5, done: true }));
};

H.beh(async () => {
  const wavSoubor = path.join(os.tmpdir(), `kb-hlas-${process.pid}.wav`);
  fs.writeFileSync(wavSoubor, wav(4));
  const opusSoubor = path.join(os.tmpdir(), `PTT-${process.pid}-WA0001.opus`);
  fs.writeFileSync(opusSoubor, Buffer.concat([Buffer.from('OggS\0\x02'), Buffer.alloc(400, 3)]));
  const whisper = await H.httpMock(whisperHandler);
  const chat = await H.httpMock(chatHandler);
  const env = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: chat.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_TRANSCRIBE_PROVIDER: 'openai', KB_TRANSCRIBE_URL: whisper.base + '/v1/audio/transcriptions', KB_TRANSCRIBE_MODEL: 'whisper-1' };
  const inst = await H.startInstance({ slug: 'ui-hlas', addHostGateway: true, env });
  await inst.register('a@example.com', { name: 'Anna' });
  const A = await inst.login('a@example.com');
  // druhá instance HNED (ne uprostřed): start kontejneru přidá síťové rozhraní a Chrome by v otevřených
  // stránkách hlásil net::ERR_NETWORK_CHANGED (známý šum souběhu docker sítí)
  const inst2 = await H.startInstance({ slug: 'ui-hlas-limit', addHostGateway: true, env: Object.assign({}, env, { KB_CHAT_HLAS_MAX_S: 2 }) });
  await inst2.register('b@example.com', { name: 'Bára' });
  const B = await inst2.login('b@example.com');
  await sleep(3000); // síť po startu kontejnerů ať se ustálí dřív, než Chrome začne sledovat změny sítě
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavSoubor}`];
  const { page, chyby, novaStranka } = await H.browser({ args });
  const priprav = async (p, tk) => p.evaluateOnNewDocument((t) => { localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })); localStorage.setItem('kb-chat-porada-ne', new Date().toLocaleDateString('en-CA')); localStorage.setItem('kb-mode', 'full'); }, tk);
  await priprav(page, A);
  const cekej = async (sel, ms = 10000, p = page) => p.waitForSelector(sel, { timeout: ms }).then(() => true).catch(() => false);
  const otevriPanel = async (p = page) => { await p.goto(`${inst.base}/`, { waitUntil: 'networkidle2' }); if (!(await cekej('[data-testid="chat-input"]', 3000, p))) { await cekej('[data-testid="chat-tab"]', 10000, p); await p.click('[data-testid="chat-tab"]'); } await cekej('[data-testid="chat-input"]', 10000, p); };
  const zpravUzivatele = async () => { const r = await inst.api('GET', '/api/kb/chat/seznam', { token: A }); let n = 0; for (const c of (r.json.chats || [])) { const d = await inst.api('GET', `/api/kb/chat/detail/${c.id}`, { token: A }); n += d.json.chat.messages.filter((m) => m.role === 'user').length; } return n; };

  console.log('== mikrofon → pruh → Odeslat → přepis → bublina ==');
  await otevriPanel();
  expect(await cekej('[data-testid="chat-hlas"]'), 'v políčku je tlačítko mikrofonu (server hlásí chat_voice)');
  await page.click('[data-testid="chat-hlas"]');
  expect(await cekej('[data-testid="chat-hlas-pruh"]') && !(await page.$('[data-testid="chat-input"]')), 'nahrávání: pruh místo políčka');
  await sleep(2300);
  const cas = await page.$eval('[data-testid="chat-hlas-cas"]', (el) => el.innerText);
  expect(/^0:0[2-3] \/ 5:00$/.test(cas.trim()), `pruh ukazuje čas a strop (${cas})`);
  const pred = prepisy.length;
  await page.click('[data-testid="chat-hlas-odeslat"]');
  expect(await cekej('[data-testid="chat-zprava-hlas"]', 20000), 'po odeslání bublina s hlasovkou (hned, s „přepisuji…“)');
  expect(await cekej('[data-testid="chat-zprava-hlas-prepis"]', 20000), 'po přepisu je v bublině text');
  expect(prepisy.length === pred + 1 && /\.webm$/.test(prepisy.at(-1)), `přepisovač dostal nahrávku z prohlížeče jako webm (${prepisy.at(-1)})`);
  const bublina = await page.$eval('[data-testid="chat-zprava-hlas"]', (el) => el.innerText);
  expect(/Hlasovka 0:0[2-3]/.test(bublina) && /objednat dřevo/.test(bublina), `bublina: délka + přepis (${bublina.replace(/\s+/g, ' ').slice(0, 90)})`);
  expect(await cekej('[data-testid="chat-input"]'), 'po odeslání je políčko zpátky');

  console.log('== tužka v bublině: oprava přepisu klávesnicí → asistent odpoví znovu (Richard 1. 10. 2026) ==');
  expect(await cekej('[data-testid="chat-prepis-upravit"]', 5000), 'u poslední hlasovky je po odpovědi tužka');
  const predOprava = volaniChatu.length;
  await page.click('[data-testid="chat-prepis-upravit"]');
  expect(await cekej('[data-testid="chat-prepis-pole"]', 3000), 'tužka otevře pole s přepisem');
  const vPoli = await page.$eval('[data-testid="chat-prepis-pole"]', (el) => el.value);
  expect(vPoli === 'zítra objednat dřevo a zavolat klientovi' && await page.$eval('[data-testid="chat-prepis-odeslat"]', (el) => el.disabled), `v poli je celý přepis a beze změny nejde odeslat (${vPoli})`);
  // psát klávesnicí (ne nastavením hodnoty): označit vše a přepsat
  await page.click('[data-testid="chat-prepis-pole"]');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type('zítra objednat dveře a zavolat klientce');
  await page.click('[data-testid="chat-prepis-odeslat"]');
  expect(await cekej('[data-testid="chat-prepis-upraveno"]', 20000), 'po odeslání má bublina značku „upraveno“');
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-thinking"]'), { timeout: 20000 }).catch(() => {});
  const bublina2 = await page.$eval('[data-testid="chat-zprava-hlas"]', (el) => el.innerText);
  expect(/objednat dveře a zavolat klientce/.test(bublina2) && !/dřevo/.test(bublina2) && /upraveno/.test(bublina2), `bublina ukazuje opravený přepis (${bublina2.replace(/\s+/g, ' ').slice(0, 110)})`);
  const kModelu = JSON.stringify((volaniChatu.at(-1) || {}).messages || []);
  expect(volaniChatu.length === predOprava + 1 && /objednat dveře/.test(kModelu) && !/dřevo/.test(kModelu), `asistent odpověděl znovu jen nad opraveným textem (volání ${volaniChatu.length - predOprava})`);
  const odpovedi = await page.$$eval('[data-testid="chat-msg"][data-role="assistant"]', (els) => els.length);
  expect(odpovedi === 1, `stará odpověď je pryč, zůstala jedna nová (${odpovedi})`);
  await page.click('[data-testid="chat-prepis-upravit"]');
  await cekej('[data-testid="chat-prepis-pole"]', 3000);
  await page.keyboard.type(' navíc');
  await page.click('[data-testid="chat-prepis-zrusit"]');
  await sleep(500);
  expect(volaniChatu.length === predOprava + 1 && !(await page.$('[data-testid="chat-prepis-pole"]')) && !/navíc/.test(await page.$eval('[data-testid="chat-zprava-hlas"]', (el) => el.innerText)), 'Zrušit: pole zmizí, nic neodejde, text beze změny');

  console.log('== Zrušit = nic neodejde ==');
  const pred2 = prepisy.length;
  await page.click('[data-testid="chat-hlas"]');
  await cekej('[data-testid="chat-hlas-pruh"]');
  await sleep(1300);
  await page.click('[data-testid="chat-hlas-zrusit"]');
  await sleep(1500);
  expect(prepisy.length === pred2 && !(await page.$('[data-testid="chat-hlas-pruh"]')), 'zrušená nahrávka nikam nešla, pruh zmizel');

  console.log('== moc krátká nahrávka ==');
  await page.click('[data-testid="chat-hlas"]');
  await cekej('[data-testid="chat-hlas-pruh"]');
  await sleep(300);
  await page.click('[data-testid="chat-hlas-odeslat"]').catch(() => {});
  expect(await cekej('[data-testid="chat-hlas-chyba"]', 5000) && /krátká/.test(await page.$eval('[data-testid="chat-hlas-chyba"]', (el) => el.innerText)) && prepisy.length === pred2, 'pod 1 s: hláška „moc krátká“, nic neodešlo');
  await page.click('[data-testid="chat-hlas-chyba-zavrit"]');

  console.log('== přepis neběží → Neodesláno → Zkusit znovu ==');
  const predZpr = await zpravUzivatele();
  rezim = 'down';
  await page.click('[data-testid="chat-hlas"]');
  await cekej('[data-testid="chat-hlas-pruh"]');
  await sleep(1800);
  await page.click('[data-testid="chat-hlas-odeslat"]');
  expect(await cekej('[data-testid="chat-hlas-neodeslano"]', 20000), 'přepis selhal → pruh Neodesláno (nahrávka zůstala)');
  expect(!!(await page.$('[data-testid="chat-hlas-stahnout"][download]')), 'nahrávku jde stáhnout');
  rezim = 'ok';
  await page.click('[data-testid="chat-hlas-znovu"]');
  expect(await cekej('[data-testid="chat-input"]', 20000) && !(await page.$('[data-testid="chat-hlas-neodeslano"]')), 'Zkusit znovu → odešla, políčko zpátky');
  await sleep(500);
  expect(await zpravUzivatele() === predZpr + 1, 'po chybě a opakování je v rozhovoru právě jedna nová zpráva');

  console.log('== výpadek sítě při odeslání → nahrávka zůstane (dřív zmizela), po obnovení odejde ==');
  const nahraj = async (ms = 1800) => { await page.click('[data-testid="chat-hlas"]'); await cekej('[data-testid="chat-hlas-pruh"]'); await sleep(ms); await page.click('[data-testid="chat-hlas-odeslat"]'); };
  let zasah = 'sit'; // sit = požadavek se ztratí · kvota = brána odmítne 429 · '' = nic
  await page.setRequestInterception(true);
  const naPozadavek = (rq) => {
    if (zasah && rq.method() === 'POST' && /\/api\/kb\/chat$/.test(rq.url())) {
      const z = zasah; zasah = '';
      if (z === 'sit') return rq.abort('failed');
      return rq.respond({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Vyčerpán měsíční limit AI operací. Kontaktujte poskytovatele.', code: 'ai_hlas' }) });
    }
    return rq.continue();
  };
  page.on('request', naPozadavek);
  const predSit = await zpravUzivatele();
  const prepisuPredSit = prepisy.length;
  await nahraj();
  expect(await cekej('[data-testid="chat-hlas-neodeslano"]', 20000) && prepisy.length === prepisuPredSit && await zpravUzivatele() === predSit, 'požadavek se ztratil → pruh Neodesláno, nahrávka zůstala, na server nic nedošlo');
  await page.click('[data-testid="chat-hlas-znovu"]');
  expect(await cekej('[data-testid="chat-input"]', 20000) && !(await page.$('[data-testid="chat-hlas-neodeslano"]')), 'po obnovení sítě Zkusit znovu → odešla');
  await sleep(500);
  expect(await zpravUzivatele() === predSit + 1, 'v rozhovoru je právě jedna nová zpráva');

  console.log('== brána odmítne 429 (měsíční limit) → její text, ne „hodinový strop“; nahrávka zůstane ==');
  zasah = 'kvota';
  await nahraj();
  expect(await cekej('[data-testid="chat-hlas-neodeslano"]', 20000), '429 z brány → nahrávka zůstala v pruhu');
  const textChyby = await page.$eval('[data-testid="chat-chyba"]', (el) => el.innerText).catch(() => '');
  expect(/měsíční limit AI operací/.test(textChyby) && !/hodinový strop/.test(textChyby), `hláška říká, co se stalo (${textChyby})`);
  await page.click('[data-testid="chat-hlas-zahodit"]');
  page.off('request', naPozadavek);
  await page.setRequestInterception(false);

  console.log('== přepis proběhl, selhal až model → přepis je v rozhovoru, nahrávka se NEnabízí znovu ==');
  const predPad = await zpravUzivatele();
  chatSpadne = 1;
  await nahraj();
  await page.waitForFunction(() => !!document.querySelector('[data-testid="chat-chyba"]'), { timeout: 20000 }).catch(() => {});
  await sleep(800);
  expect(!(await page.$('[data-testid="chat-hlas-neodeslano"]')) && await zpravUzivatele() === predPad + 1 && !!(await page.$('[data-testid="chat-chyba"]')), 'model spadl po přepisu → zpráva s přepisem je v rozhovoru, pruh Neodesláno se neukáže (neposlala by se podruhé)');

  console.log('== zavření panelu během nahrávání: mikrofon neběží naslepo, nahrávka počká a sama neodejde ==');
  const predZavreni = prepisy.length;
  await page.click('[data-testid="chat-hlas"]');
  await cekej('[data-testid="chat-hlas-pruh"]');
  await sleep(1600);
  await page.click('[data-testid="chat-zavrit"]');
  await sleep(2500);
  expect(prepisy.length === predZavreni && !(await page.$('[data-testid="chat-hlas-pruh"]')), 'po zavření panelu nic neodešlo');
  await cekej('[data-testid="chat-tab"]', 5000);
  await page.click('[data-testid="chat-tab"]');
  expect(await cekej('[data-testid="chat-hlas-neodeslano"]', 5000) && !(await page.$('[data-testid="chat-hlas-pruh"]')), 'po otevření panelu čeká nahrávka v pruhu Neodesláno (nahrávání skončilo)');
  await page.click('[data-testid="chat-hlas-znovu"]');
  expect(await cekej('[data-testid="chat-input"]', 20000) && prepisy.length === predZavreni + 1, 'podrženou nahrávku jde odeslat');
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-thinking"]'), { timeout: 20000 }).catch(() => {});
  // zavření panelu během čekání na povolení mikrofonu → pozdější povolení už nahrávání nespustí
  await page.evaluate(() => { const puvodni = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__povol = null; navigator.mediaDevices.getUserMedia = (c) => new Promise((ok, ne) => { window.__povol = () => puvodni(c).then(ok, ne); }); });
  await page.click('[data-testid="chat-hlas"]');
  await cekej('[data-testid="chat-hlas-pruh"]');
  await page.click('[data-testid="chat-hlas-zrusit"]');
  await page.evaluate(() => window.__povol && window.__povol());
  await sleep(1500);
  expect(!(await page.$('[data-testid="chat-hlas-pruh"]')) && !!(await page.$('[data-testid="chat-input"]')), 'Zrušit během čekání na povolení → pozdější povolení nahrávání nespustí');

  console.log('== moc velký zvukový soubor → srozumitelná hláška hned, nic neodejde ==');
  const velkySoubor = path.join(os.tmpdir(), `kb-velka-${process.pid}.ogg`);
  fs.writeFileSync(velkySoubor, Buffer.concat([Buffer.from('OggS\0\x02'), Buffer.alloc(3.5 * 1024 * 1024, 3)]));
  const predVelkym = prepisy.length;
  await (await page.$('[data-testid="chat-obrazek-input"]')).uploadFile(velkySoubor);
  expect(await cekej('[data-testid="chat-obrazek-chyba"]', 5000) && /větší než 3 MB/.test(await page.$eval('[data-testid="chat-obrazek-chyba"]', (el) => el.innerText)) && prepisy.length === predVelkym, 'soubor 3,5 MB → „Nahrávka je větší než 3 MB“, nikam neodešel');
  fs.unlinkSync(velkySoubor);

  console.log('== hlasovka z WhatsAppu (.opus) přes sponku ==');
  await (await page.$('[data-testid="chat-obrazek-input"]')).uploadFile(opusSoubor);
  await sleep(2500);
  expect(/\.ogg$/.test(prepisy.at(-1) || ''), `soubor .opus odešel jako hlasovka (.ogg) (${prepisy.at(-1)})`);
  await page.waitForFunction(() => !document.querySelector('[data-testid="chat-thinking"]'), { timeout: 20000 }).catch(() => {});
  const tuzek = await page.$$eval('[data-testid="chat-prepis-upravit"]', (els) => els.length);
  const hlasovek = await page.$$eval('[data-testid="chat-zprava-hlas"]', (els) => els.length);
  expect(hlasovek >= 2 && tuzek === 1, `tužku má jen POSLEDNÍ hlasovka, starší ne (${hlasovek} hlasovek, ${tuzek} tužka)`);

  console.log('== zakázaný mikrofon ==');
  const p2 = await novaStranka();
  await priprav(p2, A);
  await p2.evaluateOnNewDocument(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('odmítnuto'), { name: 'NotAllowedError' })); });
  await otevriPanel(p2);
  await cekej('[data-testid="chat-hlas"]', 10000, p2);
  await p2.click('[data-testid="chat-hlas"]');
  expect(await cekej('[data-testid="chat-hlas-chyba"]', 5000, p2) && /nepovolil mikrofon/.test(await p2.$eval('[data-testid="chat-hlas-chyba"]', (el) => el.innerText)), 'zakázaný mikrofon → srozumitelná hláška');
  await p2.close();

  console.log('== telefon: spodní lišta, mikrofon místo Odeslat při prázdném políčku ==');
  const p3 = await novaStranka();
  await p3.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await priprav(p3, A);
  await p3.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  if (await cekej('[data-testid="chat-zavrit"]', 3000, p3)) await p3.click('[data-testid="chat-zavrit"]');
  expect(await cekej('[data-testid="chat-bar"]', 10000, p3) && await cekej('[data-testid="chat-bar"] [data-testid="chat-hlas"]', 5000, p3) && !(await p3.$('[data-testid="chat-bar-send"]')), 'lišta: prázdné políčko → mikrofon místo Odeslat');
  await p3.click('[data-testid="chat-bar-input"]');
  await p3.keyboard.type('Ahoj');
  expect(await cekej('[data-testid="chat-bar-send"]', 3000, p3) && !(await p3.$('[data-testid="chat-bar"] [data-testid="chat-hlas"]')), 'po napsání textu je tam zase Odeslat');
  await p3.close();

  console.log('== limit délky: nahrávka se zastaví a odejde sama ==');
  const p4 = await novaStranka();
  await priprav(p4, B);
  await p4.goto(`${inst2.base}/`, { waitUntil: 'networkidle2' });
  if (!(await cekej('[data-testid="chat-input"]', 3000, p4))) { await cekej('[data-testid="chat-tab"]', 10000, p4); await p4.click('[data-testid="chat-tab"]'); }
  await cekej('[data-testid="chat-hlas"]', 10000, p4);
  const pred4 = prepisy.length;
  await p4.click('[data-testid="chat-hlas"]');
  expect(await cekej('[data-testid="chat-zprava-hlas-prepis"]', 25000, p4) && prepisy.length === pred4 + 1, `na limitu 2 s se nahrávka zastavila a odešla bez kliknutí (${prepisy.length - pred4})`);
  await p4.close();

  // 502 = řízený scénář „přepis neběží“ (prohlížeč neúspěšný požadavek vždy zapíše do konzole)
  // 502 = řízené scénáře „přepis neběží“ / „model spadl“, ERR_FAILED a 429 = řízený výpadek sítě a odmítnutí bránou
  expect(chyby.filter((c) => !/NotAllowedError|odmítnuto|status of 502|ERR_FAILED|status of 429/.test(c)).length === 0, `konzole bez chyb (${chyby.slice(0, 3).join(' | ')})`);
  fs.unlinkSync(wavSoubor); fs.unlinkSync(opusSoubor);
}, { nazev: 'UI-AI-HLASOVKA' });
