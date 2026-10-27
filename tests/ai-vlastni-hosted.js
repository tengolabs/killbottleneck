// Vlastní model zákazníka na HOSTOVANÉ instanci (14. 10. 2026, rozhodnutí Richarda: jakékoli OpenAI-kompatibilní
// API, tahy bez kvóty, všechny tarify, zatím jen textový chat).
//
// Co sada DOKAZUJE (ne jen „routa odpoví“):
//   · klíč zákazníka nikdy nevyjde z serveru (GET bez tokenu) a v databázi leží ŠIFROVANÝ (surový řetězec v data.db není);
//   · klíč odchází JEN na adresu téhož původu, jakou má uložená — test připojení na cizí adresu bez klíče žádnou
//     Authorization neposílá; změna adresy jinam bez nového klíče starý klíč smaže;
//   · chat asistenta jde na vlastní model (náš „proxy“ nedostane ani jedno volání), bez polí navíc z env (reasoning_effort
//     patří naší sestavě), s klíčem zákazníka v Bearer;
//   · tah na vlastním modelu = 0 kreditů a zdroj=vlastni; VYČERPANÁ kvóta ho nezastaví (hodinová brzda ano);
//   · vlastní model padne → 502 s jasnou hláškou (správce i text chyby, člen ne) a ŽÁDNÝ tichý přepad na naši AI;
//   · privátní/LAN/Tailscale adresy neprojdou; bez šifrovacího klíče instance se vlastní model nezapne;
//   · self-host routu nemá (404).
//
// Jak se mock dostane za SSRF guard: hostovaná instance privátní adresy odmítá (správně), host.docker.internal je
// 172.17.0.1. Proto docker síť s VEŘEJNĚ vypadajícím rozsahem 203.0.113.0/24 (TEST-NET-3) a v ní relay (alpine/socat)
// s adresou 203.0.113.10 → mock na hostiteli; instance dostane --add-host vlastni.test:203.0.113.10 a je k té síti
// připojená. getent přeloží jméno na veřejnou adresu, provoz jde přes relay k mocku. Druhý relay (cizi.test) = cizí původ.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-vlastni-hosted.js
const { execSync } = require('child_process');
const H = require('./_harness');
const { expect } = H;

const SETUP_CODE = 'FM-TEST-KOD1';
const KLIC = 'sk-vlastni-TAJNY-klic-9f3a7c1e';   // smyšlený; kontrola úniků hledá sk-proj-… tvar, tenhle to není
const SIFRA = 'e2e-sifrovaci-klic-32-znaku-ABCD';  // 32 znaků
const SIT = `kbt-vlastni-${process.pid}`;
const IP_VLASTNI = '203.0.113.10', IP_CIZI = '203.0.113.11';

const fronta = [];       // odpovědi vlastního modelu: { content } | { status: 500 }
const volaniVlastni = []; // { url, auth, body }
const volaniCizi = [];
const volaniNas = [];     // naše AI (KB_CHAT_*) — na vlastním modelu musí zůstat prázdné

function openaiMock(seznam, { model, hugeUsage = false } = {}) {
  return (req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    let b = null; try { b = body ? JSON.parse(body) : null; } catch { b = null; }
    seznam.push({ url: req.url, auth: req.headers.authorization || '', body: b });
    if (req.method === 'GET' && /\/v1\/models/.test(req.url)) { res.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model' }] })); return; }
    if (!/\/v1\/chat\/completions/.test(req.url)) { res.statusCode = 404; res.end('{"error":{"message":"not found"}}'); return; }
    const o = seznam === volaniVlastni ? (fronta.shift() || { content: 'Odpověď z vlastního modelu.' }) : { content: 'Odpověď z naší AI.' };
    if (o.status) { res.statusCode = o.status; res.end(JSON.stringify({ error: { message: 'model exploded' } })); return; }
    const usage = hugeUsage ? { prompt_tokens: 3000000, completion_tokens: 50000 } : { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1000 } };
    res.end(JSON.stringify({ id: 'chatcmpl-x', object: 'chat.completion', model: b && b.model, choices: [{ index: 0, message: { role: 'assistant', content: o.content }, finish_reason: 'stop' }], usage }));
  };
}

const relay = (jmeno, ip, port) => execSync(`docker run -d --name ${jmeno} --network ${SIT} --ip ${ip} --add-host=host.docker.internal:host-gateway alpine/socat tcp-listen:80,fork,reuseaddr tcp:host.docker.internal:${port}`, { stdio: 'ignore' });
const uklidSite = () => { try { execSync(`docker rm -f kbt-relay-v-${process.pid} kbt-relay-c-${process.pid} 2>/dev/null; docker network rm ${SIT} 2>/dev/null; true`, { stdio: 'ignore' }); } catch { /* nic */ } };

H.beh(async () => {
  const vlastni = await H.httpMock(openaiMock(volaniVlastni, { model: 'gpt-oss:20b' }));
  const cizi = await H.httpMock(openaiMock(volaniCizi, { model: 'gpt-oss:20b' }));
  const nas = await H.httpMock(openaiMock(volaniNas, { model: 'nas-model', hugeUsage: true }));
  execSync(`docker network create --subnet 203.0.113.0/24 ${SIT}`, { stdio: 'ignore' });
  relay(`kbt-relay-v-${process.pid}`, IP_VLASTNI, vlastni.port);
  relay(`kbt-relay-c-${process.pid}`, IP_CIZI, cizi.port);
  let inst;
  try {
    // naše AI (KB_CHAT_*) jako na boxu: env má přednost, kvóta 1 kredit/týden → po prvním (obřím) tahu vyčerpaná
    inst = await H.startInstance({ slug: 'vlastni-hosted', addHostGateway: true, addHosts: { 'vlastni.test': IP_VLASTNI, 'cizi.test': IP_CIZI },
      env: { KB_HOSTED: '1', KB_SETUP_CODE: SETUP_CODE, KB_ENCRYPTION_KEY: SIFRA, KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
        KB_CHAT_PROVIDER: 'openai', KB_CHAT_URL: nas.base + '/v1', KB_CHAT_MODEL: 'nas-model', KB_CHAT_TOKEN: 'kbc_nas_token', KB_CHAT_OPENAI_EXTRA: '{"reasoning_effort":"none"}',
        // hybrid jako na boxu (lehký model = náš proxy token): na vlastním modelu se NESMÍ použít — nesl by náš token k cizí službě
        KB_CHAT_HYBRID: 'rezim,klasifikator', KB_CHAT_LIGHT_PROVIDER: 'openai', KB_CHAT_LIGHT_URL: nas.base + '/v1', KB_CHAT_LIGHT_MODEL: 'nas-light', KB_CHAT_LIGHT_TOKEN: 'kbc_nas_token',
        // fotky a hlasovky = naše AI (vize/přepis) i při vlastním modelu → musí být zapnuté, ať tah s přílohou dojde až k brzdě
        KB_VISION_PROVIDER: 'openai', KB_VISION_URL: nas.base + '/v1', KB_VISION_MODEL: 'nas-vision', KB_VISION_TOKEN: 'kbc_nas_token',
        KB_TRANSCRIBE_PROVIDER: 'openai', KB_TRANSCRIBE_URL: nas.base + '/v1', KB_TRANSCRIBE_MODEL: 'whisper-1', KB_TRANSCRIBE_TOKEN: 'kbc_nas_token',
        KB_AI_KVOTA_TYDEN: 1 } });
    execSync(`docker network connect ${SIT} ${inst.name}`, { stdio: 'ignore' });
    await inst.register('admin@example.com', { setup_code: SETUP_CODE, name: 'Správce' });
    const A = await inst.login('admin@example.com');
    // hostovaná: registrace jen s aktivačním kódem (fail-closed) → člen vznikne s kódem a superuser mu sníží roli
    const SU = await inst.superuser();
    const reg = await inst.register('clen@example.com', { setup_code: SETUP_CODE, name: 'Člen' });
    if (reg.status !== 200) throw new Error(`registrace člena: ${reg.status} ${JSON.stringify(reg.json)}`);
    const rolePatch = await inst.api('PATCH', `/api/collections/users/records/${reg.json.id}`, { token: SU, body: { role: 'user' } });
    if (rolePatch.status !== 200) throw new Error(`snížení role člena: ${rolePatch.status} ${JSON.stringify(rolePatch.json)}`);
    const C = await inst.login('clen@example.com');
    const chat = (tok, message, extra = {}) => inst.api('POST', '/api/kb/chat', { token: tok, body: Object.assign({ message }, extra) });

    console.log('== přístup ==');
    let r = await inst.api('GET', '/api/kb/ai-vlastni', { token: C });
    expect(r.status === 403, `člen nevidí nastavení vlastního modelu (${r.status})`);
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: C, body: { enabled: true, url: 'https://x.example.com/v1', model: 'm' } });
    expect(r.status === 403, `člen nezapne vlastní model (${r.status})`);
    r = await inst.api('GET', '/api/kb/ai-vlastni', { token: A });
    expect(r.status === 200 && r.json.enabled === false && r.json.key_ready === true && r.json.token_set === false, 'správce: výchozí stav vypnuto, instance má šifrovací klíč');
    let cfg = await inst.api('GET', '/api/kb/config');
    expect(cfg.json.chat_vlastni === false && cfg.json.ai_modes.includes('chat_panel'), '/config: chat_vlastni=false, asistent (naše AI) k dispozici');

    console.log('== validace a SSRF ==');
    for (const url of ['http://10.0.0.5:11434/v1', 'http://172.17.0.1:11434/v1', 'http://100.100.1.2:11434/v1', 'http://localhost:11434/v1', 'http://[fd00::1]/v1']) {
      r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: true, url, model: 'm', token: 'x' } });
      expect(r.status === 400 && /privátní|private/i.test(r.json.error || ''), `privátní adresa se neuloží: ${url}`);
    }
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: true, url: 'ftp://neco', model: 'm' } });
    expect(r.status === 400 && /http/i.test(r.json.error || ''), 'adresa bez http(s) → 400');
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: true, url: 'http://vlastni.test/v1', model: '' } });
    expect(r.status === 400, 'zapnutí bez modelu → 400');
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: false, url: 'http://vlastni.test/v1', model: 'm', extra: '{nevalidni' } });
    expect(r.status === 400 && /JSON/.test(r.json.error || ''), 'pole navíc musí být JSON objekt');
    for (const extra of ['{"messages":[]}', '{"tools":[]}', '{"stream":true}', '{"model":"jiny"}', '{"__proto__":{"a":1}}']) {
      r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: false, url: 'http://vlastni.test/v1', model: 'm', extra } });
      expect(r.status === 400 && /messages|stream/.test(r.json.error || ''), `pole navíc nesmí přepsat tělo volání: ${extra}`);
    }
    r = await inst.api('POST', '/api/kb/ai-vlastni/test', { token: A, body: { url: 'http://vlastni.test/v1', model: 'm', extra: '{"stream":true}' } });
    expect(r.status === 200 && r.json.ok === false && /messages|stream/.test(r.json.message || ''), 'test připojení odmítne zakázané pole navíc');

    console.log('== kvóta naší AI se vyčerpá ==');
    r = await chat(A, 'Ahoj, co mám dnes dělat?');
    expect(r.status === 200, `první tah na naší AI projde (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
    expect(volaniNas.filter((v) => /chat\/completions/.test(v.url)).length >= 1, 'naše AI dostala volání');
    r = await chat(A, 'A ještě něco?');
    expect(r.status === 429 && r.json.code === 'ai_kvota', `druhý tah: týdenní kvóta vyčerpaná → 429 ai_kvota (${r.status} ${r.json && r.json.code})`);
    const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    console.log('== zapnutí vlastního modelu ==');
    // Test PŘED uložením (běžný postup správce): otisk otestované dvojice drží „ověřeno“ i po Uložit
    r = await inst.api('POST', '/api/kb/ai-vlastni/test', { token: A, body: { url: 'http://vlastni.test/v1', model: 'gpt-oss:20b', token: KLIC } });
    expect(r.status === 200 && r.json.ok === true && !!r.json.tested_at, `test před uložením projde (${JSON.stringify(r.json).slice(0, 120)})`);
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: true, url: 'http://vlastni.test/v1', model: 'gpt-oss:20b', token: KLIC } });
    expect(r.status === 200 && r.json.enabled === true && r.json.token_set === true && r.json.active === true && r.json.plain_http === true, `uloženo a aktivní (${r.status} ${JSON.stringify(r.json).slice(0, 160)})`);
    expect(r.json.ok === true && !!r.json.tested_at, `po Uložit stejné dvojice zůstává „ověřeno“ (ok=${r.json.ok})`);
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: true, url: 'http://vlastni.test/v1', model: 'jiny-model' } });
    expect(r.status === 200 && r.json.ok === false, 'změna modelu bez testu → už ne „ověřeno“');
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: true, url: 'http://vlastni.test/v1', model: 'gpt-oss:20b' } });
    expect(r.status === 200 && r.json.ok === true, 'návrat k otestované dvojici → zase „ověřeno“');
    // kvóta naší AI je vyčerpaná: TEXT na vlastním modelu projde (níže), ale fotka/hlasovka jdou na naši AI → brzda platí dál
    r = await chat(A, 'Co je na obrázku?', { image_base64: PNG1, image_mime: 'image/png' });
    expect(r.status === 429 && r.json.code === 'ai_kvota', `tah s fotkou na vlastním modelu při vyčerpané kvótě → 429 ai_kvota (${r.status} ${r.json && r.json.code})`);
    const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]), Buffer.alloc(64)]).toString('base64'); // hlavička webm
    r = await chat(A, '', { audio_base64: WEBM, audio_s: 2 });
    expect(r.status === 429 && r.json.code === 'ai_kvota', `tah s hlasovkou na vlastním modelu při vyčerpané kvótě → 429 ai_kvota (${r.status} ${r.json && r.json.code})`);
    r = await inst.api('GET', '/api/kb/ai-vlastni', { token: A });
    expect(r.json.token === undefined && r.json.token_enc === undefined && JSON.stringify(r.json).indexOf(KLIC) < 0, 'GET nikdy nevrací klíč');
    cfg = await inst.api('GET', '/api/kb/config');
    expect(cfg.json.chat_vlastni === true && cfg.json.ai_modes.includes('chat_panel'), '/config: chat_vlastni=true, panel asistenta zůstává');
    // klíč v databázi ŠIFROVANĚ — surový řetězec v data.db ani ve WAL nesmí být
    const dbTmp = `/tmp/kb-vlastni-${process.pid}`;
    execSync(`mkdir -p ${dbTmp} && docker cp ${inst.name}:/app/pb_data/data.db ${dbTmp}/data.db && (docker cp ${inst.name}:/app/pb_data/data.db-wal ${dbTmp}/data.db-wal 2>/dev/null || true)`, { stdio: 'ignore' });
    const surovy = execSync(`grep -c -a "${KLIC}" ${dbTmp}/data.db ${dbTmp}/data.db-wal 2>/dev/null | awk -F: '{s+=$2} END {print s+0}'`).toString().trim();
    const sifrovany = execSync(`grep -c -a "enc:" ${dbTmp}/data.db ${dbTmp}/data.db-wal 2>/dev/null | awk -F: '{s+=$2} END {print s+0}'`).toString().trim();
    execSync(`rm -rf ${dbTmp}`);
    expect(surovy === '0', `surový klíč v databázi NENÍ (výskytů: ${surovy})`);
    expect(Number(sifrovany) > 0, `šifrovaný tvar (enc:…) v databázi JE (výskytů: ${sifrovany})`);

    console.log('== chat jde na vlastní model ==');
    const nasPred = volaniNas.length;
    fronta.push({ content: 'Dnes máte poradu v 9:00.' });
    r = await chat(A, 'Co mám dnes?');
    expect(r.status === 200, `tah na vlastním modelu projde i s VYČERPANOU kvótou (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
    const posledniZprava = r.json && r.json.chat && r.json.chat.messages ? r.json.chat.messages[r.json.chat.messages.length - 1] : null;
    expect(!!posledniZprava && /poradu v 9:00/.test(posledniZprava.content || ''), 'odpověď přišla z vlastního modelu');
    const vCh = volaniVlastni.filter((v) => /chat\/completions/.test(v.url));
    expect(vCh.length >= 1, `vlastní model dostal volání (${vCh.length})`);
    expect(vCh.every((v) => v.auth === `Bearer ${KLIC}`), 'klíč zákazníka jde v Authorization: Bearer');
    expect(vCh.every((v) => v.body && v.body.model === 'gpt-oss:20b'), 'model zákazníka v těle');
    // gpt-oss je uvažující model → llm.js mu dává výchozí effort „low“; z env naší sestavy (none) se NIC nedědí
    expect(vCh.every((v) => v.body && v.body.reasoning_effort !== 'none'), `pole navíc z env (reasoning_effort=none naší sestavy) se NEdědí (${vCh.map((v) => v.body && v.body.reasoning_effort).join(',')})`);
    expect(volaniNas.length === nasPred, 'naše AI nedostala ani jedno volání (žádný hybrid/lehký model)');
    // log tahu: 0 kreditů, zdroj=vlastni
    let log = await inst.api('GET', '/api/collections/ai_chat_log/records?sort=-created&perPage=1', { token: SU });
    const radek = log.json && log.json.items && log.json.items[0];
    expect(!!radek && radek.zdroj === 'vlastni' && Number(radek.kredity) === 0 && radek.provider === 'openai' && Number(radek.tokens_in) > 0, `řádek logu: zdroj=vlastni, 0 kreditů, tokeny zapsané (${radek && JSON.stringify({ zdroj: radek.zdroj, kredity: radek.kredity, tokens_in: radek.tokens_in })})`);
    log = await inst.api('GET', '/api/collections/ai_chat_log/records?sort=-created&perPage=1&filter=zdroj%3D%22nas%22', { token: SU });
    expect(log.json && log.json.items && log.json.items.length === 1 && Number(log.json.items[0].kredity) > 0, 'řádek naší AI má zdroj=nas a kredity > 0');
    // kredity v administraci: tah vlastního modelu nepřibyl
    const kr = await inst.api('GET', '/api/kb/ai-kredity', { token: A });
    expect(kr.status === 200 && kr.json.celkem.n === 2, `přehled kreditů zná oba tahy (n=${kr.json && kr.json.celkem && kr.json.celkem.n})`);

    console.log('== stránky píše vlastní model (bod 7, Richard 26. 10. 2026): bez kvóty, 0 kreditů, strop 4 000 / celá 8 000 ==');
    // stránka ve frontě jako po create_page; psaní = samostatný požadavek /chat/stranka/napsat
    const adminId = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: H.PW } })).json.record.id;
    const novaStranka = async (title) => (await inst.api('POST', '/api/collections/ai_pages/records', { token: SU, body: { user: adminId, title, zadani: 'Přehled projektu pro vedení.', stav: 'ceka' } })).json.id;
    const str1 = await novaStranka('Přehled pro vedení');
    const nasPredS = volaniNas.length, vlPredS = volaniVlastni.length;
    // osnova nevyjde (ani JSON, ani HTML) → záloha „celá stránka jedním voláním“ = volání s plným stropem stránky
    fronta.push({ content: 'tohle není osnova' }, { content: '```html\n<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>STR-VL</title></head><body><h1>STR-VL</h1></body></html>\n```' });
    r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: str1 } });
    expect(r.status === 200 && r.json.stranka && r.json.stranka.stav === 'hotovo' && /STR-VL/.test(r.json.stranka.html || ''), `stránka na vlastním modelu projde i s VYČERPANOU kvótou (${r.status} ${JSON.stringify(r.json).slice(0, 140)})`);
    const vStr = volaniVlastni.slice(vlPredS).filter((v) => /chat\/completions/.test(v.url));
    expect(vStr.length === 2 && volaniNas.length === nasPredS, `psaly ji jen vlastní model (${vStr.length} volání), naše AI nic`);
    // gpt-oss = uvažující model → llm.js posílá max_completion_tokens = strop + rezerva na úvahu (KB_AI_REASONING_BUDGET 4000)
    const strop = (v) => (v.body.max_tokens !== undefined ? v.body.max_tokens : v.body.max_completion_tokens - 4000);
    expect(vStr.length === 2 && strop(vStr[0]) <= 4000 && strop(vStr[1]) === 8000, `strop na vlastním modelu: osnova/části ≤ 4 000, záloha celé stránky 8 000 (místo 12 000) (${vStr.map(strop).join(',')})`);
    log = await inst.api('GET', '/api/collections/ai_chat_log/records?sort=-created&perPage=1', { token: SU });
    const radekS = log.json && log.json.items && log.json.items[0];
    expect(!!radekS && radekS.zdroj === 'vlastni' && Number(radekS.kredity) === 0 && Number(radekS.tokens_in) > 0, `log stránky: zdroj=vlastni, 0 kreditů (${radekS && JSON.stringify({ zdroj: radekS.zdroj, kredity: radekS.kredity, tokens_in: radekS.tokens_in })})`);
    // vlastní model padne → stránka skončí chybou s jasnou hláškou, bez přepadu na naši AI
    const str2 = await novaStranka('Stránka, která spadne');
    fronta.push({ status: 500 }, { status: 500 });
    r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: str2 } });
    expect(r.status === 502 && r.json.code === 'ai_vlastni' && /vlastní model|own model/i.test(r.json.error || ''), `pád vlastního modelu u stránky → 502 ai_vlastni s hláškou o vlastním modelu (${r.status} ${r.json && r.json.code} ${r.json && r.json.error})`);
    expect(volaniNas.length === nasPredS, 'ani u stránky žádný tichý přepad na naši AI');
    fronta.length = 0;
    // psaní po částech: osnova ≤ 2 000, kostra 6 000 (jako na naší AI — na 4 000 se v ostrém průchodu usekla), část 4 000
    const vlPredC = volaniVlastni.length;
    fronta.push({ content: '{"sections": [{"id": "uvod", "heading": "Úvod", "content": "Dílna: 5 kroků"}]}' },
      { content: '```html\n<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Po částech</title></head><body><h1>Po částech</h1><main><section id="sec-uvod"></section></main></body></html>\n```' },
      { content: '```html\n<h2>Úvod</h2><p>CAST-VL</p>\n```' });
    r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: await novaStranka('Po částech') } });
    const vC = volaniVlastni.slice(vlPredC).filter((v) => /chat\/completions/.test(v.url));
    expect(r.status === 200 && r.json.stranka.stav === 'hotovo' && /CAST-VL/.test(r.json.stranka.html || ''), `po částech na vlastním modelu → hotovo (${r.status} ${r.json && (r.json.error || r.json.stranka.stav)})`);
    expect(vC.length === 3 && strop(vC[0]) === 2000 && strop(vC[1]) === 6000 && strop(vC[2]) === 4000, `stropy: osnova 2 000, kostra 6 000, část 4 000 (${vC.map(strop).join(',')})`);
    fronta.length = 0;
    // model odpověděl, jen ne HTML → obsahová chyba stránky, NE „vlastní model neodpovídá“ (code ai_vlastni jen při pádu spojení)
    fronta.push({ content: 'tohle není osnova' }, { content: 'a tohle není HTML' });
    r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: await novaStranka('Stránka bez HTML') } });
    expect(r.status === 502 && r.json.code === undefined && !/vlastní model neodpovídá/i.test(r.json.error || ''), `model bez HTML → 502 bez code ai_vlastni (${r.status} ${r.json && r.json.code} ${r.json && r.json.error})`);
    fronta.length = 0;

    console.log('== test připojení: klíč jen na uloženou adresu ==');
    r = await inst.api('POST', '/api/kb/ai-vlastni/test', { token: A, body: { url: 'http://cizi.test/v1', model: 'gpt-oss:20b' } });
    expect(r.status === 200 && volaniCizi.length > 0 && volaniCizi.every((v) => !v.auth), `cizí původ bez klíče v požadavku → ŽÁDNÁ Authorization (${volaniCizi.map((v) => v.auth || '—').join(',')})`);
    const vlPred = volaniVlastni.length;
    r = await inst.api('POST', '/api/kb/ai-vlastni/test', { token: A, body: { url: 'http://vlastni.test/v1', model: 'gpt-oss:20b' } });
    expect(r.status === 200 && r.json.ok === true, `test uložené adresy bez klíče v požadavku → uložený klíč se použije, ok (${JSON.stringify(r.json)})`);
    expect(volaniVlastni.slice(vlPred).every((v) => v.auth === `Bearer ${KLIC}`), 'a šel na uloženou adresu v Bearer');
    r = await inst.api('GET', '/api/kb/ai-vlastni', { token: A });
    expect(r.json.ok === true && !!r.json.tested_at, 'po úspěšném testu uložené adresy: ok=true, tested_at');
    r = await inst.api('POST', '/api/kb/ai-vlastni/test', { token: A, body: { url: 'http://vlastni.test/v1', model: 'neexistujici-model' } });
    expect(r.status === 200 && r.json.ok === false && /neexistujici-model/.test(r.json.message || ''), 'neznámý model → hláška s názvem modelu');

    console.log('== změna adresy jinam bez klíče = starý klíč se smaže ==');
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: true, url: 'http://cizi.test/v1', model: 'gpt-oss:20b' } });
    expect(r.status === 200 && r.json.token_set === false && r.json.ok === false, `klíč k cizí adrese neodejde — token_set=false, ok=false (${JSON.stringify(r.json).slice(0, 120)})`);
    const ciziPred = volaniCizi.length;
    r = await chat(A, 'Ahoj');
    expect(r.status === 200 && volaniCizi.slice(ciziPred).some((v) => /chat\/completions/.test(v.url) && !v.auth), 'chat na novou adresu jde BEZ klíče (žádný starý klíč)');
    // zpátky na vlastni.test s klíčem
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: true, url: 'http://vlastni.test/v1', model: 'gpt-oss:20b', token: KLIC } });
    expect(r.status === 200 && r.json.token_set === true, 'zpět na vlastní adresu s klíčem');

    console.log('== vlastní model padne → jasná hláška, žádný tichý přepad ==');
    const nasPred2 = volaniNas.length;
    fronta.push({ status: 500 });
    r = await chat(A, 'Spadni');
    expect(r.status === 502 && r.json.code === 'ai_vlastni' && /vlastní model|own model/i.test(r.json.error || '') && /500/.test(r.json.error || ''), `správce: 502 ai_vlastni s textem chyby (${r.status} ${r.json && r.json.error})`);
    fronta.push({ status: 500 });
    r = await chat(C, 'Spadni taky');
    expect(r.status === 502 && r.json.code === 'ai_vlastni' && /vlastní model|own model/i.test(r.json.error || '') && !/500|exploded/.test(r.json.error || ''), `člen: 502 ai_vlastni bez technických detailů (${r.status} ${r.json && r.json.error})`);
    expect(volaniNas.length === nasPred2, 'při pádu vlastního modelu se NIC neposlalo na naši AI');

    console.log('== vypnutí → zpět na naši AI (s kvótou) ==');
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: false, url: 'http://vlastni.test/v1', model: 'gpt-oss:20b' } });
    expect(r.status === 200 && r.json.enabled === false && r.json.active === false && r.json.token_set === true, 'vypnuto, klíč zůstává uložený pro příště');
    cfg = await inst.api('GET', '/api/kb/config');
    expect(cfg.json.chat_vlastni === false, '/config: chat_vlastni=false');
    r = await chat(A, 'Zase ty');
    expect(r.status === 429 && r.json.code === 'ai_kvota', `po vypnutí platí zase kvóta naší AI (${r.status})`);
    r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: await novaStranka('Stránka na naší AI') } });
    expect(r.status === 429 && r.json.code === 'ai_kvota', `…i pro stránky: na naší AI stránka kvótu čerpá (${r.status} ${r.json && r.json.code})`);
    r = await inst.api('POST', '/api/kb/ai-vlastni', { token: A, body: { enabled: false, url: 'http://vlastni.test/v1', model: 'gpt-oss:20b', clear_token: true } });
    expect(r.status === 200 && r.json.token_set === false, 'clear_token smaže klíč');

    console.log('== instance bez šifrovacího klíče ==');
    const bez = await H.startInstance({ slug: 'vlastni-bez-klice', env: { KB_HOSTED: '1', KB_SETUP_CODE: SETUP_CODE, KB_UVODNI_MAPA: 0 } });
    await bez.register('admin@example.com', { setup_code: SETUP_CODE });
    const BA = await bez.login('admin@example.com');
    r = await bez.api('GET', '/api/kb/ai-vlastni', { token: BA });
    expect(r.status === 200 && r.json.key_ready === false, 'key_ready=false — administrace to řekne');
    r = await bez.api('POST', '/api/kb/ai-vlastni', { token: BA, body: { enabled: true, url: 'https://example.com/v1', model: 'm', token: 'x' } });
    expect(r.status === 400 && /KB_ENCRYPTION_KEY/.test(r.json.error || ''), 'bez klíče instance se vlastní model nezapne (fail-closed)');

    console.log('== self-host ==');
    const self = await H.startInstance({ slug: 'vlastni-self', env: { KB_UVODNI_MAPA: 0 } });
    await self.register('admin@example.com');
    const SA = await self.login('admin@example.com');
    r = await self.api('GET', '/api/kb/ai-vlastni', { token: SA });
    expect(r.status === 404, `self-host: routa neexistuje (${r.status})`);
    cfg = await self.api('GET', '/api/kb/config');
    expect(cfg.json.chat_vlastni === false, 'self-host: chat_vlastni=false');
  } finally {
    if (inst) { try { execSync(`docker network disconnect ${SIT} ${inst.name} 2>/dev/null; true`, { stdio: 'ignore' }); } catch { /* nic */ } }
    uklidSite();
  }
}, { nazev: 'AI VLASTNÍ MODEL (HOSTED)' });
