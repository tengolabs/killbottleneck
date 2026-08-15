// Veřejná mapa NESMÍ vydat osobní údaje (Richardův nález 6. 8. 2026).
//
// Sdílení mapy odkazem dřív zveřejnilo i e-mail majitele, e-maily sdílených
// a u uzlů e-mail garanta — dvěma cestami: routou /api/kb/public-maps
// (mapToDto) a SUROVOU kolekcí (list/view pravidla měla `is_public = true`).
// Test hlídá OBĚ cesty a zároveň to, že veřejné sdílení dál funguje.
//
// Mutační pojistka: mapa se zakládá se skutečnou adresou v uzlu i v poli
// sdílení — kdyby sanitizace vypadla, test tu adresu v odpovědi najde.
const { execSync } = require('child_process');

const NAME = 'kb-e2e-verejne-mapy';
const PORT = 20535;
const BASE = `http://127.0.0.1:${PORT}`;
const MAJITEL = { email: 'majitel@e2e.cz', password: 'TajneHeslo.2026' };
const KOLEGA = 'kolega@e2e.cz';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil');
}

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    await waitHealthy();

    await api('POST', '/api/collections/users/records', {
      body: { email: MAJITEL.email, password: MAJITEL.password, passwordConfirm: MAJITEL.password },
    });
    const auth = await api('POST', '/api/collections/users/auth-with-password', {
      body: { identity: MAJITEL.email, password: MAJITEL.password },
    });
    const token = auth.json.token;

    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token,
      body: {
        title: 'Veřejná zkouška', is_public: true,
        shared_with: [KOLEGA], shared_with_edit: [KOLEGA],
        nodes: [
          { id: 'root', type: 'apexNode', position: { x: 0, y: 0 },
            data: { title: 'Vrchol', status: 'todo', owner: MAJITEL.email } },
          { id: 'n1', type: 'goalNode', position: { x: 0, y: 200 },
            data: { title: 'Krok', status: 'done', owner: KOLEGA, automationRequestedBy: KOLEGA } },
        ],
        // hrana schválně nese i to, co by se ven dostat NESMĚLO
        edges: [{ id: 'e1', source: 'root', target: 'n1',
                  label: `garant ${KOLEGA}`, data: { poznamka: 'tel 777123456' } }],
      },
    });
    const mapId = mapa.json.id;
    expect(!!mapId, `veřejná mapa založena (${mapa.status})`);

    console.log('== veřejná routa vydá obsah, ne osoby ==');
    const pub = await api('POST', '/api/kb/public-maps', { body: { mapId } });
    const text = JSON.stringify(pub.json);
    expect(pub.status === 200 && pub.json.map, 'veřejný odkaz DÁL FUNGUJE (200 + mapa)');
    expect(text.includes('Vrchol') && text.includes('Krok'), 'obsah mapy je vidět (názvy uzlů)');
    expect(text.includes('done'), 'stavy uzlů jsou vidět');
    expect(!text.includes(MAJITEL.email), 'e-mail majitele NENÍ v odpovědi');
    expect(!text.includes(KOLEGA), 'e-mail kolegy (sdílení, garant uzlu, žadatel) NENÍ v odpovědi');
    expect(!text.includes('shared_with'), 'pole se sdílením se vůbec neposílá');
    expect(text.includes('"e1"'), 'hrany se posílají (mapa se má vykreslit celá)');
    expect(!text.includes('777123456') && !text.includes('garant'),
      'z hran jdou ven jen id/source/target — žádné popisky ani data');

    console.log('== komentáře veřejné mapy anonym NEVIDÍ ==');
    // ⚠️ Tenhle test dřív hlídal jen kolekci `goalmaps`, takže díru v `comments`
    // nechytil — a přitom komentář nese e-mail autora i text diskuse.
    const koment = await api('POST', '/api/collections/comments/records', {
      token,
      // node_id je povinné (schéma 1751900000) — bez něj 400 a test by pak
      // „dokazoval" neviditelnost neexistujícího komentáře
      body: { goalmap: mapId, node_id: 'n1', text: 'tajny komentar', author_email: MAJITEL.email },
    });
    expect(koment.status === 200, `komentář k veřejné mapě založen (${koment.status})`);
    const anonKoment = await api('GET', '/api/collections/comments/records?perPage=50');
    const anonText = JSON.stringify(anonKoment.json);
    expect(!anonText.includes('tajny komentar'), 'anonym NEVIDÍ text komentáře');
    expect(!anonText.includes(MAJITEL.email), 'anonym NEVIDÍ e-mail autora komentáře');
    const majitelKoment = await api('GET', '/api/collections/comments/records?perPage=50', { token });
    expect(JSON.stringify(majitelKoment.json).includes('tajny komentar'),
      'přihlášený majitel svůj komentář vidí dál (nezavřeli jsme to všem)');

    console.log('== surová kolekce je pro anonyma zavřená ==');
    const raw = await api('GET', `/api/collections/goalmaps/records/${mapId}`);
    expect(raw.status === 404 || raw.status === 403, `přímý záznam anonymně nedostupný (${raw.status})`);
    const rawList = await api('GET', '/api/collections/goalmaps/records?perPage=50');
    const rawListText = JSON.stringify(rawList.json);
    expect(!rawListText.includes(MAJITEL.email) && !rawListText.includes(KOLEGA),
      'výpis kolekce anonymně nevydá žádné adresy');
    expect(!rawListText.includes('Veřejná zkouška'), 'výpis kolekce anonymně nevydá ani obsah');

    console.log('== seznam veřejných map ==');
    // ⚠️ Tenhle scénář dřív tvrdil, že anonym seznam DOSTANE — tedy zafixoval
    // jako správné chování to, co panel označil za díru. Veřejná mapa má být
    // dostupná odkazem, ne k nalezení: jinak si kdokoli vypíše názvy všech
    // veřejných map instance a s vráceným id stáhne jejich obsah.
    const anonSeznam = await api('POST', '/api/kb/public-maps', { body: {} });
    expect(anonSeznam.status === 400, `anonym seznam NEDOSTANE (${anonSeznam.status})`);
    expect(!JSON.stringify(anonSeznam.json).includes('Veřejná zkouška'),
      'a nevypadl z něj ani název mapy');
    const seznam = await api('POST', '/api/kb/public-maps', { body: {}, token });
    const seznamText = JSON.stringify(seznam.json);
    expect(seznam.status === 200 && seznamText.includes('Veřejná zkouška'),
      'přihlášený seznam dostane (galerie uvnitř aplikace funguje dál)');
    expect(!seznamText.includes(MAJITEL.email) && !seznamText.includes(KOLEGA),
      'seznam veřejných map neobsahuje adresy');
    // odkazem se mapa otevře i bez přihlášení — to je smysl veřejného sdílení
    const odkazem = await api('POST', '/api/kb/public-maps', { body: { mapId } });
    expect(odkazem.status === 200, `veřejná mapa jde otevřít ODKAZEM i anonymně (${odkazem.status})`);

    console.log('== majitel vidí svá data dál ==');
    const vlastni = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token });
    expect(vlastni.status === 200 && JSON.stringify(vlastni.json).includes(KOLEGA),
      'přihlášený majitel vidí sdílení i garanty (nic se mu neschovalo)');

    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exitCode = fail ? 1 : 0;
  } catch (err) {
    console.error('CHYBA BĚHU:', err.message);
    process.exitCode = 1;
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
})();
