// Obrázky asistenta (29. 10. 2026) — API sada proti PODVRŽENÉ ollamě a PODVRŽENÉ bráně (mode=image).
//
// Co hlídá: bez KB_IMAGE_* se kreslení nenabízí (/config, nástroje); generate_image jen ZADÁ (karta `obrazek` jen
// s id, záznam „ceka“) → /chat/obrazek/vytvorit zavolá bránu (mode image, model klein, preset, token obrázků) a uloží
// JPEG (nechráněný soubor — jde do e-mailu a /p/ stránek); druhé vytvořit = nic; znovu = nový seed bez seedu
// a nový soubor; text bez KB_IMAGE_TEXT = chyba pro model (žádný záznam, žádné tiché přepnutí); plná fronta / výpadek
// brány = chyba na kartě, 0 kreditů, nepovedené Znovu hotový obrázek nezahodí; cizí uživatel 404; strop 4 obrázky
// na tah; kredity „jako koupeno“ podle kredity-ceny.json; s KB_IMAGE_TEXT=1 + provider api: text → FLUX 3,
// token brány instance (stejný původ), /config chat_draw_text.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-obrazky.js
const H = require('./_harness');
const { expect } = H;
const fs = require('fs');
const path = require('path');

// 16×16 JPEG (červený / modrý) — PocketBase obsah pole souboru čichá (mimeTypes image/jpeg)
const JPEG = [
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooorhPqD/9k=',
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK+oMT/9k=',
];

// kredit obrázku podle téhož zdroje jako server (kredity.js)
const CENY = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/pb_hooks/kredity-ceny.json'), 'utf8'));
const R = CENY.referencni_tah, A = CENY.aki, K = CENY.eur_kc / 1e6;
const KREDIT_KC = (R.in - R.cached) * A.in * K + R.cached * A.cache * K + R.out * A.out * K;
const kreditObrazku = (m) => CENY.obrazek[m] * CENY.obrazek.usd_kc / KREDIT_KC;

// ---------- podvržená ollama ----------
const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const nastroje = (...c) => ({ tool_calls: c.map(([name, args]) => ({ function: { name, arguments: args } })) });
const text = (s) => ({ content: s });
const chatHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  const b = JSON.parse(body);
  volani.push(b);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 1000, eval_count: 50, done: true }));
};

// ---------- podvržená brána (FastAPI tvar: chyby v {detail: …}) ----------
let rezimBrany = 'ok';   // ok | busy | down | text_off
let modyBrany = ['questions', 'generate', 'expand', 'chat', 'from_text', 'transcribe', 'image'];
const branaPozadavky = [];
let obrazekCislo = 0;
const branaHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/v1/status')) { res.end(JSON.stringify({ schema_version: 1, name: 'Test', active: true, modes: modyBrany })); return; }
  if (!req.url.startsWith('/v1/advisor')) { res.statusCode = 404; res.end('{}'); return; }
  let b = {};
  try { b = JSON.parse(body || '{}'); } catch { b = {}; }
  branaPozadavky.push({ token: req.headers['x-kb-token'] || '', body: b });
  if (!['img_tok', 'kb_tok'].includes(req.headers['x-kb-token'])) { res.statusCode = 401; res.end('{"detail":{"error":"Neplatný API token."}}'); return; }
  if (b.mode !== 'image') { res.statusCode = 400; res.end('{"detail":{"error":"čekal jsem image"}}'); return; }
  if (rezimBrany === 'busy') { res.statusCode = 503; res.end('{"detail":{"error":"Obrázky jsou teď vytížené.","code":"image_busy"}}'); return; }
  if (rezimBrany === 'down') { res.statusCode = 502; res.end('{"detail":{"error":"Obrázky teď nejdou (služba neodpovídá).","code":"image_unavailable"}}'); return; }
  const i = obrazekCislo++ % 2;
  res.end(JSON.stringify({ image_base64: JPEG[i], mime: 'image/jpeg', model: b.model, seed: b.seed || 1000 + obrazekCislo, size: '1024x1024', gen_s: 1.4, schema_version: 1 }));
};

const posledniVolani = () => volani[volani.length - 1];
const jmena = (v) => (v.tools || []).map((t) => t.function.name);
const toolZ = (v) => v.messages.filter((m) => m.role === 'tool');
const karty = (chat, typ) => chat.messages.flatMap((m) => m.karty || []).filter((k) => k.type === typ);

H.beh(async () => {
  const mock = await H.httpMock(chatHandler);
  const brana = await H.httpMock(branaHandler);
  const ZAKLAD = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600 };

  console.log('== bez KB_IMAGE_*: kreslení se nenabízí ==');
  const bez = await H.startInstance({ slug: 'ai-obrazky-bez', addHostGateway: true, env: ZAKLAD });
  await bez.register('admin@example.com', { name: 'Petr' });
  const T0 = await bez.login('admin@example.com');
  let cfg = (await bez.api('GET', '/api/kb/config')).json;
  expect(!cfg.ai_modes.includes('chat_draw'), `/config bez chat_draw (${cfg.ai_modes.join(',')})`);
  fronta.push(text('Kreslit neumím.'));
  let r0 = await bez.api('POST', '/api/kb/chat', { token: T0, body: { message: 'Nakresli mi obrázek kočky' } });
  expect(!jmena(posledniVolani()).includes('generate_image'), 'bez KB_IMAGE_* generate_image v nabídce není ani s „nakresli“');
  // Kancelář (3. 11. 2026): bez služby obrázků draft_presentation / draft_card pole `picture` vůbec nenabízí
  fronta.push(text('Připravím.'));
  await bez.api('POST', '/api/kb/chat', { token: T0, body: { message: 'Udělej prezentaci a přání k Vánocům' } });
  const defBez = (n) => (posledniVolani().tools || []).find((x) => x.function.name === n);
  const dp0 = defBez('draft_presentation'), dc0 = defBez('draft_card');
  expect(!!dp0 && !!dc0 && !('picture' in dp0.function.parameters.properties) && !('slide_pictures' in dp0.function.parameters.properties) && !('picture' in dc0.function.parameters.properties) && !/PICTURES/.test(dp0.function.description + dc0.function.description),
    `bez KB_IMAGE_* prezentace a přání bez pole picture a bez věty o obrázcích (${dp0 && Object.keys(dp0.function.parameters.properties).join(',')})`);
  fronta.push(nastroj('draft_card', { kind: 'greeting', title: 'PF 2027', text: 'Hodně zdraví.', picture: 'snowy village, no text' }), text('Hotovo.'));
  r0 = await bez.api('POST', '/api/kb/chat', { token: T0, body: { message: 'Udělej přání PF 2027' } });
  const kBez = karty(r0.json.chat, 'soubor')[0];
  expect(kBez && kBez.doc_id && !kBez.obrazky, `bez služby obrázků: picture od modelu se ignoruje, přání se uloží bez obrázku (${JSON.stringify(kBez || {}).slice(0, 120)})`);
  bez.stop();

  console.log('== s KB_IMAGE_URL: karta jen s id, záznam ceka ==');
  const inst = await H.startInstance({ slug: 'ai-obrazky', addHostGateway: true, env: Object.assign({}, ZAKLAD, { KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok' }) });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A1 = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const su = await inst.superuser();
  const logy = async () => ((await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=200&sort=created', { token: su })).json.items || []);
  const zaznamy = async () => ((await inst.api('GET', '/api/collections/ai_images/records?perPage=200&sort=created', { token: su })).json.items || []);
  cfg = (await inst.api('GET', '/api/kb/config')).json;
  expect(cfg.ai_modes.includes('chat_draw') && !cfg.ai_modes.includes('chat_draw_text'), `/config: chat_draw ano, chat_draw_text ne (${cfg.ai_modes.filter((m) => /draw/.test(m)).join(',')})`);

  fronta.push(text('Ahoj.'));
  await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Co mám dnes dělat?' } });
  expect(!jmena(posledniVolani()).includes('generate_image'), 'bez klíčového slova generate_image v nabídce není (úspora tokenů)');

  fronta.push(nastroj('generate_image', { prompt: 'flat vector illustration of a calm morning desk with coffee and plants, pastel colors, no text', title: 'Ranní stůl', format: 'banner' }), text('Kreslím ho.'));
  let r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Nakresli mi banner do mailu, ranní stůl s kávou' } });
  expect(r.status === 200, `POST /chat → 200 (${r.status})`);
  expect(jmena(volani[volani.length - 2]).includes('generate_image'), '„nakresli“ otevře skupinu kresleni');
  const defG = volani[volani.length - 2].tools.find((t) => t.function.name === 'generate_image').function;
  expect(/in ENGLISH/.test(defG.description) && defG.parameters.required.join() === 'prompt,title', 'popis generate_image: anglický prompt, povinné prompt + title');
  let chat = r.json.chat;
  const k1 = karty(chat, 'obrazek')[0];
  expect(!!k1 && !!k1.image_id && k1.title === 'Ranní stůl' && k1.model === 'klein' && k1.preset === 'banner' && !('prompt' in k1) && !('url' in k1), `karta obrazek nese id, název, model, formát (${JSON.stringify(k1 || {})})`);
  expect(/queued; the app draws it now/.test(toolZ(posledniVolani()).pop().content), 'model ví: obrázek ve frontě, nevolat znovu');
  const id1 = k1.image_id;
  let z = (await zaznamy()).find((x) => x.id === id1);
  expect(z && z.stav === 'ceka' && !z.file && z.chat === chat.id && /morning desk/.test(z.prompt), `záznam čeká, bez souboru, zná rozhovor (${z && z.stav})`);
  expect(branaPozadavky.length === 0, 'během tahu se brána nevolá (kreslí až karta)');

  console.log('== vytvořit: brána mode image, klein, preset, token obrázků → JPEG ==');
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: id1 } });
  expect(r.status === 200 && r.json.obrazek && r.json.obrazek.stav === 'hotovo' && /^\/api\/files\/ai_images\//.test(r.json.obrazek.url), `vytvořit → 200 hotovo s adresou (${r.status} ${JSON.stringify(r.json.obrazek || r.json).slice(0, 160)})`);
  const o1 = r.json.obrazek;
  expect(o1.width === 1200 && o1.height === 400 && o1.gen_s === 1.4, `rozměr banneru 1200×400 a čas z brány (${o1.width}×${o1.height}, ${o1.gen_s})`);
  const p1 = branaPozadavky[0];
  expect(branaPozadavky.length === 1 && p1.token === 'img_tok' && p1.body.mode === 'image' && p1.body.model === 'klein' && p1.body.preset === 'banner' && /no text/.test(p1.body.prompt) && !('seed' in p1.body), `brána: mode image, klein, banner, KB_IMAGE_TOKEN, bez seedu (${JSON.stringify(Object.assign({}, p1.body, { prompt: '…' }))})`);
  const f1 = await fetch(inst.base + o1.url);
  const b1 = Buffer.from(await f1.arrayBuffer());
  expect(f1.status === 200 && /image\/jpeg/.test(f1.headers.get('content-type') || '') && b1.equals(Buffer.from(JPEG[0], 'base64')), `soubor jde stáhnout BEZ přihlášení (e-mail, /p/) a je to JPEG z brány (${f1.status}, ${b1.length} B)`);
  let log = (await logy()).filter((l) => l.tools === 'image_draw');
  expect(log.length === 1 && log[0].stav === 'ok' && log[0].model === 'flux2-klein#obrazek' && Math.abs(log[0].kredity - Math.round(kreditObrazku('klein') * 1e4) / 1e4) < 1e-4 && log[0].chat === chat.id && log[0].prepis_ms === 1400,
    `ai_chat_log: řádek image_draw, kredity „jako koupeno“ ${kreditObrazku('klein').toFixed(2)} (${JSON.stringify(log[0] && { m: log[0].model, k: log[0].kredity, ms: log[0].prepis_ms })})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: id1 } });
  expect(r.status === 200 && branaPozadavky.length === 1, 'vytvořit na hotovém obrázku = nic (brána se nevolá, nic se neúčtuje)');

  console.log('== znovu: nový seed, nový soubor ==');
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: id1, znovu: true } });
  const o1b = r.json.obrazek;
  expect(r.status === 200 && o1b.stav === 'hotovo' && o1b.url !== o1.url, `znovu → nový soubor (${o1b && o1b.url !== o1.url})`);
  expect(branaPozadavky.length === 2 && !('seed' in branaPozadavky[1].body), 'znovu jde do brány bez seedu (nový obrázek)');
  const f1b = Buffer.from(await (await fetch(inst.base + o1b.url)).arrayBuffer());
  expect(f1b.equals(Buffer.from(JPEG[1], 'base64')), 'nový soubor = druhý obrázek z brány');
  expect((await fetch(inst.base + o1.url)).status === 404, 'starý soubor po Znovu zmizel (nehromadí se)');
  expect((await logy()).filter((l) => l.tools === 'image_draw').length === 2, 'Znovu = druhý řádek v logu (účtuje se)');

  console.log('== cizí uživatel ==');
  // cizí = stejná odpověď jako neexistující {obrazek: null} (od 4. 11.: karta smazaného obrázku bez 404 v konzoli)
  r = await inst.api('GET', `/api/kb/chat/obrazek/${id1}`, { token: B });
  const nic = await inst.api('GET', '/api/kb/chat/obrazek/aaaaaaaaaaaaaaa', { token: B });
  expect(r.status === 200 && r.json.obrazek === null && JSON.stringify(r.json) === JSON.stringify(nic.json), `cizí GET → nic, stejně jako neexistující (${r.status} ${JSON.stringify(r.json).slice(0, 60)})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: B, body: { id: id1, znovu: true } });
  expect(r.status === 404 && branaPozadavky.length === 2, `cizí vytvořit → 404 a brána se nevolá (${r.status})`);
  r = await inst.api('GET', `/api/collections/ai_images/records/${id1}`, { token: B });
  expect(r.status === 404, `record API cizímu záznam nevydá (${r.status})`);
  r = await inst.api('POST', '/api/collections/ai_images/records', { token: A1, body: { user: 'x', prompt: 'p', model: 'klein', preset: 'ctverec', stav: 'hotovo' } });
  expect(r.status >= 400, `přímý zápis přes record API zakázán (${r.status})`);

  console.log('== text bez KB_IMAGE_TEXT: chyba pro model, žádný záznam ==');
  const pocet = (await zaznamy()).length;
  fronta.push(nastroj('generate_image', { prompt: 'a poster with a headline', title: 'Plakát', text: 'Porada v pondělí' }), text('S textem to nejde.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { chat_id: chat.id, message: 'Nakresli plakát s nápisem Porada v pondělí' } });
  expect(/pictures with readable text are not available/.test(toolZ(posledniVolani()).pop().content), 'model dostal chybu „text nejde“ (nabídne obrázek bez textu)');
  expect((await zaznamy()).length === pocet && karty(r.json.chat, 'obrazek').length === 1, 'žádný nový záznam ani karta (žádné tiché přepnutí na klein)');

  console.log('== odmítnutí před kreslením (text vypnutý / limit) → „chyba“, ne věčné „ceka“ ==');
  {
    const uX = (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent("email='admin@example.com'"), { token: su })).json.items[0].id;
    const rx = await inst.api('POST', '/api/collections/ai_images/records', { token: su, body: { user: uX, title: 'Nápis', prompt: 'a sign "Ahoj"', model: 'flux3', preset: 'ctverec', stav: 'ceka' } });
    const predX = branaPozadavky.length;
    const vx = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: rx.json.id } });
    const dx = (await inst.api('GET', `/api/kb/chat/obrazek/${rx.json.id}`, { token: A1 })).json.obrazek || {};
    expect(vx.status === 403 && dx.stav === 'chyba' && !!dx.chyba && branaPozadavky.length === predX, `odmítnuto bez kreslení → záznam „chyba“ s hláškou (karta nabídne Zkusit znovu, netočí se) (${vx.status} ${dx.stav}: ${dx.chyba})`);
  }

  console.log('== plná fronta / výpadek brány ==');
  fronta.push(nastroj('generate_image', { prompt: 'a red bicycle, no text', title: 'Kolo' }), text('Kreslím.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { chat_id: chat.id, message: 'Ještě nakresli červené kolo' } });
  const id2 = karty(r.json.chat, 'obrazek').pop().image_id;
  rezimBrany = 'busy';
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: id2 } });
  expect(r.status === 503 && r.json.code === 'image_busy' && /vytížené/.test(r.json.error), `plná fronta → 503 image_busy (${r.status} ${JSON.stringify(r.json)})`);
  let d2 = (await inst.api('GET', `/api/kb/chat/obrazek/${id2}`, { token: A1 })).json.obrazek;
  expect(d2.stav === 'chyba' && /vytížené/.test(d2.chyba) && !d2.url, `záznam ve stavu chyba s hláškou (${d2.stav}: ${d2.chyba})`);
  log = (await logy()).filter((l) => l.tools === 'image_draw');
  expect(log[log.length - 1].stav === 'chyba' && log[log.length - 1].kredity === 0, 'nepovedený obrázek = řádek chyba, 0 kreditů');
  rezimBrany = 'down';
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: id2 } });
  expect(r.status === 502 && /nejdou/.test(r.json.error) && !/10\.0\.0|rig/.test(r.json.error), `výpadek → 502 „obrázky teď nejdou“ bez interní adresy (${r.status} ${r.json.error})`);
  rezimBrany = 'ok';
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: id2 } });
  expect(r.status === 200 && r.json.obrazek.stav === 'hotovo' && r.json.obrazek.chyba === '', 'Zkusit znovu po výpadku → hotovo');
  const url2 = r.json.obrazek.url;
  rezimBrany = 'down';
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: id2, znovu: true } });
  d2 = (await inst.api('GET', `/api/kb/chat/obrazek/${id2}`, { token: A1 })).json.obrazek;
  expect(r.status === 502 && d2.stav === 'hotovo' && d2.url === url2, `nepovedené Znovu hotový obrázek nezahodí (${d2.stav}, ${d2.url === url2})`);
  rezimBrany = 'ok';

  console.log('== v1 /images (MCP generate_image): zadání + kreslení v jednom, absolutní odkaz; klíč jen pro čtení ne ==');
  const keyRW = (await inst.api('POST', '/api/kb/api-keys', { token: A1, body: { label: 'obr-rw', scope: 'read_write' } })).json.token;
  const keyRO = (await inst.api('POST', '/api/kb/api-keys', { token: A1, body: { label: 'obr-ro', scope: 'read' } })).json.token;
  const predV1 = branaPozadavky.length;
  r = await inst.api('POST', '/api/kb/v1/images', { bearer: keyRW, body: { prompt: 'a lighthouse at dusk, no text', title: 'Maják', format: 'landscape' } });
  expect(r.status === 200 && r.json.image && r.json.image.stav === 'hotovo' && /^https?:\/\/.+\/api\/files\/ai_images\//.test(r.json.image.url) && r.json.image.width === 1792, `v1/images → hotový obrázek s absolutním odkazem (${r.status} ${r.json.image && r.json.image.url})`);
  expect(branaPozadavky.length === predV1 + 1 && branaPozadavky[predV1].body.preset === 'siroky', 'v1: brána zavolána jednou, formát landscape = siroky');
  r = await inst.api('POST', '/api/kb/v1/images', { bearer: keyRO, body: { prompt: 'x', title: 'y' } });
  expect(r.status === 403 && branaPozadavky.length === predV1 + 1, `v1 klíčem jen pro čtení → 403, brána se nevolá (${r.status})`);
  rezimBrany = 'down';
  const pocetV1 = (await zaznamy()).length;
  r = await inst.api('POST', '/api/kb/v1/images', { bearer: keyRW, body: { prompt: 'a lighthouse, no text', title: 'Maják 2' } });
  expect(r.status === 502 && (await zaznamy()).length === pocetV1, `v1 při výpadku → 502 a nepovedený záznam nezůstane (${r.status})`);
  rezimBrany = 'ok';

  console.log('== Stránky: osnova smí dát ilustraci, writer vloží značku, server nakreslí a dosadí cestu bez adresy serveru (max 3) ==');
  fronta.push(nastroj('create_page', { title: 'Report dílny', brief: 'Měsíční report pro tým.', content: 'Hotovo 12 zakázek.' }), text('Píšu.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Udělej mi stránku s reportem dílny' } });
  const pid = karty(r.json.chat, 'stranka').pop().page_id;
  const KOSTRA = '<!doctype html>\n<html lang="cs"><head><meta charset="utf-8"><title>Report</title></head><body><main>\n<section id="sec-uvod"><!--SEKCE:uvod--></section>\n<section id="sec-cisla"><!--SEKCE:cisla--></section>\n</main></body></html>';
  const ZN = (p, f) => `<img data-kb-image="${p}" data-format="${f}" alt="Ilustrace ${p.slice(0, 6)}">`;
  fronta.push(text('{"style": "světlý", "sections": [{"id": "uvod", "heading": "Úvod", "content": "Report", "illustration": "a bright carpentry workshop with a team, flat style"}, {"id": "cisla", "heading": "Čísla", "content": "12 zakázek", "illustration": "stacked wooden boards"}]}'),
    text('```html\n' + KOSTRA + '\n```'),
    text('```html\n<h2>Úvod</h2>' + ZN('a bright carpentry workshop with a team, flat style', 'landscape') + '<p>UVOD</p>\n```'),
    text('```html\n<h2>Čísla</h2>' + ZN('wood one', 'header') + ZN('wood two', 'square') + ZN('wood three', 'landscape') + '<p>CISLA</p>\n```'));
  const predStr = volani.length, predBrana = branaPozadavky.length, predLog = (await logy()).filter((l) => l.tools === 'image_draw').length;
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A1, body: { id: pid } });
  expect(r.status === 200 && r.json.stranka && r.json.stranka.stav === 'hotovo', `stránka s ilustracemi → hotovo (${r.status} ${r.json.error || ''})`);
  const vs = volani.slice(predStr);
  const sysO = (vs[0].messages.find((m) => m.role === 'system') || {}).content || '';
  expect(/"illustration"/.test(sysO) && /at most 3 sections/.test(sysO), 'osnova: instance kreslí → smí dát části ilustraci');
  expect(/description in ENGLISH and match it to the look in your \\"style\\"/.test(sysO) || /description in ENGLISH and match it to the look in your "style"/.test(sysO), 'osnova: popis ilustrace anglicky a podle Vzhledu stránky (světlá/tmavá, barvy) — Richard 5. 11.');
  const uSek = vs[2].messages.filter((m) => m.role === 'user').pop().content;
  expect(/Illustration for this section/.test(uSek) && /<img data-kb-image="a bright carpentry workshop with a team, flat style"/.test(uSek), 'část dostala přesnou značku ilustrace z osnovy');
  expect(/EXCEPTION to "no external images"/.test((vs[1].messages.find((m) => m.role === 'system') || {}).content), 'kostra i části znají výjimku pro značku ilustrace');
  const hs = r.json.stranka.html;
  const imgs = [...hs.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  expect(imgs.length === 3 && imgs.every((t) => /src="\/api\/files\/ai_images\//.test(t) && !/data-kb-image/.test(t)), `3 ilustrace s cestou bez adresy serveru (jde z jakéhokoli počítače), 4. značka pryč (${imgs.length}: ${imgs.map((t) => (t.match(/src="([^"]{0,40})/) || [])[1]).join(' | ')})`);
  expect(!/data-kb-image/.test(hs) && /UVOD/.test(hs) && /CISLA/.test(hs), 'v hotové stránce žádná značka nezůstala, obsah ano');
  expect(branaPozadavky.length - predBrana === 3 && branaPozadavky.slice(predBrana).every((p) => p.body.model === 'klein' && /no text/.test(p.body.prompt)), 'brána: 3× klein, popis s „no text“ (text patří do HTML)');
  expect(branaPozadavky[predBrana].body.preset === 'siroky' && branaPozadavky[predBrana + 1].body.preset === 'hlavicka' && branaPozadavky[predBrana + 2].body.preset === 'ctverec', 'formát ze značky: landscape → siroky, header → hlavicka, square → ctverec');
  const f0 = await fetch(inst.base + imgs[0].match(/src="([^"]+)"/)[1]);
  expect(f0.status === 200 && /image\/jpeg/.test(f0.headers.get('content-type') || ''), `ilustrace jde načíst bez přihlášení (veřejná /p/ stránka) (${f0.status})`);
  expect((await logy()).filter((l) => l.tools === 'image_draw').length - predLog === 3, 'každá ilustrace = řádek image_draw (kredity)');

  console.log('== stránka psaná do 4. 11. s adresou serveru (127.0.0.1): čte se bez ní, cizí obrázek zůstane, agent dostane plnou adresu ==');
  const cestaObr = imgs[0].match(/src="([^"]+)"/)[1];
  const CIZI = 'https://jiny-server.example/api/files/ai_images/abcdefghijklmno/x.jpg';
  const stareHtml = hs.replace(cestaObr, 'http://127.0.0.1:8183' + cestaObr).replace('<p>UVOD</p>', `<p>UVOD</p><img src="${CIZI}" alt="cizí">`);
  r = await inst.api('PATCH', `/api/collections/ai_pages/records/${pid}`, { token: su, body: { html: stareHtml } });
  expect(r.status === 200, `stará stránka nastavena superuživatelem (${r.status})`);
  r = await inst.api('GET', `/api/kb/chat/stranka/${pid}`, { token: A1 });
  const hStara = r.json.stranka.html;
  expect(hStara.includes(`src="${cestaObr}"`) && !/127\.0\.0\.1/.test(hStara), 'panel: adresa 127.0.0.1 u našeho obrázku pryč, zbyla cesta');
  expect(hStara.includes(CIZI), 'obrázek z jiného serveru (id na instanci není) zůstal, jak byl');
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A1, body: { id: pid, akce: 'zapnout' } });
  const pub = await fetch(inst.base + '/p/' + r.json.stranka.share_token);
  const hPub = await pub.text();
  expect(pub.status === 200 && hPub.includes(`src="${cestaObr}"`) && !/127\.0\.0\.1/.test(hPub), `veřejná /p/ stránka: cesta bez adresy serveru (${pub.status})`);
  await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A1, body: { id: pid, akce: 'vypnout' } });
  r = await inst.api('GET', `/api/kb/v1/pages/${pid}`, { bearer: keyRW });
  const hV1 = (r.json.page || {}).html || '';
  const abs = (hV1.match(/src="(https?:\/\/[^"]+\/api\/files\/ai_images\/[^"]+)"/) || [])[1] || '';
  expect(r.status === 200 && !!abs && !/127\.0\.0\.1:8183/.test(abs) && abs.endsWith(cestaObr) && hV1.includes(CIZI), `v1 / MCP: agent mimo instanci dostane plnou adresu instance (${abs.slice(0, 50)})`);
  r = await inst.api('PATCH', `/api/collections/ai_pages/records/${pid}`, { token: su, body: { html: hs } });
  const idVeStrance = (cestaObr.match(/ai_images\/([a-z0-9]{15})\//) || [])[1];
  const predZnovuStr = branaPozadavky.length;
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: idVeStrance, znovu: true } });
  const fPo = await fetch(inst.base + cestaObr);
  expect(r.status === 409 && r.json.code === 'image_in_page' && branaPozadavky.length === predZnovuStr && fPo.status === 200,
    `obrázek ve stránce nejde nakreslit znovu (nový soubor by starý smazal) — 409, brána nevolána, stránka ho dál načte (${r.status} ${r.json.code} ${fPo.status})`);

  console.log('== karta v historii drží skupinu; strop 4 obrázky na tah ==');
  const n5 = Array.from({ length: 5 }, (_, i) => ['generate_image', { prompt: `variant ${i}, no text`, title: `Varianta ${i + 1}` }]);
  fronta.push(nastroje(...n5), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { chat_id: chat.id, message: 'Udělej pět variant' } });
  expect(jmena(volani[volani.length - 2]).includes('generate_image'), '„udělej pět variant“ bez klíčového slova: skupinu drží karta obrázku v historii');
  const vys = toolZ(posledniVolani()).slice(-5).map((m) => m.content);
  expect(vys.filter((c) => /queued/.test(c)).length === 4 && /at most 4 pictures per message/.test(vys[4]), `4 obrázky projdou, pátý = chyba (${vys.map((c) => c.slice(0, 12)).join(' | ')})`);

  console.log('== Kancelář: obrázky v prezentaci (titulní + snímky) a v přání / pozvánce / plakátu, diplom bez ==');
  const OSNOVA = '# Kuchyň Novákovi\n## Cíl\n- Nová kuchyň do Vánoc\n## Další kroky\n- Objednat desku\n- Montáž 12. 12.';
  fronta.push(nastroj('draft_presentation', { title: 'Kuchyň Novákovi', text: OSNOVA, picture: 'a bright modern kitchen, flat illustration',
    slide_pictures: [{ slide: 'Další kroky', prompt: 'a road leading to a finished kitchen' }, { slide: 'Neexistuje', prompt: 'nothing' }] }), text('Prezentace je hotová.'));
  const predBranaK = branaPozadavky.length;
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Udělej prezentaci projektu pro klienta' } });
  const defP = volani[volani.length - 2].tools.find((x) => x.function.name === 'draft_presentation');
  expect(defP && 'picture' in defP.function.parameters.properties && 'slide_pictures' in defP.function.parameters.properties && /PICTURES/.test(defP.function.description), 'se službou obrázků draft_presentation nabízí picture + slide_pictures a větu o obrázcích');
  const chatK = r.json.chat;
  const kp = karty(chatK, 'soubor')[0];
  expect(kp && kp.doc_id && Array.isArray(kp.obrazky) && kp.obrazky.length === 2, `karta prezentace nese 2 obrázky (titulní + existující snímek; neznámý snímek vypadne) (${JSON.stringify(kp && kp.obrazky)})`);
  expect(branaPozadavky.length === predBranaK && /2 pictures are being drawn/.test(toolZ(posledniVolani()).pop().content), 'během tahu se nekreslí; model ví, že se kreslí 2 obrázky');
  let zz = (await zaznamy()).filter((x) => kp.obrazky.includes(x.id));
  expect(zz.length === 2 && zz.every((x) => x.stav === 'ceka' && x.preset === 'vysoky' && /no text, no letters$/.test(x.prompt) && x.chat === chatK.id), `záznamy: čekají, na výšku, bez textu, znají rozhovor (${zz.map((x) => x.preset + '/' + x.stav).join(' ')})`);
  r = await inst.api('GET', `/api/kb/chat/dokument/${kp.doc_id}`, { token: A1 });
  let dk = r.json.dokument;
  expect(dk.meta.images.length === 2 && dk.meta.images[0].slot === '' && dk.meta.images[1].slot === 'Další kroky' && dk.obrazky.length === 2 && dk.obrazky.every((o) => o.stav === 'ceka'), `DTO dokumentu: meta.images se sloty a obrazky se stavem (${JSON.stringify(dk.meta.images)})`);
  for (const id of kp.obrazky) await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id } });
  dk = (await inst.api('GET', `/api/kb/chat/dokument/${kp.doc_id}`, { token: A1 })).json.dokument;
  expect(dk.obrazky.every((o) => o.stav === 'hotovo' && /^\/api\/files\/ai_images\//.test(o.url)) && branaPozadavky.slice(predBranaK).every((p) => p.body.preset === 'vysoky'), 'po nakreslení DTO nese adresy; brána dostala preset vysoky');

  fronta.push(nastroje(
    ['draft_card', { kind: 'greeting', title: 'PF 2027', text: 'Hodně zdraví v novém roce.', picture: 'a snowy village at dusk, watercolor' }],
    ['draft_card', { kind: 'invitation', title: 'Vánoční večírek', text: 'Zveme vás.', date: '12. 12. 2026 v 18:00', place: 'Dílna', picture: 'festive table with candles' }],
    ['draft_card', { kind: 'poster', title: 'Den otevřených dveří', text: 'Přijďte.', picture: 'an open workshop door, sunny' }],
    ['draft_card', { kind: 'certificate', title: 'Diplom', text: 'Jana Nováková\nza deset let', picture: 'a golden medal' }]), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Připrav přání PF, pozvánku, plakát a diplom' } });
  const kc = karty(r.json.chat, 'soubor');
  const podle = (tpl) => kc.find((k) => k.template === tpl);
  const presetDok = async (k) => (await zaznamy()).find((x) => x.id === (k.obrazky || [])[0]);
  expect(kc.length === 4 && (await presetDok(podle('greeting'))).preset === 'vysoky' && (await presetDok(podle('invitation'))).preset === 'banner' && (await presetDok(podle('poster'))).preset === 'hlavicka',
    'přání = pruh na výšku, pozvánka = banner, plakát = hlavička (poměr stran podle místa v šabloně)');
  expect(!podle('certificate').obrazky, 'diplom obrázek nemá (ani když ho model pošle)');

  console.log('== Kancelář: meta.images jen vlastní obrázky; update bez images je nesmaže; panel přidá obrázek ==');
  const dPrani = podle('greeting').doc_id;
  const idPrani = podle('greeting').obrazky[0];
  fronta.push(nastroj('draft_card', { kind: 'greeting', title: 'Pro Janu', text: 'Ahoj.', picture: 'a red bicycle' }), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: B, body: { message: 'Udělej mi přání' } });
  const cizi = karty(r.json.chat, 'soubor')[0].obrazky[0];
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A1, body: { id: dPrani, meta: { template: 'greeting', images: [{ slot: '', id: cizi }] } } });
  expect(r.status === 200 && !r.json.dokument.meta.images && !(r.json.dokument.obrazky || []).length, `cizí obrázek do meta.images neprojde (${JSON.stringify(r.json.dokument && r.json.dokument.meta)})`);
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A1, body: { id: dPrani, meta: { template: 'greeting', images: [{ slot: '', id: idPrani }] } } });
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A1, body: { id: dPrani, meta: { template: 'greeting', color: '#b91c1c' } } });
  expect(r.json.dokument.meta.color === '#b91c1c' && r.json.dokument.meta.images && r.json.dokument.meta.images[0].id === idPrani, 'meta bez klíče images (update_document, starý klient) obrázek nesmaže');
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A1, body: { id: dPrani, meta: { template: 'greeting', images: [] } } });
  expect(!r.json.dokument.meta.images, 'výslovné images: [] z panelu obrázek odebere');

  r = await inst.api('POST', '/api/kb/chat/dokument/obrazek', { token: A1, body: { id: kp.doc_id, slot: 'cíl', prompt: 'terč a šipka, plochá ilustrace' } });
  expect(r.status === 200 && r.json.obrazek.stav === 'ceka' && r.json.obrazek.preset === 'vysoky' && r.json.dokument.meta.images.length === 3 && r.json.dokument.meta.images[2].slot === 'Cíl', `panel: obrázek ke snímku „Cíl“ (slot podle osnovy, bez ohledu na velikost písmen) (${r.status} ${JSON.stringify(r.json.dokument && r.json.dokument.meta.images)})`);
  const idCil = r.json.obrazek.id;
  r = await inst.api('POST', '/api/kb/chat/dokument/obrazek', { token: A1, body: { id: kp.doc_id, slot: 'Cíl', prompt: 'jiný terč' } });
  expect(r.status === 200 && r.json.dokument.meta.images.length === 3 && !r.json.dokument.meta.images.some((x) => x.id === idCil), 'panel: nový obrázek téhož snímku starý v dokumentu nahradí');
  r = await inst.api('POST', '/api/kb/chat/dokument/obrazek', { token: A1, body: { id: kp.doc_id, slot: 'Žádný snímek', prompt: 'x' } });
  expect(r.status === 400, `panel: neznámý snímek → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/dokument/obrazek', { token: A1, body: { id: podle('certificate').doc_id, slot: '', prompt: 'medaile' } });
  expect(r.status === 400, `panel: diplom obrázek nedostane → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/dokument/obrazek', { token: B, body: { id: kp.doc_id, slot: '', prompt: 'cizí' } });
  expect(r.status === 404, `panel: cizí dokument → 404 (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/dokument/obrazek', { token: A1, body: { id: kp.doc_id, slot: 'Cíl', prompt: '' } });
  expect(r.status === 400, `panel: prázdný popis → 400 (${r.status})`);

  console.log('== Kancelář: smazání dokumentu smaže i jeho obrázky ==');
  const idsPrez = (await inst.api('GET', `/api/kb/chat/dokument/${kp.doc_id}`, { token: A1 })).json.dokument.meta.images.map((x) => x.id);
  r = await inst.api('POST', '/api/kb/chat/dokument/smazat', { token: A1, body: { id: kp.doc_id } });
  const zbylo = (await zaznamy()).filter((x) => idsPrez.includes(x.id) || x.id === idCil);
  expect(r.status === 200 && zbylo.length === 0, `po smazání prezentace žádný její obrázek nezůstal — ani ten z předchozí verze (${zbylo.length})`);
  expect((await zaznamy()).some((x) => x.id === cizi), 'obrázky jiných dokumentů zůstaly');

  console.log('== záložka Obrázky: seznam s místem použití, natrvalo, smazat jen nepoužitý ==');
  const imgStranky = imgs.map((t) => (t.match(/ai_images\/([a-z0-9]{15})\//) || [])[1]);
  await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: idPrani } }); // záložka ukazuje jen hotové
  r = await inst.api('GET', '/api/kb/chat/obrazky', { token: A1 });
  const sez = r.json.obrazky || [];
  const vSez = (id) => sez.find((x) => x.id === id);
  expect(r.status === 200 && r.json.dni === 90 && !!vSez(id1) && !vSez(cizi), `seznam: vlastní obrázky, cizí ne (${r.status} ${sez.length})`);
  expect(imgStranky.every((id) => { const x = vSez(id); return x && x.pouziti.length === 1 && x.pouziti[0].druh === 'stranka' && x.pouziti[0].title === 'Report dílny' && x.smaze_se === ''; }),
    `ilustrace stránky: použitá ve stránce, úklid ji nesmaže (${JSON.stringify((vSez(imgStranky[0]) || {}).pouziti)})`);
  const s1 = vSez(id1);
  const za90 = new Date(s1.created.replace(' ', 'T')).getTime() + 90 * 86400000;
  expect(s1.pouziti.length === 0 && Math.abs(new Date(s1.smaze_se).getTime() - za90) < 1000, `obrázek jen z chatu: nepoužitý, smaže se za 90 dní (${s1.smaze_se})`);
  const sp = vSez(idPrani);
  expect(sp && sp.pouziti.length === 1 && sp.pouziti[0].druh === 'dokument' && sp.smaze_se === '', 'obrázek odebraný z přání drží předchozí verze dokumentu („Vrátit“) → použitý');
  const vsechny = await zaznamy();
  const uA1 = vsechny.find((x) => x.id === id1).user;
  const nenakresleny = vsechny.find((x) => x.user === uA1 && x.stav !== 'hotovo');
  expect(!!nenakresleny && !sez.some((x) => x.stav !== 'hotovo'), `v záložce jen hotové obrázky (nenakreslený ${nenakresleny && nenakresleny.stav} tam není)`);
  r = await inst.api('GET', '/api/kb/chat/obrazky?q=' + encodeURIComponent('Ranní'), { token: A1 });
  expect(r.json.obrazky.length >= 1 && r.json.obrazky.every((x) => /Ranní/.test(x.title)), `hledání podle názvu (${r.json.obrazky.map((x) => x.title).join(' | ')})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/ponechat', { token: A1, body: { id: id1, trvale: true } });
  expect(r.status === 200 && r.json.obrazek.trvale === true && r.json.obrazek.smaze_se === '', `natrvalo → úklid ho vynechá (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/ponechat', { token: B, body: { id: id1, trvale: false } });
  expect(r.status === 404, `natrvalo cizímu obrázku → 404 (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/smazat', { token: A1, body: { id: imgStranky[0] } });
  expect(r.status === 409 && /Report dílny/.test(r.json.error || '') && (await zaznamy()).some((x) => x.id === imgStranky[0]), `použitý obrázek smazat nejde, hláška řekne kde (${r.status} ${r.json.error})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/smazat', { token: B, body: { id: id1 } });
  expect(r.status === 404 && (await zaznamy()).some((x) => x.id === id1), `cizí obrázek smazat nejde → 404 (${r.status})`);

  console.log('== smazaný rozhovor → jeho nepoužité obrázky hned (natrvalo zůstane) ==');
  fronta.push(nastroje(['generate_image', { prompt: 'a fox, no text', title: 'Liška' }], ['generate_image', { prompt: 'a hedgehog, no text', title: 'Ježek' }]), text('Kreslím.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Nakresli lišku a ježka' } });
  const chatZ = r.json.chat;
  const [idLiska, idJezek] = karty(chatZ, 'obrazek').map((k) => k.image_id);
  for (const id of [idLiska, idJezek]) await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id } });
  await inst.api('POST', '/api/kb/chat/obrazek/ponechat', { token: A1, body: { id: idJezek, trvale: true } });
  r = await inst.api('POST', '/api/kb/chat/smazat', { token: A1, body: { chat_id: chatZ.id } });
  const poChatu = (await zaznamy()).map((x) => x.id);
  expect(r.status === 200 && !poChatu.includes(idLiska) && poChatu.includes(idJezek), `po smazání rozhovoru liška pryč, ježek (natrvalo) zůstal (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/smazat', { token: A1, body: { id: idJezek } });
  expect(r.status === 200 && !(await zaznamy()).some((x) => x.id === idJezek), `nepoužitý obrázek ze záložky smazat jde (${r.status})`);

  console.log('== Nový obrázek ze záložky Obrázky: asistent přepíše český popis na anglický (jako prezentace), formát, název ==');
  const POPIS = 'truhlářská dílna v zimě, za oknem sníh, teplé světlo lampy nad ponkem, ploché ilustrace, žádný text a hodně dalších slov navíc';
  const ANGL = 'A carpentry workshop in winter with snow outside the window, one warm lamp above a wooden workbench, warm flat illustration, cozy interior, no text';
  const predLLM = volani.length, predLogN = (await logy()).length;
  fronta.push(text('Prompt: "' + ANGL + '"'));
  r = await inst.api('POST', '/api/kb/chat/obrazek/novy', { token: A1, body: { prompt: '  ' + POPIS + '  ', preset: 'siroky' } });
  const nv = r.json.obrazek || {};
  expect(r.status === 200 && nv.stav === 'ceka' && nv.preset === 'siroky' && nv.model === 'klein' && nv.title.length <= 80 && nv.title.endsWith('…') && POPIS.startsWith(nv.title.slice(0, -1)),
    `zadáno: čeká, na šířku, klein, název = začátek českého popisu (${r.status} „${nv.title}“)`);
  const zLLM = volani.length === predLLM + 1 ? volani[predLLM].messages.map((m) => m.content).join('\n') : '';
  expect(zLLM.includes(POPIS) && /presentation slide/.test(zLLM) && /detailed painterly illustration, soft cinematic lighting/.test(zLLM) && !/cozy interior/.test(zLLM) && /exact counts/.test(zLLM),
    `model dostal český popis, účel (prezentace) a výchozí styl Malba (teplé světlo) (${volani.length - predLLM}× volán)`);
  const logPopis = (await logy()).slice(predLogN).find((l) => l.tools === 'image_prompt');
  expect(!!logPopis && logPopis.tokens_in === 1000 && logPopis.stav === 'ok', `psaní popisu = řádek image_prompt v ai_chat_log (tokeny → kredity) (${logPopis && logPopis.tokens_in})`);
  const predNovy = branaPozadavky.length;
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: nv.id } });
  expect(r.status === 200 && r.json.obrazek.stav === 'hotovo' && branaPozadavky.length === predNovy + 1 && branaPozadavky[predNovy].body.prompt === ANGL && branaPozadavky[predNovy].body.preset === 'siroky',
    `nakresleno: brána dostala anglický popis od modelu (bez „Prompt:“ a uvozovek) (${(branaPozadavky[predNovy] || { body: {} }).body.prompt})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: nv.id, znovu: true } });
  expect(r.status === 200 && branaPozadavky[branaPozadavky.length - 1].body.prompt === ANGL && volani.length === predLLM + 1, 'Nakreslit znovu = týž anglický popis, model se znovu neptá');
  r = await inst.api('GET', '/api/kb/chat/obrazky', { token: A1 });
  expect(r.json.obrazky[0] && r.json.obrazky[0].id === nv.id && r.json.obrazky[0].pouziti.length === 0 && !!r.json.obrazky[0].smaze_se, 'nový obrázek je v záložce první, nepoužitý (smaže se za 90 dní)');
  fronta.push(text('A cat sitting on a windowsill, warm light'));
  r = await inst.api('POST', '/api/kb/chat/obrazek/novy', { token: A1, body: { prompt: 'kočka', preset: 'banner' } });
  expect(r.status === 200 && r.json.obrazek.preset === 'banner' && /e-mail header strip/.test(volani[volani.length - 1].messages.map((m) => m.content).join(' ')), `formát E-mail (pruh) = banner, model ví, že jde o pruh do e-mailu (${r.json.obrazek && r.json.obrazek.preset})`);
  fronta.push(text('A cat sitting on a windowsill, warm light'));
  r = await inst.api('POST', '/api/kb/chat/obrazek/novy', { token: A1, body: { prompt: 'kočka', preset: 'hlavicka' } });
  expect(r.status === 200 && r.json.obrazek.preset === 'ctverec', `jiný formát než příspěvek / prezentace / story / e-mail → čtverec (${r.json.obrazek && r.json.obrazek.preset})`);
  console.log('== Nový obrázek: styl na klik jde modelu; neznámý styl = výchozí Malba; „no text“ doplní server ==');
  const nakresliNovy = async (body, odpoved) => {
    fronta.push(text(odpoved || 'A man sitting at a desk working on a computer with one monitor, warm light'));
    const z = await inst.api('POST', '/api/kb/chat/obrazek/novy', { token: A1, body });
    const uziv = (volani[volani.length - 1].messages || []).map((m) => m.content).join('\n');
    const pred = branaPozadavky.length;
    const v = z.json.obrazek ? await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: z.json.obrazek.id } }) : { json: {} };
    return { status: z.status, z: z.json.obrazek, v: v.json.obrazek, uziv, prompt: branaPozadavky.length === pred + 1 ? branaPozadavky[pred].body.prompt : null };
  };
  let ns = await nakresliNovy({ prompt: 'muž pracující na pc', preset: 'siroky', styl: 'kresleny' });
  expect(/friendly cartoon illustration/.test(ns.uziv) && ns.z.title === 'muž pracující na pc' && ns.v.stav === 'hotovo' && ns.prompt === 'A man sitting at a desk working on a computer with one monitor, warm light, no text',
    `styl Kreslený jde modelu, název zůstal český popis, chybějící „no text“ doplněno (${ns.prompt})`);
  expect(!/means a laptop/.test(ns.uziv), 'bez slova notebook žádná nápověda navíc');
  ns = await nakresliNovy({ prompt: 'šálek kávy a dva noteboocích na stole' });
  expect(/Czech "notebook" here means a laptop computer/.test(ns.uziv), 'české „notebook“ (i ve tvaru) → modelu nápověda „laptop“, ne papírový sešit');
  ns = await nakresliNovy({ prompt: 'muž pracující na pc', styl: 'constructor' });
  expect(/detailed painterly illustration/.test(ns.uziv) && !/cartoon|cozy interior/.test(ns.uziv), 'neznámý styl (i název vlastnosti objektu) → výchozí Malba');
  ns = await nakresliNovy({ prompt: 'muž pracující na pc', styl: 'ilustrace' });
  expect(/warm flat illustration, cozy interior/.test(ns.uziv) && !/painterly/.test(ns.uziv), 'Ilustrace (jako v prezentaci) zůstala na klik');
  const predChybou = (await zaznamy()).length;
  ns = await nakresliNovy({ prompt: 'muž pracující na pc' }, 'ok');
  expect(ns.status === 502 && (await zaznamy()).length === predChybou, `model vrátil nepoužitelný popis → 502, žádný obrázek nezaložen (${ns.status})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/novy', { token: A1, body: { prompt: '   ' } });
  expect(r.status === 400, `prázdný popis → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/novy', { token: A1, body: { prompt: 'nápis', text: 'Veselé Vánoce' } });
  expect(r.status === 403, `text v obrázku bez KB_IMAGE_TEXT → 403 (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/obrazek/novy', { body: { prompt: 'x' } });
  expect(r.status === 401, `bez přihlášení → 401 (${r.status})`);

  console.log('== noční úklid: nepoužité po 90 dnech, bannery sumáře po 30, natrvalo a použité zůstávají ==');
  // banner sumáře založí server pro instanci (title sumar:<den>) — tady přímo superuživatelem; do seznamu nepatří
  const u1 = (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent("email='admin@example.com'"), { token: su })).json.items[0].id;
  r = await inst.api('POST', '/api/collections/ai_images/records', { token: su, body: { user: u1, title: 'sumar:2026-01-01', prompt: 'banner', model: 'klein', preset: 'banner', stav: 'hotovo', banner: true } });
  const idBanner = r.json.id;
  // banner patří instanci (sdílí ho všichni příjemci mailu) — první příjemce ho nesmí smazat ani překreslit (checkup 5. 11. večer)
  r = await inst.api('GET', `/api/kb/chat/obrazek/${idBanner}`, { token: A1 });
  const bGet = r.json.obrazek;
  r = await inst.api('POST', '/api/kb/chat/obrazek/smazat', { token: A1, body: { id: idBanner } });
  const bDel = r.status;
  r = await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: idBanner, znovu: true } });
  expect(bGet === null && bDel === 404 && r.status === 404 && (await zaznamy()).some((x) => x.id === idBanner), `banner sumáře: vlastník ho přes API nevidí, nesmaže ani nepřekreslí (GET ${bGet === null ? 'null' : 'VIDÍ'}, smazat ${bDel}, znovu ${r.status})`);
  // uživatel si dá název jako banner (checkup 5. 11.: dřív ho to schovalo ze záložky a úklid smazal po 30 dnech;
  // sumarMail by ho vzal jako banner instance pro všechny) → je to jeho obyčejný obrázek
  fronta.push(nastroj('generate_image', { prompt: 'a fake morning banner, no text', title: 'sumar:2026-01-02' }), text('Kreslím.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Nakresli banner' } });
  const idPodvrh = karty(r.json.chat, 'obrazek')[0].image_id;
  await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: idPodvrh } });
  const podvrh = (await zaznamy()).find((x) => x.id === idPodvrh) || {};
  r = await inst.api('GET', '/api/kb/chat/obrazky', { token: A1 });
  expect(!!idBanner && !r.json.obrazky.some((x) => x.id === idBanner), 'banner sumáře (příznak serveru) v záložce Obrázky není');
  expect(podvrh.banner === false && r.json.obrazky.some((x) => x.id === idPodvrh), `obrázek s názvem „sumar:…“ od uživatele NENÍ banner a v záložce je (banner=${podvrh.banner})`);
  fronta.push(nastroj('generate_image', { prompt: 'an old unused sketch, no text', title: 'Starý náčrt' }), text('Kreslím.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Nakresli náčrt' } });
  const idStary = karty(r.json.chat, 'obrazek')[0].image_id;
  await inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A1, body: { id: idStary } });
  fronta.push(nastroj('generate_image', { prompt: 'a fresh sketch, no text', title: 'Čerstvý náčrt' }), text('Kreslím.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A1, body: { message: 'Nakresli další náčrt' } });
  const idCerstvy = karty(r.json.chat, 'obrazek')[0].image_id;
  const souborStary = (await zaznamy()).find((x) => x.id === idStary).file;
  // stáří přepsat PŘÍMO v databázi (created je autodate) — staré: náčrt (nepoužitý), id1 (natrvalo), ilustrace stránky
  // (použitá), banner; čerstvý náčrt zůstane mladý. Bez kontrol „zůstalo“ by prošel i úklid, který smaže všechno.
  const stare = [idStary, id1, imgStranky[0], idBanner];
  // uvízlé kreslení (proces spadl uprostřed): stav „pise“ s updated dávno → navenek chyba, ne věčné točení karty
  r = await inst.api('POST', '/api/collections/ai_images/records', { token: su, body: { user: u1, title: 'Uvízlý', prompt: 'x', model: 'klein', preset: 'ctverec', stav: 'pise' } });
  const idUvizly = r.json.id;
  let uv = (await inst.api('GET', `/api/kb/chat/obrazek/${idUvizly}`, { token: A1 })).json.obrazek || {};
  expect(uv.stav === 'pise', `čerstvé „pise“ zůstává „pise“ (kreslí se) (${uv.stav})`);
  inst.pause();
  const tmpDb = `/tmp/kb-obr-${process.pid}.db`, skriptDb = `/tmp/kb-obr-${process.pid}.py`;
  const { execSync } = require('child_process');
  execSync(`docker cp ${inst.name}:/app/pb_data/data.db ${tmpDb}`, { stdio: 'ignore' });
  fs.writeFileSync(skriptDb, ['import sqlite3, sys', 'c = sqlite3.connect(sys.argv[1])',
    `for i in ${JSON.stringify(stare)}: c.execute("UPDATE ai_images SET created='2020-01-01 00:00:00.000Z' WHERE id=?", (i,))`,
    `c.execute("UPDATE ai_images SET updated='2020-01-01 00:00:00.000Z' WHERE id=?", (${JSON.stringify(idUvizly)},))`,
    // hotový obrázek uprostřed „Nakreslit znovu“ (stav pise, soubor má) — restart ho nesmí ze záložky ani z Kanceláře ztratit
    `c.execute("UPDATE ai_images SET stav='pise' WHERE id=?", (${JSON.stringify(idPodvrh)},))`, 'c.commit(); c.close()'].join('\n'));
  execSync(`python3 ${skriptDb} ${tmpDb}`, { stdio: 'ignore' });
  execSync(`docker cp ${tmpDb} ${inst.name}:/app/pb_data/data.db`, { stdio: 'ignore' });
  execSync(`rm -f ${tmpDb} ${skriptDb}`, { stdio: 'ignore' });
  await inst.resume();
  const su2 = await inst.superuser();
  uv = (await inst.api('GET', `/api/kb/chat/obrazek/${idUvizly}`, { token: A1 })).json.obrazek || {};
  expect(uv.stav === 'chyba', `„pise“ starší než zámek kreslení → navenek „chyba“ (Zkusit znovu), karta se netočí donekonečna (${uv.stav})`);
  const uvDb = ((await inst.api('GET', `/api/collections/ai_images/records/${idUvizly}`, { token: su2 })).json) || {};
  expect(uvDb.stav === 'chyba' && /restart/i.test(uvDb.chyba || ''), `po restartu: rozkreslený bez souboru → v DB „chyba“ s hláškou o restartu (${uvDb.stav}: ${uvDb.chyba})`);
  const pdDb = ((await inst.api('GET', `/api/collections/ai_images/records/${idPodvrh}`, { token: su2 })).json) || {};
  r = await inst.api('GET', '/api/kb/chat/obrazky', { token: A1 });
  expect(pdDb.stav === 'hotovo' && !!pdDb.file && r.json.obrazky.some((x) => x.id === idPodvrh), `po restartu: spadlé „Nakreslit znovu“ se souborem → zpět hotovo, v záložce zůstává (${pdDb.stav})`);
  const souborPred = execSync(`docker exec ${inst.name} sh -c "find /app/pb_data/storage -name '${souborStary}' | wc -l"`).toString().trim();
  r = await inst.api('POST', '/api/crons/prune_ai_images', { token: su2 });
  await new Promise((res) => setTimeout(res, 1500));
  const poUklidu = ((await inst.api('GET', '/api/collections/ai_images/records?perPage=200', { token: su2 })).json.items || []).map((x) => x.id);
  expect(r.status === 204 || r.status === 200, `cron prune_ai_images existuje a jde spustit (${r.status})`);
  expect(!poUklidu.includes(idStary) && !poUklidu.includes(idBanner), 'úklid smazal starý nepoužitý obrázek i starý banner sumáře');
  expect(poUklidu.includes(id1) && poUklidu.includes(imgStranky[0]) && poUklidu.includes(idCerstvy), 'zůstal obrázek natrvalo, použitá ilustrace stránky i čerstvý obrázek');
  const souborPo = execSync(`docker exec ${inst.name} sh -c "find /app/pb_data/storage -name '${souborStary}' | wc -l"`).toString().trim();
  expect(souborPred === '1' && souborPo === '0', `úklid smazal i soubor ze storage (${souborPred} → ${souborPo})`);

  console.log('== KB_IMAGE_TEXT=1 + provider api: FLUX 3 a token brány instance ==');
  const api = await H.startInstance({ slug: 'ai-obrazky-api', addHostGateway: true, env: Object.assign({}, ZAKLAD, { KB_AI_PROVIDER: 'api', KB_AI_URL: brana.base + '/v1/advisor', KB_AI_TOKEN: 'kb_tok', KB_IMAGE_PROVIDER: 'api', KB_IMAGE_TEXT: '1', KB_OBRAZEK_KREDITY: '3' }) });
  await api.register('admin@example.com', { name: 'Petr' });
  const A2 = await api.login('admin@example.com');
  cfg = (await api.api('GET', '/api/kb/config')).json;
  expect(cfg.ai_modes.includes('chat_draw') && cfg.ai_modes.includes('chat_draw_text'), `/config: chat_draw i chat_draw_text (${cfg.ai_modes.filter((m) => /draw/.test(m)).join(',')})`);
  fronta.push(nastroj('generate_image', { prompt: 'a cheerful trophy with a ribbon, flat illustration', title: 'Trofej', text: 'Projekt hotový!', format: 'square' }), text('Kreslím.'));
  r = await api.api('POST', '/api/kb/chat', { token: A2, body: { message: 'Nakresli trofej s nápisem Projekt hotový!' } });
  const k3 = karty(r.json.chat, 'obrazek')[0];
  expect(k3 && k3.model === 'flux3', `text → model flux3 (${k3 && k3.model})`);
  const predApi = branaPozadavky.length;
  r = await api.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A2, body: { id: k3.image_id } });
  const p3 = branaPozadavky[predApi];
  expect(r.status === 200 && p3 && p3.token === 'kb_tok' && p3.body.model === 'flux3' && /The image clearly shows the text "Projekt hotový!"/.test(p3.body.prompt), `brána: flux3, prompt s textem, token brány instance (${p3 && p3.token} ${p3 && p3.body.model})`);
  const log3 = ((await api.api('GET', '/api/collections/ai_chat_log/records?perPage=50', { token: await api.superuser() })).json.items || []).filter((l) => l.tools === 'image_draw');
  expect(log3.length === 1 && log3[0].model === 'flux3-klein#obrazek' && log3[0].kredity === 3, `KB_OBRAZEK_KREDITY=3 → pevná cena za kus i u FLUX 3 (${log3[0] && log3[0].kredity})`);

  fronta.push(text('A small fir tree with ornaments on a festive card, warm light, calm empty area at the top'));
  r = await api.api('POST', '/api/kb/chat/obrazek/novy', { token: A2, body: { prompt: 'vánoční přání s jedličkou', text: 'Veselé Vánoce', preset: 'vysoky' } });
  expect(r.status === 200 && r.json.obrazek.model === 'flux3' && r.json.obrazek.preset === 'vysoky', `Nový obrázek s textem → FLUX 3, na výšku (${r.status} ${r.json.obrazek && r.json.obrazek.model})`);
  const sysT = ((volani[volani.length - 1] || {}).messages || []).map((m) => m.content).join('\n');
  expect(/exactly once, clearly readable/.test(sysT) && /Words in the picture: "Veselé Vánoce"/.test(sysT) && !/end the prompt with "no text"/.test(sysT), 's textem model ví, jaká slova mají být v obrázku (a nepíše „no text“)');

  console.log('== obrázky „solo“: týdenní strop KB_OBRAZKY_TYDEN, 0 kreditů, kvóta kreditů je nezastaví ==');
  const tyd = await H.startInstance({ slug: 'ai-obrazky-tyden', addHostGateway: true, env: Object.assign({}, ZAKLAD, { KB_AI_PROVIDER: 'api', KB_AI_URL: brana.base + '/v1/advisor', KB_AI_TOKEN: 'kb_tok', KB_IMAGE_PROVIDER: 'api', KB_OBRAZKY_TYDEN: '2', KB_OBRAZEK_KREDITY: '0', KB_AI_KVOTA_TYDEN: '1' }) });
  await tyd.register('admin@example.com', { name: 'Petr' });
  const A5 = await tyd.login('admin@example.com');
  const suT = await tyd.superuser();
  const uT = (await tyd.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent("email='admin@example.com'"), { token: suT })).json.items[0].id;
  // kvóta kreditů týdne (1) je vyčerpaná dřívějším tahem asistenta → textový tah by narazil, obrázek ne
  r = await tyd.api('POST', '/api/collections/ai_chat_log/records', { token: suT, body: { user: uT, stav: 'ok', kredity: 5, calls: 1, tools: 'chat', model: 'm-a' } });
  expect(r.status === 200, `podklad: tah za 5 kreditů v logu (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
  const kresliTyden = async (popis) => {
    fronta.push(text('A calm painterly scene of ' + popis + ', warm light, no text'));
    const n = await tyd.api('POST', '/api/kb/chat/obrazek/novy', { token: A5, body: { prompt: popis, preset: 'ctverec' } });
    if (n.status !== 200) return n;
    return tyd.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A5, body: { id: n.json.obrazek.id } });
  };
  const t1 = await kresliTyden('dílna ráno');
  const t2 = await kresliTyden('les v mlze');
  expect(t1.status === 200 && t2.status === 200 && t1.json.obrazek.stav === 'hotovo' && t2.json.obrazek.stav === 'hotovo',
    `KB_OBRAZEK_KREDITY=0: vyčerpaná kvóta kreditů Nový obrázek nezastaví — 2× nakresleno (${t1.status} ${t2.status})`);
  const logT = ((await tyd.api('GET', '/api/collections/ai_chat_log/records?perPage=50', { token: suT })).json.items || []);
  const kreslT = logT.filter((l) => l.tools === 'image_draw'), popisT = logT.filter((l) => l.tools === 'image_prompt');
  expect(kreslT.length === 2 && kreslT.every((l) => l.kredity === 0) && popisT.length === 2 && popisT.every((l) => l.kredity === 0),
    `obrázek i jeho popis za 0 kreditů (kreslení ${kreslT.map((l) => l.kredity).join(',')} · popis ${popisT.map((l) => l.kredity).join(',')})`);
  const predVolani = volani.length, predBranaT = branaPozadavky.length;
  const t3 = await kresliTyden('třetí obrázek');
  expect(t3.status === 429 && t3.json.code === 'image_week' && /všech 2 obrázků/.test(t3.json.error || '') && /pondělí/.test(t3.json.error || ''),
    `3. obrázek v týdnu → 429 image_week „vyčerpáno všech 2 obrázků… od pondělí“ (${t3.status} ${t3.json.code} ${t3.json.error})`);
  expect(volani.length === predVolani && branaPozadavky.length === predBranaT, `strop odmítne DŘÍV než model popisu i brána (model ${volani.length - predVolani}×, brána ${branaPozadavky.length - predBranaT}×)`);
  fronta.length = 0; // nespotřebovaná odpověď modelu pro 3. popis
  const t4 = await tyd.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A5, body: { id: t1.json.obrazek.id, znovu: true } });
  const d4 = (await tyd.api('GET', `/api/kb/chat/obrazek/${t1.json.obrazek.id}`, { token: A5 })).json.obrazek || {};
  expect(t4.status === 429 && t4.json.code === 'image_week' && d4.stav === 'hotovo', `Nakreslit znovu se počítá taky → 429, hotový obrázek zůstává hotový (${t4.status} ${d4.stav})`);
  // asistent v rozhovoru: zadaná karta na strop narazí při kreslení → „chyba“ s hláškou (karta nabídne Zkusit znovu)
  r = await tyd.api('POST', '/api/collections/ai_images/records', { token: suT, body: { user: uT, prompt: 'a lighthouse, no text', title: 'Maják', model: 'klein', preset: 'ctverec', stav: 'ceka' } });
  const idCeka = r.json.id;
  const t5 = await tyd.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A5, body: { id: idCeka } });
  const d5 = (await tyd.api('GET', `/api/kb/chat/obrazek/${idCeka}`, { token: A5 })).json.obrazek || {};
  expect(t5.status === 429 && d5.stav === 'chyba' && /pondělí/.test(d5.chyba || ''), `karta asistenta nad stropem → „chyba“ s hláškou o týdnu (${t5.status} ${d5.stav} ${d5.chyba})`);

  console.log('== tarif brány bez image: kreslení se nenabízí ==');
  modyBrany = ['questions', 'generate', 'expand', 'chat', 'from_text', 'transcribe'];
  const tarif = await H.startInstance({ slug: 'ai-obrazky-tarif', addHostGateway: true, env: Object.assign({}, ZAKLAD, { KB_AI_PROVIDER: 'api', KB_AI_URL: brana.base + '/v1/advisor', KB_AI_TOKEN: 'kb_tok', KB_IMAGE_PROVIDER: 'api' }) });
  await tarif.register('admin@example.com', { name: 'Petr' });
  const A3 = await tarif.login('admin@example.com');
  cfg = (await tarif.api('GET', '/api/kb/config')).json;
  expect(!cfg.ai_modes.includes('chat_draw'), `tarif bez image → /config bez chat_draw (${cfg.ai_modes.join(',')})`);
  fronta.push(text('Kreslit tu nejde.'));
  await tarif.api('POST', '/api/kb/chat', { token: A3, body: { message: 'Nakresli mi obrázek' } });
  expect(!jmena(posledniVolani()).includes('generate_image'), 'tarif bez image → generate_image se nenabízí');
  const jinam = await H.startInstance({ slug: 'ai-obrazky-jinam', addHostGateway: true, env: Object.assign({}, ZAKLAD, { KB_AI_PROVIDER: 'api', KB_AI_URL: brana.base + '/v1/advisor', KB_AI_TOKEN: 'kb_tok', KB_IMAGE_PROVIDER: 'api', KB_IMAGE_URL: 'http://obrazky.example:9/v1/advisor', KB_IMAGE_TOKEN: 'jiny', KB_AI_MAX_PER_HOUR: '1' }) });
  await jinam.register('admin@example.com', { name: 'Petr' });
  cfg = (await jinam.api('GET', '/api/kb/config')).json;
  expect(cfg.ai_modes.includes('chat_draw'), `obrázky jdou na JINOU službu než chat → tarif chatové brány bez image je neskryje (${cfg.ai_modes.filter((m) => /draw/.test(m)).join(',') || 'nic'})`);
  // hodinová brzda (KB_AI_MAX_PER_HOUR=1): 1. kreslení strop vyčerpá, 2. se odmítne PŘED kreslením → „chyba“, ne věčné „ceka“
  {
    const suJ = await jinam.superuser();
    const uJ = (await jinam.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent("email='admin@example.com'"), { token: suJ })).json.items[0].id;
    const AJ = await jinam.login('admin@example.com');
    const novyJ = async (title) => (await jinam.api('POST', '/api/collections/ai_images/records', { token: suJ, body: { user: uJ, title, prompt: 'a tree, no text', model: 'klein', preset: 'ctverec', stav: 'ceka' } })).json.id;
    const j1 = await novyJ('První'), j2 = await novyJ('Druhý');
    await jinam.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: AJ, body: { id: j1 } });
    const rj = await jinam.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: AJ, body: { id: j2 } });
    const dj = (await jinam.api('GET', `/api/kb/chat/obrazek/${j2}`, { token: AJ })).json.obrazek || {};
    expect(rj.status === 429 && dj.stav === 'chyba' && !!dj.chyba, `hodinová brzda odmítne kreslení → záznam „chyba“ s hláškou, karta se netočí (${rj.status} ${dj.stav}: ${dj.chyba})`);
  }

  console.log('== vlastní služba přes OpenAI Images API (KB_IMAGE_PROVIDER=openai, Richard 5. 11.: self-host si dá svůj model) ==');
  // podvržené OpenAI: POST /v1/images/generations → {data:[{b64_json}]}; „PNG“ v popisu vrátí PNG, „ODMITNI“ 400 s kódem chyby
  const oaPozadavky = [];
  const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]).toString('base64');
  const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
  const openai = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    let b = {};
    try { b = JSON.parse(body || '{}'); } catch { b = {}; }
    oaPozadavky.push({ url: req.url, auth: req.headers.authorization || '', body: b });
    if (req.url !== '/v1/images/generations') { res.statusCode = 404; res.end('{"error":{"message":"not found"}}'); return; }
    if (/ODMITNI/.test(b.prompt || '')) { res.statusCode = 400; res.end('{"error":{"message":"Your request was rejected","type":"invalid_request_error","code":"moderation_blocked"}}'); return; }
    res.end(JSON.stringify({ created: 1, data: [{ b64_json: /PNG/.test(b.prompt || '') ? PNG_B64 : JPEG_B64 }] }));
  });
  const oa = await H.startInstance({ slug: 'ai-obrazky-openai', addHostGateway: true, env: Object.assign({}, ZAKLAD, { KB_IMAGE_PROVIDER: 'openai', KB_IMAGE_URL: openai.base + '/v1', KB_IMAGE_TOKEN: 'sk-test-oa', KB_IMAGE_MODEL: 'gpt-image-1' }) });
  await oa.register('admin@example.com', { name: 'Petr' });
  const A4 = await oa.login('admin@example.com');
  cfg = (await oa.api('GET', '/api/kb/config')).json;
  expect(cfg.ai_modes.includes('chat_draw'), `OpenAI služba → kreslení se nabízí (bez naší brány) (${cfg.ai_modes.filter((m) => /draw/.test(m)).join(',')})`);
  fronta.push(nastroj('generate_image', { prompt: 'a cozy carpentry workshop, painterly, no text', title: 'Dílna', format: 'landscape' }), text('Kreslím.'));
  r = await oa.api('POST', '/api/kb/chat', { token: A4, body: { message: 'Nakresli dílnu' } });
  const k4 = karty(r.json.chat, 'obrazek')[0];
  r = await oa.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A4, body: { id: k4.image_id } });
  const q = oaPozadavky[oaPozadavky.length - 1] || { body: {} };
  expect(r.status === 200 && r.json.obrazek.stav === 'hotovo' && !!r.json.obrazek.url, `OpenAI: obrázek nakreslen a uložen (${r.status} ${r.json.obrazek && r.json.obrazek.stav})`);
  expect(q.url === '/v1/images/generations' && q.auth === 'Bearer sk-test-oa' && q.body.model === 'gpt-image-1' && q.body.n === 1 && q.body.output_format === 'jpeg' && q.body.size === '1536x1024' && /cozy carpentry workshop/.test(q.body.prompt),
    `OpenAI: /images/generations, Bearer klíč, model, JPEG, na šířku 1536×1024 (${JSON.stringify({ u: q.url, m: q.body.model, f: q.body.output_format, s: q.body.size })})`);
  expect(!('mode' in q.body) && !('seed' in q.body) && !q.auth.includes('img_tok'), 'OpenAI: jen standardní pole (žádné mode/seed naší brány)');
  const f4 = await fetch(oa.base + r.json.obrazek.url);
  expect(f4.status === 200 && /image\/jpeg/.test(f4.headers.get('content-type') || ''), `OpenAI: uložený soubor jde načíst jako JPEG (${f4.status})`);
  const log4 = ((await oa.api('GET', '/api/collections/ai_chat_log/records?perPage=50', { token: await oa.superuser() })).json.items || []).filter((l) => l.tools === 'image_draw');
  expect(log4.length === 1 && log4[0].model === 'gpt-image-1#obrazek' && log4[0].zdroj === 'vlastni', `OpenAI: řádek logu nese model služby a zdroj „vlastni“, ne náš FLUX (${log4[0] && log4[0].model} / ${log4[0] && log4[0].zdroj})`);
  // čtverec a na výšku
  fronta.push(nastroj('generate_image', { prompt: 'a tall poster, no text', title: 'Plakát', format: 'portrait' }), text('Kreslím.'));
  r = await oa.api('POST', '/api/kb/chat', { token: A4, body: { message: 'Nakresli plakát' } });
  await oa.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A4, body: { id: karty(r.json.chat, 'obrazek')[0].image_id } });
  expect((oaPozadavky[oaPozadavky.length - 1] || { body: {} }).body.size === '1024x1536', 'OpenAI: na výšku 1024×1536');
  // PNG místo JPEG → poctivá chyba (pole souboru PNG nepřijme), žádné uvízlé kreslení
  fronta.push(nastroj('generate_image', { prompt: 'PNG please, no text', title: 'PNG' }), text('Kreslím.'));
  r = await oa.api('POST', '/api/kb/chat', { token: A4, body: { message: 'Nakresli PNG' } });
  const kPng = karty(r.json.chat, 'obrazek')[0];
  r = await oa.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A4, body: { id: kPng.image_id } });
  const dPng = (await oa.api('GET', `/api/kb/chat/obrazek/${kPng.image_id}`, { token: A4 })).json.obrazek || {};
  expect(r.status === 502 && /JPEG/.test(r.json.error || '') && dPng.stav === 'chyba', `OpenAI vrátí PNG → 502 „jiný formát než JPEG“, obrázek ve stavu chyba (${r.status} ${dPng.stav})`);
  // odmítnutí (moderace / špatný klíč) → hláška s kódem služby, ne obecné „nejde“
  fronta.push(nastroj('generate_image', { prompt: 'ODMITNI tohle, no text', title: 'Odmítnutý' }), text('Kreslím.'));
  r = await oa.api('POST', '/api/kb/chat', { token: A4, body: { message: 'Nakresli něco' } });
  r = await oa.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: A4, body: { id: karty(r.json.chat, 'obrazek')[0].image_id } });
  expect(r.status === 502 && /moderation_blocked/.test(r.json.error || ''), `OpenAI odmítne → hláška s kódem služby (${r.status} ${r.json.error})`);
  // bez klíče se OpenAI nenabízí
  const oa2 = await H.startInstance({ slug: 'ai-obrazky-openai2', addHostGateway: true, env: Object.assign({}, ZAKLAD, { KB_IMAGE_PROVIDER: 'openai' }) });
  await oa2.register('admin@example.com', { name: 'Petr' });
  cfg = (await oa2.api('GET', '/api/kb/config')).json;
  expect(!cfg.ai_modes.includes('chat_draw'), 'KB_IMAGE_PROVIDER=openai bez klíče → kreslení se nenabízí');
}, { nazev: 'AI-OBRAZKY' });
