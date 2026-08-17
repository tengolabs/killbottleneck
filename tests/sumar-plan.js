// Denní AI sumář musí respektovat „kdy to chci řešit".
//
// Nález Richarda z ostrého provozu 8. 8. 2026: „pořád máme denní sumáře, kde bude,
// že je dnes po termínu nebo zítra, i když se ho rozhodnu řešit za týden."
// Sekce přehledu plán respektovaly, ale do PODKLADU pro model šel jen termín —
// model tedy o rozhodnutí uživatele vůbec nevěděl a soudil naléhavost z data.
//
// ⚠️ Proč vlastní sada a ne přílepek k daily-summaries.js: ta sada mluví s REÁLNÝM
// ollama modelem, takže se v ní dá kontrolovat jen „přišel netriviální text".
// Tady jde o PODKLAD, který je deterministický — mock server request zachytí a
// prompt se dá čtením ověřit. Žádný model, žádná náhoda.
//
// Mock stojí na hostiteli a kontejner na něj sahá přes host.docker.internal
// (proto --add-host). Ochrana proti privátním adresám (aiHostBlocked) platí jen
// na hostované instanci (HOSTED=1), takže testovacímu kontejneru nepřekáží.
const { execSync } = require('child_process');
const http = require('http');

const NAME = 'flowmap-e2e-sumar-plan';
const PORT = 20516;
const MOCK_PORT = 20517;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

// ⚠️ Datum POČÍTAT V UTC, ne lokálně: kontejner žije v UTC a mezi půlnocí
// a 2:00 SELČ se lokální „dnešek" od serverového liší o den — sada pak
// každou noc deterministicky padala (odhaleno 14. 8. 0:39). Vzor v1-api.js.
const den = (offset) => {
  const n = new Date();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
  return d.toISOString().slice(0, 10);
};

// Podklad má tvar „NADPIS SEKCE (počet):\n- řádek\n- řádek\n\n" — vytáhnout jednu sekci.
const sekce = (prompt, nadpis) => {
  const i = prompt.indexOf(nadpis + ' (');
  if (i < 0) return '';
  const zbytek = prompt.slice(i);
  const konec = zbytek.indexOf('\n\n');
  return konec < 0 ? zbytek : zbytek.slice(0, konec);
};

(async () => {
  let mock;
  const zachyceno = [];
  try {
    mock = http.createServer((req, res) => {
      let telo = '';
      req.on('data', (c) => { telo += c; });
      req.on('end', () => {
        try { zachyceno.push(JSON.parse(telo)); } catch { zachyceno.push({ raw: telo }); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // odpověď musí vypadat jako od AI služby: { reply }
        res.end(JSON.stringify({ reply: 'Dnes to zvládneš. Drž se plánu. 💪' }));
      });
    });
    await new Promise((r) => mock.listen(MOCK_PORT, '0.0.0.0', r));

    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 `
      // ⚠️ prefix KB_ je povinný — helpers.env() čte jen KB_* / FLOWMAP_*,
      // bez něj se konfigurace tiše ignoruje a routa vrátí 503 „AI vypnutá"
      + `-e KB_SUMMARY_PROVIDER=api -e KB_SUMMARY_URL=http://host.docker.internal:${MOCK_PORT} `
      + `--add-host=host.docker.internal:host-gateway -p ${PORT}:8090 `
      + `${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'a@e2e.local', password: PW, passwordConfirm: PW } });
    const AT = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@e2e.local', password: PW } })).json.token;
    // SLOVNÍK 17. 8. 2026: položky sází superuser (uživatelský create = 403)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST2 = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const uidA = ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent("email='a@e2e.local'")}`, { token: ST2 })).json.items || [])[0].id;

    const DNES = den(0), PRISTE = den(7), PROPADLY = den(-3);
    const mapa = (await api('POST', '/api/collections/goalmaps/records', { token: AT, body: {
      title: 'Projekt', nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Projekt', title: 'Projekt', status: 'todo' } },
        // úkol musí mít konkrétní uzel (13. 8.) — neutrální bez ownera/termínu,
        // aby se nesložil s úkoly ani nepřidal řádek do sumáře
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Zázemí', status: 'todo' } },
      ], edges: [{ id: 'e1', source: 'apex', target: 'n1' }],
    } })).json;
    const mkTask = (body) => api('POST', '/api/collections/tasks/records', { token: ST2, body: { map: mapa.id, node_id: 'n1', assignee_email: 'a@e2e.local', status: 'todo', owner: uidA, owner_email: 'a@e2e.local', ...body } });
    await mkTask({ title: 'ODLOZENY-NA-TYDEN', deadline: DNES, planned_on: PRISTE });
    await mkTask({ title: 'OPRAVDU-DNESNI', deadline: DNES });
    await mkTask({ title: 'PROPADLY-ODLOZENY', deadline: PROPADLY, planned_on: PRISTE });

    const r = await api('POST', '/api/flowmap/my-summary/refresh', { token: AT });
    expect(r.status === 200, `sumář se vygeneroval přes mock AI službu (${r.status})`);
    expect(zachyceno.length === 1, `mock zachytil právě jeden dotaz na model (${zachyceno.length})`);
    const prompt = String((zachyceno[0] || {}).message || '');
    console.log('  --- podklad pro model ---\n' + prompt.split('\n').map((l) => '  ' + l).join('\n') + '\n  ---');

    // Pojistka proti falešně zelené sadě: většina kontrol níž je ve tvaru „tohle
    // tam NENÍ", a ty by na prázdném podkladu prošly všechny.
    expect(prompt.length > 100 && /ODLOZENY-NA-TYDEN/.test(prompt),
      `podklad není prázdný a nese testovaná data (${prompt.length} znaků)`);

    console.log('== plán je v podkladu vidět ==');
    expect(new RegExp(`ODLOZENY-NA-TYDEN[^\\n]*chci řešit ${PRISTE}`).test(prompt),
      'řádek odložené položky nese „chci řešit" i s datem');
    expect(new RegExp(`ODLOZENY-NA-TYDEN[^\\n]*termín ${DNES}`).test(prompt),
      '…a zároveň pořád ukazuje původní termín (ten se plánem NEMĚNÍ)');
    expect(!/OPRAVDU-DNESNI[^\n]*chci řešit/.test(prompt),
      'u položky bez plánu se „chci řešit" nevymýšlí');

    console.log('== zařazení v podkladu odpovídá plánu, ne termínu ==');
    const dnesniSekce = sekce(prompt, 'DNES');
    expect(/OPRAVDU-DNESNI/.test(dnesniSekce), `v sekci DNES je skutečná dnešní práce (${dnesniSekce.split('\n')[0]})`);
    expect(!/ODLOZENY-NA-TYDEN/.test(dnesniSekce), 'odložená položka v sekci DNES NENÍ');
    expect(/ODLOZENY-NA-TYDEN/.test(sekce(prompt, 'DO 7 DNŮ')), 'leží tam, kdy ji chce uživatel řešit');
    expect(!/ODLOZENY-NA-TYDEN|PROPADLY-ODLOZENY/.test(sekce(prompt, 'PO TERMÍNU')),
      'odložená práce se do sekce PO TERMÍNU nedostane, i když jí termín prošel');

    console.log('== model dostane i pravidlo, jak to čte ==');
    // Samotné datum v řádku by nestačilo: bez tohohle model soudil naléhavost
    // z termínu a psal „dnes máš po termínu" o vědomě odložené práci.
    expect(/naléhavosti rozhoduje VÝHRADNĚ sekce/.test(prompt), 'prompt zakazuje soudit naléhavost podle data v řádku');
    expect(/neoznačuj ji za dnešní/.test(prompt), 'a výslovně říká, že odloženou práci nemá tlačit do dneška');
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
    if (mock) await new Promise((r) => mock.close(r));
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} SUMAR-PLAN PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
