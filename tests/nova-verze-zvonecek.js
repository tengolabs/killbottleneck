// Po aktualizaci má do zvonečku přijít zpráva o nové verzi.
//
// Richard 18. 8. 2026: „když vydáme novou verzi, aby přišlo do zvonečku info
// nová verze a novinky."
//
// Nejdůležitější tvrzení sady: PODRUHÉ SE TO NEPOŠLE. Kontejner se restartuje
// běžně (aktualizace, pád, ruční zásah) a zvoneček plný „nová verze" by byl
// horší než žádné oznámení. Hlídá to dedup klíč s verzí, ne příznak stranou.
const { execSync } = require('child_process');

const NAME = 'kb-e2e-nova-verze';
const PORT = 20538;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SU = { email: 'su@example.com', pw: 'superheslo123' };

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

const spust = (env) => {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${env} -v ${NAME}-data:/app/pb_data ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
};
const restartuj = (env) => {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${env} -v ${NAME}-data:/app/pb_data ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
};
const pockej = async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* startuje */ } await sleep(1000); }
  return false;
};
const zvonecek = async (token) => {
  const r = await api('GET', '/api/collections/notifications/records?perPage=50&sort=-created', { token });
  return (r.json.items || []).filter((n) => n.type === 'new_version');
};

(async () => {
  try {
    execSync(`docker volume rm -f ${NAME}-data 2>/dev/null; true`);

    console.log('== účet vznikne na verzi v0.40 ==');
    spust('-e KB_VERSION=v0.40');
    ok(await pockej(), 'instance na v0.40 naběhla');
    await api('POST', '/api/collections/users/records', { body: { email: 'a@example.com', password: PW, passwordConfirm: PW } });
    let auth = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@example.com', password: PW } });
    const token = auth.json.token;

    console.log('== aktualizace na v0.41 → zpráva ve zvonečku ==');
    restartuj('-e KB_VERSION=v0.41');
    ok(await pockej(), 'instance po aktualizaci naběhla');
    await sleep(2500);   // bootstrap běží po startu
    const po = await zvonecek(token);
    ok(po.length === 1, `přišla právě jedna zpráva o nové verzi (${po.length})`);
    ok(po[0] && /v0\.41/.test(po[0].text || ''), `nese číslo verze (${po[0] && po[0].text})`);
    ok(po[0] && !/github\.com/.test(po[0].text || ''),
      'BEZ odkazu na anglický changelog — ten byl moc dlouhý a v angličtině');
    ok(po[0] && po[0].read === false, 'je nepřečtená, takže zvoneček ji ukáže');

    console.log('== restart na TÉŽE verzi nesmí poslat nic navíc ==');
    restartuj('-e KB_VERSION=v0.41');
    ok(await pockej(), 'instance po restartu naběhla');
    await sleep(2500);
    const poRestartu = await zvonecek(token);
    ok(poRestartu.length === 1, `pořád jen jedna zpráva (${poRestartu.length}) — restart nikoho nezasype`);

    console.log('== další vydání → další zpráva ==');
    restartuj('-e KB_VERSION=v0.42');
    ok(await pockej(), 'instance na v0.42 naběhla');
    await sleep(2500);
    const dalsi = await zvonecek(token);
    ok(dalsi.length === 2, `o dalším vydání se ví taky (${dalsi.length})`);

    console.log('== vývojový build se neoznamuje ==');
    restartuj('-e KB_VERSION=v0.42-3-gabc1234-dirty');
    ok(await pockej(), 'instance na rozpracovaném buildu naběhla');
    await sleep(2500);
    const poDirty = await zvonecek(token);
    ok(poDirty.length === 2, `rozdělaná práce zvoneček nebudí (${poDirty.length})`);

    console.log('== body novinek pro známou verzi ==');
    // v0.38-beta má body v pb_hooks/novinky.js; ostatní verze dostanou holé
    // oznámení. Nikdy se nic nedomýšlí — co není zapsané, se neposílá.
    execSync(`docker volume rm -f ${NAME}-body 2>/dev/null; true`);
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 -e KB_VERSION=v0.37 -v ${NAME}-body:/app/pb_data ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    ok(await pockej(), 'čistá instance na v0.37 naběhla');
    await api('POST', '/api/collections/users/records', { body: { email: 'b@example.com', password: PW, passwordConfirm: PW } });
    const auth2 = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'b@example.com', password: PW } });
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 -e KB_VERSION=v0.38-beta -v ${NAME}-body:/app/pb_data ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    ok(await pockej(), 'aktualizace na v0.38-beta proběhla');
    await sleep(2500);
    const sBody = await zvonecek(auth2.json.token);
    const txt = (sBody[0] && sBody[0].text) || '';
    ok(sBody.length === 1, `přišla zpráva (${sBody.length})`);
    ok(/•/.test(txt), 'nese odrážky, ne odkaz');
    ok(txt.split(String.fromCharCode(10)).length >= 3, `body jsou na řádcích (${txt.split(String.fromCharCode(10)).length})`);
    ok(!/[Ww]hat's new/.test(txt), 'a je to česky, ne anglicky');
    execSync(`docker volume rm -f ${NAME}-body 2>/dev/null; true`);

    console.log('== pojistka: cron dožene, co bootstrap nestihl ==');
    // onBootstrap běží DŘÍV než migrace, takže vydání, které samo přidává nový
    // typ notifikace, při prvním startu neoznámí nic. Ověřuje se, že ruční
    // spuštění téže cesty (jako to dělá cron) oznámení dopraví — a že přitom
    // NEVZNIKNE druhá kopie pro verzi, která už oznámená je.
    restartuj('-e KB_VERSION=v0.43');
    ok(await pockej(), 'instance na v0.43 naběhla');
    await sleep(2500);
    const pred = await zvonecek(token);
    ok(pred.length === 3, `o v0.43 se ví (${pred.length} zpráv celkem)`);

    // ⚠️ Dřív tu stálo `docker exec … true` a pak tvrzení „nevznikla kopie".
    // To nedokazovalo NIC (nález panelu 19. 8. 2026). Ověřuje se:
    //  a) cron je opravdu zaregistrovaný — na něm stojí celá pojistka pro případ,
    //     že bootstrap běžel dřív než migrace,
    //  b) jeho ruční spuštění oznámení NEZDVOJÍ.
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
    const st = (await api('POST', '/api/collections/_superusers/auth-with-password',
      { body: { identity: SU.email, password: SU.pw } })).json.token;
    const crony = await api('GET', '/api/crons', { token: st });
    const nasCron = (crony.json || []).find((c) => c.id === 'nova_verze');
    ok(!!nasCron, `cron nova_verze je zaregistrovaný (${nasCron ? nasCron.expression : 'CHYBÍ'})`);
    const spusteni = await api('POST', '/api/crons/nova_verze', { token: st });
    ok(spusteni.status === 204 || spusteni.status === 200, `ruční spuštění cronu prošlo (${spusteni.status})`);
    await sleep(1500);
    const znovu = await zvonecek(token);
    ok(znovu.length === pred.length, `a oznámení NEZDVOJIL (${pred.length} → ${znovu.length})`);

    console.log('== e-mailem to nechodí ==');
    // instance nemá SMTP; kdyby oznámení chtělo poslat mail, spadlo by to do logu.
    // Podstatné je, že notifyChannels u typu new_version e-mail vždy zakáže —
    // jinak by z každého vydání byla hromadná pošta všem uživatelům instance.
    const log = execSync(`docker logs ${NAME} 2>&1 | tail -40`).toString();
    ok(!/mail|smtp/i.test(log) || !/new_version/i.test(log), 'v logu není pokus o odeslání mailu');
  } catch (e) {
    fail++;
    console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker volume rm -f ${NAME}-data 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} NOVÁ VERZE PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
