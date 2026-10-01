// Hlasovky v AI asistentovi (1. 10. 2026, fáze B plánu AI funkcí) — API sada proti podvrženému přepisu
// (OpenAI tvar: multipart /audio/transcriptions, jako speaches / whisper.cpp / OpenAI) a podvrženému chatu.
//
// Hlídá: /config (chat_voice jen tam, kde přepis jde) · přepis PŘED smyčkou a značka „[Přepis hlasovky]“ ·
// druh nahrávky podle obsahu (WhatsApp .opus → .ogg, PNG ne) · kontroly PŘED hodinovým stropem · váha 2 ·
// výpadek přepisu = nic se neuloží a hláška bez adresy služby · prázdná nahrávka · log délky · výzva porady
// podle toho, co instance umí · stará cesta /advisor (Nahrát zvuk) jde přes týž modul · token jen na týž původ ·
// cloudová cesta (provider api = brána): přepis přes /v1/advisor, vyčerpaná kvóta brány · příznak `ulozeno` (kdy
// nahrávku nenabízet k opakování) · strop těla a jeden zápis u opravy přepisu · váha přesně 2 · brzda /advisor.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-hlasovka.js
const H = require('./_harness');
const { expect } = H;

// ---------- podvržený přepis (přísný jako OpenAI: jen multipart se souborem) ----------
let rezimPrepisu = 'ok';             // ok | down | prazdno
const textyPrepisu = [];            // fronta textů, které „řekl“ uživatel
const prepisy = [];                 // {soubor, model, auth, jazyk}
const whisperHandler = (req, res, telo) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) { res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'whisper-1' }] })); return; }
  if (!req.url.startsWith('/v1/audio/transcriptions')) { res.statusCode = 404; res.end('{}'); return; }
  if (!/^multipart\/form-data/.test(req.headers['content-type'] || '')) { res.statusCode = 415; res.end('{"error":{"message":"Expected multipart/form-data"}}'); return; }
  const soubor = (telo.match(/name="file"; filename="([^"]+)"/) || [])[1] || '';
  const model = (telo.match(/name="model"\r\n\r\n([^\r\n]+)/) || [])[1] || '';
  const jazyk = (telo.match(/name="language"\r\n\r\n([^\r\n]+)/) || [])[1] || '';
  const vad = (telo.match(/name="vad_filter"\r\n\r\n([^\r\n]+)/) || [])[1] || '';
  prepisy.push({ soubor, model, auth: req.headers.authorization || '', jazyk, vad });
  if (!soubor) { res.statusCode = 400; res.end('{"error":{"message":"Missing file part"}}'); return; }
  if (!/\.(webm|ogg|m4a|mp3|wav|flac|mp4|mpga|mpeg)$/.test(soubor)) { res.statusCode = 400; res.end('{"error":{"message":"Invalid file format"}}'); return; }
  if (rezimPrepisu === 'down') { res.statusCode = 503; res.end('{"error":{"message":"whisper na stroji prepis-interni neběží (interní adresa 192.168.77.17)"}}'); return; }
  res.end(JSON.stringify({ text: rezimPrepisu === 'prazdno' ? '' : rezimPrepisu === 'halucinace' ? 'www.hradeckralove.org' : (textyPrepisu.shift() || 'koupit barvu a zavolat klientovi') }));
};

// ---------- podvržená brána (provider api): náš JSON kontrakt, token v hlavičce X-KB-Token ----------
let rezimBrany = 'ok';              // ok | kvota
const branaPozadavky = [];
const branaHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/v1/status')) { res.end(JSON.stringify({ schema_version: 1, name: 'Test', active: true, modes: ['questions', 'generate', 'expand', 'chat', 'from_text', 'transcribe'] })); return; }
  if (!req.url.startsWith('/v1/advisor')) { res.statusCode = 404; res.end('{}'); return; }
  let b = {};
  try { b = JSON.parse(body || '{}'); } catch { b = {}; }
  branaPozadavky.push({ token: req.headers['x-kb-token'] || '', mode: b.mode, filename: b.filename, lang: b.lang, audio: String(b.audio_base64 || '').length });
  if (req.headers['x-kb-token'] !== 'kb_test_token') { res.statusCode = 401; res.end('{"detail":{"error":"Neplatný token."}}'); return; }
  // FastAPI balí HTTPException do {detail: …} — stejně jako skutečná brána
  if (rezimBrany === 'kvota') { res.statusCode = 429; res.end(JSON.stringify({ detail: { error: 'Vyčerpán měsíční limit AI operací. Kontaktujte poskytovatele.' } })); return; }
  if (b.mode !== 'transcribe' || !b.audio_base64) { res.statusCode = 400; res.end('{"detail":{"error":"čekal jsem transcribe"}}'); return; }
  res.end(JSON.stringify({ text: 'objednat barvy a zavolat klientovi', schema_version: 1 }));
};

// ---------- podvržený chat (ollama) ----------
const fronta = [];
const volani = [];
const chatHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }, { name: 'vize-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  const b = JSON.parse(body);
  volani.push(b);
  const o = fronta.shift() || { content: '(fronta prázdná)' };
  if (o.status) { res.statusCode = o.status; res.end('{"error":"model spadl"}'); return; }
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
};
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const systemZ = (v) => ((v && v.messages) || []).find((m) => m.role === 'system')?.content || '';

// nahrávky podle hlavičky (obsah za ní je pro přepis mocku jedno)
const vypln = Buffer.alloc(300, 7);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]), vypln]).toString('base64');
const OGG = Buffer.concat([Buffer.from('OggS\0\x02'), vypln]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), vypln]).toString('base64');
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

H.beh(async () => {
  const whisper = await H.httpMock(whisperHandler);
  const whisper2 = await H.httpMock(whisperHandler); // jiný původ (port) — vlastní whisper mimo adresu AI
  const chatMock = await H.httpMock(chatHandler);
  const PREPIS = { KB_TRANSCRIBE_PROVIDER: 'openai', KB_TRANSCRIBE_URL: whisper.base + '/v1/audio/transcriptions', KB_TRANSCRIBE_MODEL: 'Systran/faster-whisper-large-v3', KB_TRANSCRIBE_TOKEN: 'tajny-prepis' };
  const CHAT = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: chatMock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0 };

  const inst = await H.startInstance({ slug: 'hlas', addHostGateway: true, env: Object.assign({}, CHAT, PREPIS, { KB_AI_MAX_PER_HOUR: 600 }) });
  await inst.register('a@example.com', { name: 'Anna' });
  const A = await inst.login('a@example.com');

  console.log('== /config: hlasovky jen tam, kde přepis jde ==');
  const cfg = (await inst.api('GET', '/api/kb/config')).json;
  expect((cfg.ai_modes || []).includes('chat_voice') && (cfg.ai_modes || []).includes('transcribe') && cfg.chat_voice_max_s === 300, `vlastní přepis → transcribe + chat_voice, max 300 s (${JSON.stringify(cfg.ai_modes)})`);

  console.log('== hlasovka → přepis před smyčkou → značka pro model ==');
  textyPrepisu.push('koupit barvu na plot, zavolat panu Novákovi kvůli zakázce a objednat kování');
  fronta.push(nastroj('add_ideas', { items: [{ title: 'koupit barvu na plot' }, { title: 'objednat kování' }] }));
  let predV = volani.length;
  let r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 42, context: { route: '/' } } });
  expect(r.status === 200, `hlasovka bez textu → 200 (${r.status} ${JSON.stringify(r.json).slice(0, 160)})`);
  const p1 = prepisy.at(-1) || {};
  expect(/\.webm$/.test(p1.soubor) && p1.model === 'Systran/faster-whisper-large-v3' && p1.auth === 'Bearer tajny-prepis' && p1.jazyk === 'cs', `přepis: multipart *.webm, model a token z KB_TRANSCRIBE_*, jazyk cs (${JSON.stringify(p1)})`);
  expect(p1.vad === 'true', 'vlastní přepisovač dostává vad_filter=true (bez filtru ticha si Whisper na tichu vymýšlí)');
  const v1 = volani[predV];
  const uziv = (v1.messages || []).filter((m) => m.role === 'user').pop().content;
  expect(/\[Přepis hlasovky\]\nkoupit barvu na plot/.test(uziv) && !JSON.stringify(v1).includes(WEBM.slice(0, 40)), 'chat model dostal přepis se značkou, ne nahrávku');
  expect((v1.tools || []).some((t) => t.function.name === 'add_ideas'), 'značka hlasovky otevře třídicí nástroje (add_ideas)');
  expect(/Přepis hlasovky/.test(systemZ(v1)), 'systém zná pravidlo pro „[Přepis hlasovky]“');
  let chat = r.json.chat;
  const zU = chat.messages.find((m) => m.role === 'user');
  expect(zU.hlas && zU.hlas.s === 42 && /^Hlasovka: koupit barvu/.test(chat.title), `uložená zpráva nese délku, titulek z přepisu (${chat.title})`);
  expect(!JSON.stringify(chat).includes(WEBM.slice(0, 40)), 'nahrávka se NEukládá');
  expect((chat.messages.at(-1).karty || []).some((k) => k.type === 'akce' && /zásobník/i.test(k.popis || '')), 'z hlasovky vznikla karta k potvrzení (nic se neuložilo rovnou)');

  console.log('== WhatsApp .opus (Ogg) → .ogg; druh podle obsahu, ne podle názvu ==');
  fronta.push({ content: 'Rozumím.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: '', audio_base64: OGG, audio_s: 5, audio_name: 'PTT-20261001-WA0001.opus' } });
  expect(r.status === 200 && /\.ogg$/.test((prepisy.at(-1) || {}).soubor), `Ogg/Opus jde přepisovači jako .ogg (${(prepisy.at(-1) || {}).soubor})`);

  console.log('== vadné vstupy → 400 dřív, než brzda ubere strop ==');
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: PNG } });
  expect(r.status === 400 && r.json.code === 'ai_hlas_typ', `PNG místo zvuku → 400 ai_hlas_typ (${r.status} ${r.json && r.json.code})`);
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, image_base64: JPG } });
  expect(r.status === 400, `hlasovka + obrázek (bez čtení obrázků) → 400 (${r.status} ${r.json && r.json.code})`);
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: 'tohle není base64!!' } });
  expect(r.status === 400, `nesmysl → 400 (${r.status})`);

  console.log('== výpadek přepisu: nic se neuloží, hláška bez adresy služby ==');
  const predZprav = (await inst.api('GET', `/api/kb/chat/detail/${chat.id}`, { token: A })).json.chat.messages.length;
  rezimPrepisu = 'down';
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: '', audio_base64: WEBM, audio_s: 7 } });
  rezimPrepisu = 'ok';
  expect(r.status === 502 && r.json.code === 'ai_hlas' && !/192\.168\.77|prepis-interni|host\.docker/.test(r.json.error || ''), `přepis neběží → 502 ai_hlas bez vnitřní adresy (${JSON.stringify(r.json)})`);
  const poZprav = (await inst.api('GET', `/api/kb/chat/detail/${chat.id}`, { token: A })).json.chat.messages.length;
  expect(poZprav === predZprav, `po neúspěšném přepisu se do rozhovoru nic nepřidalo (${predZprav} → ${poZprav})`);
  rezimPrepisu = 'prazdno';
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: '', audio_base64: WEBM, audio_s: 3 } });
  rezimPrepisu = 'ok';
  expect(r.status === 422 && r.json.code === 'ai_hlas_prazdny', `nahrávka bez řeči → 422 ai_hlas_prazdny (${r.status})`);
  rezimPrepisu = 'halucinace';
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: '', audio_base64: WEBM, audio_s: 3 } });
  rezimPrepisu = 'ok';
  expect(r.status === 422 && r.json.code === 'ai_hlas_prazdny', `typická halucinace Whisperu („www.hradeckralove.org“) = žádná řeč, ne nápad (${r.status})`);

  console.log('== log spotřeby: délka hlasovky a značka ==');
  const su = await inst.superuser();
  const log = (await inst.api('GET', `/api/collections/ai_chat_log/records?perPage=50&sort=-created&filter=${encodeURIComponent(`chat='${chat.id}'`)}`, { token: su })).json.items || [];
  expect(log.some((l) => Number(l.audio_ms) === 42000 && /#hlas/.test(l.model)), `ai_chat_log: audio_ms 42000 a značka #hlas (${log.map((l) => l.audio_ms + ' ' + l.model).join(' | ')})`);
  expect(log.some((l) => /#hlas-fail/.test(l.model) && l.stav === 'chyba'), 'nepovedený přepis je v logu jako #hlas-fail / chyba');

  console.log('== oprava přepisu (tužka v bublině): text se nahradí, nepotvrzené návrhy zmizí, model odpoví znovu ==');
  textyPrepisu.push('koupit pylu a zavolat Nováčkovi');
  fronta.push(nastroj('add_ideas', { items: [{ title: 'koupit pylu' }, { title: 'zavolat Nováčkovi' }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Poznámky z dílny', audio_base64: WEBM, audio_s: 9 } });
  let ch2 = r.json.chat;
  expect(r.status === 200 && ch2.lze_opravit === true && ch2.pending.length === 1, `hlasovka s nepotvrzenou kartou → přepis jde opravit (${ch2.lze_opravit}, čeká ${ch2.pending.length})`);
  fronta.push(nastroj('add_ideas', { items: [{ title: 'koupit pilu' }, { title: 'zavolat Novákovi' }] }));
  predV = volani.length;
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: ch2.id, text: 'koupit pilu a zavolat Novákovi' } });
  ch2 = r.json.chat || { messages: [], pending: [] };
  const uO = ch2.messages.filter((m) => m.role === 'user');
  expect(r.status === 200 && uO.length === 1 && uO[0].content === 'Poznámky z dílny\n\n[Přepis hlasovky]\nkoupit pilu a zavolat Novákovi', `oprava: doprovodný text a značka zůstaly, přepis nahrazen (${r.status} ${JSON.stringify((uO[0] || {}).content)})`);
  expect(!!uO[0] && !!uO[0].hlas && uO[0].hlas.s === 9 && uO[0].opraveno === true, 'opravená zpráva dál nese délku hlasovky a příznak opravy');
  expect(!JSON.stringify(ch2.messages).includes('pylu') && ch2.pending.length === 1 && /pilu/.test(JSON.stringify(ch2.pending)), 'stará odpověď i její karta jsou pryč, čeká jen nový návrh');
  const uModel = ((volani[predV] || {}).messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n---\n');
  expect(volani.length === predV + 1 && /\[Přepis hlasovky\]\nkoupit pilu a zavolat Novákovi/.test(uModel) && !/pylu/.test(JSON.stringify((volani[predV] || {}).messages)), 'model dostal jen opravený přepis — bez chybné verze a bez staré odpovědi');
  expect(ch2.lze_opravit === true && ch2.title === 'Poznámky z dílny', `po opravě jde opravit znovu; titulek z doprovodného textu zůstal (${ch2.title})`);
  const logO = (await inst.api('GET', `/api/collections/ai_chat_log/records?perPage=50&filter=${encodeURIComponent(`chat='${ch2.id}'`)}`, { token: su })).json.items || [];
  expect(logO.length === 2, `oprava je běžný tah AI: v logu původní i opravený (${logO.length})`);
  // první zpráva jen z hlasovky → titulek rozhovoru se přepočítá z opraveného textu
  textyPrepisu.push('zavolat mámě kvůli nedělnímu obědu');
  fronta.push({ content: 'Rozumím.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 4 } });
  fronta.push({ content: 'Opraveno.' });
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: r.json.chat.id, text: 'zavolat tátovi kvůli sobotnímu obědu a koupit dort' } });
  expect(r.status === 200 && r.json.chat.title === 'Hlasovka: zavolat tátovi kvůli sobotnímu obědu a' && r.json.chat.messages.at(-1).content === 'Opraveno.', `titulek rozhovoru z opraveného přepisu (${r.json.chat && r.json.chat.title})`);
  // z tahu už něco vzniklo → oprava nejde (409) a rozhovor zůstane, jak byl
  fronta.push({ content: 'Uloženo do zásobníku.' });
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: ch2.id, action_id: ch2.pending[0].id, ok: true } });
  expect(r.status === 200 && r.json.chat.lze_opravit === false, `po potvrzení karty už přepis opravit nejde (${r.status} ${r.json.chat && r.json.chat.lze_opravit})`);
  const predOdm = r.json.chat.messages.length;
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: ch2.id, text: 'něco úplně jiného' } });
  const poOdm = (await inst.api('GET', `/api/kb/chat/detail/${ch2.id}`, { token: A })).json.chat;
  expect(r.status === 409 && /další zprávu/.test(r.json.error || '') && poOdm.messages.length === predOdm && /koupit pilu/.test(poOdm.messages.find((m) => m.role === 'user').content), `potvrzená karta → 409 s vysvětlením, rozhovor beze změny (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
  textyPrepisu.push('udělej mi sumář dílny');
  fronta.push(nastroj('draft_text', { kind: 'summary', title: 'Sumář dílny', text: 'Sumář:\n- nic' }), { content: 'Sumář je v Dokumentech.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 6 } });
  const chD = r.json.chat;
  expect(r.status === 200 && chD.messages.some((m) => (m.karty || []).some((k) => k.type === 'koncept')) && chD.lze_opravit === false, `z hlasovky vznikl dokument → opravit nejde (${chD.lze_opravit})`);
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: chD.id, text: 'udělej mi sumář skladu' } });
  expect(r.status === 409, `uložený dokument → 409 (${r.status})`);
  // jen přepis POSLEDNÍ zprávy: psaná zpráva, cizí rozhovor, prázdná oprava
  fronta.push({ content: 'Ahoj.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ahoj' } });
  expect(r.json.chat.lze_opravit === false, 'psaná zpráva tužku nemá');
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: r.json.chat.id, text: 'Nazdar' } });
  expect(r.status === 400 && /přepis poslední hlasovky nebo fotky/.test(r.json.error || ''), `psaná zpráva → 400 (${r.status})`);
  textyPrepisu.push('poznámka k opravě');
  fronta.push({ content: 'Dobře.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 3 } });
  const chE = r.json.chat;
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: chE.id, text: '   ' } });
  expect(r.status === 400, `prázdná oprava → 400 (${r.status})`);
  await inst.register('cizi@example.com', { name: 'Cizí' });
  const CIZI = await inst.login('cizi@example.com');
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: CIZI, body: { chat_id: chE.id, text: 'cizí zásah' } });
  expect(r.status === 404 && (await inst.api('GET', `/api/kb/chat/detail/${chE.id}`, { token: A })).json.chat.messages.find((m) => m.role === 'user').content === '[Přepis hlasovky]\npoznámka k opravě', `cizí rozhovor → 404, nic se nezměnilo (${r.status})`);
  // pád modelu při opravě: opravená zpráva zůstane uložená (s hlasovkou), odpověď chybí → jde opravit znovu
  fronta.push({ status: 500 });
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: chE.id, text: 'poznámka k opravě číslo dvě' } });
  const poPadu = (await inst.api('GET', `/api/kb/chat/detail/${chE.id}`, { token: A })).json.chat;
  expect(r.status >= 500 && poPadu.messages.at(-1).role === 'user' && /číslo dvě/.test(poPadu.messages.at(-1).content) && !!poPadu.messages.at(-1).hlas && poPadu.lze_opravit === true, `model spadl → opravená zpráva uložená i s hlasovkou, oprava jde zopakovat (${r.status})`);

  console.log('== ranní porada a noční plánování nabízí hlasovku ==');
  // úvod skládá aplikace (1. 10. 2026) — výzva namluvit a volba s hlasovkou jsou na kartě, ne v promptu
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { mode: 'porada', message: '', context: { route: '/' } } });
  const uP = r.json.chat.messages.at(-1);
  expect(uP.content.startsWith('Namluvte hlasovku (tlačítko mikrofonu) a vypište všechno, co máte v hlavě') && JSON.stringify(uP.karty.find((k) => k.type === 'otazky').questions[0].options) === '["Pošlu hlasovku nebo nápady","Nic nemám, pokračuj"]' && !/fotku/.test(uP.content), `porada bez obrázků, s hlasovkou: výzva namluvit, volba „Pošlu hlasovku nebo nápady“ (${uP.content.slice(0, 60)})`);
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: '1) Pošlu hlasovku nebo nápady' } });
  expect(r.json.chat.messages.at(-1).content === 'Sem s tím, čekám na hlasovku nebo text.', `„Pošlu hlasovku…“ → aplikace čeká na hlasovku nebo text (${r.json.chat.messages.at(-1).content})`);
  fronta.push({ content: 'PORADA' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: '', audio_base64: WEBM, audio_s: 4 } });
  const sysP = systemZ(volani.at(-1));
  expect(r.status === 200 && /přepis obrázku, přepis hlasovky nebo text/.test(sysP) && /RANNÍ PORADA/.test(sysP), 'hlasovka po výzvě → model s porada promptem; třídění počítá s přepisem hlasovky');

  console.log('== stará cesta /advisor (Nahrát zvuk) jde přes týž přepis ==');
  const predP = prepisy.length;
  r = await inst.api('POST', '/api/kb/advisor', { token: A, body: { mode: 'transcribe', audio_base64: WEBM, filename: 'porada.webm' } });
  expect(r.status === 200 && typeof r.json.text === 'string' && prepisy.length === predP + 1 && /\.webm$/.test(prepisy.at(-1).soubor) && prepisy.at(-1).auth === 'Bearer tajny-prepis', `/advisor transcribe → KB_TRANSCRIBE_* i bez obecné AI (${r.status} ${JSON.stringify(r.json).slice(0, 80)})`);

  console.log('== váha hlasovky 2 v hodinovém stropu; vadná nahrávka strop NEubírá ==');
  const inst2 = await H.startInstance({ slug: 'hlas-brzda', addHostGateway: true, env: Object.assign({}, CHAT, PREPIS, { KB_AI_MAX_PER_HOUR: 3 }) });
  await inst2.register('b@example.com', { name: 'Bára' });
  const B = await inst2.login('b@example.com');
  for (let i = 0; i < 4; i++) await inst2.api('POST', '/api/kb/chat', { token: B, body: { message: '', audio_base64: PNG } });
  fronta.push({ content: 'ok' });
  r = await inst2.api('POST', '/api/kb/chat', { token: B, body: { message: '', audio_base64: WEBM, audio_s: 4 } });
  expect(r.status === 200, `4× vadná nahrávka strop neubrala, hlasovka projde (${r.status})`);
  r = await inst2.api('POST', '/api/kb/chat', { token: B, body: { message: '', audio_base64: WEBM, audio_s: 4 } });
  expect(r.status === 429 && r.json.code === 'ai_rate', `druhá hlasovka při stropu 3 → 429 (váha 2) (${r.status})`);

  console.log('== bez přepisu: žádné hlasovky ==');
  const inst3 = await H.startInstance({ slug: 'hlas-bez', addHostGateway: true, env: CHAT });
  await inst3.register('c@example.com', { name: 'Cyril' });
  const C = await inst3.login('c@example.com');
  expect(!((await inst3.api('GET', '/api/kb/config')).json.ai_modes || []).includes('chat_voice'), 'bez přepisu /config chat_voice NEhlásí');
  r = await inst3.api('POST', '/api/kb/chat', { token: C, body: { message: '', audio_base64: WEBM } });
  expect(r.status === 400 && r.json.code === 'ai_voice_off', `hlasovka bez přepisu → 400 ai_voice_off (${r.status})`);
  r = await inst3.api('POST', '/api/kb/chat', { token: C, body: { mode: 'nocni', message: '' } });
  const uN3 = r.json.chat.messages.at(-1);
  expect(uN3.karty.find((k) => k.type === 'otazky').questions[0].options[0] === 'Napíšu nápady' && !/hlasovku/.test(uN3.content), 'noční bez obrázků i hlasovek: jen „Napíšu nápady“');

  console.log('== obrázky + hlasovky: výzva s obojím; moc velká nahrávka ==');
  const vize = await H.httpMock((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: { role: 'assistant', content: 'x' }, done: true })); });
  const inst4 = await H.startInstance({ slug: 'hlas-obr', addHostGateway: true, env: Object.assign({}, CHAT, PREPIS, { KB_VISION_PROVIDER: 'ollama', KB_VISION_URL: vize.base, KB_VISION_MODEL: 'vize-a', KB_CHAT_MAX_AUDIO_MB: 0.05 }) });
  await inst4.register('d@example.com', { name: 'Dan' });
  const D = await inst4.login('d@example.com');
  r = await inst4.api('POST', '/api/kb/chat', { token: D, body: { mode: 'porada', message: '' } });
  const uP4 = r.json.chat.messages.at(-1);
  expect(uP4.content.startsWith('Vložte fotku poznámek (Ctrl+V, přetažením, nebo tlačítkem se sponkou / fotoaparátem na telefonu), namluvte hlasovku (tlačítko mikrofonu) a vypište všechno') && uP4.karty.find((k) => k.type === 'otazky').questions[0].options[0] === 'Pošlu fotku, hlasovku nebo nápady', 'obrázky + hlasovky: výzva s fotkou i hlasovkou');
  r = await inst4.api('POST', '/api/kb/chat', { token: D, body: { message: '', audio_base64: WEBM, image_base64: JPG } });
  expect(r.status === 400 && r.json.code === 'ai_hlas_typ', `hlasovka + obrázek v jedné zprávě → 400 ai_hlas_typ (${r.status} ${r.json && r.json.code})`);
  const velka = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(80000, 1)]).toString('base64');
  r = await inst4.api('POST', '/api/kb/chat', { token: D, body: { message: '', audio_base64: velka } });
  expect(r.status === 400 && r.json.code === 'ai_hlas_velka', `nahrávka nad KB_CHAT_MAX_AUDIO_MB → 400 ai_hlas_velka (${r.status})`);

  console.log('== oprava přepisu fotky: stejná tužka, náhled zůstane ==');
  fronta.push(nastroj('ask_user', { questions: [{ text: 'Kam s tím?', options: ['Do zásobníku', 'Do projektu'] }] }));
  r = await inst4.api('POST', '/api/kb/chat', { token: D, body: { message: '', image_base64: JPG, nahled_base64: JPG } });
  const chF = r.json.chat || { messages: [] };
  const uF = chF.messages.find((m) => m.role === 'user') || {};
  expect(r.status === 200 && uF.content === '[Přepis obrázku]\nx' && !!(uF.obrazek && uF.obrazek.nahled) && chF.lze_opravit === true, `fotka: přepis s náhledem jde opravit (${r.status} ${JSON.stringify(uF.content)})`);
  fronta.push({ content: 'Rozumím, pila a hřebíky.' });
  predV = volani.length;
  r = await inst4.api('POST', '/api/kb/chat/oprav', { token: D, body: { chat_id: chF.id, text: '- koupit pilu\n- hřebíky' } });
  const uF2 = ((r.json.chat || {}).messages || []).find((m) => m.role === 'user') || {};
  expect(r.status === 200 && uF2.content === '[Přepis obrázku]\n- koupit pilu\n- hřebíky' && !!(uF2.obrazek && uF2.obrazek.nahled) && uF2.opraveno === true && r.json.chat.title === 'Obrázek: koupit pilu', `oprava přepisu fotky: text nahrazen, náhled i titulek sedí (${r.status} ${r.json.chat && r.json.chat.title})`);
  expect(volani.length === predV + 1 && !r.json.chat.messages.some((m) => (m.karty || []).some((k) => k.type === 'otazky')), 'fotka se znovu nepřepisovala (jen 1 volání chatu) a stará otázka je pryč');

  // fotka + PDF v jedné zprávě: oprava přepisu fotky nesmí uříznout text PDF (dřív se celá zpráva zkrátila na 8000 znaků)
  const stranyPdf = [1, 2, 3].map((n) => ({ page: n, text: `Strana ${n}: ` + 'text smlouvy '.repeat(800) + `KONEC-STRANY-${n}` }));
  fronta.push({ content: 'Mám fotku i smlouvu.' });
  r = await inst4.api('POST', '/api/kb/chat', { token: D, body: { message: '', image_base64: JPG, nahled_base64: JPG, pdf_text: stranyPdf, pdf_name: 'smlouva.pdf', pdf_pages: 3 } });
  const chFP = r.json.chat || { messages: [] };
  const delkaPred = ((chFP.messages.find((m) => m.role === 'user') || {}).content || '').length;
  fronta.push({ content: 'Opraveno, smlouvu mám dál celou.' });
  predV = volani.length;
  r = await inst4.api('POST', '/api/kb/chat/oprav', { token: D, body: { chat_id: chFP.id, text: '- podepsat smlouvu do pátku' } });
  const uFP = ((r.json.chat || {}).messages || []).find((m) => m.role === 'user') || {};
  const kModeluFP = (((volani[predV] || {}).messages || []).filter((m) => m.role === 'user').pop() || {}).content || '';
  expect(r.status === 200 && delkaPred > 30000 && /^\[Přepis obrázku\]\n- podepsat smlouvu do pátku\n\n\[Text z PDF: smlouva\.pdf/.test(uFP.content || '') && /KONEC-STRANY-3/.test(uFP.content || '') && !!uFP.pdf && uFP.pdf.pages === 3 && !!(uFP.obrazek && uFP.obrazek.nahled),
    `fotka + PDF: po opravě přepisu zůstal text PDF celý (${delkaPred} → ${(uFP.content || '').length} znaků), příznak PDF i náhled`);
  expect(/KONEC-STRANY-3/.test(kModeluFP) && /podepsat smlouvu do pátku/.test(kModeluFP), 'model dostal opravený přepis i celý text PDF');

  console.log('== obecná AI openai: přepis tou službou; vlastní adresa jinde = bez tokenu ==');
  const inst5 = await H.startInstance({ slug: 'hlas-openai', addHostGateway: true, env: Object.assign({}, CHAT, { KB_AI_PROVIDER: 'openai', KB_AI_URL: whisper.base + '/v1', KB_AI_MODEL: 'gpt-4o-mini', KB_AI_TOKEN: 'sk-hlavni' }) });
  await inst5.register('e@example.com', { name: 'Eva' });
  const E = await inst5.login('e@example.com');
  expect(((await inst5.api('GET', '/api/kb/config')).json.ai_modes || []).includes('chat_voice'), 'služba openai s whisper-1 v /models → chat_voice');
  fronta.push({ content: 'ok' });
  r = await inst5.api('POST', '/api/kb/chat', { token: E, body: { message: '', audio_base64: WEBM, audio_s: 3 } });
  expect(r.status === 200 && prepisy.at(-1).auth === 'Bearer sk-hlavni' && prepisy.at(-1).model === 'whisper-1' && !prepisy.at(-1).vad, `přepis na /audio/transcriptions téže služby s jejím klíčem, bez vad_filter (${JSON.stringify(prepisy.at(-1))})`);
  const inst6 = await H.startInstance({ slug: 'hlas-jinde', addHostGateway: true, env: Object.assign({}, CHAT, { KB_AI_PROVIDER: 'openai', KB_AI_URL: whisper.base + '/v1', KB_AI_MODEL: 'gpt-4o-mini', KB_AI_TOKEN: 'sk-hlavni', KB_AI_TRANSCRIBE_URL: whisper2.base + '/v1/audio/transcriptions' }) });
  await inst6.register('f@example.com', { name: 'Filip' });
  const F = await inst6.login('f@example.com');
  fronta.push({ content: 'ok' });
  const pred6 = whisper2.pozadavky.length;
  r = await inst6.api('POST', '/api/kb/chat', { token: F, body: { message: '', audio_base64: WEBM, audio_s: 3 } });
  const q6 = whisper2.pozadavky.slice(pred6).find((q) => q.url.startsWith('/v1/audio/transcriptions'));
  expect(r.status === 200 && !!q6 && !q6.headers.authorization, `KB_AI_TRANSCRIBE_URL končící /audio/transcriptions = OpenAI tvar; jiný původ → klíč k AI nedostane (${r.status}, auth=${q6 && q6.headers.authorization})`);
  const inst7 = await H.startInstance({ slug: 'hlas-none', addHostGateway: true, env: Object.assign({}, CHAT, { KB_AI_PROVIDER: 'openai', KB_AI_URL: whisper.base + '/v1', KB_AI_MODEL: 'gpt-4o-mini', KB_AI_TOKEN: 'sk-hlavni', KB_TRANSCRIBE_PROVIDER: 'none' }) });
  const m7 = (await inst7.api('GET', '/api/kb/config')).json.ai_modes || [];
  expect(!m7.includes('chat_voice') && !m7.includes('transcribe'), `KB_TRANSCRIBE_PROVIDER=none vypne přepis i hlasovky (${JSON.stringify(m7)})`);

  console.log('== /config: strop velikosti nahrávky pro klienta ==');
  expect(cfg.chat_voice_max_mb === 3 && (await inst4.api('GET', '/api/kb/config')).json.chat_voice_max_mb === 0.05, `chat_voice_max_mb: výchozí 3, jinak podle KB_CHAT_MAX_AUDIO_MB (${cfg.chat_voice_max_mb})`);

  console.log('== cloudová cesta: provider api → přepis přes bránu (/v1/advisor, mode transcribe) ==');
  const brana = await H.httpMock(branaHandler);
  const BRANA = { KB_AI_PROVIDER: 'api', KB_AI_URL: brana.base + '/v1/advisor', KB_AI_TOKEN: 'kb_test_token' };
  const inst8 = await H.startInstance({ slug: 'hlas-brana', addHostGateway: true, env: Object.assign({}, CHAT, BRANA, { KB_AI_MAX_PER_HOUR: 600 }) });
  await inst8.register('g@example.com', { name: 'Gustav' });
  const G = await inst8.login('g@example.com');
  const m8 = (await inst8.api('GET', '/api/kb/config')).json.ai_modes || [];
  expect(m8.includes('transcribe') && m8.includes('chat_voice'), `brána s módem transcribe → chat_voice (${JSON.stringify(m8)})`);
  fronta.push({ content: 'Rozumím.' });
  let predB = branaPozadavky.length;
  predV = volani.length;
  r = await inst8.api('POST', '/api/kb/chat', { token: G, body: { message: '', audio_base64: OGG, audio_s: 12 } });
  const qB = branaPozadavky.slice(predB).find((q) => q.mode === 'transcribe') || {};
  expect(r.status === 200 && qB.token === 'kb_test_token' && qB.filename === 'hlasovka.ogg' && qB.lang === 'cs' && qB.audio === OGG.length, `hlasovka přes bránu: token v hlavičce, mode transcribe, hlasovka.ogg, jazyk (${r.status} ${JSON.stringify(qB)})`);
  expect(/\[Přepis hlasovky\]\nobjednat barvy a zavolat klientovi/.test(((volani[predV] || {}).messages || []).filter((m) => m.role === 'user').pop().content), 'model dostal přepis z brány se značkou');
  // vyčerpaná měsíční kvóta brány: 429 s textem brány (ne „hodinový strop“ — ten má kód ai_rate), nic se neuloží
  const chB = r.json.chat;
  rezimBrany = 'kvota';
  r = await inst8.api('POST', '/api/kb/chat', { token: G, body: { chat_id: chB.id, message: '', audio_base64: OGG, audio_s: 5 } });
  rezimBrany = 'ok';
  expect(r.status === 429 && r.json.code === 'ai_hlas' && /měsíční limit/.test(r.json.error || '') && !r.json.ulozeno, `kvóta brány → 429 ai_hlas s textem brány, bez příznaku ulozeno (${JSON.stringify(r.json)})`);
  expect((await inst8.api('GET', `/api/kb/chat/detail/${chB.id}`, { token: G })).json.chat.messages.length === chB.messages.length, 'po odmítnutí bránou se do rozhovoru nic nepřidalo');
  // zkušební instance: strop zkušebky se řekne jako strop ZKUŠEBKY
  const inst9 = await H.startInstance({ slug: 'hlas-zkusebka', addHostGateway: true, env: Object.assign({}, CHAT, BRANA, { KB_TRIAL_UNTIL: '2099-12-31' }) });
  await inst9.register('h@example.com', { name: 'Hana' });
  const HN = await inst9.login('h@example.com');
  rezimBrany = 'kvota';
  r = await inst9.api('POST', '/api/kb/chat', { token: HN, body: { message: '', audio_base64: OGG, audio_s: 5 } });
  rezimBrany = 'ok';
  expect(r.status === 429 && r.json.code === 'ai_hlas' && /zkušeb/i.test(r.json.error || '') && !/Kontaktujte poskytovatele/.test(r.json.error || ''), `zkušebka: kvóta brány → text o zkušební verzi (${JSON.stringify(r.json)})`);

  console.log('== příznak ulozeno: nahrávku nenabízet k opakování jen tehdy, když je přepis v rozhovoru ==');
  textyPrepisu.push('poznámka před pádem modelu');
  fronta.push({ status: 500 });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 5 } });
  expect(r.status >= 500 && r.json.ulozeno === true, `přepis proběhl, selhal až model → odpověď nese ulozeno: true (${r.status} ${JSON.stringify(r.json)})`);
  const seznamPoPadu = (await inst.api('GET', '/api/kb/chat/seznam', { token: A })).json.chats || [];
  const chPad = (await inst.api('GET', `/api/kb/chat/detail/${seznamPoPadu[0].id}`, { token: A })).json.chat;
  expect(/poznámka před pádem modelu/.test(chPad.messages.at(-1).content) && chPad.messages.at(-1).role === 'user', 'a přepis v rozhovoru opravdu je (zpráva uživatele uložená)');
  rezimPrepisu = 'down';
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 5 } });
  rezimPrepisu = 'ok';
  expect(r.status === 502 && r.json.code === 'ai_hlas' && r.json.ulozeno === undefined, `selhal přepis → bez ulozeno (nahrávka zůstane k opakování) (${JSON.stringify(r.json)})`);

  console.log('== oprava přepisu: strop těla, dřívější historie zůstane, při odmítnutí se nic nezmění ==');
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: chE.id, text: 'x'.repeat(100 * 1024) } });
  expect(r.status === 413, `/chat/oprav se 100 kB → 413 (strop těla jako u /chat/potvrdit) (${r.status})`);
  // opravovaná hlasovka NENÍ první zprávou: všechno před ní musí zůstat (mutace „zahoď historii“ dřív prošla zeleně)
  fronta.push({ content: 'Dobrý den.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Nejdřív psaná zpráva' } });
  const chH = r.json.chat;
  textyPrepisu.push('druhá zpráva hlasem s chibou');
  fronta.push({ content: 'Odpověď na hlasovku.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chH.id, message: '', audio_base64: WEBM, audio_s: 6 } });
  fronta.push({ content: 'Odpověď na opravenou hlasovku.' });
  predV = volani.length;
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: chH.id, text: 'druhá zpráva hlasem bez chyby' } });
  const mH = ((r.json.chat || {}).messages || []).filter((m) => m.role !== 'tool');
  expect(r.status === 200 && mH.length === 4 && mH[0].content === 'Nejdřív psaná zpráva' && mH[1].content === 'Dobrý den.' && /bez chyby/.test(mH[2].content) && mH[3].content === 'Odpověď na opravenou hlasovku.' && r.json.chat.title === chH.title,
    `oprava druhé zprávy: dřívější zpráva i odpověď zůstaly, titulek beze změny (${mH.map((m) => String(m.content).slice(0, 22)).join(' | ')})`);
  const kModeluH = JSON.stringify((volani[predV] || {}).messages || []);
  expect(/Nejdřív psaná zpráva/.test(kModeluH) && /Dobrý den\./.test(kModeluH) && !/s chibou/.test(kModeluH) && !/Odpověď na hlasovku\./.test(kModeluH), 'model dostal dřívější historii, opravený přepis — a ne chybnou verzi ani starou odpověď');
  // odmítnutá oprava (hodinový strop) nechá rozhovor přesně tak, jak byl — původní přepis i odpověď
  textyPrepisu.push('hlasovka u stropu');
  fronta.push({ content: 'Odpověď u stropu.' });
  const inst10 = await H.startInstance({ slug: 'hlas-vaha', addHostGateway: true, env: Object.assign({}, CHAT, PREPIS, { KB_AI_MAX_PER_HOUR: 5 }) });
  await inst10.register('i@example.com', { name: 'Ivo' });
  const I = await inst10.login('i@example.com');
  r = await inst10.api('POST', '/api/kb/chat', { token: I, body: { message: '', audio_base64: WEBM, audio_s: 4 } }); // 2 z 5
  const chS = r.json.chat;
  fronta.push({ content: 'ok' });
  r = await inst10.api('POST', '/api/kb/chat', { token: I, body: { message: '', audio_base64: WEBM, audio_s: 4 } }); // 4 z 5
  expect(r.status === 200, `strop 5: druhá hlasovka ještě projde (váha 2 + 2) (${r.status})`);
  fronta.push({ content: 'ok' });
  r = await inst10.api('POST', '/api/kb/chat', { token: I, body: { message: 'psaná' } }); // 5 z 5
  expect(r.status === 200, `strop 5: po dvou hlasovkách zbývá přesně 1 psaný tah (váha hlasovky je 2, ne 3) (${r.status})`);
  r = await inst10.api('POST', '/api/kb/chat', { token: I, body: { message: 'další psaná' } });
  expect(r.status === 429 && r.json.code === 'ai_rate', `strop 5: další tah už ne (váha hlasovky je 2, ne 1) (${r.status})`);
  r = await inst10.api('POST', '/api/kb/chat/oprav', { token: I, body: { chat_id: chS.id, text: 'oprava po vyčerpání stropu' } });
  const poStropu = (await inst10.api('GET', `/api/kb/chat/detail/${chS.id}`, { token: I })).json.chat;
  expect(r.status === 429 && poStropu.messages.length === chS.messages.length && /hlasovka u stropu/.test(poStropu.messages[0].content) && poStropu.messages.at(-1).content === 'Odpověď u stropu.', `oprava odmítnutá stropem → původní přepis i odpověď zůstaly (${r.status})`);

  console.log('== neznámý mode není průvodce: předkontroly i váha platí (dřív mode:"x" dal hlasovce váhu 1) ==');
  const inst11 = await H.startInstance({ slug: 'hlas-mode', addHostGateway: true, env: Object.assign({}, CHAT, PREPIS, { KB_AI_MAX_PER_HOUR: 3 }) });
  await inst11.register('j@example.com', { name: 'Jan' });
  const J = await inst11.login('j@example.com');
  r = await inst11.api('POST', '/api/kb/chat', { token: J, body: { mode: 'x', message: '', audio_base64: PNG } });
  expect(r.status === 400 && r.json.code === 'ai_hlas_typ', `mode "x" + vadná nahrávka → 400 z předkontroly (${r.status} ${r.json && r.json.code})`);
  fronta.push({ content: 'ok' });
  r = await inst11.api('POST', '/api/kb/chat', { token: J, body: { mode: 'x', message: '', audio_base64: WEBM, audio_s: 3 } });
  expect(r.status === 200 && /\[Přepis hlasovky\]/.test(r.json.chat.messages[0].content), `mode "x" + hlasovka se zpracuje jako běžná zpráva (${r.status})`);
  r = await inst11.api('POST', '/api/kb/chat', { token: J, body: { mode: 'x', message: '', audio_base64: WEBM, audio_s: 3 } });
  expect(r.status === 429 && r.json.code === 'ai_rate', `…a ubere váhu 2: druhá při stropu 3 → 429 (${r.status})`);

  console.log('== délka od klienta: nesmysl neshodí zápis do logu (a s ním započtení tahu) ==');
  textyPrepisu.push('hlasovka s nesmyslnou délkou');
  fronta.push({ content: 'ok' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 1e16 } });
  const logN = (await inst.api('GET', `/api/collections/ai_chat_log/records?perPage=5&filter=${encodeURIComponent(`chat='${(r.json.chat || {}).id}'`)}`, { token: su })).json.items || [];
  expect(r.status === 200 && logN.length === 1 && Number(logN[0].audio_ms) === 3600000 && r.json.chat.messages[0].hlas.s === 3600, `audio_s 1e16 → řádek logu existuje, délka omezená na hodinu (${logN.length} ř., ${logN[0] && logN[0].audio_ms})`);
  fronta.push({ content: 'ok' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 'abc' } });
  expect(r.status === 200 && r.json.chat.messages[0].hlas.s === 0, `audio_s "abc" → 0 (${r.status})`);

  console.log('== dlouhý přepis (soubor na desítky minut): zkrácení se přizná, neztratí se potichu ==');
  textyPrepisu.push('slovo '.repeat(1700) + 'ÚPLNÝ-KONEC');
  fronta.push({ content: 'ok' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 0 } });
  const dlouhy = ((r.json.chat || {}).messages || [])[0] || {};
  expect(r.status === 200 && dlouhy.content.length <= 8000 && /\[… nahrávka pokračuje, zbytek přepisu se do zprávy nevešel\]$/.test(dlouhy.content) && !/ÚPLNÝ-KONEC/.test(dlouhy.content), `přepis nad 8000 znaků končí poznámkou o zkrácení (${dlouhy.content.length} znaků)`);
  textyPrepisu.push('krátká hlasovka');
  fronta.push({ content: 'ok' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', audio_base64: WEBM, audio_s: 2 } });
  expect(r.json.chat.messages[0].content === '[Přepis hlasovky]\nkrátká hlasovka', 'běžná hlasovka je beze změny (žádná poznámka)');

  console.log('== /advisor transcribe: strop i bez obecné AI, výpadek bez adresy služby ==');
  const inst12 = await H.startInstance({ slug: 'hlas-advisor', addHostGateway: true, env: Object.assign({}, PREPIS, { KB_AI_MAX_TRANSCRIBE_PER_HOUR: 2, KB_UVODNI_MAPA: 0 }) });
  await inst12.register('k@example.com', { name: 'Karel' });
  const K = await inst12.login('k@example.com');
  const stavy = [];
  for (let i = 0; i < 3; i++) stavy.push((await inst12.api('POST', '/api/kb/advisor', { token: K, body: { mode: 'transcribe', audio_base64: WEBM, filename: 'a.webm' } })).status);
  expect(stavy.join(',') === '200,200,429', `vlastní přepisovač bez obecné AI: 3. přepis za hodinu při stropu 2 → 429 (${stavy.join(',')})`);
  rezimPrepisu = 'down';
  r = await inst.api('POST', '/api/kb/advisor', { token: A, body: { mode: 'transcribe', audio_base64: WEBM, filename: 'a.webm' } });
  rezimPrepisu = 'ok';
  expect(r.status === 502 && r.json.error === 'Přepisovací služba je nedostupná.' && !/host\.docker|192\.168|http|whisper/i.test(JSON.stringify(r.json)), `/advisor: výpadek přepisu → obecná hláška bez adresy služby (${JSON.stringify(r.json)})`);
}, { nazev: 'AI-HLASOVKA' });
