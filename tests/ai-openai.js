// Provider „openai" — připojení k jakémukoli OpenAI-kompatibilnímu rozhraní
// (OpenAI, OpenRouter, Groq, vLLM, LM Studio…). Do v0.39 uměl killBottleneck
// jen tvar volání Ollamy, takže se k běžným poskytovatelům nedalo připojit —
// hlášeno z bety (Discord, 20. 8. 2026).
//
// ⚠️ Mock se schválně chová jako SKUTEČNÁ služba, ne jako ochotný dvojník:
// vrací přesný tvar {choices:[{message:{content}}]}, na cizí klíč 401, na
// neznámý parametr 400 a přepis přijímá VÝHRADNĚ jako multipart. Dvojník,
// který spolkne cokoli, by „dokázal" cestu, která proti OpenAI vždycky padá.
//
// Ostrý protějšek téhle sady: běh proti opravdové službě (ollama vystavuje
// /v1, faster-whisper /v1/audio/transcriptions) — mock hlídá chybové stavy,
// které se na živé službě vyrábějí špatně.
const http = require('http');
const { execSync } = require('child_process');
const NAME = 'flowmap-e2e-openai';
const PORT = 20558;
const MOCK_PORT = 20559;
const BASE = `http://127.0.0.1:${PORT}`;
const KLIC = 'testovaci-klic-bez-prefixu';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// co má mock předstírat: 'ok' | 'bezFormatu' | 'prazdno' | 'bezSeznamuModelu'
//                       | 'htmlChyba' | 'nezmocnen' | 'preteceno'
let rezim = 'ok';
let umiPrepis = true;   // je v seznamu modelů něco přepisovacího?
let chatVolani = [];       // těla všech /chat/completions v tomhle běhu
let prepisVolani = [];     // syrová těla /audio/transcriptions
let vlastniPrepisVolani = 0;   // dotazy na zvlášť nastavenou adresu přepisu

const mock = http.createServer((req, res) => {
  let raw = Buffer.alloc(0);
  req.on('data', (ch) => { raw = Buffer.concat([raw, ch]); });
  req.on('end', () => {
    const posli = (code, obj) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(obj));
    };
    const klicOk = (req.headers.authorization || '') === `Bearer ${KLIC}`;

    if (req.url.startsWith('/v1/models')) {
      if (rezim === 'bezSeznamuModelu') return posli(404, { error: { message: 'Not found' } });
      if (!klicOk) return posli(401, { error: { message: 'Incorrect API key provided' } });
      const modely = [{ id: 'kb-test-model', object: 'model' }];
      if (umiPrepis) modely.push({ id: 'whisper-1', object: 'model' });
      return posli(200, { object: 'list', data: modely });
    }

    if (req.url.startsWith('/vlastni-prepis')) {
      vlastniPrepisVolani += 1;
      return posli(200, { text: 'z vlastní adresy' });
    }

    if (req.url.startsWith('/v1/audio/transcriptions')) {
      const text = raw.toString('latin1');
      prepisVolani.push({ contentType: req.headers['content-type'] || '', text: text });
      if (!klicOk) return posli(401, { error: { message: 'Incorrect API key provided' } });
      // skutečná služba bere VÝHRADNĚ multipart se souborem
      if (!/^multipart\/form-data/.test(req.headers['content-type'] || '')) {
        return posli(415, { error: { message: 'Expected multipart/form-data' } });
      }
      if (!/name="file"; filename=/.test(text)) {
        return posli(400, { error: { message: 'Missing file part' } });
      }
      return posli(200, { text: 'nadiktovaný text' });
    }

    if (req.url.startsWith('/v1/chat/completions')) {
      let body = {}; try { body = JSON.parse(raw.toString('utf8')); } catch { /* nevalidní */ }
      chatVolani.push(body);
      if (!klicOk) return posli(401, { error: { message: 'Incorrect API key provided' } });
      if (rezim === 'bezFormatu' && body.response_format) {
        return posli(400, { error: { message: "Unsupported parameter: 'response_format' is not supported with this model." } });
      }
      if (rezim === 'nezmocnen') return posli(401, { error: { message: 'Incorrect API key provided: NEPLATNY-TESTOVACI-KLIC-1234' } });
      if (rezim === 'preteceno') return posli(429, { error: { message: 'Rate limit reached' } });
      if (rezim === 'htmlChyba') {
        // skutečná proxy (Cloudflare, nginx) vrací HTML stránku, ne JSON
        res.statusCode = 502;
        res.setHeader('Content-Type', 'text/html');
        return res.end('<html><body>' + 'A'.repeat(4000) + '</body></html>');
      }
      if (rezim === 'prazdno') {
        // uvažující model, který spotřeboval celý strop na přemýšlení
        return posli(200, { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '' } }] });
      }
      const prompt = JSON.stringify(body.messages || []);
      // Ranní shrnutí si říká o PROSTÝ TEXT, ne o JSON — skutečný model by taky
      // odpověděl větou. Kdyby mock vracel vždy JSON, sada by tuhle cestu
      // „ověřila" tvarem, který v provozu nenastane.
      if (/PROST\u00dd TEXT|PLAIN TEXT/.test(prompt)) {
        return posli(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Dneska tě čeká jedna věc po termínu — začni fakturou a máš klid.' } }] });
      }
      // pozor: prompt je uvnitř JSONu, uvozovky jsou escapované — hledat holé slovo
      const obsah = /questions/.test(prompt)
        ? JSON.stringify({ questions: ['Kolik lidí?', 'Do kdy?', 'Za kolik?'] })
        : JSON.stringify({ nodes: [
          { id: 'root', title: 'Vánoční večírek', description: '', parentId: null },
          { id: 'n1', title: 'Zamluvit sál', description: 'Do konce října.', parentId: 'root' },
          { id: 'n2', title: 'Objednat catering', description: 'Podle počtu lidí.', parentId: 'root' },
        ] });
      return posli(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: obsah } }] });
    }
    posli(404, { error: { message: 'Not found' } });
  });
});

const api = async (path, { token, body, method } = {}) => {
  const res = await fetch(BASE + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

(async () => {
  try {
    await new Promise((r) => mock.listen(MOCK_PORT, '0.0.0.0', r));
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    const URL_MOCK = `http://host.docker.internal:${MOCK_PORT}/v1`;
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 --add-host=host.docker.internal:host-gateway \
      -e KB_AI_PROVIDER=openai -e KB_AI_URL=${URL_MOCK} -e KB_AI_TOKEN=${KLIC} \
      -e KB_AI_MODEL=kb-test-model -e KB_UVODNI_MAPA=0 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    await api('/api/collections/users/records', { body: { email: 'a@x.cz', password: 'testheslo123', passwordConfirm: 'testheslo123' } });
    const T = (await api('/api/collections/users/auth-with-password', { body: { identity: 'a@x.cz', password: 'testheslo123' } })).json.token;

    console.log('== zapnutá AI a nabídnuté funkce ==');
    let cfg = await api('/api/kb/config');
    expect(cfg.json.ai_provider === 'openai' && cfg.json.ai_enabled === true, `provider openai je zapnutý (${cfg.json.ai_provider})`);
    expect(cfg.json.ai_healthy === true, 'služba odpovídá → ai_healthy=true');
    expect((cfg.json.ai_modes || []).includes('transcribe'),
      `diktování se nabízí bez zvlášť nastavené adresy přepisu (${(cfg.json.ai_modes || []).join(',')})`);

    console.log('== návrh mapy skutečným tvarem OpenAI ==');
    chatVolani = [];
    let r = await api('/api/kb/advisor', { token: T, body: { mode: 'generate', goal: 'Vánoční večírek', scope: 'stručná' } });
    expect(r.status === 200 && (r.json.nodes || []).length === 3, `mapa se vygenerovala (${r.status}, uzlů ${(r.json.nodes || []).length})`);
    expect(chatVolani.length === 1 && (chatVolani[0] || {}).model === 'kb-test-model', 'volání šlo na /chat/completions se zadaným modelem');
    expect(!!(chatVolani[0] || {}).response_format, 'poprvé se ptáme na strukturovaný JSON (response_format)');

    console.log('== otázky a chat nad mapou ==');
    r = await api('/api/kb/advisor', { token: T, body: { mode: 'questions', goal: 'Vánoční večírek' } });
    expect(r.status === 200 && (r.json.questions || []).length === 3, `otázky dorazily (${r.status})`);
    r = await api('/api/kb/advisor', { token: T, body: { mode: 'chat', message: 'Co chybí?', map: { nodes: [{ id: 'root', title: 'X', status: 'todo' }] } } });
    expect(r.status === 200 && typeof r.json.reply === 'string', `chat odpověděl (${r.status})`);

    console.log('== služba neumí response_format → druhý pokus bez něj ==');
    rezim = 'bezFormatu';
    chatVolani = [];
    r = await api('/api/kb/advisor', { token: T, body: { mode: 'generate', goal: 'Vánoční večírek', scope: 'stručná' } });
    expect(r.status === 200 && (r.json.nodes || []).length === 3, `mapa se vygenerovala i tak (${r.status})`);
    expect(chatVolani.length === 2, `proběhly právě dva pokusy (${chatVolani.length})`);
    // ⚠️ bez téhle opatrnosti by pád jedné kontroly ukončil celou sadu a zbytek
    // by se vůbec neproběhl — sada by pak o zbylých oblastech mlčela
    const druhy = chatVolani[1] || {};
    expect(!druhy.response_format && druhy.temperature === undefined,
      'druhý pokus je holý — bez response_format i bez temperature');
    expect(druhy.max_completion_tokens > 0, 'druhý pokus posílá max_completion_tokens (uvažující modely)');
    rezim = 'ok';

    console.log('== uvažující model spotřebuje strop a nic nenapíše ==');
    rezim = 'prazdno';
    r = await api('/api/kb/advisor', { token: T, body: { mode: 'generate', goal: 'Vánoční večírek' } });
    expect(r.status === 502 && /přemýšlení/.test(r.json.error || ''),
      `uživatel se dozví PROČ nic nepřišlo (${r.status}: ${(r.json.error || '').slice(0, 70)})`);
    rezim = 'ok';

    console.log('== diktování jde na službu jako multipart ==');
    prepisVolani = [];
    const wav = Buffer.from('RIFF....WAVEfmt zkusebni-nahravka').toString('base64');
    r = await api('/api/kb/advisor', { token: T, body: { mode: 'transcribe', audio_base64: wav, filename: 'nahravka.webm' } });
    expect(r.status === 200 && r.json.text === 'nadiktovaný text', `přepis se vrátil (${r.status}: ${JSON.stringify(r.json).slice(0, 80)})`);
    expect(prepisVolani.length === 1 && /^multipart\/form-data/.test((prepisVolani[0] || {}).contentType || ''),
      'odešel skutečný multipart, ne JSON s base64');
    expect(/filename="[^"]+\.webm"/.test((prepisVolani[0] || {}).text || ''),
      'přípona nahrávky se zachovala (podle ní služba pozná formát)');
    expect(/zkusebni-nahravka/.test((prepisVolani[0] || {}).text || ''), 've zprávě je dekódovaný obsah nahrávky, ne base64');
    const zbytky = execSync(`docker exec ${NAME} sh -c 'ls /tmp | grep kb-audio || true'`).toString().trim();
    expect(zbytky === '', `dočasné soubory s nahrávkou se uklidily (${zbytky || 'žádné'})`);

    console.log('== test připojení v administraci ==');
    // účet a@x.cz je první založený → má roli admin, takže na admin routy dosáhne
    r = await api('/api/kb/ai-test', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'kb-test-model', token: KLIC } });
    expect(r.json && r.json.ok === true, `platný klíč + známý model = OK (${JSON.stringify(r.json).slice(0, 90)})`);

    r = await api('/api/kb/ai-test', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'kb-test-model', token: 'sk-spatny' } });
    expect(r.json && r.json.ok === false && /token/i.test(r.json.message || ''),
      `špatný klíč se pozná jako špatný klíč, ne jako výpadek (${(r.json || {}).message})`);

    r = await api('/api/kb/ai-test', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'neexistujici-model', token: KLIC } });
    expect(r.json && r.json.ok === false && /neexistujici-model/.test(r.json.message || ''),
      `neznámý model se pojmenuje (${(r.json || {}).message})`);

    console.log('== brána bez seznamu modelů ==');
    rezim = 'bezSeznamuModelu';
    r = await api('/api/kb/ai-test', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'kb-test-model', token: KLIC } });
    expect(r.json && r.json.ok === true,
      `chybějící /models není důkaz nefunkčnosti — ověří se dotazem na chat (${JSON.stringify(r.json).slice(0, 90)})`);
    rezim = 'ok';

    console.log('== adresa zadaná jinak, než čekáme ==');
    for (const varianta of [`${URL_MOCK}/`, `${URL_MOCK}/chat/completions`, URL_MOCK.replace(/\/v1$/, '')]) {
      r = await api('/api/kb/ai-test', { token: T, body: { provider: 'openai', url: varianta, model: 'kb-test-model', token: KLIC } });
      expect(r.json && r.json.ok === true, `„${varianta}" se srovná na správný tvar`);
    }

    console.log('== po 401/429 se NEOPAKUJE (opakuje se jen tvar požadavku) ==');
    for (const [r, jmeno] of [['nezmocnen', '401'], ['preteceno', '429']]) {
      rezim = r; chatVolani = [];
      const o = await api('/api/kb/advisor', { token: T, body: { mode: 'generate', goal: 'X', scope: 'stručná' } });
      expect(chatVolani.length === 1, `${jmeno} → jediný pokus, žádné opakování (${chatVolani.length})`);
      expect(o.status === 502, `${jmeno} skončí chybou, ne tichem (${o.status})`);
    }
    rezim = 'ok';

    console.log('== chybové tělo, které NENÍ JSON ==');
    rezim = 'htmlChyba';
    r = await api('/api/kb/advisor', { token: T, body: { mode: 'generate', goal: 'X', scope: 'stručná' } });
    expect(r.status === 502 && (r.json.error || '').length < 500,
      `HTML stránka od proxy se do hlášky nevysype celá (${(r.json.error || '').length} znaků)`);
    rezim = 'ok';

    console.log('== detail cizí chyby vidí admin, řadový člen ne ==');
    // ⚠️ OpenAI vrací v 401 kus klíče. Admin detail potřebuje, běžný člen ho
    // vidět NESMÍ — jinak si ho z chybové hlášky přečte kdokoli z organizace.
    await api('/api/collections/users/records', { body: { email: 'clen@x.cz', password: 'clenskeheslo123', passwordConfirm: 'clenskeheslo123' } });
    const CT = (await api('/api/collections/users/auth-with-password', { body: { identity: 'clen@x.cz', password: 'clenskeheslo123' } })).json.token;
    rezim = 'nezmocnen';
    r = await api('/api/kb/advisor', { token: T, body: { mode: 'generate', goal: 'X', scope: 'stručná' } });
    expect(/TESTOVACI-KLIC/.test(r.json.error || ''), `admin detail od služby vidí (${(r.json.error || '').slice(0, 70)})`);
    r = await api('/api/kb/advisor', { token: CT, body: { mode: 'generate', goal: 'X', scope: 'stručná' } });
    expect(!/TESTOVACI-KLIC|sk-/.test(r.json.error || ''),
      `řadový člen materiál klíče NEVIDÍ (${(r.json.error || '').slice(0, 70)})`);
    expect(r.status === 502 && (r.json.error || '').length > 10, 'člen přesto dostane srozumitelnou hlášku');
    rezim = 'ok';

    console.log('== ranní shrnutí (jiná cesta než poradce: prostý text, bez auth kontextu) ==');
    // Shrnutí generuje i cron bez přihlášeného uživatele — proto má vlastní
    // větev v helpers.js. Aby bylo co shrnovat, musí mít uživatel otevřenou práci.
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const uid = ((await api(`/api/collections/users/records?filter=${encodeURIComponent("email='a@x.cz'")}`, { token: ST })).json.items || [])[0].id;
    const mapa = (await api('/api/collections/goalmaps/records', { token: T, body: { title: 'Administrativa', nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Administrativa', title: 'Administrativa', status: 'todo' } },
      { id: 'a1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Agenda', status: 'todo' } },
    ], edges: [{ id: 'e-a1', source: 'apex', target: 'a1' }] } })).json;
    await api('/api/collections/tasks/records', { token: ST, body: {
      title: 'Zaplatit fakturu Novák', status: 'todo', deadline: '2026-07-01',
      assignee_email: 'a@x.cz', map: mapa.id, node_id: 'a1', owner: uid, owner_email: 'a@x.cz',
    } });
    r = await api('/api/kb/my-summary/refresh', { token: T, body: {} });
    // routa vrací celý záznam: { summary: { date, provider, text } }
    const shrnuti = ((r.json || {}).summary || {});
    expect(r.status === 200 && typeof shrnuti.text === 'string' && shrnuti.text.length > 10,
      `„Obnovit" u ranního shrnutí projde i s providerem openai (${r.status}: ${JSON.stringify(r.json).slice(0, 90)})`);
    expect(shrnuti.provider === 'openai', `shrnutí je označené správným providerem (${shrnuti.provider})`);
    expect(!/^[{[]/.test(String(shrnuti.text || 'x').trim()), 'shrnutí je věta pro člověka, ne JSON');

    console.log('== diktování se nabízí jen tam, kde ho služba umí ==');
    // OpenRouter, vLLM ani LM Studio /audio/transcriptions nemají. Mikrofon,
    // který vždycky skončí chybou, je horší než žádný.
    umiPrepis = false;
    await api('/api/kb/ai-settings', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'kb-test-model' } });
    await sleep(300);
    cfg = await api('/api/kb/config');
    expect(!(cfg.json.ai_modes || []).includes('transcribe'),
      `služba bez přepisu → mikrofon se nenabízí (${(cfg.json.ai_modes || []).join(',')})`);
    umiPrepis = true;
    await api('/api/kb/ai-settings', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'kb-test-model' } });
    await sleep(300);
    cfg = await api('/api/kb/config');
    expect((cfg.json.ai_modes || []).includes('transcribe'),
      `služba s whisperem → mikrofon se nabízí (${(cfg.json.ai_modes || []).join(',')})`);

    console.log('== vlastní adresa přepisu má přednost ==');
    prepisVolani = [];
    await api('/api/kb/ai-settings', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'kb-test-model', transcribe_url: `http://host.docker.internal:${MOCK_PORT}/vlastni-prepis` } });
    await sleep(300);
    r = await api('/api/kb/advisor', { token: T, body: { mode: 'transcribe', audio_base64: Buffer.from('RIFFtest').toString('base64'), filename: 'a.webm' } });
    expect(vlastniPrepisVolani === 1, `dotaz šel na VLASTNÍ adresu přepisu, ne na službu (${vlastniPrepisVolani}×)`);
    expect(prepisVolani.length === 0, 'na /audio/transcriptions se nesáhlo');
    await api('/api/kb/ai-settings', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'kb-test-model', transcribe_url: '' } });
    await sleep(300);

    console.log('== test připojení bez názvu modelu nesmí svítit zeleně ==');
    // ⚠️ prázdný `model` v požadavku znamená „vezmi uložený" — aby scénář
    // odpovídal skutečnosti (admin model NIKDY nevyplnil), musí být prázdný
    // i v uloženém nastavení
    await api('/api/kb/ai-settings', { token: T, body: { provider: 'openai', url: URL_MOCK, model: '' } });
    await sleep(300);
    rezim = 'bezSeznamuModelu';
    r = await api('/api/kb/ai-test', { token: T, body: { provider: 'openai', url: URL_MOCK, model: '', token: KLIC } });
    expect(r.json && r.json.ok === false, `prázdný model = červená i bez seznamu modelů (${JSON.stringify(r.json).slice(0, 90)})`);
    rezim = 'ok';
    r = await api('/api/kb/ai-test', { token: T, body: { provider: 'openai', url: URL_MOCK, model: '', token: KLIC } });
    expect(r.json && r.json.ok === false, `prázdný model = červená i se seznamem modelů (${JSON.stringify(r.json).slice(0, 90)})`);

    console.log('== uložení nastavení v administraci ==');
    r = await api('/api/kb/ai-settings', { token: T, body: { provider: 'openai', url: URL_MOCK, model: 'kb-test-model', token: KLIC } });
    expect(r.status === 200 && r.json.provider === 'openai' && r.json.token_set === true,
      `openai lze uložit a klíč se uloží (${r.status})`);
    r = await api('/api/kb/ai-settings', { token: T });
    expect(r.json.provider === 'openai' && r.json.token === undefined,
      'klíč se z administrace zpátky NEVYDÁVÁ (jen token_set)');
    console.log('== hodinový strop AI operací (peníze zákazníka) ==');
    // Vlastní kontejner s natvrdo sníženým stropem — na výchozích 60 by se
    // sada protáhla a nic navíc by nedokázala.
    const NAME2 = NAME + '-strop', PORT2 = 20560, BASE2 = `http://127.0.0.1:${PORT2}`;  // 20559 drží mock
    try {
      execSync(`docker rm -f ${NAME2} 2>/dev/null; true`);
      execSync(`docker run -d --name ${NAME2} -p ${PORT2}:8090 --add-host=host.docker.internal:host-gateway \
        -e KB_AI_PROVIDER=openai -e KB_AI_URL=${URL_MOCK} -e KB_AI_TOKEN=${KLIC} \
        -e KB_AI_MODEL=kb-test-model -e KB_AI_MAX_PER_HOUR=2 -e KB_UVODNI_MAPA=0 \
        ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
      for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE2}/api/health`)).ok) break; } catch {} await sleep(1000); }
      const api2 = async (path, body, token) => {
        const res = await fetch(BASE2 + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: JSON.stringify(body) });
        let json = null; try { json = await res.json(); } catch {}
        return { status: res.status, json };
      };
      await api2('/api/collections/users/records', { email: 'a@x.cz', password: 'testheslo123', passwordConfirm: 'testheslo123' });
      const T2 = (await api2('/api/collections/users/auth-with-password', { identity: 'a@x.cz', password: 'testheslo123' })).json.token;
      const stavy = [];
      for (let i = 0; i < 3; i++) {
        const o = await api2('/api/kb/advisor', { mode: 'questions', goal: 'X' }, T2);
        stavy.push(o.status);
      }
      expect(stavy[0] === 200 && stavy[1] === 200 && stavy[2] === 429,
        `třetí volání nad strop 2/h se odmítne (${stavy.join(',')})`);
      const posledni = await api2('/api/kb/advisor', { mode: 'questions', goal: 'X' }, T2);
      expect(/strop/i.test((posledni.json || {}).error || ''),
        `odmítnutí je srozumitelné, ne holé 429 (${((posledni.json || {}).error || '').slice(0, 70)})`);
    } finally {
      execSync(`docker rm -f ${NAME2} 2>/dev/null; true`);
    }
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', String(e.message).slice(0, 200));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    mock.close();
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
