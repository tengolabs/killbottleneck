// Changes made to a page WHILE the page writer is writing must survive (code analysis 4,
// finding S6-01). API suite against a FAKE ollama — no real model.
//
// Before: the writer kept the record it loaded at the start (minutes, up to 22 model calls)
// and saved it whole after every step, so a public link cancelled meanwhile came back to
// life, and a rename / team visibility / named share made during the writing was lost.
//
// What is measured (rewrite of a page written in parts — the default path):
//   A) during the writing: cancel the link, rename, show to the team, share by name →
//      after the writing all four changes hold, the old address is 404 AND the writer's
//      result is there (nothing lost in either direction); three rounds, the changes made
//      at different moments of the writing;
//   B) the writer FAILS (the error branch saved the old record too) → the link stays off;
//   C) "New link" during the writing → the new token holds, the old one stays dead;
//   D) the page is deleted during the writing → it stays deleted, the writer ends;
//   E) hybrid: the light model orders a rewrite and then hands the turn over — the order is
//      taken back (vratitTah), but a rename and a cancelled link made by the person DURING
//      that turn stay.
//
// Run: KB_TEST_IMAGE=<image> node product/tests/stranky-psani-soubeh.js
const H = require('./_harness');
const { expect, sleep } = H;

let zdrzeni = 0;          // ms per writer call
let castSelze = false;    // the section call answers without HTML
const volani = [];
const fronta = [];        // section E: answers in order ({ content | tool_calls, zdrzeni })
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  const b = JSON.parse(body);
  volani.push(b);
  if (fronta.length) {
    const o = fronta.shift();
    const message = { role: 'assistant', content: o.content || '' };
    if (o.tool_calls) message.tool_calls = o.tool_calls;
    setTimeout(() => res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 50, done: true })), o.zdrzeni || 0);
    return;
  }
  const system = (b.messages.find((m) => m.role === 'system') || {}).content || '';
  let content;
  if (/You plan CHANGES to an existing/.test(system)) {
    content = '{"skeleton": "keep", "sections": [{"id": "uvod", "action": "keep", "heading": "Úvod"}, {"id": "cisla", "action": "rewrite", "heading": "Čísla", "content": "nová čísla"}, {"id": "rizika", "action": "new", "heading": "Rizika", "content": "kapacita"}]}';
  } else if (castSelze) content = 'I cannot write this part.';
  else content = '```html\n<h2>Část</h2><p>NOVY-OBSAH-' + volani.length + '</p>\n```';
  const odpoved = () => res.end(JSON.stringify({ message: { role: 'assistant', content }, prompt_eval_count: 100, eval_count: 50, done: true }));
  if (zdrzeni) setTimeout(odpoved, zdrzeni); else odpoved();
};

const STRANKA = '<!doctype html>\n<html lang="cs"><head><meta charset="utf-8"><title>P</title></head><body>\n'
  + '<section id="sec-uvod"><!--sekce:uvod-->\n<h2>Úvod</h2><p>STARY-UVOD</p>\n<!--/sekce:uvod--></section>\n'
  + '<section id="sec-cisla"><!--sekce:cisla-->\n<h2>Čísla</h2><p>STARA-CISLA</p>\n<!--/sekce:cisla--></section>\n</body></html>';

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'str-soubeh', addHostGateway: true,
    env: { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600 } });
  const ra = await inst.register('admin@example.com', { name: 'Petr' });
  const rb = await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const su = await inst.superuser();
  const post = (path, body) => inst.api('POST', path, { token: A, body });
  const zaznam = async (id) => (await inst.api('GET', `/api/collections/ai_pages/records/${id}`, { token: su }));
  const verejna = async (token) => (await fetch(`${inst.base}/p/${token}`)).status;
  // a finished page with section markers and a public link, then queued for a rewrite
  const priprav = async (title) => {
    let r = await inst.api('POST', '/api/collections/ai_pages/records', { token: su, body: { user: ra.json.id, title, html: STRANKA, stav: 'hotovo' } });
    if (r.status !== 200) throw new Error(`stránka ${title}: ${r.status} ${JSON.stringify(r.json)}`);
    const id = r.json.id;
    r = await post('/api/kb/chat/stranka/sdilet', { id, akce: 'zapnout' });
    if (r.status !== 200 || !r.json.stranka.share_url) throw new Error(`odkaz ${title}: ${r.status} ${JSON.stringify(r.json)}`);
    const token = (await zaznam(id)).json.share_token;
    r = await inst.api('PATCH', `/api/collections/ai_pages/records/${id}`, { token: su, body: { stav: 'ceka', zadani: 'Změň čísla a přidej rizika.' } });
    if (r.status !== 200) throw new Error(`zadání přepisu ${title}: ${r.status}`);
    return { id, token };
  };
  const pise = (id) => fetch(`${inst.base}/api/kb/chat/stranka/napsat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: A, 'Accept-Language': 'cs' }, body: JSON.stringify({ id }) })
    .then(async (res) => ({ status: res.status, json: await res.json().catch(() => null) }));
  const azPise = (id) => H.waitFor(async () => { const z = (await zaznam(id)).json || {}; return z.stav === 'pise' && z.prubeh && (z.prubeh.kroky || []).length > 0; }, { timeout: 15000, krok: 100, popis: 'writer začal psát' });

  console.log('== A) změny sdílení a názvu BĚHEM psaní přežijí, výsledek writeru také ==');
  zdrzeni = 1500;
  for (const [kolo, odstup] of [[1, 0], [2, 1700], [3, 3300]]) {
    const { id, token } = await priprav(`Stranka ${kolo}`);
    expect(await verejna(token) === 200, `kolo ${kolo}: předpoklad — veřejný odkaz funguje`);
    const beh = pise(id);
    await azPise(id);
    if (odstup) await sleep(odstup);
    let r = await post('/api/kb/chat/stranka/sdilet', { id, akce: 'vypnout' });
    const vypnuto = r.status === 200 && r.json.stranka.shared === false && await verejna(token) === 404;
    r = await post('/api/kb/chat/stranka', { id, title: `Prejmenovano ${kolo}` });
    const prejm = r.status === 200;
    r = await post('/api/kb/chat/stranka/tym', { id, team_visible: true });
    const tym = r.status === 200 && r.json.stranka.team_visible === true;
    r = await post('/api/kb/chat/stranka/lide', { id, akce: 'pridat', user: 'clen@example.com' });
    const lide = r.status === 200;
    expect(vypnuto && prejm && tym && lide, `kolo ${kolo}: během psaní zrušen odkaz, přejmenováno, zapnut tým, nasdíleno jmenovitě (${[vypnuto, prejm, tym, lide]})`);
    const mezi = (await zaznam(id)).json;
    expect(mezi.stav === 'pise', `kolo ${kolo}: writer mezitím dál píše (${mezi.stav})`);
    const vysl = await beh;
    const po = (await zaznam(id)).json;
    expect(vysl.status === 200 && po.stav === 'hotovo', `kolo ${kolo}: psaní doběhlo (${vysl.status} ${po.stav} ${(vysl.json || {}).error || ''})`);
    expect(po.share_token === '' && await verejna(token) === 404, `kolo ${kolo}: zrušený odkaz zůstal ZRUŠENÝ (token „${po.share_token}", GET /p → ${await verejna(token)})`);
    expect(po.title === `Prejmenovano ${kolo}`, `kolo ${kolo}: přejmenování zůstalo („${po.title}")`);
    expect(po.team_visible === true, `kolo ${kolo}: viditelnost pro tým zůstala (${po.team_visible})`);
    expect(JSON.stringify(po.shared_with) === JSON.stringify([rb.json.id]), `kolo ${kolo}: jmenovité sdílení zůstalo (${JSON.stringify(po.shared_with)})`);
    expect(/NOVY-OBSAH/.test(po.html) && /STARY-UVOD/.test(po.html) && !/STARA-CISLA/.test(po.html) && /STARA-CISLA/.test(po.predchozi_html || ''),
      `kolo ${kolo}: výsledek writeru je uložený (přepsaná část nová, zachovaná původní, předchozí verze schovaná)`);
  }

  console.log('== B) writer SELŽE → zrušený odkaz zůstane zrušený ==');
  castSelze = true;
  {
    const { id, token } = await priprav('Selhani');
    const beh = pise(id);
    await azPise(id);
    const r = await post('/api/kb/chat/stranka/sdilet', { id, akce: 'vypnout' });
    expect(r.status === 200 && await verejna(token) === 404, 'během psaní odkaz zrušen');
    const vysl = await beh;
    const po = (await zaznam(id)).json;
    expect(vysl.status === 502 && po.stav === 'chyba', `psaní skončilo chybou (${vysl.status} ${po.stav})`);
    expect(po.share_token === '' && await verejna(token) === 404, `odkaz zůstal zrušený i po chybě writeru (token „${po.share_token}")`);
    expect(Array.isArray((po.prubeh || {}).kroky) && po.prubeh.kroky.some((k) => k.s === 'chyba'), 'průběh s chybným krokem se uložil (panel nabídne Zkusit znovu)');
  }
  castSelze = false;

  console.log('== C) „Nový odkaz" během psaní → platí nový, starý je mrtvý ==');
  {
    const { id, token } = await priprav('Novy odkaz');
    const beh = pise(id);
    await azPise(id);
    const r = await post('/api/kb/chat/stranka/sdilet', { id, akce: 'obnovit' });
    const novy = (await zaznam(id)).json.share_token;
    expect(r.status === 200 && !!novy && novy !== token, 'během psaní vydán nový odkaz');
    const vysl = await beh;
    const po = (await zaznam(id)).json;
    expect(vysl.status === 200 && po.share_token === novy, `po psaní platí NOVÝ token (${po.share_token === novy})`);
    expect(await verejna(token) === 404 && await verejna(novy) === 200, `starý odkaz 404, nový 200 (${await verejna(token)}, ${await verejna(novy)})`);
  }

  console.log('== D) stránka smazaná během psaní zůstane smazaná ==');
  {
    const { id, token } = await priprav('Smazana');
    const pred = volani.length;
    const beh = pise(id);
    await azPise(id);
    const r = await post('/api/kb/chat/stranka/smazat', { id });
    expect(r.status === 200, `během psaní smazána (${r.status})`);
    const vysl = await beh;
    expect(vysl.status !== 200, `writer skončil bez úspěchu (${vysl.status})`);
    expect((await zaznam(id)).status === 404 && await verejna(token) === 404, 'stránka se nevrátila (záznam ani veřejná adresa)');
    expect(volani.length - pred <= 2, `writer po smazání přestal volat model (${volani.length - pred} volání)`);
    // the writer slot of the user is free again
    const dalsi = await priprav('Po smazane');
    zdrzeni = 0;
    const v2 = await pise(dalsi.id);
    expect(v2.status === 200, `další psaní téhož uživatele projde — zámek writeru se uvolnil (${v2.status})`);
  }

  console.log('== E) hybrid: zahozený tah lehkého modelu nepřepíše přejmenování ani zrušený odkaz ==');
  {
    const hy = await H.startInstance({ slug: 'str-soubeh-hy', addHostGateway: true, env: { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
      KB_CHAT_LIGHT_PROVIDER: 'ollama', KB_CHAT_LIGHT_URL: mock.base, KB_CHAT_LIGHT_MODEL: 'm-light', KB_CHAT_HYBRID: 'klasifikator,predani' } });
    const ru = await hy.register('hy@example.com', { name: 'Hy' });
    const HY = await hy.login('hy@example.com');
    const suHy = await hy.superuser();
    let r = await hy.api('POST', '/api/collections/ai_pages/records', { token: suHy, body: { user: ru.json.id, title: 'Hybridni stranka', html: STRANKA, stav: 'hotovo' } });
    const id = r.json.id;
    r = await hy.api('POST', '/api/kb/chat/stranka/sdilet', { token: HY, body: { id, akce: 'zapnout' } });
    const token = (await hy.api('GET', `/api/collections/ai_pages/records/${id}`, { token: suHy })).json.share_token;
    expect(r.status === 200 && !!token, 'předpoklad: hotová stránka s veřejným odkazem');
    const tc = (name, args) => ({ function: { name, arguments: args } });
    fronta.push({ content: '{"zapis": false}' },
      { tool_calls: [tc('update_page', { page: id, instructions: 'Přepiš čísla.', title: 'Nazev od lehkeho modelu' })] },
      { tool_calls: [tc('add_idea_to_map', { idea_id: 'x', map_id: 'y' })], zdrzeni: 3000 }, // a write → the light model hands the turn over
      { content: 'Hotovo.' });
    const pred = volani.length;
    const tah = hy.api('POST', '/api/kb/chat', { token: HY, body: { message: 'uprav stránku Hybridni stranka a vlož nápad' } });
    const zadano = await H.waitFor(async () => (await hy.api('GET', `/api/collections/ai_pages/records/${id}`, { token: suHy })).json.stav === 'ceka', { timeout: 10000, krok: 100, popis: 'lehký model zadal přepis' }).then(() => true).catch(() => false);
    expect(zadano, 'lehký model zadal přepis (stránka čeká, název změnil)');
    const r1 = await hy.api('POST', '/api/kb/chat/stranka', { token: HY, body: { id, title: 'Prejmenovano clovekem' } });
    const r2 = await hy.api('POST', '/api/kb/chat/stranka/sdilet', { token: HY, body: { id, akce: 'vypnout' } });
    expect(r1.status === 200 && r2.status === 200, `během tahu: člověk stránku přejmenoval a zrušil odkaz (${r1.status}, ${r2.status})`);
    const rt = await tah;
    const po = (await hy.api('GET', `/api/collections/ai_pages/records/${id}`, { token: suHy })).json;
    expect(rt.status === 200 && volani.slice(pred).map((v) => v.model).join(',') === 'm-light,m-light,m-light,m-a', `tah lehkého modelu byl předán hlavnímu (${rt.status}; ${volani.slice(pred).map((v) => v.model).join(',')})`);
    expect(po.stav === 'hotovo' && po.zadani === '', `zadání přepisu ze zahozeného tahu je vrácené (${po.stav}, „${po.zadani}")`);
    expect(po.title === 'Prejmenovano clovekem', `přejmenování člověkem zůstalo („${po.title}")`);
    expect(po.share_token === '' && (await fetch(`${hy.base}/p/${token}`)).status === 404, `zrušený odkaz zůstal zrušený (token „${po.share_token}")`);
  }
}, { nazev: 'STRANKY-PSANI-SOUBEH' });
