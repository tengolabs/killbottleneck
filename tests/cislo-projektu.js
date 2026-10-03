// Číslo projektu (#12) — Richard 2. 10. 2026: „každý projekt musí mít specifické číslo“.
//
// Sada hlídá, že číslo přiděluje VÝHRADNĚ server (model hook onRecordCreate → helpers.assignProjectNumber)
// pro každou cestu vzniku mapy, že je unikátní i při souběhu, že ho klient nepřepíše, že org mapa číslo
// nemá a že import přiděluje číslo nové (číslo ze souboru se nepřenáší). Mutace, které musí shodit:
//   M1 index pryč · M4 hook bez větve org · M5 čítač bez samoopravy · M7 import přenáší číslo ·
//   M8 číslo jen v request hooku (v1 / úvodní mapa by zůstaly bez čísla).
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/cislo-projektu.js
const H = require('./_harness');
const { expect } = H;

const mapa = (title, extra = {}) => Object.assign({
  title,
  nodes: [
    { id: 'r', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: title, title, status: 'todo' } },
    { id: 'a', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Krok', status: 'todo' } },
  ],
  edges: [{ id: 'e', source: 'r', target: 'a' }],
}, extra);

H.beh(async () => {
  // výchozí KB_UVODNI_MAPA → registrace zakládá úvodní mapu (cesta přes $app.save, request hook ji NEVIDÍ)
  const inst = await H.startInstance({ slug: 'cislo' });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const A = await inst.login('sef@example.com');
  const ST = await inst.superuser();
  const moje = async (tok = A) => (await inst.api('GET', '/api/collections/goalmaps/records?perPage=200&sort=created', { token: tok })).json.items || [];
  const cisla = (items) => items.map((m) => m.project_number);

  console.log('== úvodní mapa po registraci má číslo (model hook, ne request hook) ==');
  let vse = await moje();
  expect(vse.length >= 1, `registrace založila úvodní mapu (${vse.length})`);
  expect(vse.every((m) => m.project_number > 0), `každá úvodní mapa má číslo > 0 (${cisla(vse).join(',')})`);
  expect(new Set(cisla(vse)).size === vse.length && Math.min(...cisla(vse)) === 1, `čísla jdou od 1 bez duplicit (${cisla(vse).join(',')})`);
  let max = Math.max(...cisla(vse));

  console.log('== REST create: číslo si klient nevybírá ==');
  let r = await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa('Dílna', { project_number: 999 }) });
  expect(r.status === 200 && r.json.project_number === max + 1, `poslané 999 server přepsal na další v řadě (${r.json && r.json.project_number}, čekáno ${max + 1})`);
  const dilna = r.json; max = dilna.project_number;

  console.log('== PATCH číslo nejde změnit — vlastník ani superuser ==');
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${dilna.id}`, { token: A, body: { project_number: 777 } });
  expect(r.status === 200 && r.json.project_number === max, `vlastník: číslo zůstalo ${max} (${r.json && r.json.project_number})`);
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${dilna.id}`, { token: ST, body: { project_number: 778, title: 'Dílna 2' } });
  expect(r.status === 200 && r.json.project_number === max && r.json.title === 'Dílna 2', `superuser: číslo zůstalo ${max}, ostatní pole projdou`);

  console.log('== v1 API (API klíč → $app.save) a DTO ==');
  r = await inst.api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'test', scope: 'read_write' } });
  const klic = r.json && r.json.token;
  expect(!!klic, 'API klíč založen');
  r = await inst.api('POST', '/api/kb/v1/maps', { bearer: klic, body: { title: 'Z API', tree: [{ title: 'Krok z API' }] } });
  expect(r.status === 200 && r.json.id, `v1 POST /maps → 200 (${r.status})`);
  const zApi = (await inst.api('GET', `/api/collections/goalmaps/records/${r.json.id}`, { token: A })).json;
  expect(zApi.project_number === max + 1, `mapa z v1 API má další číslo (${zApi.project_number}, čekáno ${max + 1})`);
  max = zApi.project_number;
  r = await inst.api('GET', '/api/kb/v1/maps', { bearer: klic });
  const vMaps = (r.json && r.json.maps) || [];
  expect(vMaps.length && vMaps.every((m) => m.project_number > 0) && vMaps.some((m) => m.id === zApi.id && m.project_number === max), 'GET /v1/maps nese project_number u každé mapy');
  r = await inst.api('GET', `/api/kb/v1/maps/${zApi.id}`, { bearer: klic });
  expect(r.status === 200 && r.json.project_number === max, `GET /v1/maps/{id} nese project_number (${r.json && r.json.project_number})`);

  console.log('== import: číslo ze souboru se NEPŘENÁŠÍ ==');
  r = await inst.api('POST', '/api/kb/map-import', { token: A, body: { format: 'killbottleneck.map/1', map: Object.assign(mapa('Import jedné'), { project_number: 555 }) } });
  expect(r.status === 200, `map-import → 200 (${r.status} ${JSON.stringify(r.json).slice(0, 100)})`);
  vse = await moje();
  const imp1 = vse.find((m) => m.title === 'Import jedné');
  expect(!!imp1 && imp1.project_number === max + 1 && imp1.project_number !== 555, `importovaná mapa dostala nové číslo ${imp1 && imp1.project_number} (soubor měl 555)`);
  max = imp1.project_number;
  r = await inst.api('POST', '/api/kb/import-all', { token: A, body: { format: 'killbottleneck.export/1', maps: [
    { format: 'killbottleneck.map/1', map: Object.assign(mapa('Import archivované'), { project_number: 777, archived: true, archived_at: '2026-01-05 10:00:00.000Z' }) },
  ] } });
  expect(r.status === 200 && r.json.maps_imported === 1, `import-all → 1 mapa (${r.status})`);
  vse = await moje();
  const imp2 = vse.find((m) => m.title === 'Import archivované');
  expect(!!imp2 && imp2.project_number === max + 1 && imp2.archived === true, `hromadný import: nové číslo ${imp2 && imp2.project_number} (soubor 777), archivace zachována`);
  max = imp2.project_number;

  console.log('== export nese project_number (informativně) ==');
  r = await inst.api('GET', '/api/kb/export', { token: A });
  const exp = ((r.json && r.json.maps) || []).find((x) => x.map && x.map.title === 'Dílna 2');
  expect(!!exp && exp.map.project_number === dilna.project_number, `export: Dílna 2 má project_number ${exp && exp.map.project_number}`);

  console.log('== org mapa číslo nemá a v seznamu projektů není ==');
  r = await inst.api('POST', '/api/kb/org-map', { token: A });
  expect(r.status === 200 && r.json.map && r.json.map.id, `org mapa založena (${r.status})`);
  const org = (await inst.api('GET', `/api/collections/goalmaps/records/${r.json.map.id}`, { token: A })).json;
  expect(org.kind === 'org' && (org.project_number || 0) === 0, `org mapa: kind=org, project_number=0 (${org.project_number})`);
  r = await inst.api('GET', '/api/kb/v1/maps', { bearer: klic });
  expect(!(r.json.maps || []).some((m) => m.id === org.id), 'org mapa není v GET /v1/maps');
  r = await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa('Po org') });
  expect(r.json.project_number === max + 1, `další běžná mapa po org pokračuje v řadě (${r.json.project_number}, čekáno ${max + 1})`);
  max = r.json.project_number;

  console.log('== souběh: 10 map naráz → 10 různých čísel po sobě ==');
  const naraz = await Promise.all(Array.from({ length: 10 }, (_, i) => inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa(`Souběh ${i}`) })));
  const nova = naraz.map((x) => x.json && x.json.project_number).filter((n) => n > 0).sort((a, b) => a - b);
  expect(naraz.every((x) => x.status === 200), `všech 10 založení → 200 (${naraz.map((x) => x.status).join(',')})`);
  expect(nova.length === 10 && new Set(nova).size === 10 && nova[0] === max + 1 && nova[9] === max + 10, `čísla ${max + 1}…${max + 10} bez duplicity a díry (${nova.join(',')})`);
  max += 10;

  console.log('== smazání číslo nerecykluje ==');
  r = await inst.api('DELETE', `/api/collections/goalmaps/records/${naraz[9].json.id}`, { token: A });
  r = await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa('Po smazání') });
  expect(r.json.project_number === max + 1, `po smazání #${max} dostane nová mapa #${max + 1}, ne uvolněné číslo (${r.json.project_number})`);
  max = r.json.project_number;

  console.log('== samooprava čítače (obnova zálohy nastavení / ruční zásah) ==');
  r = await inst.api('GET', '/api/collections/instance_settings/records', { token: ST });
  const st = ((r.json && r.json.items) || [])[0];
  expect(!!st && st.next_project_number === max + 1, `čítač = příští číslo ${max + 1} (${st && st.next_project_number})`);
  r = await inst.api('PATCH', `/api/collections/instance_settings/records/${st.id}`, { token: ST, body: { next_project_number: 1 } });
  expect(r.status === 200 && r.json.next_project_number === 1, 'superuser čítač shodil na 1');
  r = await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa('Po shození čítače') });
  expect(r.status === 200 && r.json.project_number === max + 1, `číslo se nevrátilo pod maximum — ${r.json && r.json.project_number} (čekáno ${max + 1})`);
  max = r.json.project_number;

  console.log('== schéma: částečný unikátní index + pole ==');
  r = await inst.api('GET', '/api/collections/goalmaps', { token: ST });
  const idx = (r.json && r.json.indexes) || [];
  expect(idx.some((i) => /UNIQUE INDEX idx_goalmaps_project_number .*WHERE project_number > 0/i.test(i)), `kolekce má částečný unikátní index (${idx.filter((i) => /project_number/.test(i)).join(' | ')})`);
  expect(((r.json && r.json.fields) || []).some((f) => f.name === 'project_number' && f.type === 'number'), 'pole project_number je číselné');

  console.log('== druhý uživatel: společná řada instance, cizí čísla nevidí jako mapy ==');
  await inst.register('clen@example.com', { name: 'Člen' });
  const B = await inst.login('clen@example.com');
  const bMapy = (await moje(B)).filter((m) => m.kind !== 'org'); // org mapu vidí celý tým a číslo nemá (0)
  expect(bMapy.length >= 1 && bMapy.every((m) => m.project_number > max), `úvodní mapa člena pokračuje v řadě instance (${cisla(bMapy).join(',')} > ${max})`);
}, { nazev: 'CISLO-PROJEKTU' });
