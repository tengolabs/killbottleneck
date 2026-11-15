// Code analysis 4, finding S8-04 — the weekly picture cap overshot by drawings sent at once.
//
// The cap (KB_OBRAZKY_TYDEN) counted only FINISHED drawings (rows of ai_chat_log); a picture
// being drawn has no row yet, so N drawings sent at the same moment all passed — cap 2 drew 6.
//
// The suite fires bursts of drawings against a mocked gateway that holds every answer for a
// while (so all of them are in flight together) and claims the invariant: the gateway is
// NEVER asked for more pictures than the cap leaves, exactly that many succeed, the rest get
// 429 image_week before the gateway. Repeated over several rounds (the log is emptied between
// them), over both entries (/chat/obrazek/vytvorit and /v1/images), with part of the cap
// already used, and after failed drawings (a failed drawing gives its place back).
// No real image generator: the gateway is a local mock.
// Run: KB_TEST_IMAGE=<image> node product/tests/chyby4-soubeh-obrazky.js
const H = require('./_harness');
const { expect } = H;

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooorhPqD/9k=';
const STROP = 3;
const NARAZ = 8;
const KOL = 5;
const DRZI_MS = 500;   // the gateway holds every answer → the whole burst is in flight together

H.beh(async () => {
  let rezim = 'ok';      // ok | down
  let kresleni = 0, soucasne = 0, nejvicSoucasne = 0;
  const brana = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/v1/status')) { res.end(JSON.stringify({ schema_version: 1, name: 'Test', active: true, modes: ['chat', 'image'] })); return; }
    let b = {};
    try { b = JSON.parse(body || '{}'); } catch { b = {}; }
    if (b.mode !== 'image') { res.statusCode = 400; res.end('{"detail":{"error":"image expected"}}'); return; }
    kresleni++; soucasne++; nejvicSoucasne = Math.max(nejvicSoucasne, soucasne);
    setTimeout(() => {
      soucasne--;
      if (rezim === 'down') { res.statusCode = 502; res.end('{"detail":{"error":"Obrázky teď nejdou.","code":"image_unavailable"}}'); return; }
      res.end(JSON.stringify({ image_base64: JPEG, mime: 'image/jpeg', model: b.model, seed: 1000 + kresleni, size: '1024x1024', gen_s: 0.5, schema_version: 1 }));
    }, DRZI_MS);
  });
  const inst = await H.startInstance({ slug: 'soubeh-obrazky', addHostGateway: true,
    env: { KB_UVODNI_MAPA: 0, KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok', KB_OBRAZKY_TYDEN: STROP, KB_AI_MAX_PER_HOUR: 100000 } });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const su = await inst.superuser();
  const uid = async (e) => (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent(`email='${e}'`), { token: su })).json.items[0].id;
  const UA = await uid('admin@example.com'), UB = await uid('clen@example.com');
  const keyA = (await inst.api('POST', '/api/kb/api-keys', { token: A, body: { label: 'rw', scope: 'read_write' } })).json.token;

  const logKresleni = async () => ((await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=500', { token: su })).json.items || []).filter((l) => l.tools === 'image_draw');
  const vycistiLog = async () => {
    const vse = ((await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=500', { token: su })).json.items || []);
    for (const l of vse) await inst.api('DELETE', `/api/collections/ai_chat_log/records/${l.id}`, { token: su });
    const zbylo = (await logKresleni()).length;
    if (zbylo) throw new Error(`log se nevyčistil (${zbylo} řádků) — kola by na sebe navazovala`);
  };
  // n pictures waiting to be drawn (as the assistant orders them), alternating owners
  const zadej = async (n) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const r = await inst.api('POST', '/api/collections/ai_images/records', { token: su, body: { user: i % 2 ? UB : UA, prompt: 'a lighthouse at dusk, no text', title: 'Maják ' + i, model: 'klein', preset: 'ctverec', stav: 'ceka' } });
      if (r.status !== 200) throw new Error(`zadání obrázku: ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
      ids.push({ id: r.json.id, token: i % 2 ? B : A });
    }
    return ids;
  };
  const nakresli = (o) => inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: o.token, body: { id: o.id } });
  const stav = async (o) => ((await inst.api('GET', `/api/kb/chat/obrazek/${o.id}`, { token: o.token })).json.obrazek || {});

  console.log('== sériově: strop drží (předpoklad sady) ==');
  let zadane = await zadej(STROP + 1);
  const serie = [];
  for (const o of zadane) serie.push((await nakresli(o)).status);
  expect(serie.slice(0, STROP).every((s) => s === 200) && serie[STROP] === 429, `sériově ${STROP}× 200 a pak 429 (${serie.join(',')})`);
  await vycistiLog();

  console.log(`== ${KOL} kol × ${NARAZ} kreslení naráz, strop ${STROP} ==`);
  let pres = 0, min = 0, spatne = 0, bezChyby = 0, najednou = true;
  const prubeh = [];
  for (let k = 0; k < KOL; k++) {
    zadane = await zadej(NARAZ);
    const pred = kresleni; nejvicSoucasne = 0;
    const odp = await Promise.all(zadane.map(nakresli));
    const ok = odp.filter((x) => x.status === 200).length;
    const odm = odp.filter((x) => x.status === 429 && x.json && x.json.code === 'image_week');
    const brana1 = kresleni - pred;
    const radku = (await logKresleni()).filter((l) => l.stav === 'ok').length;
    prubeh.push(`${odp.map((x) => x.status).join(',')} | brána ${brana1}× | řádků ${radku}`);
    if (ok > STROP || brana1 > STROP || radku > STROP) pres++;
    if (ok < STROP) min++;
    if (ok + odm.length !== NARAZ) spatne++;
    if (nejvicSoucasne < Math.min(2, brana1)) najednou = false;
    // a refused picture ends as "chyba" with the weekly message (the card offers Try again), never as endless "ceka"
    for (let i = 0; i < odp.length; i++) {
      if (odp[i].status !== 429) continue;
      const s = await stav(zadane[i]);
      if (s.stav !== 'chyba' || !/pondělí/.test(s.chyba || '')) bezChyby++;
    }
    await vycistiLog();
  }
  console.log('   ' + prubeh.join('\n   '));
  expect(pres === 0, `NIKDY přes strop: úspěchů, volání brány ani řádků image_draw není víc než ${STROP} (kol přes strop: ${pres} z ${KOL})`);
  expect(min === 0, `strop se využije celý — v každém kole ${STROP} obrázky (kol s méně: ${min})`);
  expect(spatne === 0, `ostatní dostanou 429 image_week, nic jiného (kol s jinou odpovědí: ${spatne})`);
  expect(bezChyby === 0, `odmítnutý obrázek = stav „chyba“ s hláškou o týdnu (vadných: ${bezChyby})`);
  expect(najednou, 'předpoklad: brána opravdu kreslila víc obrázků současně (souběh nastal)');

  console.log('== část stropu už vyčerpaná: naráz projde jen zbytek ==');
  zadane = await zadej(STROP - 1);
  for (const o of zadane) await nakresli(o);
  zadane = await zadej(5);
  let pred = kresleni;
  let odp = await Promise.all(zadane.map(nakresli));
  expect(odp.filter((x) => x.status === 200).length === 1 && kresleni - pred === 1 && (await logKresleni()).length === STROP,
    `hotové ${STROP - 1}, naráz 5 → projde 1, brána 1× (${odp.map((x) => x.status).join(',')}, brána ${kresleni - pred}×)`);
  await vycistiLog();

  console.log('== /v1/images (API klíč) naráz ==');
  pred = kresleni;
  odp = await Promise.all(Array.from({ length: 6 }, (_, i) => inst.api('POST', '/api/kb/v1/images', { bearer: keyA, body: { prompt: 'a calm lake, no text', title: 'Jezero ' + i } })));
  expect(odp.filter((x) => x.status === 200).length === STROP && kresleni - pred === STROP && odp.filter((x) => x.status === 429).length === 6 - STROP,
    `v1/images 6 naráz → ${STROP}× 200, zbytek 429, brána ${STROP}× (${odp.map((x) => x.status).join(',')}, brána ${kresleni - pred}×)`);
  await vycistiLog();

  console.log('== nepovedené kreslení místo pod stropem VRÁTÍ ==');
  rezim = 'down';
  zadane = await zadej(NARAZ);
  odp = await Promise.all(zadane.map(nakresli));
  expect(odp.every((x) => x.status !== 200), `předpoklad: brána dole → žádný obrázek (${odp.map((x) => x.status).join(',')})`);
  rezim = 'ok';
  pred = kresleni;
  odp = await Promise.all(zadane.map(nakresli)); // "Try again" on all of them at once
  expect(odp.filter((x) => x.status === 200).length === STROP && kresleni - pred === STROP,
    `po výpadku jde nakreslit zase přesně ${STROP} (${odp.map((x) => x.status).join(',')}, brána ${kresleni - pred}×) — místa nezůstala zabraná`);
  await vycistiLog();

  console.log('== po souběhu: sériově strop počítá správně (nic nezůstalo viset) ==');
  zadane = await zadej(STROP + 1);
  const serie2 = [];
  for (const o of zadane) serie2.push((await nakresli(o)).status);
  expect(serie2.slice(0, STROP).every((s) => s === 200) && serie2[STROP] === 429, `sériově znovu ${STROP}× 200 a pak 429 (${serie2.join(',')})`);
}, { nazev: 'CHYBY4-SOUBEH-OBRAZKY' });
