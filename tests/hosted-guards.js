// Ochrany HOSTOVANÉ instance (FLOWMAP_HOSTED=1) + měkký výpadek AI.
//
// Proč zvlášť: na sdíleném boxu Cloud Lite běží vedle sebe kontejnery cizích
// zákazníků a metadata služba poskytovatele. Admin instance = ZÁKAZNÍK, ne
// správce železa, takže mu server nesmí dovolit poslat požadavek na privátní
// adresu (test připojení k AI = jinak pohodlný skener vnitřní sítě).
//
// Druhá polovina sady hlídá OPAČNÝ default pro self-host: bez FLOWMAP_HOSTED
// musí ollama na 172.17.0.1 / v LAN dál projít, jinak by aktualizace tiše
// rozbila existující domácí instalace (je to tak i v README).
const { execSync } = require('child_process');
const HN = require('./_harness');
const { expect, sleep, PW } = HN;

const HOSTED = { name: null, slug: 'hosted' };
const SELFHOST = { name: null, slug: 'selfhost' };
const SETUP_CODE = 'FM-TEST-KOD1';
const api = HN.apiBaseFirst();

// vrací base URL (sada je psaná base-first); jméno kontejneru pro docker cp/stop/start
async function start(inst, env) {
  const i = await HN.startInstance({ slug: inst.slug, extraArgs: env });
  inst.name = i.name;
  inst.inst = i;
  return i.base;
}

const register = (base, email, extra = {}) =>
  api(base, 'POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW, ...extra } });
const login = async (base, email) => {
  const r = await api(base, 'POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
  if (r.status !== 200) throw new Error(`přihlášení selhalo: ${r.status}`);
  return r.json.token;
};

HN.beh(async () => {
    // ── hostovaná instance ────────────────────────────────────────────────
    console.log('== hostovaná instance (FLOWMAP_HOSTED=1) ==');
    // --add-host = podvržené DNS pro past na rebinding (níž). Přes /etc/hosts,
    // protože getent i Go resolver ho čtou první — sada tak nezávisí na veřejném
    // DNS a běží i offline. `verejne.test` je KONTROLA opačným směrem.
    let H = await start(HOSTED, `-e FLOWMAP_HOSTED=1 -e FLOWMAP_SETUP_CODE=${SETUP_CODE}`
      + ' --add-host benigni.test:10.0.0.5'
      + ' --add-host benigni6.test:fd00::1'
      + ' --add-host verejne.test:93.184.216.34');

    let r = await register(H, 'admin@example.com');
    expect(r.status !== 200, `bez aktivačního kódu registrace neprojde (${r.status})`);
    r = await register(H, 'admin@example.com', { setup_code: SETUP_CODE });
    expect(r.status === 200 && r.json.role === 'admin', 'se správným kódem vznikne admin');
    const A = await login(H, 'admin@example.com');

    console.log('-- SSRF: test připojení k AI --');
    // Zápisy, kterými guard PROPOUŠTĚL (nález kontrolního panelu): IPv6 tvary,
    // IPv4 zabalená do IPv6, adresa schovaná ve jméně a interní jména poskytovatelů.
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5:8090/api/health',
                       'http://127.0.0.1:8090/api/health', 'http://192.168.1.1/', 'http://172.17.0.1:11434',
                       'http://[::1]:8090/x', 'http://[::ffff:169.254.169.254]/latest/meta-data/',
                       'http://[fd00::1]:8090/', 'http://[fe80::1]/',
                       'http://169.254.169.254.nip.io/latest/meta-data/',
                       'http://10-0-0-5.nip.io:8090/', 'http://metadata.google.internal/',
                       'http://metadata/computeMetadata/v1/', 'http://neco.internal/']) {
      const t = await api(H, 'POST', '/api/flowmap/ai-test', { token: A, body: { provider: 'custom', url } });
      const blocked = t.status === 200 && t.json && t.json.ok === false && /privátní|private/i.test(t.json.message || '');
      expect(blocked, `privátní cíl odmítnut: ${url}`);
    }
    const pub = await api(H, 'POST', '/api/flowmap/ai-test', { token: A, body: { provider: 'custom', url: 'https://example.com' } });
    expect(pub.status === 200 && !/privátní|private/i.test(pub.json?.message || ''),
      'veřejná adresa guardem neprojde jako privátní (dosažitelnost neřešíme)');

    console.log('-- SSRF: DNS rebinding --');
    // Past z reálného průniku 5. 8. 2026: jméno BEZ privátního vzorku, které se
    // teprve v resolveru přeloží na privátní adresu. Guard porovnával jen ZÁPIS
    // adresy, takže tudy prošlo a zákazník měl z vlastní instance skener sítě.
    // Oprava (prelozenyHost v helpers.js) jméno překládá a rozhoduje o VÝSLEDKU.
    for (const url of ['http://benigni.test:8090/api/health', 'https://benigni6.test/x']) {
      const t = await api(H, 'POST', '/api/flowmap/ai-test', { token: A, body: { provider: 'custom', url } });
      const blocked = t.status === 200 && t.json && t.json.ok === false && /privátní|private/i.test(t.json.message || '');
      expect(blocked, `jméno přeložené do privátní sítě odmítnuto: ${url}`);
    }
    // Uložit se taková adresa nesmí taky — jinak by ji volaly crony (sumáře),
    // kde už žádný test připojení nestojí.
    let reb = await api(H, 'POST', '/api/flowmap/ai-settings', { token: A, body: { provider: 'custom', url: 'https://benigni.test/v1/advisor' } });
    expect(reb.status === 400, `rebinding adresu nejde ani ULOŽIT (${reb.status})`);
    // ⚠️ KONTROLA OPAČNÝM SMĚREM. Bez ní by sadu splnil i guard, který blokuje
    // úplně všechno — a to je jedna ze tří pastí vždy-zelených testů.
    reb = await api(H, 'POST', '/api/flowmap/ai-settings', { token: A, body: { provider: 'custom', url: 'https://verejne.test/v1/advisor' } });
    expect(reb.status === 200, `jméno přeložené na VEŘEJNOU adresu se uloží (${reb.status})`);
    // Nepřeložitelné jméno není „privátní" — ať zákazník s překlepem dostane
    // hlášku o nedostupné službě, ne o zakázané síti.
    const typo = await api(H, 'POST', '/api/flowmap/ai-test', { token: A, body: { provider: 'custom', url: 'https://neexistuje.invalid/x' } });
    expect(typo.status === 200 && !/privátní|private/i.test(typo.json?.message || ''),
      'nepřeložitelné jméno se nehlásí jako privátní');

    console.log('-- SSRF: uložení nastavení AI --');
    let s = await api(H, 'POST', '/api/flowmap/ai-settings', { token: A, body: { provider: 'ollama', url: 'http://172.17.0.1:11434' } });
    expect(s.status === 400, `privátní adresu nejde ani ULOŽIT (${s.status}) — jinak by ji volal cron`);
    s = await api(H, 'POST', '/api/flowmap/ai-settings', { token: A, body: { provider: 'custom', url: 'https://ai.example.com/v1/advisor', transcribe_url: 'http://10.1.2.3/whisper' } });
    expect(s.status === 400, `privátní adresa přepisu se kontroluje taky (${s.status})`);
    s = await api(H, 'POST', '/api/flowmap/ai-settings', { token: A, body: { provider: 'custom', url: 'https://ai.example.com/v1/advisor' } });
    expect(s.status === 200, 'veřejná adresa se uloží normálně');

    console.log('-- SSRF: adresa podvržená AŽ PO uložení (TOCTOU) --');
    // Kontrola při uložení nestačí: záznam se dá změnit i mimo /ai-settings
    // (přímý zápis do DB, data z doby před zavedením kontroly). /advisor proto
    // musí adresu ověřit znovu těsně před odesláním. Nejdřív OPAČNÝ SMĚR:
    // s veřejnou adresou nesmí /advisor hlásit „privátní" (past vždy-zelených).
    let adv = await api(H, 'POST', '/api/flowmap/advisor', { token: A, body: { mode: 'chat', message: 'ahoj', map: { nodes: [], edges: [] } } });
    expect(!/privátní|private/i.test(JSON.stringify(adv.json || {})),
      `veřejná adresa se v /advisor nehlásí jako privátní (${adv.status})`);
    // Teď se uložená adresa přepíše PŘÍMO V DATABÁZI na metadata službu —
    // stejný postup jako v hlaseni-chyby.js (python3 je na stroji, sqlite3 v image není).
    HOSTED.inst.pause();
    const dbTmp = `/tmp/kb-toctou-${process.pid}.db`;
    execSync(`docker cp ${HOSTED.name}:/app/pb_data/data.db ${dbTmp}`, { stdio: 'ignore' });
    const pySkript = `/tmp/kb-toctou-${process.pid}.py`;
    require('fs').writeFileSync(pySkript, [
      'import sqlite3, sys',
      'c = sqlite3.connect(sys.argv[1])',
      'c.execute("UPDATE ai_settings SET url=\'http://169.254.169.254/latest\'")',
      'c.commit(); c.close()',
    ].join('\n'));
    execSync(`python3 ${pySkript} ${dbTmp}`, { stdio: 'ignore' });
    execSync(`docker cp ${dbTmp} ${HOSTED.name}:/app/pb_data/data.db`, { stdio: 'ignore' });
    execSync(`rm -f ${pySkript} ${dbTmp}`, { stdio: 'ignore' });
    H = await HOSTED.inst.resume(); // port se po startu mění — resume vrací nový base
    const A2 = await login(H, 'admin@example.com');
    adv = await api(H, 'POST', '/api/flowmap/advisor', { token: A2, body: { mode: 'chat', message: 'ahoj', map: { nodes: [], edges: [] } } });
    expect(adv.status === 503 && /privátní|private/i.test(JSON.stringify(adv.json || {})),
      `podvržená privátní adresa se odmítne i V OKAMŽIKU VOLÁNÍ (${adv.status})`);
    // uklidit po sobě: vrátit veřejnou adresu, ať navazující kroky sady nestaví na podvrhu
    await api(H, 'POST', '/api/flowmap/ai-settings', { token: A2, body: { provider: 'custom', url: 'https://ai.example.com/v1/advisor' } });

    console.log('-- brzda na hádání aktivačního kódu --');
    // Server počítá pokusy v PEVNÉM 10minutovém kyblíku (floor(now/600000)). Když série
    // špatných pokusů přeteče přes hranici okna, správný kód už padne do nového (prázdného)
    // kyblíku a kontrola níž zčervená — 2× v plné regresi 27. 8. (běhy kolem 13:00 a 13:30).
    // Proto před sekcí počkat, je-li hranice okna blíž než 30 s.
    const doOkna = 600000 - (Date.now() % 600000);
    if (doOkna < 30000) { console.log(`   (hranice 10min okna za ${Math.round(doOkna / 1000)} s — čekám)`); await sleep(doOkna + 500); }
    let limited = 0, rejected = 0;
    for (let i = 0; i < 14; i++) {
      const bad = await register(H, `utok${i}@example.com`, { setup_code: 'FM-XXXX-XXXX' });
      const msg = JSON.stringify(bad.json || {});
      if (/mnoho|many/i.test(msg)) limited++; else rejected++;
    }
    expect(rejected > 0 && limited > 0, `po sérii špatných kódů se zapne brzda (odmítnuto ${rejected}, přibrzděno ${limited})`);
    const ok = await register(H, 'kolega@example.com', { setup_code: SETUP_CODE });
    expect(ok.status !== 200, 'brzda drží i pro správný kód ze stejné IP (okno 10 min)');

    console.log('-- měkký výpadek AI --');
    // Sonda se dělá jen tam, kde známe kontrakt: `api` (naše brána) a `ollama`.
    // U `custom` (vlastní endpoint zákazníka) vědomě NEsondujeme → healthy zůstává
    // true, protože „nevím" nesmí schovat funkční AI.
    let cfg = await api(H, 'GET', '/api/flowmap/config');
    expect(cfg.json && typeof cfg.json.ai_healthy === 'boolean', 'config hlásí ai_healthy');
    expect(cfg.json.ai_healthy === true, 'u vlastního endpointu se nesonduje → „nevím" = zdravé');

    await api(H, 'POST', '/api/flowmap/ai-settings', { token: A, body: { provider: 'api', url: 'https://ai-sluzba.invalid/v1/advisor' } });
    cfg = await api(H, 'GET', '/api/flowmap/config');
    expect(cfg.status === 200, 'config odpovídá i při nedostupné AI (appka jede dál)');
    expect(cfg.json.ai_healthy === false, 'nedosažitelná AI služba = ai_healthy false, ne chyba requestu');
    expect(Array.isArray(cfg.json.ai_modes), 'módy se pořád vracejí (rozhodnutí dělá frontend)');

    // ── self-host ─────────────────────────────────────────────────────────
    console.log('\n== self-host (bez FLOWMAP_HOSTED) ==');
    const S = await start(SELFHOST, '');
    await register(S, 'admin@example.com');
    const SA = await login(S, 'admin@example.com');
    const t2 = await api(S, 'POST', '/api/flowmap/ai-test', { token: SA, body: { provider: 'ollama', url: 'http://172.17.0.1:11434' } });
    expect(!/privátní|private/i.test(t2.json?.message || ''), 'lokální ollama se na self-hostu NEBLOKUJE (regrese README nastavení)');
    const s2 = await api(S, 'POST', '/api/flowmap/ai-settings', { token: SA, body: { provider: 'ollama', url: 'http://172.17.0.1:11434' } });
    expect(s2.status === 200, 'a jde i uložit');
}, { nazev: 'HOSTED GUARDS' });
