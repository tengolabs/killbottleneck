// Code analysis 4, finding S8-04, the second entry — the weekly picture cap and the ILLUSTRATIONS
// OF PAGES written at once (obrazky.js dosadIlustrace → reserveWeek). chyby4-soubeh-obrazky.js
// covers the cards (/chat/obrazek/vytvorit) and /v1/images only.
//
// Several people have a page rewritten at the same moment; the writer (a FAKE ollama) puts an
// illustration mark <img data-kb-image="…"> into every section it writes, the server draws the
// marks through a mocked gateway that holds every answer for a while. The invariant: the gateway
// is NEVER asked for more pictures than the cap leaves, the pages are finished anyway (a refused
// mark just disappears), and no reservation stays behind.
// No real model, no real image generator.
// Run: KB_TEST_IMAGE=<image> node product/tests/chyby4-soubeh-obrazky-stranky.js
const H = require('./_harness');
const { expect } = H;

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDPooorhPqD/9k=';
const STROP = 3;
const LIDI = 6;          // pages written at once, each by another person (the writer allows few per person)
const ZNACEK = 2;        // illustration marks per page (one in each written section)
const KOL = 3;
const DRZI_MS = 500;     // the gateway holds every answer → the drawings of all pages are in flight together

const STRANKA = '<!doctype html>\n<html lang="cs"><head><meta charset="utf-8"><title>P</title></head><body>\n'
  + '<section id="sec-uvod"><!--sekce:uvod-->\n<h2>Úvod</h2><p>STARY-UVOD</p>\n<!--/sekce:uvod--></section>\n'
  + '<section id="sec-cisla"><!--sekce:cisla-->\n<h2>Čísla</h2><p>STARA-CISLA</p>\n<!--/sekce:cisla--></section>\n</body></html>';

H.beh(async () => {
  // ---------- fake ollama: the plan of changes, then one section per call, each with ONE mark ----------
  let sekci = 0;
  const llm = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
    const b = JSON.parse(body);
    const system = (b.messages.find((m) => m.role === 'system') || {}).content || '';
    let content;
    if (/You plan CHANGES to an existing/.test(system)) {
      content = '{"skeleton": "keep", "sections": [{"id": "uvod", "action": "keep", "heading": "Úvod"}, {"id": "cisla", "action": "rewrite", "heading": "Čísla", "content": "nová čísla"}, {"id": "rizika", "action": "new", "heading": "Rizika", "content": "kapacita"}]}';
    } else {
      sekci++;
      content = '```html\n<h2>Část</h2><img data-kb-image="stacked wooden boards number ' + sekci + '" data-format="landscape" alt="Ilustrace ' + sekci + '"><p>NOVY-OBSAH-' + sekci + '</p>\n```';
    }
    res.end(JSON.stringify({ message: { role: 'assistant', content }, prompt_eval_count: 100, eval_count: 50, done: true }));
  });
  // ---------- mocked picture gateway ----------
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
      res.end(JSON.stringify({ image_base64: JPEG, mime: 'image/jpeg', model: b.model, seed: 1000 + kresleni, size: '1024x1024', gen_s: 0.5, schema_version: 1 }));
    }, DRZI_MS);
  });

  const inst = await H.startInstance({ slug: 'soubeh-obr-stranky', addHostGateway: true,
    env: { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: llm.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 100000,
      KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok', KB_OBRAZKY_TYDEN: STROP } });
  const lide = [];
  for (let i = 0; i < LIDI; i++) {
    const r = await inst.register(`clovek${i}@example.com`, { name: 'Člověk ' + i }); // clovek0 = admin
    lide.push({ id: r.json.id, token: await inst.login(`clovek${i}@example.com`) });
  }
  const su = await inst.superuser();

  const logKresleni = async () => ((await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=500', { token: su })).json.items || []).filter((l) => l.tools === 'image_draw');
  const vycistiLog = async () => {
    const vse = ((await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=500', { token: su })).json.items || []);
    for (const l of vse) await inst.api('DELETE', `/api/collections/ai_chat_log/records/${l.id}`, { token: su });
    const zbylo = (await logKresleni()).length;
    if (zbylo) throw new Error(`log se nevyčistil (${zbylo} řádků) — kola by na sebe navazovala`);
  };
  // a finished page of that person, queued for a rewrite (the writer then rewrites one section and adds one)
  const priprav = async (clovek, title) => {
    const r = await inst.api('POST', '/api/collections/ai_pages/records', { token: su, body: { user: clovek.id, title, html: STRANKA, stav: 'ceka', zadani: 'Změň čísla a přidej rizika.' } });
    if (r.status !== 200) throw new Error(`stránka ${title}: ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
    return { id: r.json.id, token: clovek.token };
  };
  const napis = (s) => inst.api('POST', '/api/kb/chat/stranka/napsat', { token: s.token, body: { id: s.id } });
  const html = async (s) => ((await inst.api('GET', `/api/collections/ai_pages/records/${s.id}`, { token: su })).json || {});
  const obrazku = (h) => (String(h || '').match(/<img [^>]*src="\/api\/files\/ai_images\//g) || []).length;
  // one burst: every person has one page written at the same moment → what the pages and the gateway say
  const davka = async (jmeno, kdo) => {
    const stranky = [];
    for (let i = 0; i < kdo.length; i++) stranky.push(await priprav(kdo[i], `${jmeno} ${i}`));
    const pred = kresleni; nejvicSoucasne = 0;
    const odp = await Promise.all(stranky.map(napis));
    const zaznamy = [];
    for (const s of stranky) zaznamy.push(await html(s));
    return { odp, zaznamy, brana: kresleni - pred, najednou: nejvicSoucasne,
      hotove: odp.filter((x) => x.status === 200 && x.json && x.json.stranka && x.json.stranka.stav === 'hotovo').length,
      obr: zaznamy.reduce((a, z) => a + obrazku(z.html), 0),
      znacek: zaznamy.filter((z) => /data-kb-image/.test(z.html || '')).length,
      obsah: zaznamy.filter((z) => /NOVY-OBSAH/.test(z.html || '') && /STARY-UVOD/.test(z.html || '')).length,
      radku: (await logKresleni()).filter((l) => l.stav === 'ok').length };
  };

  console.log('== sériově: strop platí i pro ilustrace stránek (předpoklad sady) ==');
  const serie = [];
  for (let i = 0; i < 3; i++) {
    const s = await priprav(lide[i], 'Sériová ' + i);
    const r = await napis(s);
    serie.push(`${r.status}/${obrazku((await html(s)).html)}`);
  }
  expect(serie.join() === '200/2,200/1,200/0' && kresleni === STROP, `tři stránky po sobě, strop ${STROP}: 2 + 1 + 0 ilustrací, brána ${STROP}× (${serie.join(', ')}, brána ${kresleni}×)`);
  await vycistiLog();

  console.log(`== ${KOL} kola × ${LIDI} stránek naráz (po ${ZNACEK} značkách), strop ${STROP} ==`);
  let pres = 0, min = 0, nedopsane = 0, zbyleZnacky = 0, nesedi = 0, najednou = true;
  const prubeh = [];
  for (let k = 0; k < KOL; k++) {
    const d = await davka('Kolo ' + k, lide);
    prubeh.push(`stavy ${d.odp.map((x) => x.status).join(',')} | hotových ${d.hotove} | brána ${d.brana}× (nejvíc současně ${d.najednou}) | ilustrací ve stránkách ${d.obr} | řádků image_draw ${d.radku}`);
    if (d.brana > STROP || d.radku > STROP || d.obr > STROP) pres++;
    if (d.brana < STROP) min++;
    if (d.hotove !== LIDI || d.obsah !== LIDI) nedopsane++;
    if (d.znacek) zbyleZnacky++;
    if (d.obr !== d.radku || d.obr !== d.brana) nesedi++;
    if (d.najednou < 2) najednou = false;
    await vycistiLog();
  }
  console.log('   ' + prubeh.join('\n   '));
  expect(pres === 0, `NIKDY přes strop: volání brány, řádků image_draw ani ilustrací ve stránkách není víc než ${STROP} (kol přes strop: ${pres} z ${KOL})`);
  expect(min === 0, `strop se využije celý — v každém kole ${STROP} ilustrace (kol s méně: ${min})`);
  expect(nedopsane === 0, `všechny stránky jsou dopsané i s novým obsahem, odmítnutá ilustrace psaní neshodí (kol s nedopsanou stránkou: ${nedopsane})`);
  expect(zbyleZnacky === 0, `v žádné stránce nezůstala značka data-kb-image (kol se zbylou značkou: ${zbyleZnacky})`);
  expect(nesedi === 0, `počty sedí: ilustrací ve stránkách = řádků image_draw = volání brány (kol s rozdílem: ${nesedi})`);
  expect(najednou, 'předpoklad: brána opravdu kreslila ilustrace víc stránek současně (souběh nastal)');

  console.log('== stránky a karty obrázků naráz: strop je společný ==');
  const karty = [];
  for (let i = 0; i < STROP - 1; i++) { // fewer cards than the cap: the last place is left for the pages
    const r = await inst.api('POST', '/api/collections/ai_images/records', { token: su, body: { user: lide[i].id, prompt: 'a lighthouse at dusk, no text', title: 'Maják ' + i, model: 'klein', preset: 'ctverec', stav: 'ceka' } });
    if (r.status !== 200) throw new Error(`zadání obrázku: ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
    karty.push({ id: r.json.id, token: lide[i].token });
  }
  const strankyMix = [];
  for (let i = 0; i < 4; i++) strankyMix.push(await priprav(lide[i], 'Mix ' + i));
  let pred = kresleni;
  const [odpK, odpS] = await Promise.all([
    Promise.all(karty.map((o) => inst.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: o.token, body: { id: o.id } }))),
    Promise.all(strankyMix.map(napis))]);
  let obrMix = 0;
  for (const s of strankyMix) obrMix += obrazku((await html(s)).html);
  const kartOk = odpK.filter((x) => x.status === 200).length;
  const radkuMix = (await logKresleni()).filter((l) => l.stav === 'ok').length;
  expect(kresleni - pred === STROP && kartOk === STROP - 1 && obrMix === 1 && radkuMix === STROP,
    `${STROP - 1} karty + 4 stránky naráz → dohromady právě ${STROP} obrázky: karty všechny, na stránky zbyde 1 ilustrace (karty ${kartOk}, ilustrace ${obrMix}, brána ${kresleni - pred}×, řádků ${radkuMix})`);
  expect(odpS.every((x) => x.status === 200 && x.json.stranka.stav === 'hotovo') && odpK.every((x) => x.status === 200),
    `stránky dopsané, karty nakreslené (stránky ${odpS.map((x) => x.status).join(',')}; karty ${odpK.map((x) => x.status).join(',')})`);
  await vycistiLog();

  console.log('== po souběhu: nic nezůstalo zabrané ==');
  pred = kresleni;
  const s1 = await priprav(lide[0], 'Po souběhu');
  const r1 = await napis(s1);
  expect(r1.status === 200 && obrazku((await html(s1)).html) === ZNACEK && kresleni - pred === ZNACEK, `jedna stránka po souběhu dostane obě ilustrace (${obrazku((await html(s1)).html)}, brána ${kresleni - pred}×)`);
}, { nazev: 'CHYBY4-SOUBEH-OBRAZKY-STRANKY' });
