// Nahlásit chybu / nápad — routa /api/kb/report.
//
// ⚠️ ŽÁDNÁ ZPRÁVA NEODEJDE VEN. Test si postaví vlastní SMTP jímku a čte, co jí
// instance podstrčila (vzor maily-jazyk.js). Cíl hlášení se navíc nastavuje
// proměnnou KB_REPORT_TO, kterou tady schválně míříme na example.com — brzda
// je uvnitř odesílající cesty, ne v prostředí testu (feedback z 6. 8. 2026,
// kdy „vypnutí přes prostředí" nefungovalo a testy psaly skutečné zprávy).
//
// Nejdůležitější tvrzení sady: BEZ KB_REPORT_TO routa neexistuje. Na tom stojí
// Richardovo zadání „jen z našich instancí" — cizí self-host nesmí odesílat nic.
const { execSync } = require('child_process');
const H = require('./_harness');
const { ok, sleep, PW } = H;
const SU = { email: 'su@example.com', pw: 'superheslo123' };
const SU2 = SU;
let inst = null, api = null, sink = null, maily = [];
const CIL = 'podpora@example.com';


const qp = (s) => Buffer.from(
  s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
  'binary').toString('utf8');
const dekoduj = (s) => {
  let out = s.replace(/=\?[Uu][Tt][Ff]-8\?[Bb]\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  out = qp(out);
  for (const kus of out.split(/\r?\n\r?\n/)) {
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(kus.trim())) {
      try { out += '\n' + Buffer.from(kus.trim(), 'base64').toString('utf8'); } catch { /* nevadí */ }
    }
  }
  return out;
};

const spust = async (env) => {
  if (inst) inst.stop();
  inst = await H.startInstance({ slug: 'hlaseni', addHostGateway: true, extraArgs: env });
  api = inst.api;
};
const pockej = async () => (await api('GET', '/api/health')).status === 200;
const nastavSmtp = async () => {
  const st = await inst.superuser({ email: SU.email, pw: SU.pw });
  await sink.zapoj(inst, st);
};
const ucet = async (email) => {
  await api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
  return (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;
};

H.beh(async () => {
    sink = await H.smtpSink();
    maily = sink.maily;

    console.log('== BEZ KB_REPORT_TO: funkce vůbec neexistuje ==');
    await spust('');
    ok(await pockej(), 'instance bez KB_REPORT_TO naběhla');
    await nastavSmtp();
    const t0 = await ucet('kdokoli@example.com');
    const cfg0 = await api('GET', '/api/kb/config');
    ok(cfg0.json.report_enabled === false, 'config hlásí report_enabled=false');
    maily.length = 0;
    const r0 = await api('POST', '/api/kb/report', { token: t0, body: { kind: 'chyba', text: 'tohle nesmí nikam odejít' } });
    ok(r0.status === 404, `routa vrací 404, neprozrazuje se (${r0.status})`);
    await sleep(1200);
    ok(maily.length === 0, `a NEODEŠLA žádná zpráva (${maily.length})`);

    console.log('== S KB_REPORT_TO: hlášení dojde ==');
    await spust(`-e KB_REPORT_TO=${CIL} -e KB_VERSION=v0.38-test`);
    ok(await pockej(), 'instance s KB_REPORT_TO naběhla');
    await nastavSmtp();
    const token = await ucet('uzivatel@example.com');
    const cfg = await api('GET', '/api/kb/config');
    ok(cfg.json.report_enabled === true, 'config hlásí report_enabled=true');
    ok(JSON.stringify(cfg.json).indexOf(CIL) === -1, 'cílová adresa se v configu ven NEPOSÍLÁ');

    maily.length = 0;
    const r1 = await api('POST', '/api/kb/report', { token, body: {
      kind: 'chyba', text: 'Tlačítko Uložit nic nedělá <script>alert(1)</script> a & uvozovky "x"', page: '/map/abc', browser: 'Chrome/141',
    } });
    ok(r1.status === 200, `hlášení přijato (${r1.status})`);
    await sleep(1500);
    ok(maily.length === 1, `odešla právě jedna zpráva (${maily.length})`);
    const m = dekoduj(maily[0] || '');
    ok(/podpora@example\.com/.test(m), 'míří na adresu z KB_REPORT_TO');
    // ⚠️ Bez zaškrtnutí „chci odpověď" NESMÍ z instance odejít adresa ani název
    // firmy — Richardovo rozhodnutí 19. 8. 2026. Na opravu programu je nepotřebujeme
    // a bez nich to nejsou osobní údaje.
    ok(!/uzivatel@example\.com/.test(m), 'BEZ souhlasu neodešla adresa pisatele');
    ok(!/Reply-To/i.test(m), 'a ani Reply-To');
    ok(!/127\.0\.0\.1:20534|instance/i.test((m.match(/^Subject:.*$/m) || [''])[0]),
      'předmět neprozrazuje instanci ani firmu');
    ok(/noreply@killbottleneck\.com/.test(m), 'From zůstává noreply (kvůli SPF/DKIM)');
    ok(/Tlačítko Uložit nic nedělá/.test(m), 'text uživatele je ve zprávě');
    // ⚠️ HTML a TEXTOVOU část je nutné posuzovat ZVLÁŠŤ. V HTML musí být
    // uživatelův text escapovaný, v textové verzi naopak syrový — ta se
    // nikde nerenderuje. Test, který to slil dohromady, hlásil chybu tam,
    // kde žádná nebyla (19. 8. 2026).
    const htmlCast = (m.split(/Content-Type:\s*text\/html/i)[1] || '');
    ok(/&lt;script&gt;/.test(htmlCast), 'v HTML části je text uživatele escapovaný');
    ok(!/<script>alert/.test(htmlCast), 'a žádná živá značka tam není');
    // Escapovat se smí JEDNOU. Dvojí escapování dorazí jako „&amp;lt;b&amp;gt;" — a hlášení
    // chyby je přesně ten obsah, kde úryvky kódu a ampersandy chodí (panel 19. 8.).
    ok(!/&amp;(lt|gt|amp|quot);/.test(htmlCast), 'escapuje se jen jednou, ne dvakrát');
    ok(/v0\.38-test/.test(m), 'je vidět verze instance');
    ok(/\/map\/abc/.test(m), 'je vidět, na které stránce to bylo');

    console.log('== se zaškrtnutím „chci odpověď" adresa odejde ==');
    maily.length = 0;
    await api('POST', '/api/kb/report', { token, body: {
      kind: 'chyba', text: 'Tohle je hlášení, na které chci odpověď.', reply: true } });
    await sleep(1500);
    const mo = dekoduj(maily[0] || '');
    ok(/Reply-To:\s*uzivatel@example\.com/i.test(mo), 'Reply-To je adresa pisatele');
    ok(/uzivatel@example\.com/.test(mo), 'a je vidět, kdo psal');

    console.log('== nápad má vlastní předmět ==');
    maily.length = 0;
    await api('POST', '/api/kb/report', { token, body: { kind: 'napad', text: 'Chtělo by to tmavý režim i v tabulce' } });
    await sleep(1500);
    const mn = dekoduj(maily[0] || '');
    ok(/Nápad|Idea/.test(mn), 'předmět rozlišuje nápad od chyby');
    // ⚠️ Serverové i18n dosazuje {klic}, ne {{klic}} jako frontend. Zapsáno
    // frontendovým způsobem projde všude kromě výsledku: v předmětu pak stojí
    // „instance {adresa}" i se závorkami (naraženo při přípravě klik-testu).
    ok(!/\{\s*org\s*\}|\{\{/.test(mn), 'v předmětu nezůstala nedosazená značka');
    // Přísnější než kontrola výše: hodnota se dosadí, ale závorky kolem ní
    // zůstanou („instance {127.0.0.1}"), takže hledat samotné {org} nestačí.
    ok(!/\{[^}\n]*\}/.test((mn.match(/^Subject:.*$/m) || [''])[0]), 'v předmětu nezůstaly složené závorky kolem hodnoty');

    console.log('== snímek obrazovky: dojde jako skutečná příloha ==');
    // Podnět z bety 21. 8. 2026. Snímek jde jako base64 v JSONu a mailem jako
    // SKUTEČNÁ příloha — žádné URL instance (neprozrazovat firmu) ani data: URI
    // (Gmail je zahazuje). Vlastní účet, ať se nepletou kvóty s dřívějšími kroky.
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const ts = await ucet('snimkar@example.com');
    maily.length = 0;
    const rs = await api('POST', '/api/kb/report', { token: ts, body: {
      kind: 'chyba', text: 'Tohle je vidět jen na obrázku.', image_base64: PNG_B64, image_name: 'snimek.png' } });
    ok(rs.status === 200, `hlášení se snímkem přijato (${rs.status} ${rs.json && rs.json.error ? rs.json.error : ''})`);
    await sleep(1500);
    const ms = maily[0] || '';
    ok(/Content-Disposition:\s*attachment/i.test(ms) && /snimek\.png/.test(ms), 'mail nese skutečnou přílohu snimek.png');
    ok(ms.includes('iVBORw0KGgo'), 'a v příloze jsou data obrázku (PNG signatura)');
    ok(!/data:image/i.test(ms), 'žádné data: URI v těle (Gmail je zahazuje)');
    ok(/v příloze|attached/i.test(dekoduj(ms)), 'karta v mailu snímek přiznává');
    // snímek zůstal u záznamu — pisatel ho vidí v „Už jste nahlásili" a při
    // výpadku pošty se neztratí; maže ho prune_reports s celým záznamem
    const seznamS = await api('GET', '/api/collections/reports/records?perPage=5&sort=-created', { token: ts });
    const zaznamS = (seznamS.json.items || [])[0];
    ok(zaznamS && zaznamS.image, `záznam nese soubor (${zaznamS ? zaznamS.image || 'PRÁZDNÉ' : '—'})`);
    if (zaznamS && zaznamS.image) {
      // ⚠️ Soubor je PROTECTED: bez tokenu ho nesmí dostat NIKDO — snímek
      // obrazovky je nejcitlivější věc v kolekci a zásady slibují „jen vy".
      const bez = await fetch(`${inst.base}/api/files/reports/${zaznamS.id}/${zaznamS.image}`);
      ok(bez.status !== 200, `bez file tokenu se snímek NEVYDÁ (${bez.status})`);
      const ftok = (await api('POST', '/api/files/token', { token: ts })).json.token;
      const fr = await fetch(`${inst.base}/api/files/reports/${zaznamS.id}/${zaznamS.image}?token=${ftok}`);
      const bytes = Buffer.from(await fr.arrayBuffer());
      ok(fr.status === 200 && bytes.length > 0 && bytes.slice(1, 4).toString() === 'PNG',
        `s tokenem pisatele jde stáhnout a je to PNG (${fr.status}, ${bytes.length} B)`);
    }

    console.log('== ochrany snímku ==');
    const velky = 'A'.repeat(3 * 1024 * 1024);   // ~2,2 MB po dekódování, limit 2 MB
    const rv = await api('POST', '/api/kb/report', { token: ts, body: { kind: 'chyba', text: 'moc velký obrázek', image_base64: velky, image_name: 'x.png' } });
    ok(rv.status === 400, `moc velký obrázek odmítnut (${rv.status})`);
    const rt = await api('POST', '/api/kb/report', { token: ts, body: { kind: 'chyba', text: 'špatný typ souboru', image_base64: PNG_B64, image_name: 'x.svg' } });
    ok(rt.status === 400, `SVG a jiné ne-rastrové typy odmítnuty (${rt.status})`);
    // garbage base64 nesmí skončit 500 (výjimka z base64 -d) — srozumitelná 400
    const rg = await api('POST', '/api/kb/report', { token: ts, body: { kind: 'chyba', text: 'rozbité base64', image_base64: 'data:image/png;base64,©©©', image_name: 'x.png' } });
    ok(rg.status === 400, `rozbité base64 dostane 400, ne 500 (${rg.status})`);
    // obsah, co neodpovídá příponě (text vydávaný za PNG) — magic bytes ho chytí
    const rf = await api('POST', '/api/kb/report', { token: ts, body: { kind: 'chyba', text: 'binárka vydávaná za obrázek', image_base64: Buffer.from('MZ tohle neni obrazek ale binarka').toString('base64'), image_name: 'x.png' } });
    ok(rf.status === 400, `obsah neodpovídající rastru odmítnut (${rf.status})`);
    // ⚠️ Odmítnutý obrázek NESMÍ užírat kvótu 5/h — validace je před počítáním
    // pokusu. Kdyby užíral, čtvrté z těchto hlášení by dostalo 429.
    let proslo = 0;
    for (let i = 0; i < 4; i++) {
      const r = await api('POST', '/api/kb/report', { token: ts, body: { kind: 'chyba', text: `kontrola kvóty po odmítnutí ${i}` } });
      if (r.status === 200) proslo++;
    }
    ok(proslo === 4, `odmítnuté obrázky neužírají kvótu (prošlo ${proslo}/4)`);

    console.log('== seznam odeslaných hlášení ==');
    // Richard 18. 8. 2026: „ať vím, co už jsem nahlásil a nedělám to znovu."
    const moje = await api('GET', '/api/collections/reports/records?perPage=10&sort=-created', { token });
    ok(moje.status === 200 && moje.json.totalItems >= 2, `svá hlášení si přečtu (${moje.json && moje.json.totalItems})`);
    const posledni = (moje.json.items || [])[0];
    ok(posledni && posledni.sent === true, 'odeslané hlášení má příznak, že odešlo');
    ok(posledni && posledni.version, `nese verzi instance (${posledni && posledni.version})`);
    // cizí hlášení nesmí být vidět — text může být cokoli, včetně stížnosti na kolegu
    const cizi = await ucet('treti@example.com');
    const ciziSeznam = await api('GET', '/api/collections/reports/records?perPage=10', { token: cizi });
    ok(ciziSeznam.json.totalItems === 0, `cizí hlášení nevidím (${ciziSeznam.json.totalItems})`);
    // do kolekce se nesmí psát mimo routu (obešel by se rate limit i odeslání)
    const primo = await api('POST', '/api/collections/reports/records', { token,
      body: { kind: 'chyba', text: 'zápis mimo routu', owner: 'x' } });
    ok(primo.status === 400 || primo.status === 403 || primo.status === 404,
      `přímý zápis do kolekce neprojde (${primo.status})`);

    console.log('== ochrany ==');
    const bezPrihlaseni = await api('POST', '/api/kb/report', { body: { kind: 'chyba', text: 'anonymní pokus' } });
    ok(bezPrihlaseni.status === 401 || bezPrihlaseni.status === 403,
      `bez přihlášení to nejde (${bezPrihlaseni.status})`);
    const prazdne = await api('POST', '/api/kb/report', { token, body: { kind: 'chyba', text: 'ne' } });
    ok(prazdne.status === 400, `prázdné/krátké hlášení odmítnuto (${prazdne.status})`);

    maily.length = 0;
    let limit = 0;
    for (let i = 0; i < 6; i++) {
      const r = await api('POST', '/api/kb/report', { token, body: { kind: 'chyba', text: `opakované hlášení ${i}` } });
      if (r.status === 429) limit++;
    }
    ok(limit > 0, `po pěti hlášeních za hodinu přijde 429 (${limit}× odmítnuto)`);

    console.log('== úklid: hlášení se nedrží navěky ==');
    // Zásady soukromí slibují tři roky; bez téhle úlohy by tam ležela navždy
    // a slib by byl prázdný (panel 19. 8. 2026).
    const crony2 = await api('GET', '/api/crons', { token: (await api('POST',
      '/api/collections/_superusers/auth-with-password',
      { body: { identity: SU2.email, password: SU2.pw } })).json.token });
    const stToken = (await api('POST', '/api/collections/_superusers/auth-with-password',
      { body: { identity: SU2.email, password: SU2.pw } })).json.token;
    const uklid = (crony2.json || []).find((c) => c.id === 'prune_reports');
    ok(!!uklid, `úklidová úloha prune_reports existuje (${uklid ? uklid.expression : 'CHYBÍ'})`);

    // ⚠️ „Cron existuje" nedokazuje, že něco maže. Datum se přepíše PŘÍMO
    // V DATABÁZI (přes API to nejde, `created` je autodate), pak se úloha
    // spustí: starý záznam musí zmizet, čerstvý zůstat. Bez druhé půlky by
    // prošel i dotaz, který smaže všechno.
    // Richard 19. 8. 2026 zkrátil dobu ze tří let na 30 dnů.
    await api('POST', '/api/kb/report', { token, body: { kind: 'napad', text: 'cerstvy zaznam musi zustat' } });
    await sleep(800);
    inst.pause();
    const tmp = `/tmp/kb-ret-${process.pid}.db`;
    execSync(`docker cp ${inst.name}:/app/pb_data/data.db ${tmp}`, { stdio: 'ignore' });
    // starý = všechno kromě posledního; python3 je na stroji, sqlite3 binárka ne
    const skript = `/tmp/kb-ret-${process.pid}.py`;
    require('fs').writeFileSync(skript, [
      'import sqlite3, sys',
      "c = sqlite3.connect(sys.argv[1])",
      "ids = [r[0] for r in c.execute('SELECT id FROM reports ORDER BY created').fetchall()][:-1]",
      "for i in ids: c.execute(\"UPDATE reports SET created='2020-01-01 00:00:00.000Z' WHERE id=?\", (i,))",
      'c.commit(); c.close()',
    ].join('\n'));
    execSync(`python3 ${skript} ${tmp}`, { stdio: 'ignore' });
    execSync(`rm -f ${skript}`, { stdio: 'ignore' });
    execSync(`docker cp ${tmp} ${inst.name}:/app/pb_data/data.db`, { stdio: 'ignore' });
    execSync(`rm -f ${tmp}`, { stdio: 'ignore' });
    await inst.resume(); // port se po startu mění — resume ho přečte znovu
    const st2 = (await api('POST', '/api/collections/_superusers/auth-with-password',
      { body: { identity: SU2.email, password: SU2.pw } })).json.token;
    const predUklidem = (await api('GET', '/api/collections/reports/records?perPage=200', { token: st2 })).json;
    ok(predUklidem.totalItems >= 2, `je co uklízet (${predUklidem.totalItems} záznamů, z toho staré)`);
    // ⚠️ Úklid musí smazat i SOUBORY snímků ze storage — surové SQL je nechávalo
    // ležet na disku navždy (nález panelu 24. 8. 2026); proto se maže přes záznamy.
    const souboruPredUklidem = parseInt(execSync(`docker exec ${inst.name} sh -c "find /app/pb_data/storage -type f 2>/dev/null | wc -l"`).toString().trim(), 10);
    ok(souboruPredUklidem >= 1, `před úklidem je ve storage aspoň snímek (${souboruPredUklidem})`);
    await api('POST', '/api/crons/prune_reports', { token: st2 });
    await sleep(1500);
    const poUklidu = (await api('GET', '/api/collections/reports/records?perPage=200', { token: st2 })).json;
    ok(poUklidu.totalItems === 1, `úklid smazal STARÉ (${predUklidem.totalItems} → ${poUklidu.totalItems})`);
    const souboruPoUklidu = parseInt(execSync(`docker exec ${inst.name} sh -c "find /app/pb_data/storage -type f 2>/dev/null | wc -l"`).toString().trim(), 10);
    ok(souboruPoUklidu < souboruPredUklidem,
      `a zmizely i soubory snímků ze storage (${souboruPredUklidem} → ${souboruPoUklidu})`);
    const zbyl = (poUklidu.items || [])[0];
    ok(zbyl && !zbyl.created.startsWith('2020'),
      `a čerstvý záznam NECHAL — dotaz nemaže všechno (zbyl z ${zbyl ? zbyl.created.slice(0, 10) : '—'})`);

    console.log('== stará cesta /api/flowmap/report ==');
    const t2 = await ucet('druhy@example.com');
    const stara = await api('POST', '/api/flowmap/report', { token: t2, body: { kind: 'chyba', text: 'přes starou cestu' } });
    ok(stara.status === 200, `stará cesta funguje taky (${stara.status})`);
}, { nazev: 'HLÁŠENÍ' });
