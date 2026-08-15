// Příloha jako ODKAZ + vypínač nahrávání (Richard 28. 7. 2026).
//
// Proč to takhle je: cizí soubory jsou pro provozovatele hostingu nejdražší část
// služby — místo, každá záloha, DPA a odpovědnost za obsah. Hostovaná verze je
// proto nemá vůbec a přílohy se přidávají jako odkaz na místo, kde soubor už je
// (Disk, OneDrive, SharePoint, e-mail). Self-host má vlastní disk → beze změny.
//
// Sada hlídá tři věci: (1) odkaz projde i s vypnutým nahráváním, (2) nahrání
// projde jen tam, kde je povolené, (3) strop platí na CELOU INSTANCI, ne na
// projekt — kvóta na projekt se dá obejít založením dalšího.
const { execSync } = require('child_process');
const fs = require('fs');

const VYP = { name: 'flowmap-e2e-links-off', port: 20522 };   // FLOWMAP_FILES_MB=0
const ZAP = { name: 'flowmap-e2e-links-on', port: 20523 };    // strop 1 MB
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (base, method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

async function start(inst, env) {
  execSync(`docker rm -f ${inst.name} 2>/dev/null; true`);
  execSync(`docker run -d --name ${inst.name} -p ${inst.port}:8090 ${env} ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  const base = `http://127.0.0.1:${inst.port}`;
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return base; } catch { /* startuje */ }
    await sleep(1000);
  }
  throw new Error(`${inst.name} nenaběhl`);
}

// nahrání souboru dané velikosti (multipart, jako z prohlížeče)
async function nahraj(base, token, mapId, kb) {
  const form = new FormData();
  form.append('map', mapId);
  form.append('node_id', 'n1');
  form.append('name', `soubor-${kb}kb.bin`);
  form.append('size', String(kb * 1024));
  form.append('file', new Blob([new Uint8Array(kb * 1024)]), `soubor-${kb}kb.bin`);
  const res = await fetch(`${base}/api/collections/node_files/records`, {
    method: 'POST', headers: { Authorization: token }, body: form,
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné */ }
  return { status: res.status, json };
}

async function pripravMapu(base) {
  await api(base, 'POST', '/api/collections/users/records', { body: { email: 'admin@example.com', password: PW, passwordConfirm: PW } });
  const auth = await api(base, 'POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: PW } });
  const token = auth.json.token;
  const mapa = await api(base, 'POST', '/api/collections/goalmaps/records', {
    token, body: { title: 'Projekt', nodes: [{ id: 'n1', type: 'goal', position: { x: 0, y: 0 }, data: { title: 'Uzel' } }], edges: [] },
  });
  return { token, mapId: mapa.json.id };
}

(async () => {
  try {
    console.log('== hostovaná verze: nahrávání vypnuté (FLOWMAP_FILES_MB=0) ==');
    const B = await start(VYP, '-e FLOWMAP_FILES_MB=0');
    const { token, mapId } = await pripravMapu(B);

    const cfg = await api(B, 'GET', '/api/flowmap/config');
    expect(cfg.json.uploads_enabled === false, 'config hlásí vypnuté nahrávání (frontend schová tlačítko)');

    let r = await api(B, 'POST', '/api/collections/node_files/records', {
      token, body: { map: mapId, node_id: 'n1', url: 'https://drive.google.com/file/d/abc/view', name: 'Nabídka.pdf' },
    });
    expect(r.status === 200 && r.json.url, `odkaz projde i s vypnutým nahráváním (${r.status})`);
    expect(r.json?.size === 0, 'odkaz nezabírá místo (size 0)');

    const up = await nahraj(B, token, mapId, 10);
    expect(up.status >= 400, `nahrání souboru odmítnuto (${up.status})`);
    expect(/odkaz|link/i.test(JSON.stringify(up.json || {})), 'hláška poradí přidat odkaz');

    console.log('-- co za odkaz se nesmí uložit --');
    for (const zly of ['javascript:alert(1)', 'data:text/html,<script>x</script>',
                       'file:///etc/passwd', '\\\\server\\slozka\\soubor.xlsx', 'ftp://server/soubor']) {
      const bad = await api(B, 'POST', '/api/collections/node_files/records', {
        token, body: { map: mapId, node_id: 'n1', url: zly, name: 'zkouška' },
      });
      expect(bad.status >= 400, `odmítnuto: ${zly.slice(0, 32)}`);
    }
    const prazdna = await api(B, 'POST', '/api/collections/node_files/records', {
      token, body: { map: mapId, node_id: 'n1', name: 'nic' },
    });
    expect(prazdna.status >= 400, 'příloha bez souboru i bez odkazu neprojde');

    // seznam příloh musí odkaz vrátit tak, jak ho UI čeká
    const list = await api(B, 'GET', `/api/collections/node_files/records?filter=(map='${mapId}')`, { token });
    expect(list.json?.items?.some((i) => i.url && i.name === 'Nabídka.pdf'), 'odkaz je v seznamu příloh uzlu');

    console.log('\n== strop platí na CELOU INSTANCI, ne na projekt ==');
    const C = await start(ZAP, '-e FLOWMAP_FILES_MB=1');   // 1 MB na instanci
    const b = await pripravMapu(C);
    const cfg2 = await api(C, 'GET', '/api/flowmap/config');
    expect(cfg2.json.uploads_enabled === true, 'se stropem je nahrávání zapnuté');

    const prvni = await nahraj(C, b.token, b.mapId, 700);
    expect(prvni.status === 200, `první soubor (700 kB) projde (${prvni.status})`);

    // druhý projekt — dřív měl vlastní kvótu, takže tudy se strop obcházel
    const druha = await api(C, 'POST', '/api/collections/goalmaps/records', {
      token: b.token, body: { title: 'Druhý projekt', nodes: [{ id: 'n1', type: 'goal', position: { x: 0, y: 0 }, data: { title: 'Uzel' } }], edges: [] },
    });
    const druhy = await nahraj(C, b.token, druha.json.id, 700);
    expect(druhy.status >= 400, `druhý soubor v JINÉM projektu narazí na strop instance (${druhy.status})`);
    expect(/MB/.test(JSON.stringify(druhy.json || {})), 'hláška říká, kolik MB je strop');

    const odkaz = await api(C, 'POST', '/api/collections/node_files/records', {
      token: b.token, body: { map: druha.json.id, node_id: 'n1', url: 'https://example.com/soubor.xlsx', name: 'Tabulka' },
    });
    expect(odkaz.status === 200, 'odkaz projde i po vyčerpání stropu (nezabírá místo)');
  } catch (e) {
    fail++; console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    for (const inst of [VYP, ZAP]) execSync(`docker rm -f ${inst.name} 2>/dev/null; true`);
  }
  console.log(`\n${pass} OK, ${fail} chyb`);
  process.exit(fail ? 1 : 0);
})();
