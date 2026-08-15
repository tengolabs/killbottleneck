// PŘECHOD po přejmenování FlowMap → killBottleneck (28. 7. 2026).
//
// Proč tenhle test existuje: přejmenování se dotklo věcí, které jsou KONTRAKTY,
// ne jen texty — proměnné v .env běžících instancí, cesty API uložené v databázi
// (callback_url agentních běhů), vydané API klíče a soubory, které mají lidé
// vyexportované na disku. Kterákoli z nich by po aktualizaci tiše přestala platit
// a projevilo by se to až u zákazníka.
//
// Sada proto pouští DVA kontejnery vedle sebe: jeden nastavený POUZE po starém,
// druhý POUZE po novém — a čeká od obou stejné chování. Až se přechod bude rušit
// (vydání po zveřejnění repa), tenhle soubor zčervená jako první a řekne, co se
// musí doohlásit uživatelům.
const { execSync } = require('child_process');
const crypto = require('crypto');

const STARY = { name: 'kb-e2e-compat-stary', port: 20525 };
const NOVY = { name: 'kb-e2e-compat-novy', port: 20526 };
const PW = 'testheslo123';
const KOD = 'FM-PRECHOD-KOD';

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

(async () => {
  try {
    // Staré názvy proměnných = instance, která běží od loňska a nikdo jí .env nepřepsal.
    const S = await start(STARY, `-e FLOWMAP_SETUP_CODE=${KOD} -e FLOWMAP_FILES_MB=0 -e FLOWMAP_HOSTED=1`);
    const N = await start(NOVY, `-e KB_SETUP_CODE=${KOD} -e KB_FILES_MB=0 -e KB_HOSTED=1`);

    console.log('== nastavení: staré proměnné dělají totéž co nové ==');
    for (const [jmeno, base] of [['stará instance', S], ['nová instance', N]]) {
      const cfg = await api(base, 'GET', '/api/kb/config');
      expect(cfg.json?.setup_code_required === true, `${jmeno}: registrační klíč se vynucuje`);
      expect(cfg.json?.uploads_enabled === false, `${jmeno}: nahrávání souborů vypnuté`);
    }

    console.log('== obě cesty API odpovídají stejně ==');
    const nova = await api(S, 'GET', '/api/kb/config');
    const stara = await api(S, 'GET', '/api/flowmap/config');
    expect(stara.status === 200 && nova.status === 200, 'stará i nová cesta vrací 200');
    expect(JSON.stringify(stara.json) === JSON.stringify(nova.json), 'a vrací TOTÉŽ');

    console.log('== registrace: klíč platí na obou ==');
    for (const [jmeno, base] of [['stará instance', S], ['nová instance', N]]) {
      const spatne = await api(base, 'POST', '/api/collections/users/records',
        { body: { email: 'x@example.com', password: PW, passwordConfirm: PW, setup_code: 'SPATNY' } });
      expect(spatne.status >= 400, `${jmeno}: špatný klíč odmítnut`);
      const dobre = await api(base, 'POST', '/api/collections/users/records',
        { body: { email: 'admin@example.com', password: PW, passwordConfirm: PW, setup_code: KOD } });
      expect(dobre.status === 200 && dobre.json.role === 'admin', `${jmeno}: správný klíč pustí admina`);
    }

    console.log('== ochrana hostované instance platí i po staru ==');
    const auth = await api(S, 'POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: PW } });
    const token = auth.json.token;
    const ssrf = await api(S, 'POST', '/api/flowmap/ai-test', { token, body: { provider: 'custom', url: 'http://169.254.169.254/' } });
    expect(/privátní|private/i.test(ssrf.json?.message || ''), 'FLOWMAP_HOSTED=1 pořád blokuje privátní cíle');

    console.log('== vydávané tokeny mají nový tvar, staré ale platí ==');
    const klic = await api(S, 'POST', '/api/kb/api-keys', { token, body: { label: 'prechod', scope: 'read_write' } });
    expect(/^kb_user_/.test(klic.json?.token || ''), `nový API klíč začíná kb_user_ (${(klic.json?.token || '').slice(0, 8)}…)`);
    const v1 = await fetch(`${S}/api/kb/v1/maps`, { headers: { Authorization: `Bearer ${klic.json.token}` } });
    expect(v1.status === 200, `nový klíč funguje na v1 API (${v1.status})`);

    console.log('== staré tokeny a staré cesty platí dál ==');
    // API klíč vydaný PŘED přejmenováním: v databázi je jen OTISK, takže ho nejde
    // „přepsat na nový" — musí platit dál, jinak přestane fungovat MCP i skripty zákazníků.
    //
    // ⚠️ Dřív se tu jen ověřovalo, že starý tvar vrátí 401 „až na ověření". To
    // nedokazovalo NIC: nesmyslný tvar vrací 401 taky. Test proto starý klíč
    // opravdu ZALOŽÍ — vloží jeho otisk do api_keys tak, jak tam ležel loni —
    // a zkusí s ním sáhnout na data. (Nález kontrolního panelu.)
    const staryKlic = 'fm_user_' + 'a'.repeat(40);
    const otisk = crypto.createHash('sha256').update(staryKlic).digest('hex');
    execSync(`docker exec ${STARY.name} /app/pocketbase superuser upsert spravce@example.com heslo12345 2>/dev/null`, { stdio: 'ignore' });
    const su = await api(S, 'POST', '/api/collections/_superusers/auth-with-password',
      { body: { identity: 'spravce@example.com', password: 'heslo12345' } });
    const majitel = await api(S, 'GET', '/api/collections/users/records?perPage=1', { token: su.json?.token });
    const vlozeno = await api(S, 'POST', '/api/collections/api_keys/records', {
      token: su.json?.token,
      body: { owner: majitel.json?.items?.[0]?.id, token_hash: otisk, label: 'klíč z doby před přejmenováním' },
    });
    expect(vlozeno.status === 200, `starý klíč se podařilo nasimulovat v databázi (${vlozeno.status})`);

    for (const cesta of ['/api/kb/v1/maps', '/api/flowmap/v1/maps']) {
      const r = await fetch(`${S}${cesta}`, { headers: { Authorization: `Bearer ${staryKlic}` } });
      expect(r.status === 200, `starý klíč fm_user_… OPRAVDU funguje na ${cesta} (${r.status})`);
    }
    const nesmysl = await fetch(`${S}/api/kb/v1/maps`, { headers: { Authorization: 'Bearer fm_user_' + 'z'.repeat(40) } });
    expect(nesmysl.status === 401, `neexistující klíč ve stejném tvaru je odmítnut (${nesmysl.status}) — kontrola, že test neměří jen tvar`);

    const starýCallback = await fetch(`${S}/api/flowmap/agent-callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run_token: 'fmr_' + 'b'.repeat(40) }),
    });
    expect(starýCallback.status === 401, `stará callback cesta žije (${starýCallback.status} = došla až na ověření tokenu)`);

    console.log('== export z dřívější verze musí jít naimportovat ==');
    const stary_export = {
      format: 'flowmap.map/1',
      map: { title: 'Projekt z předchozí verze', description: '',
        nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } }],
        edges: [] },
      tasks: [],
    };
    const imp = await api(S, 'POST', '/api/kb/map-import', { token, body: stary_export });
    expect(imp.status === 200, `starý export se naimportuje (${imp.status})`);
    expect(imp.json?.nodes_imported === 1, 'a data v něm sedí');
  } catch (e) {
    fail++; console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    for (const inst of [STARY, NOVY]) execSync(`docker rm -f ${inst.name} 2>/dev/null; true`);
  }
  console.log(`\n${pass} OK, ${fail} chyb`);
  process.exit(fail ? 1 : 0);
})();
