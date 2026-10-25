// Stránky asistenta (14. 10. 2026) — serverová sada BEZ modelu: v1 API (externí agent nahraje HTML),
// routy panelu /chat/strank*, veřejná /p/{token} (sandbox CSP, nosniff, noindex, no-store, 404 pro
// zrušený i neexistující token, minutová brzda), tým (DTO bez tokenu, cizí 404), verze/vrátit,
// limity KB_PAGE_KB / KB_PAGES_MAX / KB_PAGES=0, zámek zkušebky (čtení žije, zápis 402),
// export dat nese stránky bez tokenu, record API zavřené, service worker /p/ neobsluhuje.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/stranky-verejne.js
const H = require('./_harness');
const { expect } = H;
const fs = require('fs');
const path = require('path');

const HTML = (zn) => `<!doctype html>\n<html lang="cs"><head><meta charset="utf-8"><title>${zn}</title></head><body><h1>${zn}</h1><script>document.title='x'</script></body></html>`;
const CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-popups-to-escape-sandbox; form-action 'none'; connect-src 'none'; frame-ancestors 'none'"; // /checkup 25. 10.: form-action/connect-src chrání návštěvníka (phishing z cizí stránky), frame-ancestors proti vložení do cizího webu

// syrový GET bez přihlášení (cizí návštěvník s odkazem)
const verejne = async (inst, cesta) => {
  const res = await fetch(inst.base + cesta, { redirect: 'manual' });
  return { status: res.status, headers: res.headers, text: await res.text() };
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'stranky', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const klicA = (await inst.api('POST', '/api/kb/api-keys', { token: A, body: { label: 'agent', scope: 'read_write' } })).json.token;
  expect(!!klicA, 'API klíč read_write založen');

  console.log('== /config hlásí stránky ==');
  let r = await inst.api('GET', '/api/kb/config');
  expect(r.json.pages && r.json.pages.max === 100 && r.json.pages.kb === 300, `config.pages = výchozí limity (${JSON.stringify(r.json.pages)})`);

  console.log('== v1: externí agent nahraje hotovou stránku ==');
  r = await inst.api('POST', '/api/kb/v1/pages', { bearer: klicA, body: { title: 'Prezentace Q4', html: HTML('STR-1') } });
  expect(r.status === 200 && r.json.page && r.json.page.status === 'hotovo' && r.json.page.share_url === '' && r.json.page.team_visible === false, `POST /v1/pages → hotová, nesdílená (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
  const id = r.json.page.id;
  r = await inst.api('GET', '/api/kb/v1/pages', { bearer: klicA });
  expect(r.status === 200 && r.json.pages.length === 1 && r.json.pages[0].id === id && !('html' in r.json.pages[0]), 'GET /v1/pages = seznam bez HTML');
  r = await inst.api('GET', `/api/kb/v1/pages/${id}`, { bearer: klicA });
  expect(r.status === 200 && /STR-1/.test(r.json.page.html), 'GET /v1/pages/{id} nese HTML');
  r = await inst.api('POST', '/api/kb/v1/pages', { bearer: klicA, body: { title: '', html: HTML('x') } });
  expect(r.status === 400, `bez názvu → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/v1/pages', { bearer: klicA, body: { title: 'bez html' } });
  expect(r.status === 400, `bez HTML → 400 (${r.status})`);

  console.log('== panel: vlastník vidí, cizí 404, tým zatím nic ==');
  r = await inst.api('GET', '/api/kb/chat/stranky', { token: A });
  expect(r.status === 200 && r.json.stranky.length === 1 && r.json.stranky[0].mine === true && r.json.stranky[0].shared === false && !('html' in r.json.stranky[0]) && r.json.max === 100, `vlastník: 1 stránka v seznamu, bez HTML (${JSON.stringify(r.json).slice(0, 160)})`);
  expect((await inst.api('GET', '/api/kb/chat/stranky', { token: B })).json.stranky.length === 0, 'člen: žádné vlastní stránky');
  expect((await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: B })).json.stranky.length === 0, 'člen: týmový seznam prázdný (stránka není pro tým)');
  r = await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: B });
  expect(r.status === 404, `člen: cizí stránka 404 (${r.status})`);
  r = await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: A });
  expect(r.status === 200 && /STR-1/.test(r.json.stranka.html) && r.json.stranka.share_token === '' && r.json.stranka.size_kb > 0, 'vlastník: detail s HTML a (prázdným) tokenem');

  console.log('== veřejný odkaz ==');
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A, body: { id, akce: 'zapnout' } });
  const tok1 = r.json.stranka && r.json.stranka.share_token;
  expect(r.status === 200 && /^[a-z0-9]{32}$/.test(tok1) && r.json.stranka.share_url === `${inst.base}/p/${tok1}`, `sdílet zapnout → token 32 znaků + adresa (${r.json.stranka && r.json.stranka.share_url})`);
  // adresa odkazu = adresa, na které uživatel aplikaci používá (jako odkaz na mapu; klik-test 25. 10. 2026): LAN → LAN
  r = await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: A, headers: { 'X-Forwarded-Host': 'kb.firma.local:8090', 'X-Forwarded-Proto': 'http' } });
  expect(r.status === 200 && r.json.stranka.share_url === `http://kb.firma.local:8090/p/${tok1}`, `odkaz nese adresu požadavku (X-Forwarded-Host) (${r.json.stranka && r.json.stranka.share_url})`);
  r = await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: A, headers: { 'X-Forwarded-Host': 'zly host "x', 'X-Forwarded-Proto': 'http' } });
  expect(r.status === 200 && r.json.stranka.share_url === `${inst.base}/p/${tok1}`, 'neplatný X-Forwarded-Host se zahodí → adresa požadavku');
  let v = await verejne(inst, `/p/${tok1}`);
  expect(v.status === 200 && /STR-1/.test(v.text) && v.text.startsWith('<!doctype html>'), `GET /p/<token> bez přihlášení → 200 s HTML (${v.status})`);
  expect(v.headers.get('content-security-policy') === CSP, `CSP sandbox přesně (${v.headers.get('content-security-policy')})`);
  expect(!/allow-same-origin/.test(v.headers.get('content-security-policy') || ''), 'CSP NIKDY allow-same-origin');
  expect(/^text\/html; charset=utf-8/i.test(v.headers.get('content-type') || ''), `Content-Type text/html utf-8 (${v.headers.get('content-type')})`);
  expect(v.headers.get('x-content-type-options') === 'nosniff', 'nosniff');
  expect(/noindex/.test(v.headers.get('x-robots-tag') || '') && /nofollow/.test(v.headers.get('x-robots-tag') || ''), `X-Robots-Tag noindex, nofollow (${v.headers.get('x-robots-tag')})`);
  expect(v.headers.get('referrer-policy') === 'no-referrer', 'Referrer-Policy no-referrer');
  expect(/no-store/.test(v.headers.get('cache-control') || ''), `Cache-Control no-store — zrušení odkazu platí hned (${v.headers.get('cache-control')})`);
  expect(/camera=\(\)/.test(v.headers.get('permissions-policy') || ''), 'Permissions-Policy bez kamery/mikrofonu/polohy');
  v = await verejne(inst, '/p/' + 'z'.repeat(32));
  expect(v.status === 404 && !/<html/i.test(v.text), `neexistující token → 404 bez HTML (${v.status})`);
  v = await verejne(inst, '/p/kratky');
  expect(v.status === 404, `token špatného tvaru → 404 (${v.status})`);
  v = await verejne(inst, '/p/' + tok1.toUpperCase());
  expect(v.status === 404, 'velká písmena = jiný (neplatný) token');
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A, body: { id, akce: 'zapnout' } });
  expect(r.json.stranka.share_token === tok1, 'druhé „zapnout“ token nemění (odkaz zůstává platný)');
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A, body: { id, akce: 'obnovit' } });
  const tok2 = r.json.stranka.share_token;
  expect(/^[a-z0-9]{32}$/.test(tok2) && tok2 !== tok1, 'obnovit → nový token');
  expect((await verejne(inst, `/p/${tok1}`)).status === 404 && (await verejne(inst, `/p/${tok2}`)).status === 200, 'starý odkaz hned 404, nový 200');
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A, body: { id, akce: 'vypnout' } });
  expect(r.json.stranka.share_token === '' && r.json.stranka.shared === false && r.json.stranka.share_url === '', 'vypnout → bez tokenu a bez adresy');
  expect((await verejne(inst, `/p/${tok2}`)).status === 404, 'po vypnutí odkaz 404');
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A, body: { id, akce: 'cokoli' } });
  expect(r.status === 400, `neznámá akce → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: B, body: { id, akce: 'zapnout' } });
  expect(r.status === 404, `člen nesmí sdílet cizí stránku (404, ${r.status})`);
  r = await inst.api('POST', `/api/kb/v1/pages/${id}/share`, { bearer: klicA, body: { action: 'link_on' } });
  const tok3 = r.json.page && r.json.page.share_url;
  expect(r.status === 200 && /\/p\/[a-z0-9]{32}$/.test(tok3), `v1 share link_on → share_url (${tok3})`);
  expect((await verejne(inst, tok3.replace(inst.base, ''))).status === 200, 'v1 odkaz funguje');
  r = await inst.api('POST', `/api/kb/v1/pages/${id}/share`, { bearer: klicA, body: { action: 'link_off' } });
  expect(r.json.page.share_url === '', 'v1 link_off');

  console.log('== tým ==');
  r = await inst.api('POST', '/api/kb/chat/stranka/tym', { token: A, body: { id, team_visible: true } });
  expect(r.status === 200 && r.json.stranka.team_visible === true, 'vidí tým zapnuto');
  r = await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: B });
  const t1 = r.json.stranky[0];
  expect(r.json.stranky.length === 1 && t1.id === id && t1.mine === false && t1.owner_name === 'Petr' && !('share_token' in t1) && !('owner' in t1) && !('html' in t1), `člen vidí týmovou stránku: autor jménem, BEZ tokenu a id autora (${JSON.stringify(t1)})`);
  expect((await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: A })).json.stranky.length === 0, 'vlastní stránky v týmovém seznamu nejsou (jsou v Moje)');
  r = await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: B });
  expect(r.status === 200 && /STR-1/.test(r.json.stranka.html) && !('share_token' in r.json.stranka) && r.json.stranka.mine === false, 'člen otevře týmovou stránku (HTML ano, token ne)');
  r = await inst.api('POST', '/api/kb/chat/stranka/tym', { token: B, body: { id, team_visible: false } });
  expect(r.status === 404, 'člen nemůže týmové sdílení vypnout (404)');
  r = await inst.api('POST', '/api/kb/chat/stranka/smazat', { token: B, body: { id } });
  expect(r.status === 404, 'člen nemůže týmovou stránku smazat (404)');
  r = await inst.api('POST', '/api/kb/chat/stranka', { token: B, body: { id, title: 'hack' } });
  expect(r.status === 404, 'člen nemůže týmovou stránku přejmenovat (404)');
  r = await inst.api('POST', `/api/kb/v1/pages/${id}/share`, { bearer: klicA, body: { action: 'team_off' } });
  expect(r.json.page.team_visible === false && (await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: B })).json.stranky.length === 0, 'v1 team_off → člen už nevidí');

  console.log('== jmenovité sdílení přes v1 (user_on / user_off, shared_with e-maily) ==');
  r = await inst.api('POST', `/api/kb/v1/pages/${id}/share`, { bearer: klicA, body: { action: 'user_on', email: 'clen@example.com' } });
  expect(r.status === 200 && JSON.stringify(r.json.page.shared_with) === '["clen@example.com"]', `v1 user_on → shared_with e-maily (${JSON.stringify(r.json.page.shared_with)})`);
  r = await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: B });
  expect(r.status === 200 && r.json.stranka.mine === false, 'jmenovitě nasdílený člen stránku otevře');
  expect((await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: B })).json.stranky.length === 1, 'a vidí ji v „sdílené se mnou“');
  r = await inst.api('POST', `/api/kb/v1/pages/${id}/share`, { bearer: klicA, body: { action: 'user_on', email: 'nikdo@example.com' } });
  expect(r.status === 400, `v1 user_on neznámý e-mail → 400 (${r.status})`);
  r = await inst.api('POST', `/api/kb/v1/pages/${id}/share`, { bearer: klicA, body: { action: 'user_off', email: 'clen@example.com' } });
  expect(r.status === 200 && r.json.page.shared_with.length === 0 && (await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: B })).status === 404, 'v1 user_off → člen už nevidí');

  console.log('== verze, přejmenování, vrátit ==');
  r = await inst.api('POST', `/api/kb/v1/pages/${id}`, { bearer: klicA, body: { html: HTML('STR-2'), title: 'Prezentace Q4 v2' } });
  expect(r.status === 200 && r.json.page.title === 'Prezentace Q4 v2', 'v1 nová verze + název');
  r = await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: A });
  expect(/STR-2/.test(r.json.stranka.html) && r.json.stranka.ma_predchozi === true, 'detail: nové HTML, předchozí verze k dispozici');
  r = await inst.api('POST', '/api/kb/chat/stranka/vratit', { token: A, body: { id } });
  expect(r.status === 200 && /STR-1/.test(r.json.stranka.html) && r.json.stranka.title === 'Prezentace Q4', `vrátit → STR-1 a původní název (${r.json.stranka && r.json.stranka.title})`);
  r = await inst.api('POST', '/api/kb/chat/stranka/vratit', { token: A, body: { id } });
  expect(/STR-2/.test(r.json.stranka.html) && r.json.stranka.title === 'Prezentace Q4 v2', 'druhé vrátit = zpět na STR-2');
  r = await inst.api('POST', '/api/kb/chat/stranka', { token: A, body: { id, title: 'Výsledky Q4' } });
  expect(r.status === 200 && r.json.stranka.title === 'Výsledky Q4', 'přejmenování z panelu');
  r = await inst.api('POST', `/api/kb/v1/pages/${id}`, { bearer: klicA, body: { html: HTML('STR-2') } });
  r = await inst.api('POST', `/api/kb/v1/pages/${id}`, { bearer: klicA, body: {} });
  expect(r.status === 400, `v1 bez html i názvu → 400 (${r.status})`);

  console.log('== record API zavřené, export ==');
  r = await inst.api('POST', '/api/collections/ai_pages/records', { token: A, body: { user: 'x', title: 'přímo', html: HTML('hack'), stav: 'hotovo' } });
  expect(r.status === 400 || r.status === 403, `přímý zápis do ai_pages zavřený (${r.status})`);
  r = await inst.api('GET', '/api/collections/ai_pages/records', { token: B });
  expect(r.status === 200 && r.json.items.length === 0, 'record API: člen cizí stránky nevidí (ani týmové — ty jdou jen přes routu)');
  r = await inst.api('GET', '/api/collections/ai_pages/records', { token: A });
  expect(r.status === 200 && r.json.items.length === 1, 'record API: vlastník své vidí (realtime pro panel)');
  r = await inst.api('GET', '/api/kb/export', { token: A });
  const ex = r.json && r.json.pages;
  expect(Array.isArray(ex) && ex.length === 1 && /STR-2/.test(ex[0].html) && ex[0].title === 'Výsledky Q4' && !('share_token' in ex[0]) && r.json.counts.pages === 1, `export nese stránky bez tokenu (${JSON.stringify(ex && ex[0] && Object.keys(ex[0]))})`);

  console.log('== smazání ==');
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A, body: { id, akce: 'zapnout' } });
  const tok4 = r.json.stranka.share_token;
  r = await inst.api('DELETE', `/api/kb/v1/pages/${id}`, { bearer: klicA });
  expect(r.status === 200 && (await verejne(inst, `/p/${tok4}`)).status === 404, 'v1 DELETE → veřejný odkaz 404');
  expect((await inst.api('GET', '/api/kb/chat/stranky', { token: A })).json.stranky.length === 0, 'seznam prázdný');

  console.log('== limity: KB_PAGE_KB=1, KB_PAGES_MAX=1 + minutová brzda ==');
  const inst2 = await H.startInstance({ slug: 'stranky-limity', env: { KB_UVODNI_MAPA: 0, KB_PAGE_KB: 1, KB_PAGES_MAX: 1, KB_PUBLIC_URL: 'https://firma.killbottleneck.com' } });
  await inst2.register('a@example.com', { name: 'A' });
  const A2 = await inst2.login('a@example.com');
  const klic2 = (await inst2.api('POST', '/api/kb/api-keys', { token: A2, body: { label: 'k', scope: 'read_write' } })).json.token;
  expect((await inst2.api('GET', '/api/kb/config')).json.pages.kb === 1, 'config.pages.kb = 1');
  r = await inst2.api('POST', '/api/kb/v1/pages', { bearer: klic2, body: { title: 'velká', html: HTML('V') + '<!--' + 'x'.repeat(1100) + '-->' } });
  expect(r.status === 400 && /1 kB/.test(r.json.error), `HTML nad KB_PAGE_KB → 400 s limitem (${r.status} ${r.json.error})`);
  r = await inst2.api('POST', '/api/kb/v1/pages', { bearer: klic2, body: { title: 'malá', html: HTML('M') } });
  expect(r.status === 200, 'malá stránka projde');
  const id2 = r.json.page.id;
  r = await inst2.api('POST', '/api/kb/v1/pages', { bearer: klic2, body: { title: 'druhá', html: HTML('D') } });
  expect(r.status === 400 && /1 str/.test(r.json.error), `KB_PAGES_MAX=1 → druhá 400 (${r.status} ${r.json.error})`);
  r = await inst2.api('POST', `/api/kb/v1/pages/${id2}/share`, { bearer: klic2, body: { action: 'link_on' } });
  // KB_PUBLIC_URL (cloud doména) platí, když požadavek přijde z localhostu (MCP/agent na témže stroji); z hlavičky proxy vede adresa požadavku
  expect(/^https:\/\/firma\.killbottleneck\.com\/p\/[a-z0-9]{32}$/.test(r.json.page.share_url), `z 127.0.0.1 s KB_PUBLIC_URL → doména instance (${r.json.page.share_url})`);
  r = await inst2.api('GET', `/api/kb/v1/pages/${id2}`, { bearer: klic2, headers: { 'X-Forwarded-Host': 'firma.killbottleneck.com', 'X-Forwarded-Proto': 'https' } });
  expect(/^https:\/\/firma\.killbottleneck\.com\/p\/[a-z0-9]{32}$/.test(r.json.page.share_url), `v cloudu za proxy: tatáž doména (${r.json.page.share_url})`);
  const cesta2 = r.json.page.share_url.replace(/^https?:\/\/[^/]+/, '');
  let posledni = 0, prvni429 = 0;
  for (let i = 1; i <= 62; i++) { posledni = (await verejne(inst2, cesta2)).status; if (posledni === 429 && !prvni429) prvni429 = i; }
  expect(prvni429 === 61 && posledni === 429, `minutová brzda: 60 průchodů, 61. = 429 (první 429 u ${prvni429})`);
  expect((await verejne(inst2, '/p/' + 'q'.repeat(32))).status === 429, 'brzda platí i pro neexistující token (IP, ne stránka)');

  console.log('== KB_PAGES=0 ==');
  const inst3 = await H.startInstance({ slug: 'stranky-off', env: { KB_UVODNI_MAPA: 0, KB_PAGES: 0 } });
  await inst3.register('a@example.com', { name: 'A' });
  const A3 = await inst3.login('a@example.com');
  const klic3 = (await inst3.api('POST', '/api/kb/api-keys', { token: A3, body: { label: 'k', scope: 'read_write' } })).json.token;
  expect((await inst3.api('GET', '/api/kb/config')).json.pages === null, 'config.pages = null (vypnuto)');
  expect((await inst3.api('GET', '/api/kb/chat/stranky', { token: A3 })).status === 404, 'seznam 404');
  r = await inst3.api('POST', '/api/kb/v1/pages', { bearer: klic3, body: { title: 'x', html: HTML('x') } });
  expect(r.status === 404, `v1 založení 404 (${r.status})`);
  expect((await verejne(inst3, '/p/' + 'a'.repeat(32))).status === 404, '/p/ 404');

  console.log('== zámek zkušebky: čtení (seznam, /p/, v1 GET) žije, zápis 402 ==');
  // registrace i založení stránky jsou zápis (402) → účet a stránku zakládá superuser (obchází pravidla, jako ai-zkusebka-limit)
  const inst4 = await H.startInstance({ slug: 'stranky-trial', env: { KB_UVODNI_MAPA: 0, KB_TRIAL_UNTIL: '2020-01-01' } });
  const SU4 = await inst4.superuser();
  r = await inst4.api('POST', '/api/collections/users/records', { token: SU4, body: { email: 'sef@vyprselo.cz', password: H.PW, passwordConfirm: H.PW, name: 'Šéf', role: 'admin' } });
  expect(r.status === 200, `superuser založí účet i po vypršení (${r.status})`);
  const uziv4 = r.json.id;
  const A4 = await inst4.login('sef@vyprselo.cz');
  const tokT = 't'.repeat(32);
  r = await inst4.api('POST', '/api/collections/ai_pages/records', { token: SU4, body: { user: uziv4, title: 'Před vypršením', html: HTML('TRIAL'), stav: 'hotovo', share_token: tokT } });
  expect(r.status === 200, `superuser vloží stránku sdílenou před vypršením (${r.status})`);
  const id4 = r.json.id;
  const klicText = 'kb_user_' + 'a'.repeat(40);
  await inst4.api('POST', '/api/collections/api_keys/records', { token: SU4, body: { owner: uziv4, token_hash: require('crypto').createHash('sha256').update(klicText).digest('hex'), label: 'mcp', scope: 'read_write', use_count: 0 } });
  expect((await verejne(inst4, `/p/${tokT}`)).status === 200, 'veřejný odkaz po vypršení zkušebky dál funguje (jako veřejná mapa)');
  expect((await inst4.api('GET', '/api/kb/chat/stranky', { token: A4 })).json.stranky.length === 1, 'seznam stránek (čtení) jde');
  expect((await inst4.api('GET', `/api/kb/v1/pages/${id4}`, { bearer: klicText })).status === 200, 'v1 GET (čtení) jde');
  r = await inst4.api('POST', '/api/kb/chat/stranka/sdilet', { token: A4, body: { id: id4, akce: 'obnovit' } });
  expect(r.status === 402, `sdílet (zápis) → 402 (${r.status})`);
  r = await inst4.api('POST', '/api/kb/chat/stranka/napsat', { token: A4, body: { id: id4 } });
  expect(r.status === 402, `napsat (zápis, model) → 402 (${r.status})`);
  r = await inst4.api('POST', '/api/kb/v1/pages', { bearer: klicText, body: { title: 'nová', html: HTML('N') } });
  expect(r.status === 402, `v1 POST → 402 (${r.status})`);

  console.log('== service worker /p/ neobsluhuje (statická kontrola) ==');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'sw.js'), 'utf8');
  const i1 = sw.indexOf("startsWith('/p/')"), i2 = sw.indexOf("req.mode === 'navigate'");
  expect(i1 > 0 && i2 > i1, 'sw.js: výjimka /p/ je PŘED obsluhou navigací (jinak by cizí HTML přepsalo offline shell)');
}, { nazev: 'STRANKY-VEREJNE' });
